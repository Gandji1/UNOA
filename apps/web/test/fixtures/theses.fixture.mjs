import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Theses and defences: regulation by level, topics validated by another
// person, project and protocol validated, qualified supervision, successive
// drafts and comments, proportionate integrity check (plagiarism blocks the
// defence), jury composed and convened according to the regulation, rapporteur
// reports, defence minutes and signatures, mark sent to the unit's grades,
// corrected final deposit with embargo, confidential work never disclosed.
// Runs after the grades fixture (students s1.., grading policy in force).
export async function exerciseTheses({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [student] } = await database.query(`SELECT student.account_id, registration.id AS registration_id, cohort.version_id FROM unoa.student
    JOIN unoa.registration ON registration.student_id = student.id JOIN unoa.cohort ON cohort.id = registration.cohort_id WHERE student.matricule = 'NOTES-S1'`);
  const names = ['manager', 'validator', 'supervisor', 'unqualified', 'checker', 'president', 'rapporteur', 'external', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('thesis_manager_t'), ('thesis_validator_t'), ('thesis_supervisor_t'), ('thesis_checker_t'), ('thesis_member_t');
    INSERT INTO unoa.role_permission VALUES ('thesis_manager_t', 'thesis.read'), ('thesis_manager_t', 'thesis.manage'), ('thesis_validator_t', 'thesis.read'), ('thesis_validator_t', 'thesis.validate'),
      ('thesis_supervisor_t', 'thesis.read'), ('thesis_supervisor_t', 'thesis.supervise'), ('thesis_checker_t', 'thesis.read'), ('thesis_checker_t', 'thesis.integrity'), ('thesis_member_t', 'thesis.read');
  `);
  const roles = { manager: 'thesis_manager_t', validator: 'thesis_validator_t', supervisor: 'thesis_supervisor_t', checker: 'thesis_checker_t', president: 'thesis_member_t', rapporteur: 'thesis_member_t', external: 'thesis_member_t' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Mémoire ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'mem-' + name, id]);
    if (roles[name]) await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)', [id, univ.id, roles[name]]);
  }
  // Test-only: a thesis unit in a new period of the student's programme, with a pedagogical registration.
  const period = randomUUID(); const unit = randomUUID();
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.program_period(id, version_id, ordinal, label) VALUES ('${period}', '${student.version_id}', 8, 'Semestre mémoire (test)');
    INSERT INTO unoa.teaching_unit(id, version_id, period_id, code, title, credits) VALUES ('${unit}', '${student.version_id}', '${period}', 'MEM1', 'Mémoire de fin d’études', 10);
    INSERT INTO unoa.course_registration(registration_id, unit_id) VALUES ('${student.registration_id}', '${unit}');
    COMMIT;`);
  const cookies = {};
  for (const subject of [...names.map(name => 'mem-' + name), 'grd-s1', 'grd-s2']) {
    issuer.useIdentity(subject, 'test-mfa');
    cookies[subject.replace(/^(mem|grd)-/, '')] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/thesis/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const upload = (who, projectId, bytes, name = 'memoire.pdf', kind = 'draft') => {
    const body = new FormData();
    body.set('return', '/memoires/projet?id=' + projectId); body.set('projectId', projectId); body.set('kind', kind); body.set('file', new Blob([bytes]), name);
    return call('/api/v1/thesis/drafts', { method: 'POST', headers: { Origin: origin, Cookie: cookies[who] }, body, redirect: 'manual' });
  };
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => {
    const result = await response;
    assert.equal(result.status, expected, label + (result.status === expected ? '' : ' — ' + (await result.text()).slice(0, 300)));
  };
  const outcome = response => new URL(response.headers.get('location')).searchParams;
  const pdf = text => new TextEncoder().encode('%PDF-1.4\n% ' + text + '\n');
  const details = async (who, id) => okay(await get(`/api/v1/thesis/projects/${id}`, who));

  // 1. Regulation and topics.
  const rule = { scopeId: univ.id, level: 'master', minJury: 3, rapporteurs: 1, externalMember: true, similarityThreshold: 25, maxEmbargoYears: 2, noticeDays: 0, effectiveFrom: new Date().toISOString().slice(0, 10) };
  await status(post('rules', 'outsider', rule), 403, 'règlement réservé');
  await okay(await post('rules', 'manager', rule));
  await status(post('rules', 'manager', rule), 409, 'une version par date');
  await status(post('topics', 'unqualified', { scopeId: univ.id, level: 'master', title: 'X', summary: 'X' }), 403, 'proposition réservée');
  const topic = (await okay(await post('topics', 'supervisor', { scopeId: univ.id, level: 'master', title: 'Apprentissage automatique frugal (test)', summary: 'Sujet de test.' }))).subject;
  await status(post('validate-topic', 'supervisor', { topicId: topic, decision: 'open' }), 403, 'validation par une autre personne');
  await okay(await post('validate-topic', 'validator', { topicId: topic, decision: 'open' }));

  // 2. Project, protocol, validation; qualified supervision.
  const { rows: [foreign] } = await database.query("SELECT id FROM unoa.teaching_unit WHERE code = 'UE1' LIMIT 1");
  await status(post('projects', 's1', { topicId: topic, title: 'X', registrationId: student.registration_id, unitId: foreign.id }), 422, 'unité hors inscription');
  const project = (await okay(await post('projects', 's1', { topicId: topic, title: 'Apprentissage frugal sur données ouvertes (test)', registrationId: student.registration_id, unitId: unit }))).projectId;
  await status(post('projects', 's2', { topicId: topic, title: 'Bis' }), 409, 'sujet déjà attribué');
  await status(post('submit', 's1', { projectId: project }), 422, 'protocole requis');
  await okay(await post('protocol', 's1', { projectId: project, protocol: 'Problématique, méthode, calendrier (test).' }));
  await okay(await post('submit', 's1', { projectId: project }));
  await status(post('validate-project', 's1', { projectId: project, decision: 'validated' }), 403);
  await status(post('validate-project', 'validator', { projectId: project, decision: 'rejected' }), 400, 'motif de refus exigé');
  await okay(await post('validate-project', 'validator', { projectId: project, decision: 'validated', note: 'Protocole solide.' }));
  assert.equal(outcome(await upload('s1', project, pdf('v0'))).get('error'), '422', 'pas de version sans directeur');
  await status(post('supervise', 'manager', { projectId: project, accountId: ids.unqualified, role: 'director', qualification: 'x' }), 422, 'encadrant non qualifié');
  await okay(await post('supervise', 'manager', { projectId: project, accountId: ids.supervisor, role: 'director', qualification: 'Maître de conférences (test)' }));
  await status(post('supervise', 'manager', { projectId: project, accountId: ids.supervisor, role: 'co_director', qualification: 'x' }), 409, 'déjà encadrant');
  await okay(await post('milestones', 'supervisor', { projectId: project, label: 'État de l’art', dueOn: new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10) }));

  // 3. Drafts, comments, integrity: plagiarism blocks the defence.
  assert.equal(outcome(await upload('s1', project, new TextEncoder().encode('<html>'))).get('error'), '400', 'PDF exigé');
  assert.equal(outcome(await upload('outsider', project, pdf('x'))).get('error'), '403');
  assert.equal(outcome(await upload('s1', project, pdf('version 1'))).get('message'), 'saved');
  let view = await details('supervisor', project);
  const v1 = view.drafts[0].id;
  await okay(await post('comments', 'supervisor', { draftId: v1, body: 'Revoir la section 2 (test).' }));
  await status(post('comments', 'outsider', { draftId: v1, body: 'x' }), 403);
  await status(post('integrity', 's1', { draftId: v1, method: 'manual_review', result: 'clear', note: 'x' }), 403);
  await okay(await post('integrity', 'checker', { draftId: v1, method: 'similarity_report', similarity: 40, note: 'Rapport de similarité externe : 40 % (test).' }));
  await status(post('defenses', 'manager', { projectId: project, mode: 'onsite', place: 'Salle A', startsAt: new Date(Date.now() + 864e5).toISOString() }), 422, 'mémoire suspect de plagiat');
  await upload('s1', project, pdf('version 2'));
  view = await details('checker', project);
  await okay(await post('integrity', 'checker', { draftId: view.drafts[0].id, method: 'manual_review', result: 'clear', note: 'Sources citées, reprise corrigée.' }));

  // 4. Defence: mode, jury composition, reports, notice.
  await status(post('defenses', 'manager', { projectId: project, mode: 'online', startsAt: new Date(Date.now() + 864e5).toISOString() }), 400, 'lien exigé en ligne');
  const defense = (await okay(await post('defenses', 'manager', { projectId: project, mode: 'hybrid', place: 'Salle A (test)', meetingUrl: 'https://visio.example.org/soutenance',
    startsAt: new Date(Date.now() + 864e5).toISOString() }))).defenseId;
  const jury = (accountId, role, external = false) => post('jury', 'manager', { defenseId: defense, accountId, role, external });
  await status(jury(ids.supervisor, 'president'), 403, 'un encadrant ne préside pas');
  await status(jury(student.account_id, 'examiner'), 403, 'l’auteur ne siège pas');
  await okay(await jury(ids.president, 'president'));
  await okay(await jury(ids.rapporteur, 'rapporteur'));
  await status(post('convene', 'manager', { defenseId: defense }), 422, 'jury incomplet');
  await okay(await jury(ids.supervisor, 'supervisor'));
  await status(post('convene', 'manager', { defenseId: defense }), 422, 'membre extérieur requis');
  await okay(await jury(ids.external, 'examiner', true));
  await status(post('convene', 'manager', { defenseId: defense }), 422, 'rapports préalables');
  await status(post('reports', 'president', { defenseId: defense, opinion: 'favourable', report: 'x' }), 403);
  await okay(await post('reports', 'rapporteur', { defenseId: defense, opinion: 'favourable', report: 'Travail soutenable (test).' }));
  await status(post('hold', 'president', { defenseId: defense, outcome: 'admitted', present: [] }), 422, 'soutenance sans jury convoqué');
  await okay(await post('convene', 'manager', { defenseId: defense }));
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'thesis.convocation'", [student.account_id])).rows[0]);

  // 5. Minutes, signatures, mark into the grades module.
  await status(post('hold', 'rapporteur', { defenseId: defense, outcome: 'admitted' }), 403);
  await status(post('hold', 'president', { defenseId: defense, outcome: 'admitted', present: [ids.president, ids.rapporteur] }), 422, 'jury insuffisant');
  await okay(await post('hold', 'president', { defenseId: defense, outcome: 'admitted_with_corrections', mark: 15, minutes: 'Corrections mineures demandées (test).',
    present: [ids.president, ids.rapporteur, ids.supervisor, ids.external] }));
  const { rows: [grade] } = await database.query('SELECT mark, state FROM unoa.grade_entry WHERE registration_id = $1 AND unit_id = $2', [student.registration_id, unit]);
  assert.deepEqual([Number(grade.mark), grade.state], [15, 'provisional'], 'note transmise aux notes, à valider');
  await assert.rejects(database.query("UPDATE unoa.defense SET mark = 20 WHERE id = $1", [defense]), /kept/);
  await status(post('sign', 's1', { defenseId: defense }), 403);
  for (const who of ['president', 'rapporteur']) await okay(await post('sign', who, { defenseId: defense }));

  // 6. Corrected final deposit, embargo within the regulation.
  assert.equal(outcome(await upload('s1', project, pdf('finale'), 'finale.pdf', 'final')).get('error'), '422', 'version corrigée exigée');
  assert.equal(outcome(await upload('s1', project, pdf('corrigée'), 'corrigee.pdf', 'corrected')).get('message'), 'saved');
  await status(post('accept-deposit', 'manager', { projectId: project }), 403, 'acceptation par le directeur');
  await status(post('accept-deposit', 'supervisor', { projectId: project }), 422, 'signatures manquantes');
  for (const who of ['supervisor', 'external']) await okay(await post('sign', who, { defenseId: defense }));
  const later = years => new Date(Date.now() + years * 366 * 864e5).toISOString().slice(0, 10);
  await status(post('accept-deposit', 'supervisor', { projectId: project, embargoUntil: later(5), embargoReason: 'Brevet' }), 422, 'embargo plafonné');
  await okay(await post('accept-deposit', 'supervisor', { projectId: project, embargoUntil: later(1), embargoReason: 'Dépôt de brevet en cours (test)' }));
  const archive = await (await get('/memoires')).text();
  assert.match(archive, /Apprentissage frugal sur données ouvertes \(test\)/);
  assert.match(archive, /sous embargo/);
  view = await details('s1', project);
  await status(get(`/api/v1/thesis/drafts/${view.deposit.draft_id}`, 'outsider'), 403, 'embargo respecté');

  // 7. Confidential work: never in the archive, never readable outside its circle.
  const secret = (await okay(await post('projects', 's2', { scopeId: univ.id, level: 'master', title: 'Étude confidentielle (test)', confidential: true }))).projectId;
  await status(get(`/api/v1/thesis/projects/${secret}`, 'outsider'), 403, 'contenu confidentiel protégé');
  await status(get(`/api/v1/thesis/projects/${secret}`, 's1'), 403);
  assert.doesNotMatch(await (await get('/memoires')).text(), /Étude confidentielle/);

  // 8. Screens.
  assert.match(await (await get('/memoires/mes', 's1')).text(), /Mes mémoires et thèses/);
  assert.match(await (await get(`/memoires/projet?id=${project}`, 'president')).text(), /Procès-verbal de soutenance/);
  assert.match(await (await get(`/administration/memoires?scope=${univ.id}`, 'manager')).text(), /Règlement des soutenances/);
}
