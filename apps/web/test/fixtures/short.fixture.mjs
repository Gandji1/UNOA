import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Short courses: catalogue with free modules and competencies, reuse of
// validated content under licence, approval, public and client sessions with
// capacity and price, enrolment of the public and of employees, progress
// recorded with evidence by a trainer, incomplete path refused, private
// attestation and stacked badge through the document register, feedback and
// participation report, recognition of prior learning decided by a person.
// Runs after the credentials fixture (document designer and signatory).
export async function exerciseShort({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const names = ['manager', 'approver', 'trainer', 'learner', 'employee', 'contact', 'other', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('short_manager_t'), ('short_approver_t'), ('short_trainer_t');
    INSERT INTO unoa.role_permission VALUES ('short_manager_t', 'short.read'), ('short_manager_t', 'short.manage'), ('short_manager_t', 'short.clients'), ('short_manager_t', 'short.rpl'),
      ('short_manager_t', 'cred.issue'), ('short_approver_t', 'short.read'), ('short_approver_t', 'short.approve'), ('short_trainer_t', 'short.read'), ('short_trainer_t', 'short.train');
  `);
  const roles = { manager: 'short_manager_t', approver: 'short_approver_t', trainer: 'short_trainer_t' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name, email) VALUES ($1, $2, $3)', [id, 'Formation ' + name, `short-${name}@example.org`]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'short-' + name, id]);
    if (roles[name]) await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)', [id, univ.id, roles[name]]);
  }
  const cookies = {};
  for (const subject of [...names.map(name => 'short-' + name), 'cred-designer', 'cred-signatory']) {
    issuer.useIdentity(subject, 'test-mfa');
    cookies[subject.replace(/^short-/, '')] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const send = (module, action, who, data) => call(`/api/v1/${module}/${action}`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const post = (action, who, data) => send('short', action, who, data);
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => {
    const result = await response;
    assert.equal(result.status, expected, label + (result.status === expected ? '' : ' — ' + (await result.text()).slice(0, 300)));
  };
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  // 0. Documents of the register for short courses (designed and approved by the documents team).
  const type = async (code, label, category, eligibility) => {
    await okay(await send('cred', 'types', 'cred-designer', { scopeId: univ.id, code, label, category, issuingAuthority: 'Université Alpha — formation continue', eligibility, requiredSignatures: 1 }));
    const { rows: [row] } = await database.query('SELECT id FROM unoa.credential_type WHERE code = $1 AND scope_id = $2', [code, univ.id]);
    await okay(await send('cred', 'templates', 'cred-designer', { typeId: row.id, language: 'fr', title: label, body: '{{nom}} a suivi avec succès « {{formation}} » ({{annee}}). Document n° {{numero}}, {{autorite}}.' }));
    const { rows: [template] } = await database.query('SELECT id FROM unoa.document_template WHERE type_id = $1', [row.id]);
    await okay(await send('cred', 'publish-template', 'cred-signatory', { templateId: template.id }));
    await okay(await send('cred', 'publish-type', 'cred-signatory', { typeId: row.id }));
    return row.id;
  };
  const attestationType = await type('FC', 'Attestation de formation (test)', 'internal_attestation', 'short_completion');
  const stackType = await type('MICRO', 'Microcertification (test)', 'badge', 'stack_completion');
  const { rows: [enrolledType] } = await database.query("SELECT id FROM unoa.credential_type WHERE code = 'ATT' AND scope_id = $1", [univ.id]);

  // 1. Catalogue: any duration, free modules with competencies, validated content reused under licence.
  const course = { scopeId: univ.id, code: 'FC-DATA', title: 'Analyse de données (test)', description: 'Formation courte de test.', durationHours: 21, passThreshold: 50,
    competencies: 'Analyse de données, Visualisation', credentialTypeId: attestationType };
  await status(post('courses', 'outsider', course), 403, 'catalogue réservé');
  await status(post('courses', 'manager', { ...course, credentialTypeId: enrolledType.id }), 422, 'document « inscription » refusé');
  const courseA = (await okay(await post('courses', 'manager', course))).subject;
  const courseB = (await okay(await post('courses', 'manager', { ...course, code: 'FC-VIZ', title: 'Tableaux de bord (test)', durationHours: 3.5 }))).subject;
  const { rows: [stored] } = await database.query('SELECT competencies FROM unoa.short_course WHERE id = $1', [courseA]);
  assert.deepEqual(stored.competencies, ['Analyse de données', 'Visualisation']);
  const { rows: [published] } = await database.query("SELECT id FROM unoa.course_version WHERE state = 'published' LIMIT 1");
  const { rows: [draftVersion] } = await database.query("SELECT id FROM unoa.course_version WHERE state <> 'published' LIMIT 1");
  if (draftVersion) await status(post('modules', 'manager', { courseId: courseA, title: 'X', hours: 1, contentVersionId: draftVersion.id, licence: 'CC BY' }), 422, 'contenu non validé');
  await status(post('modules', 'manager', { courseId: courseA, title: 'X', hours: 1, contentVersionId: published.id }), 400, 'licence exigée');
  await okay(await post('modules', 'manager', { courseId: courseA, title: 'Fondamentaux', hours: 14, competencies: 'Analyse de données', contentVersionId: published.id, licence: 'CC BY 4.0 (test)' }));
  await okay(await post('modules', 'manager', { courseId: courseA, title: 'Projet', hours: 7 }));
  await okay(await post('modules', 'manager', { courseId: courseB, title: 'Atelier', hours: 3.5 }));
  await status(post('publish', 'manager', { courseId: courseA }), 403, 'publication réservée');
  for (const id of [courseA, courseB]) await okay(await post('publish', 'approver', { courseId: id }));
  await status(post('modules', 'manager', { courseId: courseA, title: 'Ajout', hours: 1 }), 409, 'modules figés après publication');

  // 2. Client company, sessions with price, capacity and reservation.
  await status(post('clients', 'manager', { scopeId: univ.id, name: 'Entreprise X', contactEmail: 'inconnu@example.org' }), 404, 'contact sans compte');
  const client = (await okay(await post('clients', 'manager', { scopeId: univ.id, name: 'Entreprise cliente (test)', registration: 'RC-TEST-1', contactEmail: 'short-contact@example.org' }))).subject;
  const { rows: [price] } = await database.query("SELECT id FROM unoa.price_rule WHERE label = 'Frais en euros (test)'");
  const publicSession = (await okay(await post('sessions', 'manager', { courseId: courseA, label: 'Session publique (test)', modality: 'online', startsOn: day(-1), endsOn: day(30), capacity: 2, priceRuleId: price.id, trainerId: ids.trainer }))).subject;
  const clientSession = (await okay(await post('sessions', 'manager', { courseId: courseA, label: 'Session entreprise (test)', modality: 'onsite', startsOn: day(-1), endsOn: day(30), clientId: client }))).subject;
  const sessionB = (await okay(await post('sessions', 'manager', { courseId: courseB, label: 'Atelier (test)', modality: 'hybrid', startsOn: day(-1), endsOn: day(10) }))).subject;
  const catalogue = await (await get('/formations-courtes')).text();
  assert.match(catalogue, /Analyse de données \(test\)/);
  assert.match(catalogue, /jamais à un diplôme d’État/);
  assert.match(catalogue, /1[\s ]?250,50/, 'prix du tarif approuvé');
  assert.doesNotMatch(catalogue, /Session entreprise \(test\)/, 'session client non publique');

  // 3. Enrolment of the public and of employees.
  const enrol = (who, sessionId) => post('enrol', who, { sessionId });
  const learnerEnrollment = (await okay(await enrol('learner', publicSession))).enrollmentId;
  await status(enrol('learner', publicSession), 409, 'déjà inscrit');
  await status(enrol('other', clientSession), 403, 'session réservée au client');
  await okay(await enrol('other', publicSession));
  await status(enrol('outsider', publicSession), 409, 'session complète');
  await okay(await post('enrol-employees', 'manager', { clientId: client, sessionId: clientSession, emails: 'short-employee@example.org' }));
  const { rows: [employee] } = await database.query('SELECT id FROM unoa.short_enrollment WHERE account_id = $1', [ids.employee]);
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'short.enrolled'", [ids.employee])).rows[0]);

  // 4. Progress with evidence, by the trainer only; incomplete path refused; latest result counts.
  const { rows: modules } = await database.query('SELECT id FROM unoa.short_module WHERE course_id = $1 ORDER BY ordinal', [courseA]);
  const result = (who, enrollmentId, moduleId, score) => post('results', who, { enrollmentId, moduleId, score, evidence: 'Évaluation pratique (test)' });
  await status(result('learner', learnerEnrollment, modules[0].id, 100), 403, 'pas d’auto-validation');
  await okay(await result('trainer', learnerEnrollment, modules[0].id, 80));
  await status(post('conclude', 'trainer', { enrollmentId: learnerEnrollment }), 422, 'parcours incomplet');
  await okay(await result('trainer', learnerEnrollment, modules[1].id, 40));
  await okay(await result('trainer', learnerEnrollment, modules[1].id, 70));
  assert.equal((await okay(await post('conclude', 'trainer', { enrollmentId: learnerEnrollment }))).outcome, 'completed');
  for (const module of modules) await okay(await result('trainer', employee.id, module.id, 30));
  assert.equal((await okay(await post('conclude', 'trainer', { enrollmentId: employee.id }))).outcome, 'not_passed');
  await assert.rejects(database.query('UPDATE unoa.module_result SET score = 100 WHERE enrollment_id = $1', [employee.id]), /append-only/);

  // 5. Private attestation through the register.
  await status(post('certify', 'manager', { enrollmentId: employee.id }), 422, 'attestation réservée à la réussite');
  const certificate = await okay(await post('certify', 'manager', { enrollmentId: learnerEnrollment }));
  assert.match(certificate.number, /^FC-\d{4}-\d{6}$/);
  await status(post('certify', 'manager', { enrollmentId: learnerEnrollment }), 409, 'une attestation par réussite');
  await okay(await send('cred', 'sign', 'cred-signatory', { credentialId: certificate.credentialId }));
  const documents = await okay(await get('/api/v1/cred/me', 'learner'));
  assert.ok(documents.credentials.some(item => item.number === certificate.number && item.state === 'issued'));
  const { rows: [code] } = await database.query('SELECT verification_code FROM unoa.credential WHERE id = $1', [certificate.credentialId]);
  assert.match(await (await get(`/verifier/${code.verification_code}`)).text(), /Document authentique/);

  // 6. Stack of micro-certifications.
  await status(post('stacks', 'manager', { scopeId: univ.id, title: 'Parcours données (test)', courseIds: [courseA], credentialTypeId: stackType }), 400, 'deux formations au moins');
  await status(post('stacks', 'manager', { scopeId: univ.id, title: 'Parcours données (test)', courseIds: [courseA, courseB], credentialTypeId: attestationType }), 422, 'badge de parcours exigé');
  const stack = (await okay(await post('stacks', 'manager', { scopeId: univ.id, title: 'Parcours données (test)', courseIds: [courseA, courseB], credentialTypeId: stackType }))).subject;
  await status(post('certify-stack', 'manager', { stackId: stack, accountId: ids.learner }), 422, 'parcours incomplet');
  const workshop = (await okay(await enrol('learner', sessionB))).enrollmentId;
  const { rows: [moduleB] } = await database.query('SELECT id FROM unoa.short_module WHERE course_id = $1', [courseB]);
  await okay(await result('trainer', workshop, moduleB.id, 90));
  await okay(await post('conclude', 'trainer', { enrollmentId: workshop }));
  const badge = await okay(await post('certify-stack', 'manager', { stackId: stack, accountId: ids.learner }));
  assert.match(badge.number, /^MICRO-/);

  // 7. Feedback and participation report.
  await status(post('feedback', 'learner', { enrollmentId: learnerEnrollment, rating: 6 }), 400);
  await status(post('feedback', 'other', { enrollmentId: learnerEnrollment, rating: 4 }), 403);
  await okay(await post('feedback', 'learner', { enrollmentId: learnerEnrollment, rating: 4, comment: 'Utile (test).' }));
  const report = await (await get(`/api/v1/short/report?scopeId=${univ.id}`, 'manager')).text();
  assert.match(report, /Analyse de données \(test\);3;1;1;0;33 %;4\.00;1/);
  await status(get(`/api/v1/short/report?scopeId=${univ.id}`, 'learner'), 403);

  // 8. Recognition of prior learning: a reasoned decision by another person.
  const rpl = (await okay(await post('rpl', 'employee', { courseId: courseA, target: 'Module Fondamentaux', experience: 'Cinq ans d’analyse de données en entreprise (test).' }))).rplId;
  await status(post('decide-rpl', 'employee', { rplId: rpl, decision: 'accepted', reason: 'x' }), 403);
  await status(post('decide-rpl', 'manager', { rplId: rpl, decision: 'accepted' }), 400, 'motivation exigée');
  await okay(await post('decide-rpl', 'manager', { rplId: rpl, decision: 'partially_accepted', reason: 'Fondamentaux reconnus ; projet à réaliser.' }));
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'short.rpl_decided'", [ids.employee])).rows[0]);
  assert.equal((await database.query('SELECT count(*)::int AS total FROM unoa.module_result WHERE enrollment_id = $1', [employee.id])).rows[0].total, 2, 'aucune validation automatique');

  // 9. Screens and isolation.
  assert.match(await (await get('/formations-courtes/mes', 'learner')).text(), /Voir mon attestation/);
  assert.match(await (await get(`/administration/formations-courtes?scope=${univ.id}`, 'manager')).text(), /Participation et qualité/);
  await status(get(`/api/v1/short/scopes?scopeId=${univ.id}`, 'learner'), 403);
  await status(get(`/api/v1/short/enrollments/${learnerEnrollment}`, 'other'), 403, 'progression réservée');
}
