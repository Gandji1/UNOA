import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Student records: configured matricule, cohort, admission accepted → record →
// registration validated by another person → pedagogical registration, status
// changes with reasons, history, own-record isolation and export.
// Runs after the admissions fixture (its first candidate accepted an admission).
export async function exerciseStudents({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [accepted] } = await database.query(`
    SELECT application.id, application.applicant_id, round.version_id FROM unoa.application JOIN unoa.admission_round AS round ON round.id = application.round_id
    WHERE application.state = 'accepted' LIMIT 1`);
  assert.ok(accepted, 'une admission acceptée existe');
  const ids = { admin: randomUUID(), validator: randomUUID() };
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('sis_admin'), ('sis_validator');
    INSERT INTO unoa.role_permission VALUES ('sis_admin', 'sis.read'), ('sis_admin', 'sis.manage'), ('sis_admin', 'sis.enrol'), ('sis_admin', 'sis.status'),
      ('sis_validator', 'sis.read'), ('sis_validator', 'sis.validate');
  `);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Scolarité ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'sis-' + name, id]);
    await database.query("INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)",
      [id, univ.id, name === 'admin' ? 'sis_admin' : 'sis_validator']);
  }
  // Test-only: the seeded published version receives a period, a mandatory unit and an option.
  const unit = randomUUID(); const option = randomUUID(); const period = randomUUID(); const group = randomUUID();
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.program_period(id, version_id, ordinal, label) VALUES ('${period}', '${accepted.version_id}', 1, 'Semestre 1');
    INSERT INTO unoa.option_group(id, version_id, period_id, label, min_choices, max_choices) VALUES ('${group}', '${accepted.version_id}', '${period}', 'Options', 0, 1);
    INSERT INTO unoa.teaching_unit(id, version_id, period_id, code, title, credits) VALUES ('${unit}', '${accepted.version_id}', '${period}', 'UE1', 'Fondamentaux', 6);
    INSERT INTO unoa.teaching_unit(id, version_id, period_id, code, title, credits, option_group_id) VALUES ('${option}', '${accepted.version_id}', '${period}', 'OPT1', 'Option', 3, '${group}');
    COMMIT;`);

  const cookies = {};
  for (const subject of ['sis-admin', 'sis-validator', 'adm-first', 'adm-second']) {
    issuer.useIdentity(subject, 'test-mfa');
    cookies[subject] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (path, who, data) => call('/api/v1/sis/' + path, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: { Cookie: cookies[who] } });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = (response, expected, label) => assert.equal(response.status, expected, label);

  // 1. Matricule pattern and cohort, configured by the institution.
  await status(await post('rule', 'sis-admin', { institutionId: univ.id, pattern: 'SANS-SEQUENCE' }), 400, 'séquence obligatoire');
  await status(await post('rule', 'sis-validator', { institutionId: univ.id, pattern: 'A-{SEQ:4}' }), 403, 'configuration réservée');
  await okay(await post('rule', 'sis-admin', { institutionId: univ.id, pattern: 'UNOA-{AAAA}-{SEQ:4}' }));
  const cohortData = { versionId: accepted.version_id, code: 'C2026', label: 'Promotion 2026', academicYear: '2026-2027', startsOn: '2026-10-01', endsOn: '2027-07-31', capacity: 30 };
  await status(await post('cohorts', 'sis-admin', { ...cohortData, academicYear: '2026-2028' }), 400, 'année académique');
  const cohort = (await okay(await post('cohorts', 'sis-admin', cohortData))).id;
  await okay(await post('groups', 'sis-admin', { cohortId: cohort, label: 'Groupe A' }));
  let overview = await okay(await get(`/api/v1/sis/institutions?institutionId=${univ.id}`, 'sis-admin'));
  assert.ok(overview.admitted.some(item => item.id === accepted.id), 'admission acceptée à inscrire');

  // 2. Enrolment: record and matricule, one registration per year, validation by another person.
  await status(await post('enrol', 'adm-second', { applicationId: accepted.id, cohortId: cohort }), 403, 'inscription réservée');
  const enrolled = await okay(await post('enrol', 'sis-admin', { applicationId: accepted.id, cohortId: cohort }));
  assert.match(enrolled.matricule, /^UNOA-\d{4}-0001$/);
  await status(await post('enrol', 'sis-admin', { applicationId: accepted.id, cohortId: cohort }), 409, 'double inscription la même année');
  overview = await okay(await get(`/api/v1/sis/institutions?institutionId=${univ.id}`, 'sis-admin'));
  assert.ok(!overview.admitted.some(item => item.id === accepted.id));
  assert.equal(overview.pending.length, 1);
  await status(await post('validate', 'sis-admin', { registrationId: enrolled.registration }), 403, 'validation par l’auteur');
  await okay(await post('validate', 'sis-validator', { registrationId: enrolled.registration, conditions: 'Pièce d’identité à présenter' }));
  await status(await post('validate', 'sis-validator', { registrationId: enrolled.registration }), 409, 'déjà validée');
  const { rows: inbox } = await database.query("SELECT title FROM unoa.notification WHERE account_id = $1 AND kind = 'sis.registration_validated'", [accepted.applicant_id]);
  assert.match(inbox[0].title, /Inscription validée · 2026-2027/);

  // 3. Pedagogical registration: mandatory units at validation, options chosen afterwards.
  let record = await okay(await get(`/api/v1/sis/students/${enrolled.id}`, 'sis-admin'));
  assert.deepEqual(record.units.map(item => [item.code, item.state]), [['OPT1', null], ['UE1', 'registered']]);
  assert.deepEqual(record.credits, { acquired: 0, pending: 6, required: 6 });
  await okay(await post('units', 'sis-admin', { registrationId: enrolled.registration, unitId: option, state: 'registered' }));
  await status(await post('units', 'sis-admin', { registrationId: enrolled.registration, unitId: randomUUID(), state: 'registered' }), 422, 'UE hors programme');
  record = await okay(await get(`/api/v1/sis/students/${enrolled.id}`, 'sis-admin'));
  assert.equal(record.credits.pending, 9);

  // 4. The student sees and exports only their own record.
  const mine = await okay(await get('/api/v1/sis/me', 'adm-first'));
  assert.equal(mine.records[0].student.matricule, enrolled.matricule);
  await status(await get(`/api/v1/sis/students/${enrolled.id}`, 'adm-second'), 403, 'dossier d’un autre étudiant');
  const exported = await get(`/api/v1/sis/students/${enrolled.id}/export`, 'adm-first');
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  assert.equal((await exported.json()).matricule, enrolled.matricule);
  assert.match(await (await get('/etudiant', 'adm-first')).text(), new RegExp(enrolled.matricule));

  // 5. Status changes with reasons; no registration while suspended; graduation closes the record.
  await status(await post('suspend', 'sis-admin', { studentId: enrolled.id }), 400, 'motif obligatoire');
  await status(await post('suspend', 'sis-validator', { studentId: enrolled.id, reason: 'x' }), 403);
  await okay(await post('suspend', 'sis-admin', { studentId: enrolled.id, reason: 'Demande de l’étudiant' }));
  const next = (await okay(await post('cohorts', 'sis-admin', { ...cohortData, code: 'C2027', label: 'Promotion 2027', academicYear: '2027-2028', startsOn: '2027-10-01', endsOn: '2028-07-31' }))).id;
  await status(await post('register', 'sis-admin', { studentId: enrolled.id, cohortId: next, kind: 'renewal' }), 422, 'étudiant suspendu');
  await status(await post('graduate', 'sis-admin', { studentId: enrolled.id, reason: 'x' }), 409, 'transition depuis suspendu');
  await okay(await post('resume', 'sis-admin', { studentId: enrolled.id, reason: 'Reprise' }));
  await okay(await post('register', 'sis-admin', { studentId: enrolled.id, cohortId: next, kind: 'renewal' }));
  await okay(await post('graduate', 'sis-admin', { studentId: enrolled.id, reason: 'Parcours achevé' }));
  record = await okay(await get(`/api/v1/sis/students/${enrolled.id}`, 'adm-first'));
  assert.equal(record.student.status, 'graduated');
  const kinds = record.events.map(item => item.kind);
  for (const kind of ['created', 'registration_requested', 'registration_validated', 'units_changed', 'status_suspended', 'status_active', 'status_graduated']) {
    assert.ok(kinds.includes(kind), kind);
  }
  await assert.rejects(database.query("UPDATE unoa.student_event SET detail = 'x' WHERE student_id = $1", [enrolled.id]), /history|immutable|append/i);
  assert.match(await (await get(`/administration/scolarite?etablissement=${univ.id}`, 'sis-admin')).text(), /Promotion 2026/);
  assert.match(await (await get('/', 'sis-admin')).text(), /href="\/administration\/scolarite"/);
}
