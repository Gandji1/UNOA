import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Grades, credits and juries: inherited and programme-specific rule sets,
// provisional then validated grades, re-evaluation with reasons, jury quorum,
// computed decisions, signed minutes, publication calendar, credits awarded and
// capitalised, appeal, rectification by amendment, second session, sealed
// transcript, invariants detecting a silent change. Runs after the students fixture.
export async function exerciseGrades({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id, parent_id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [cohort] } = await database.query(`SELECT cohort.id, cohort.owner_scope_id, cohort.version_id, cohort.academic_year, cohort.institution_id FROM unoa.cohort
    WHERE unoa.scope_within(cohort.owner_scope_id, $1) ORDER BY cohort.created_at LIMIT 1`, [univ.id]);
  assert.ok(cohort, 'une cohorte existe (recette scolarité)');
  const names = ['author', 'publisher', 'enterer', 'validator', 'organiser', 'president', 'member', 'absent', 'reviewer', 'outsider', 's1', 's2', 's3'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('grd_policy'), ('grd_enter'), ('grd_validate'), ('grd_jury'), ('grd_appeal');
    INSERT INTO unoa.role_permission VALUES ('grd_policy', 'grd.read'), ('grd_policy', 'grd.policy'), ('grd_enter', 'grd.read'), ('grd_enter', 'grd.enter'),
      ('grd_validate', 'grd.read'), ('grd_validate', 'grd.validate'), ('grd_jury', 'grd.read'), ('grd_jury', 'grd.jury'), ('grd_appeal', 'grd.read'), ('grd_appeal', 'grd.appeal');
  `);
  const roles = { author: 'grd_policy', publisher: 'grd_policy', enterer: 'grd_enter', validator: 'grd_validate', organiser: 'grd_jury', reviewer: 'grd_appeal' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Notes ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'grd-' + name, id]);
    // The territory-level rule set is written above the establishment (inheritance).
    if (roles[name]) await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)',
      [id, name === 'author' || name === 'publisher' ? univ.parent_id : univ.id, roles[name]]);
  }
  // Test-only: a period with two units, three validated registrations.
  const period = randomUUID(); const n1 = randomUUID(); const n2 = randomUUID();
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.program_period(id, version_id, ordinal, label) VALUES ('${period}', '${cohort.version_id}', 7, 'Semestre notes (test)');
    INSERT INTO unoa.teaching_unit(id, version_id, period_id, code, title, credits, coefficient) VALUES
      ('${n1}', '${cohort.version_id}', '${period}', 'N1', 'Algorithmique', 6, 2), ('${n2}', '${cohort.version_id}', '${period}', 'N2', 'Réseaux', 3, 1);
    COMMIT;`);
  const registrations = {};
  for (const name of ['s1', 's2', 's3']) {
    const student = randomUUID(); registrations[name] = randomUUID();
    await database.query("INSERT INTO unoa.student(id, account_id, institution_id, matricule, created_by) VALUES ($1, $2, $3, $4, $5)",
      [student, ids[name], cohort.institution_id, 'NOTES-' + name.toUpperCase(), ids.organiser]);
    await database.query(`INSERT INTO unoa.registration(id, student_id, cohort_id, academic_year, kind, state, created_by, decided_by, decided_at)
      VALUES ($1, $2, $3, $4, 'first', 'validated', $5, $6, now())`, [registrations[name], student, cohort.id, cohort.academic_year, ids.organiser, ids.validator]);
    await database.query("INSERT INTO unoa.course_registration(registration_id, unit_id) VALUES ($1, $2), ($1, $3)", [registrations[name], n1, n2]);
  }
  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('grd-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/grd/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: { Cookie: cookies[who] } });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => {
    const result = await response;
    assert.equal(result.status, expected, label + (result.status === expected ? '' : ' — ' + await result.text()));
  };
  const today = new Date().toISOString().slice(0, 10);
  const policyFor = async () => (await database.query('SELECT unoa.grading_policy_for($1, current_date) AS id', [cohort.id])).rows[0].id;

  // 1. Rule sets: territory default, programme-specific override, author ≠ publisher, immutable.
  const base = { label: 'Règle pays (test)', scaleMax: 20, passMark: 10, unitPassMark: 10, rounding: 'half_up', decimals: 2, resit: true, resitRule: 'best', juryQuorum: 3, appealDays: 15, effectiveFrom: today };
  await status(post('policy', 'outsider', { scopeId: univ.parent_id, ...base }), 403, 'règle réservée');
  await status(post('policy', 'author', { scopeId: univ.parent_id, ...base, passMark: 30 }), 422, 'seuil hors échelle');
  await status(post('policy', 'author', { scopeId: univ.parent_id, ...base, compensation: true }), 400, 'plancher de compensation exigé');
  const territory = (await okay(await post('policy', 'author', { scopeId: univ.parent_id, ...base }))).policyId;
  assert.equal(await policyFor(), null, 'brouillon sans effet');
  await status(post('publish-policy', 'author', { policyId: territory }), 403, 'publication par une autre personne');
  await okay(await post('publish-policy', 'publisher', { policyId: territory }));
  assert.equal(await policyFor(), territory, 'règle héritée du pays');
  const specific = (await okay(await post('policy', 'author', { scopeId: univ.parent_id, programVersionId: cohort.version_id, ...base, label: 'Règle formation (test)',
    compensation: true, compensationFloor: 7, juryQuorum: 2 }))).policyId;
  await okay(await post('publish-policy', 'publisher', { policyId: specific }));
  assert.equal(await policyFor(), specific, 'la règle de la formation l’emporte');
  await assert.rejects(database.query('UPDATE unoa.grading_policy SET pass_mark = 8 WHERE id = $1', [specific]), /immutable/, 'règle publiée immuable');

  // 2. Provisional grades, re-evaluation with a reason, validation by another person.
  const grade = (who, name, unitId, data) => post('grade', who, { registrationId: registrations[name], unitId, session: 'first', ...data });
  await status(grade('outsider', 's1', n1, { mark: 12 }), 403, 'saisie réservée');
  await status(grade('enterer', 's1', n1, { mark: 25 }), 400, 'au-dessus de l’échelle');
  await okay(await grade('enterer', 's1', n1, { mark: 14 }));
  await okay(await grade('enterer', 's1', n2, { mark: 7 }));
  await status(grade('enterer', 's1', n2, { mark: 8 }), 400, 'motif exigé pour une modification');
  await okay(await grade('enterer', 's1', n2, { mark: 8, reason: 'Erreur de report (test)' }));
  await okay(await grade('enterer', 's2', n1, { mark: 12 }));
  await okay(await grade('enterer', 's2', n2, { mark: 5 }));
  await okay(await grade('enterer', 's3', n1, { mark: 15 }));
  await okay(await grade('enterer', 's3', n2, { absence: 'justified' }));
  const history = await okay(await get(`/api/v1/grd/history?registrationId=${registrations.s1}&unitId=${n2}`, 'validator'));
  assert.deepEqual(history.entries.map(item => Number(item.mark)), [7, 8], 'historique complet');
  await status(post('validate', 'enterer', { registrationId: registrations.s1, unitId: n1, session: 'first' }), 403, 'validation réservée');
  await okay(await post('validate', 'validator', { registrationId: registrations.s1, unitId: n1, session: 'first' }));
  await status(post('validate', 'validator', { registrationId: registrations.s1, unitId: n1, session: 'first' }), 409, 'déjà validée');

  // 3. Jury: no second session first, members, quorum, only validated grades.
  await status(post('juries', 'organiser', { cohortId: cohort.id, periodId: period, session: 'resit', publishAt: new Date(Date.now() - 60_000).toISOString() }), 422, 'seconde session après la première');
  await status(post('juries', 'enterer', { cohortId: cohort.id, periodId: period, publishAt: new Date().toISOString() }), 403);
  const jury = (await okay(await post('juries', 'organiser', { cohortId: cohort.id, periodId: period, session: 'first', publishAt: new Date(Date.now() + 864e5).toISOString() }))).juryId;
  await okay(await post('calendar', 'organiser', { juryId: jury, publishAt: new Date(Date.now() - 60_000).toISOString() }));
  for (const [name, role] of [['president', 'president'], ['member', 'member'], ['absent', 'member']]) await okay(await post('members', 'organiser', { juryId: jury, accountId: ids[name], role }));
  await status(post('members', 'organiser', { juryId: jury, accountId: ids.member, role: 'president' }), 409, 'un seul président');
  await status(post('deliberate', 'member', { juryId: jury, present: [ids.president, ids.member] }), 403, 'délibération par le président');
  await status(post('deliberate', 'president', { juryId: jury, present: [ids.president, ids.member] }), 422, 'notes provisoires restantes');
  for (const unitId of [n1, n2]) await okay(await post('validate-all', 'validator', { cohortId: cohort.id, unitId, session: 'first' }));
  await status(post('deliberate', 'president', { juryId: jury, present: [] }), 422, 'quorum non atteint');
  await status(post('deliberate', 'president', { juryId: jury, present: [ids.outsider, ids.member] }), 422, 'présent non membre');
  await okay(await post('deliberate', 'president', { juryId: jury, present: [ids.president, ids.member], minutes: 'Délibération de test.' }));
  let details = await okay(await get(`/api/v1/grd/juries/${jury}`, 'member'));
  const outcome = name => details.decisions.find(item => item.registration_id === registrations[name]);
  assert.deepEqual([outcome('s1').outcome, Number(outcome('s1').credits), Number(outcome('s1').average)], ['compensated', 9, 12], 'compensation selon la règle');
  assert.deepEqual([outcome('s2').outcome, Number(outcome('s2').credits)], ['resit', 6], 'sous le plancher : seconde session');
  assert.equal(outcome('s3').outcome, 'resit', 'absence justifiée');
  assert.match(details.jury.minutes, /Quorum : 2 \/ 2/);
  await status(grade('enterer', 's2', n2, { mark: 9, reason: 'Réévaluation tardive' }), 409, 'réévaluation tardive refusée');

  // 4. Signatures of the members present, publication, credits.
  await status(post('sign', 'absent', { juryId: jury }), 403, 'un absent ne signe pas');
  await status(post('publish', 'president', { juryId: jury }), 422, 'signatures manquantes');
  await okay(await post('sign', 'member', { juryId: jury }));
  await okay(await post('sign', 'president', { juryId: jury }));
  await status(post('publish', 'member', { juryId: jury }), 403);
  await okay(await post('publish', 'president', { juryId: jury }));
  assert.match(await (await get(`/api/v1/grd/jury-minutes/${jury}`, 'member')).text(), /Empreinte SHA-256/);
  let mine = await okay(await get('/api/v1/grd/me', 's1'));
  assert.deepEqual([mine.decisions.length, mine.credits], [1, 9]);
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'grd.results_published'", [ids.s1])).rows[0]);
  await status(get(`/api/v1/grd/juries/${jury}`, 's1'), 403, 'jury réservé');

  // 5. Appeal, decision by another person, rectification by amendment.
  const decision = mine.decisions[0].id;
  await status(post('appeal', 's2', { decisionId: decision, reason: 'x' }), 403, 'contestation de son seul résultat');
  const appeal = (await okay(await post('appeal', 's1', { decisionId: decision, reason: 'Copie de N2 mal additionnée (test).' }))).appealId;
  await status(post('appeal', 's1', { decisionId: decision, reason: 'Bis' }), 409, 'une contestation à la fois');
  await status(post('decide-appeal', 's1', { appealId: appeal, outcome: 'upheld', response: 'x' }), 403);
  await okay(await post('decide-appeal', 'reviewer', { appealId: appeal, outcome: 'upheld', response: 'Erreur d’addition constatée.' }));
  await status(post('rectify', 'member', { juryId: jury, registrationId: registrations.s1, reason: 'x', [`m.${n2}`]: 11 }), 403, 'avenant par le président');
  await status(post('rectify', 'president', { juryId: jury, registrationId: registrations.s1, reason: 'Sans note' }), 400);
  await okay(await post('rectify', 'president', { juryId: jury, registrationId: registrations.s1, appealId: appeal, reason: 'Avenant n° 1 : note de N2 rectifiée.', [`m.${n2}`]: 11 }));
  mine = await okay(await get('/api/v1/grd/me', 's1'));
  assert.deepEqual([mine.decisions[0].outcome, mine.decisions[0].rectified, mine.credits], ['admitted', true, 9]);
  const { rows: awards } = await database.query("SELECT mode, revoked_at FROM unoa.credit_award AS award JOIN unoa.student ON student.id = award.student_id WHERE student.account_id = $1 AND award.unit_id = $2 ORDER BY awarded_at", [ids.s1, n2]);
  assert.deepEqual(awards.map(item => [item.mode, !!item.revoked_at]), [['compensated', true], ['earned', false]], 'crédit compensé remplacé, historique gardé');
  details = await okay(await get(`/api/v1/grd/juries/${jury}`, 'organiser'));
  assert.equal(details.decisions.filter(item => item.registration_id === registrations.s1).length, 2, 'décision initiale conservée');

  // 6. Second session: only students sent to resit, best mark kept, credits capitalised.
  const resit = (await okay(await post('juries', 'organiser', { cohortId: cohort.id, periodId: period, session: 'resit', publishAt: new Date(Date.now() - 60_000).toISOString() }))).juryId;
  await okay(await post('members', 'organiser', { juryId: resit, accountId: ids.president, role: 'president' }));
  await okay(await post('members', 'organiser', { juryId: resit, accountId: ids.member }));
  await okay(await post('grade', 'enterer', { registrationId: registrations.s2, unitId: n2, session: 'resit', mark: 12 }));
  await okay(await post('grade', 'enterer', { registrationId: registrations.s3, unitId: n2, session: 'resit', mark: 13 }));
  await okay(await post('validate-all', 'validator', { cohortId: cohort.id, unitId: n2, session: 'resit' }));
  await okay(await post('deliberate', 'president', { juryId: resit, present: [ids.member] }));
  details = await okay(await get(`/api/v1/grd/juries/${resit}`, 'organiser'));
  assert.deepEqual(details.decisions.map(item => item.registration_id).sort(), [registrations.s2, registrations.s3].sort(), 's1 non concerné');
  assert.ok(details.decisions.every(item => item.outcome === 'admitted'));
  await okay(await post('sign', 'member', { juryId: resit })); await okay(await post('sign', 'president', { juryId: resit }));
  await okay(await post('publish', 'president', { juryId: resit }));
  assert.equal((await okay(await get('/api/v1/grd/me', 's2'))).credits, 9, 'crédits capitalisés + seconde session');

  // 7. Transcript sealed and verifiable.
  const transcript = await (await get('/api/v1/grd/transcript', 's2')).json();
  assert.match(transcript.seal, /^[0-9a-f]{64}$/);
  assert.equal(transcript.credits, 9);
  assert.match(transcript.notice, /ne constitue pas un diplôme/);
  assert.equal((await okay(await get(`/api/v1/grd/transcripts/${transcript.seal}`, 'validator'))).valid, true);
  await status(get(`/api/v1/grd/transcripts/${transcript.seal}`, 'outsider'), 403);
  await status(get('/api/v1/grd/transcript', 'outsider'), 404, 'sans dossier étudiant');

  // 8. Invariants: clean, then a silent change made below the application is detected.
  assert.deepEqual((await okay(await get(`/api/v1/grd/invariants?scopeId=${univ.id}`, 'validator'))).anomalies, []);
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.grade_entry(registration_id, unit_id, session, mark, state, author_id) VALUES ('${registrations.s2}', '${n1}', 'first', 2, 'validated', '${ids.enterer}');
    COMMIT;`);
  const kinds = (await okay(await get(`/api/v1/grd/invariants?scopeId=${univ.id}`, 'validator'))).anomalies.map(item => item.kind);
  assert.ok(kinds.includes('grade_changed_after_deliberation') && kinds.includes('decision_differs_from_rules'), 'modification silencieuse détectée');
  await assert.rejects(database.query("UPDATE unoa.jury_decision SET outcome = 'failed' WHERE jury_id = $1", [jury]), /append-only|history/i);

  // 9. Screens.
  assert.match(await (await get(`/administration/notes?scope=${univ.id}`, 'organiser')).text(), /Règles de notation/);
  assert.match(await (await get(`/administration/notes/saisie?cohorte=${cohort.id}&periode=${period}`, 'enterer')).text(), /Algorithmique/);
  assert.match(await (await get(`/administration/notes/jury?id=${jury}`, 'president')).text(), /Procès-verbal/);
  assert.match(await (await get('/resultats', 's1')).text(), /rectifié par avenant/);
  assert.match(await (await get(`/administration/notes/jury?id=${jury}`, 'outsider')).text(), /réservé à ses membres/);
}
