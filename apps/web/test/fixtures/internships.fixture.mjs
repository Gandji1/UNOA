import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Partner companies and internships (lot 027): registration, documentary
// verification by another person, fictitious company rejected, team and loss of
// rights, partnership signed by both sides, reports; internship request with
// eligibility, agreement from an approved template signed by three parties on
// the same digest, absent tutor blocking, logs, messages, confidential report,
// grid reviews, academic validation feeding the grades, events, statistics by
// region, closure purging documents. Runs after the theses fixture (student
// NOTES-S1 with a validated registration).
export async function exerciseInternships({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [student] } = await database.query(`SELECT student.account_id, registration.id AS registration_id, cohort.version_id FROM unoa.student
    JOIN unoa.registration ON registration.student_id = student.id JOIN unoa.cohort ON cohort.id = registration.cohort_id WHERE student.matricule = 'NOTES-S1'`);
  const names = ['officer', 'signer', 'validator', 'academic', 'owner', 'recruiter', 'tutor', 'second', 'fake', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('stg_officer_t'), ('stg_signer_t'), ('stg_validator_t'), ('stg_academic_t');
    INSERT INTO unoa.role_permission VALUES ('stg_officer_t', 'ent.read'), ('stg_officer_t', 'ent.verify'), ('stg_officer_t', 'ent.manage'), ('stg_officer_t', 'stg.read'), ('stg_officer_t', 'stg.manage'),
      ('stg_signer_t', 'stg.read'), ('stg_signer_t', 'stg.sign'), ('stg_validator_t', 'stg.read'), ('stg_validator_t', 'stg.validate'), ('stg_academic_t', 'lms.read');
  `);
  const roles = { officer: 'stg_officer_t', signer: 'stg_signer_t', validator: 'stg_validator_t', academic: 'stg_academic_t' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Stage ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'stg-' + name, id]);
    if (roles[name]) await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)', [id, univ.id, roles[name]]);
  }
  // Company members are found by their local login.
  for (const name of ['recruiter', 'tutor', 'second']) {
    await database.query("INSERT INTO unoa.local_credential(account_id, login, password_hash, must_change) VALUES ($1, $2, 'scrypt$16384$8$1$c2FsdA$aGFzaA', false)", [ids[name], 'stg.' + name]);
  }
  // Test-only: an internship unit in the student's pedagogical registration.
  const period = randomUUID(); const unit = randomUUID();
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.program_period(id, version_id, ordinal, label) VALUES ('${period}', '${student.version_id}', 9, 'Semestre stage (test)');
    INSERT INTO unoa.teaching_unit(id, version_id, period_id, code, title, credits) VALUES ('${unit}', '${student.version_id}', '${period}', 'STG1', 'Stage en entreprise', 12);
    INSERT INTO unoa.course_registration(registration_id, unit_id) VALUES ('${student.registration_id}', '${unit}');
    COMMIT;`);
  const cookies = {};
  for (const subject of [...names.map(name => 'stg-' + name), 'grd-s1']) {
    issuer.useIdentity(subject, 'test-mfa');
    cookies[subject.replace(/^(stg|grd)-/, '')] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (module, action, who, data) => call(`/api/v1/${module}/${action}`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const ent = (action, who, data) => post('ent', action, who, data);
  const stg = (action, who, data) => post('stg', action, who, data);
  const upload = (path, who, fields, bytes, name) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    body.set('file', new Blob([bytes]), name);
    return call(path, { method: 'POST', headers: { Origin: origin, Cookie: cookies[who] }, body, redirect: 'manual' });
  };
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    const result = await response;
    assert.equal(result.status, 200, result.ok ? '' : JSON.stringify(await result.clone().json()));
    return result.json();
  }
  const status = async (response, expected, label) => {
    const result = await response;
    assert.equal(result.status, expected, label + (result.status === expected ? '' : ' — ' + (await result.text()).slice(0, 300)));
  };
  const pdf = text => new TextEncoder().encode('%PDF-1.4\n% ' + text + '\n');
  const at = days => new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
  const company = { scopeId: univ.id, name: 'Atelier Numérique (test)', registrationNumber: 'RB-COT-2026-B-0001', country: 'Bénin', sector: 'Services numériques',
    city: 'Cotonou', representativeName: 'Responsable (test)', representativeTitle: 'Gérant', description: 'Entreprise fictive de recette.', address: 'Adresse privée (test)' };

  // 1. Registration and documentary verification by another person.
  const companyId = (await okay(ent('register', 'owner', company))).companyId;
  await status(ent('register', 'second', company), 409, 'immatriculation déjà inscrite');
  await status(ent('register', 'owner', { ...company, registrationNumber: 'RB-1', scopeId: randomUUID() }), 422, 'établissement inexistant');
  const document = (kind, who = 'owner', bytes = pdf(kind)) => upload('/api/v1/ent/documents', who, { companyId, kind, return: '/entreprise' }, bytes, kind + '.pdf');
  assert.match((await document('registration', 'owner', new TextEncoder().encode('<html>'))).headers.get('location'), /error=400/, 'format vérifié');
  assert.match((await document('registration', 'outsider')).headers.get('location'), /error=403/, 'dépôt par un tiers');
  await document('registration');
  const verify = (who, data, id = companyId) => ent('verify', who, { companyId: id, legalExists: true, mandateOk: true, decision: 'approved', ...data });
  await status(verify('officer', {}), 422, 'mandat manquant');
  await document('mandate');
  await status(verify('officer', { mandateOk: false }), 422, 'contrôles requis');
  await status(verify('owner', {}), 403, 'auto-vérification');
  await okay(verify('officer', {}));
  await status(verify('officer', {}), 409, 'déjà approuvée');
  // Fictitious company: rejected with a reason.
  const fake = (await okay(ent('register', 'fake', { ...company, name: 'Société fantôme (test)', registrationNumber: 'FAUX-0000' }))).companyId;
  await status(ent('verify', 'officer', { companyId: fake, decision: 'rejected' }), 400, 'refus motivé');
  await okay(ent('verify', 'officer', { companyId: fake, decision: 'rejected', reason: 'Immatriculation introuvable au registre (test)' }));
  // Public directory shows the public profile only.
  const directory = await (await get('/entreprises')).text();
  assert.ok(!directory.includes('Adresse privée'), 'informations privées non publiées');

  // 2. Team, visibility and loss of rights.
  await status(ent('members', 'outsider', { companyId, login: 'stg.recruiter', role: 'recruiter' }), 403, 'équipe gérée par le responsable');
  await okay(ent('members', 'owner', { companyId, login: 'stg.recruiter', role: 'recruiter' }));
  await okay(ent('members', 'owner', { companyId, login: 'stg.tutor', role: 'tutor', jobTitle: 'Ingénieure' }));
  await okay(ent('members', 'owner', { companyId, login: 'stg.second', role: 'tutor' }));
  await status(ent('members', 'owner', { companyId, login: 'inconnu.x', role: 'tutor' }), 404, 'compte inconnu');
  assert.equal((await okay(get('/api/v1/ent/me', 'recruiter'))).companies[0].documents.length, 0, 'pièces réservées au responsable');
  assert.equal((await okay(get('/api/v1/ent/me', 'outsider'))).companies.length, 0);
  await status(get(`/api/v1/ent/scopes?scopeId=${univ.id}`, 'owner'), 403, 'vue établissement réservée');

  // 3. Partnership signed by both sides; report handled.
  const partnership = (await okay(ent('partnerships', 'officer', { companyId, title: 'Convention de partenariat (test)', terms: 'Accueil de stagiaires et interventions (test).', startsOn: at(0), endsOn: at(365) }))).partnershipId;
  await status(ent('partnership-sign', 'recruiter', { partnershipId: partnership, party: 'company' }), 403, 'signature par le responsable');
  await okay(ent('partnership-sign', 'owner', { partnershipId: partnership, party: 'company' }));
  await okay(ent('partnership-sign', 'officer', { partnershipId: partnership, party: 'institution' }));
  assert.equal((await database.query('SELECT state FROM unoa.partnership WHERE id = $1', [partnership])).rows[0].state, 'active');
  await okay(ent('report', 'outsider', { companyId, reason: 'Offre trompeuse signalée (test)' }));
  const overview = await okay(get(`/api/v1/ent/scopes?scopeId=${univ.id}`, 'officer'));
  await okay(ent('handle-report', 'officer', { reportId: overview.reports[0].id, outcome: 'Vérifié : offre corrigée (test)' }));
  assert.ok(overview.activity.some(row => row.action === 'member.added'), 'activité des recruteurs tracée');

  // 4. Internship request and eligibility.
  const request = { companyId, registrationId: student.registration_id, unitId: unit, title: 'Développement d’une application (test)', missions: 'Analyse, développement et tests d’une application.',
    startsOn: at(1), endsOn: at(90), weeklyHours: 35 };
  await status(stg('request', 's1', { ...request, companyId: fake }), 422, 'entreprise refusée');
  await status(stg('request', 'outsider', { companyId, freeTraining: 'Formation libre', title: 'X', missions: 'Missions du stage', startsOn: at(1), endsOn: at(10), weeklyHours: 20 }), 403, 'non-étudiant');
  await status(stg('request', 'outsider', { ...request }), 403, 'inscription d’un autre');
  const internship = (await okay(stg('request', 's1', request))).internshipId;
  await status(stg('decide', 's1', { internshipId: internship, decision: 'approved' }), 403, 'auto-décision');
  await status(stg('decide', 'officer', { internshipId: internship, decision: 'rejected' }), 400, 'refus motivé');
  await okay(stg('decide', 'officer', { internshipId: internship, decision: 'approved' }));

  // 5. Template approved by another person, grid, supervisors, agreement.
  const template = (await okay(stg('templates', 'officer', { scopeId: univ.id, title: 'Convention de stage (test)', legalReference: 'Texte applicable saisi par l’établissement (test)',
    body: 'Convention entre {{etudiant}}, {{entreprise}} représentée par {{representant}} et {{etablissement}}. Stage « {{titre}} » du {{debut}} au {{fin}}, {{heures}} h par semaine. Missions : {{missions}}. Maître de stage : {{maitre_de_stage}} ; encadreur : {{encadreur}}.' }))).templateId;
  const grid = (await okay(stg('grids', 'officer', { scopeId: univ.id, title: 'Grille de stage (test)', scale: 20, criteria: 'Savoir-faire = 3\nComportement = 1' }))).gridId;
  await status(stg('grids', 'officer', { scopeId: univ.id, title: 'Grille invalide', scale: 20, criteria: 'Sans poids' }), 400, 'critère mal formé');
  await status(stg('agreement', 'officer', { internshipId: internship, templateId: template, gridId: grid }), 422, 'modèle non approuvé');
  await status(stg('approve-template', 'officer', { templateId: template }), 403, 'approbation par l’auteur');
  await okay(stg('approve-template', 'signer', { templateId: template }));
  await status(stg('agreement', 'officer', { internshipId: internship, templateId: template, gridId: grid }), 422, 'encadrants requis');
  await status(stg('supervisors', 'recruiter', { internshipId: internship, role: 'company', accountId: ids.outsider }), 422, 'maître de stage hors entreprise');
  await status(stg('supervisors', 'recruiter', { internshipId: internship, role: 'academic', accountId: ids.academic }), 403, 'encadreur désigné par l’établissement');
  await okay(stg('supervisors', 'recruiter', { internshipId: internship, role: 'company', accountId: ids.tutor }));
  await okay(stg('supervisors', 'officer', { internshipId: internship, role: 'academic', accountId: ids.academic }));
  await okay(stg('agreement', 'officer', { internshipId: internship, templateId: template, gridId: grid }));
  let file = await okay(get(`/api/v1/stg/internships/${internship}`, 's1'));
  assert.match(file.internship.agreement, /Stage « Développement d’une application \(test\) »/);
  assert.match(file.internship.agreement, /Référence juridique/);
  const digest = file.internship.agreement_sha256;

  // 6. Three signatures on the same digest.
  await status(stg('sign', 's1', { internshipId: internship, sha256: 'a'.repeat(64) }), 409, 'empreinte différente');
  await status(stg('sign', 'tutor', { internshipId: internship, sha256: digest }), 403, 'le maître de stage ne signe pas pour l’entreprise');
  await okay(stg('sign', 's1', { internshipId: internship, sha256: digest }));
  await status(stg('sign', 's1', { internshipId: internship, sha256: digest }), 409, 'déjà signé');
  await okay(stg('sign', 'recruiter', { internshipId: internship, sha256: digest }));
  await okay(stg('sign', 'signer', { internshipId: internship, sha256: digest }));
  assert.equal((await okay(get(`/api/v1/stg/internships/${internship}`, 's1'))).internship.state, 'active');

  // 7. Logs, absent tutor, messages, extension.
  const log = (who, data) => stg('log', who, { internshipId: internship, entryOn: at(2), body: 'Installation et découverte (test)', ...data });
  await okay(log('s1', {}));
  await status(log('s1', { kind: 'absence' }), 403, 'absence signalée par un encadrant');
  await okay(stg('event', 's1', { internshipId: internship, kind: 'tutor_absent', reason: 'Maître de stage en congé prolongé (test)' }));
  await status(log('s1', {}), 422, 'maître de stage absent');
  await okay(stg('supervisors', 'owner', { internshipId: internship, role: 'company', accountId: ids.second }));
  await okay(log('second', { kind: 'absence', body: 'Absence non justifiée le lundi (test)' }));
  await okay(stg('message', 'recruiter', { internshipId: internship, body: 'Merci pour le premier compte rendu (test).' }));
  await status(stg('message', 'outsider', { internshipId: internship, body: 'Intrusion' }), 403, 'échanges réservés');
  await status(stg('event', 's1', { internshipId: internship, kind: 'extend', reason: 'x', newEnd: at(120) }), 403, 'prolongation par l’établissement');
  await okay(stg('event', 'officer', { internshipId: internship, kind: 'extend', reason: 'Projet prolongé (test)', newEnd: at(120) }));
  await okay(stg('event', 'recruiter', { internshipId: internship, kind: 'dispute', reason: 'Désaccord sur les horaires (test)' }));
  await okay(stg('event', 'officer', { internshipId: internship, kind: 'resolve', reason: 'Horaires précisés (test)' }));
  await status(stg('event', 'officer', { internshipId: internship, kind: 'resolve', reason: 'Bis' }), 409, 'aucun litige ouvert');

  // 8. Confidential report, reviews on the grid, academic validation.
  await status(stg('review', 'second', { internshipId: internship, score0: 15, score1: 16 }), 409, 'évaluation avant rapport');
  assert.match((await upload('/api/v1/stg/reports', 's1', { internshipId: internship, confidential: 'on', return: '/stages' }, new TextEncoder().encode('<html>'), 'r.pdf')).headers.get('location'), /error=400/);
  await upload('/api/v1/stg/reports', 's1', { internshipId: internship, confidential: 'on', return: '/stages' }, pdf('rapport'), 'rapport.pdf');
  const companyView = await okay(get(`/api/v1/stg/internships/${internship}`, 'recruiter'));
  assert.equal(companyView.reports.length, 0, 'rapport confidentiel masqué au recruteur');
  const tutorView = await okay(get(`/api/v1/stg/internships/${internship}`, 'second'));
  await status(get(`/api/v1/stg/reports/${tutorView.reports[0].id}`, 'recruiter'), 403, 'fichier confidentiel');
  await status(get(`/api/v1/stg/reports/${tutorView.reports[0].id}`, 'second'), 200, 'maître de stage');
  await status(stg('review', 'second', { internshipId: internship, score0: 25, score1: 16 }), 400, 'note hors barème');
  assert.equal((await okay(stg('review', 'second', { internshipId: internship, score0: 15, score1: 11, comment: 'Stagiaire autonome (test)' }))).mark, 14);
  await status(stg('review', 'second', { internshipId: internship, score0: 15, score1: 11 }), 409, 'une évaluation par partie');
  await status(stg('validate', 'validator', { internshipId: internship }), 422, 'deux évaluations requises');
  await okay(stg('review', 'academic', { internshipId: internship, score0: 14, score1: 14 }));
  assert.equal((await okay(get(`/api/v1/stg/internships/${internship}`, 's1'))).reviews.length, 0, 'évaluations visibles après validation');
  await status(stg('validate', 'officer', { internshipId: internship }), 403, 'validation académique réservée');
  await okay(stg('validate', 'validator', { internshipId: internship }));
  file = await okay(get(`/api/v1/stg/internships/${internship}`, 's1'));
  assert.equal(file.internship.state, 'validated');
  assert.equal(Number(file.mark), 14);
  assert.equal(file.reviews.length, 2);
  const { rows: [grade] } = await database.query("SELECT mark, state FROM unoa.grade_entry WHERE registration_id = $1 AND unit_id = $2 AND reason = 'Note de stage'", [student.registration_id, unit]);
  assert.deepEqual([Number(grade.mark), grade.state], [14, 'provisional'], 'note provisoire transmise aux notes');

  // 9. Agreement broken on a second internship.
  const other = (await okay(stg('request', 's1', { ...request, unitId: '', title: 'Second stage (test)' }))).internshipId;
  await okay(stg('event', 'officer', { internshipId: other, kind: 'postpone', reason: 'Report demandé (test)', newStart: at(30), newEnd: at(60) }));
  await okay(stg('decide', 'officer', { internshipId: other, decision: 'approved' }));
  await okay(stg('supervisors', 'owner', { internshipId: other, role: 'company', accountId: ids.tutor }));
  await okay(stg('supervisors', 'officer', { internshipId: other, role: 'academic', accountId: ids.academic }));
  await okay(stg('agreement', 'officer', { internshipId: other, templateId: template, gridId: grid }));
  await okay(stg('event', 'officer', { internshipId: other, kind: 'break', reason: 'Rupture d’un commun accord (test)' }));
  assert.equal((await okay(get(`/api/v1/stg/internships/${other}`, 's1'))).internship.state, 'broken');

  // 10. Statistics by region and isolation.
  const stats = await okay(get(`/api/v1/stg/scopes?scopeId=${univ.id}`, 'officer'));
  assert.ok(stats.statistics.some(row => row.state === 'validated' && row.total >= 1 && row.region), 'statistiques par territoire');
  await status(get(`/api/v1/stg/internships/${internship}`, 'outsider'), 403, 'isolation');
  await status(get(`/api/v1/stg/scopes?scopeId=${univ.id}`, 'recruiter'), 403, 'vue établissement réservée');

  // 11. Departure of a member and closure with purge.
  const team = (await okay(get('/api/v1/ent/me', 'owner'))).companies[0].members;
  await okay(ent('remove-member', 'owner', { companyId, memberId: team.find(row => row.name === 'Stage recruiter').id }));
  assert.equal((await okay(get('/api/v1/ent/me', 'recruiter'))).companies.length, 0, 'droits perdus après départ');
  await status(stg('message', 'recruiter', { internshipId: internship, body: 'Après départ' }), 403, 'plus d’accès au stage');
  const documentId = (await okay(get(`/api/v1/ent/scopes?scopeId=${univ.id}`, 'officer'))).companies.find(row => row.id === companyId).documents[0].id;
  await status(get(`/api/v1/ent/documents/${documentId}`, 'officer'), 200, 'pièce lisible avant clôture');
  await okay(ent('close', 'owner', { companyId, reason: 'Cessation d’activité (test)' }));
  await status(get(`/api/v1/ent/documents/${documentId}`, 'officer'), 410, 'pièces purgées');
  assert.equal((await okay(get('/api/v1/ent/me', 'owner'))).companies.length, 0);
  assert.ok((await database.query('SELECT 1 FROM unoa.company_verification WHERE company_id = $1', [companyId])).rows[0], 'historique conservé');
}
