import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Careers and opportunities (lot 028): fraudulent offer held for review and
// suspended, report, alerts, explainable suggestions, consent required,
// late application refused, frozen snapshot, recruiter access restricted and
// logged, statuses and interview, withdrawal erasing documents, profile shared
// only with consent and revocable, skill levels from evidence (declared vs
// validated), CV PDF, portable export, anonymised statistics. Runs after the
// grades fixture (student NOTES-S1 with credits awarded).
export async function exerciseCareers({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [award] } = await database.query(`SELECT award.unit_id, unit.version_id, student.account_id FROM unoa.credit_award AS award JOIN unoa.student ON student.id = award.student_id
    JOIN unoa.teaching_unit AS unit ON unit.id = award.unit_id WHERE student.matricule = 'NOTES-S1' AND award.revoked_at IS NULL LIMIT 1`);
  assert.ok(award, 'crédits accordés à l’étudiant (recette des notes)');
  const names = ['officer', 'owner', 'recruiter', 'rival', 'candidate'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`INSERT INTO unoa.access_role(code) VALUES ('car_officer_t');
    INSERT INTO unoa.role_permission VALUES ('car_officer_t', 'ent.read'), ('car_officer_t', 'ent.verify'), ('car_officer_t', 'ent.manage');`);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Carrière ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'car-' + name, id]);
  }
  await database.query("INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, 'car_officer_t', now(), true)", [ids.officer, univ.id]);
  // Test-only: two approved companies with their teams; competencies on the awarded unit.
  const company = randomUUID(); const rival = randomUUID(); const skill = randomUUID(); const other = randomUUID();
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.company(id, scope_id, name, registration_number, country, representative_name, representative_title, state, created_by)
      VALUES ('${company}', '${univ.id}', 'Data Conseil (test)', 'RB-DC-0001', 'Bénin', 'Gérante', 'Gérante', 'approved', '${ids.owner}'),
             ('${rival}', '${univ.id}', 'Concurrent (test)', 'RB-CC-0002', 'Bénin', 'Gérant', 'Gérant', 'approved', '${ids.rival}');
    INSERT INTO unoa.company_member(company_id, account_id, role, added_by) VALUES ('${company}', '${ids.owner}', 'owner', '${ids.owner}'),
      ('${company}', '${ids.recruiter}', 'recruiter', '${ids.owner}'), ('${rival}', '${ids.rival}', 'owner', '${ids.rival}');
    INSERT INTO unoa.competency(id, owner_scope_id, code, label, created_by) VALUES ('${skill}', '${univ.id}', 'CAR-DATA', 'Analyse de données (test)', '${ids.officer}'),
      ('${other}', '${univ.id}', 'CAR-COM', 'Communication écrite (test)', '${ids.officer}');
    INSERT INTO unoa.version_competency(version_id, competency_id) VALUES ('${award.version_id}', '${skill}');
    INSERT INTO unoa.unit_competency(unit_id, version_id, competency_id, level) VALUES ('${award.unit_id}', '${award.version_id}', '${skill}', 'Maîtrise');
    COMMIT;`);
  const cookies = {};
  for (const subject of [...names.map(name => 'car-' + name), 'grd-s1']) {
    issuer.useIdentity(subject, 'test-mfa');
    cookies[subject.replace(/^(car|grd)-/, '')] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/car/' + action, { method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const multipart = (action, who, fields, files = {}) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.set(key, value);
    for (const [key, bytes] of Object.entries(files)) body.set(key, new Blob([bytes]), key + '.pdf');
    return call('/api/v1/car/' + action, { method: 'POST', headers: { Origin: origin, Cookie: cookies[who] }, body, redirect: 'manual' });
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
  const later = days => new Date(Math.floor((Date.now() + days * 864e5) / 6e4) * 6e4).toISOString().slice(0, 16);
  const offer = { companyId: company, kind: 'internship', title: 'Stage analyste de données (test)', description: 'Analyse de données agricoles et tableaux de bord pour nos clients.',
    country: 'Bénin', city: 'Cotonou', languages: 'fr', competencies: [skill], requiredDocuments: ['cv'], closesAt: later(30) };

  // 1. Alert opted in before publication; fraudulent offer held, then suspended.
  await okay(post('alert', 's1', { label: 'Stages au Bénin', kind: 'internship', country: 'Bénin' }));
  const fraud = await okay(post('opportunities', 'recruiter', { ...offer, title: 'Stage rémunéré (test)', description: 'Frais de dossier de 10 000 F à payer par mobile money avant l’entretien, contact WhatsApp.' }));
  assert.equal(fraud.state, 'review');
  assert.ok(fraud.flags.includes('Paiement demandé au candidat'));
  await status(post('opportunities', 'rival', { ...offer }), 403, 'offre pour une autre entreprise');
  assert.ok(!(await (await get('/offres')).text()).includes('Stage rémunéré (test)'), 'offre à risque non publiée');
  await status(post('moderate', 'owner', { opportunityId: fraud.opportunityId, decision: 'published' }), 403, 'modération par l’établissement');
  await status(post('moderate', 'officer', { opportunityId: fraud.opportunityId, decision: 'suspended' }), 400, 'suspension motivée');
  await okay(post('moderate', 'officer', { opportunityId: fraud.opportunityId, decision: 'suspended', note: 'Paiement exigé des candidats (test)' }));
  const published = await okay(post('opportunities', 'recruiter', offer));
  assert.equal(published.state, 'published');
  const offerId = published.opportunityId;
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'job.alert'", [award.account_id])).rows[0], 'alerte notifiée');
  assert.match(await (await get('/offres?country=Bénin&kind=internship')).text(), /Stage analyste de données/, 'recherche filtrée');
  await okay(post('report-opportunity', 'candidate', { opportunityId: offerId, reason: 'Vérification demandée (test)' }));
  let overview = await okay(get(`/api/v1/car/scopes?scopeId=${univ.id}`, 'officer'));
  await okay(post('handle-opportunity-report', 'officer', { reportId: overview.reports[0].id, outcome: 'Offre conforme (test)' }));

  // 2. Profile, skills by evidence, portfolio, CV.
  await okay(post('profile', 's1', { headline: 'Étudiant en économie (version 1)', country: 'Bénin', languages: 'fr, en', openToOffers: true }));
  await okay(post('declare', 's1', { competencyId: other, level: 'advanced' }));
  await okay(post('portfolio', 's1', { kind: 'experience', title: 'Bénévolat associatif (test)', organisation: 'Association', shared: true }));
  let space = await okay(get('/api/v1/car/me', 's1'));
  const { rows: [diploma] } = await database.query(`SELECT 1 FROM unoa.credential JOIN unoa.credential_type AS type ON type.id = credential.type_id
    WHERE credential.holder_id = $1 AND credential.state = 'issued' AND type.category = 'institutional_diploma'`, [award.account_id]);
  const proven = space.skills.find(item => item.competency_id === skill);
  assert.equal(proven.level, diploma ? 'certified' : 'validated', 'niveau prouvé : diplôme délivré, sinon crédits accordés');
  assert.match(proven.evidence, diploma ? /^Document délivré/ : /^Crédits accordés/);
  assert.equal(space.skills.find(item => item.competency_id === other).level, 'declared', 'compétence seulement déclarée');
  assert.equal(space.portfolio[0].verified, false, 'expérience externe non vérifiée');
  assert.ok(space.suggestions.some(item => item.id === offerId && item.reasons.some(reason => reason.includes('Analyse de données'))), 'suggestion expliquée');
  const cvId = (await okay(post('cv', 's1', { title: 'CV stage' }))).cvId;
  const pdf = await get(`/api/v1/car/cvs/${cvId}`, 's1');
  assert.equal(pdf.headers.get('content-type'), 'application/pdf');
  assert.ok(Buffer.from(await pdf.arrayBuffer()).toString('latin1').startsWith('%PDF-1.4'));
  await status(get(`/api/v1/car/cvs/${cvId}`, 'rival'), 403, 'CV privé');

  // 3. Applications: consent, window, snapshot, restricted and logged reading.
  await status(post('apply', 's1', { opportunityId: offerId, cvVersionId: cvId }), 422, 'consentement requis');
  await status(post('apply', 's1', { opportunityId: fraud.opportunityId, cvVersionId: cvId, consent: true }), 422, 'offre suspendue');
  await status(post('apply', 'recruiter', { opportunityId: offerId, consent: true, letter: 'x' }), 403, 'membre de l’entreprise');
  await status(post('apply', 'candidate', { opportunityId: offerId, consent: true }), 422, 'pièce exigée');
  const application = (await okay(post('apply', 's1', { opportunityId: offerId, cvVersionId: cvId, consent: true, letter: 'Motivé par vos projets (test).' }))).applicationId;
  await status(post('apply', 's1', { opportunityId: offerId, cvVersionId: cvId, consent: true }), 409, 'une candidature par offre');
  await okay(post('profile', 's1', { headline: 'Profil modifié après envoi', country: 'Bénin', languages: 'fr' }));
  await status(get(`/api/v1/car/applications/${application}`, 'rival'), 403, 'recruteur d’une autre entreprise');
  const read = await okay(get(`/api/v1/car/applications/${application}`, 'recruiter'));
  assert.equal(read.snapshot.profile.headline, 'Étudiant en économie (version 1)', 'instantané figé');
  assert.ok((await okay(get('/api/v1/car/me', 's1'))).access.some(row => row.resource === 'application'), 'lecture journalisée et visible');
  await status(get(`/api/v1/car/cvs/${cvId}`, 'recruiter'), 200, 'CV joint lisible par le recruteur');
  // Late application.
  const late = (await okay(post('opportunities', 'recruiter', { ...offer, title: 'Offre close (test)' }))).opportunityId;
  await database.query("UPDATE unoa.opportunity SET opens_at = now() - interval '2 days', closes_at = now() - interval '1 day' WHERE id = $1", [late]);
  await status(post('apply', 's1', { opportunityId: late, cvVersionId: cvId, consent: true }), 422, 'candidature tardive');

  // 4. Statuses and interview.
  await status(post('application-status', 'recruiter', { applicationId: application, state: 'offer' }), 409, 'étapes successives');
  await status(post('application-status', 'rival', { applicationId: application, state: 'shortlisted' }), 403);
  await okay(post('application-status', 'recruiter', { applicationId: application, state: 'shortlisted' }));
  await okay(post('interviews', 'recruiter', { applicationId: application, startsAt: later(3), durationMinutes: 45, mode: 'online', place: 'Salle en ligne' }));
  space = await okay(get('/api/v1/car/me', 's1'));
  const mine = space.applications.find(item => item.id === application);
  assert.equal(mine.state, 'interview');
  await okay(post('confirm-interview', 's1', { interviewId: mine.interviews[0].id }));
  await okay(post('application-status', 'recruiter', { applicationId: application, state: 'offer' }));

  // 5. Withdrawal erases documents and snapshot.
  const withdrawn = await multipart('apply', 'candidate', { opportunityId: offerId, consent: 'on', return: '/offres' }, { cvFile: new TextEncoder().encode('%PDF-1.4\n% cv\n') });
  assert.doesNotMatch(withdrawn.headers.get('location'), /error=/);
  const candidateApp = (await okay(get('/api/v1/car/me', 'candidate'))).applications[0].id;
  const document = (await okay(get(`/api/v1/car/applications/${candidateApp}`, 'recruiter'))).documents[0].id;
  await okay(post('withdraw', 'candidate', { applicationId: candidateApp }));
  await status(get(`/api/v1/car/documents/${document}`, 'recruiter'), 410, 'pièce effacée');
  assert.equal((await okay(get(`/api/v1/car/applications/${candidateApp}`, 'recruiter'))).snapshot.retire, true);

  // 6. Profile shared only with consent; revocation.
  await status(get(`/api/v1/car/profiles/${award.account_id}?companyId=${rival}`, 'rival'), 403, 'aucun accord');
  await status(post('consent', 's1', { companyId: rival }), 422, 'accord explicite');
  await okay(post('consent', 's1', { companyId: rival, agree: true }));
  const shared = await okay(get(`/api/v1/car/profiles/${award.account_id}?companyId=${rival}`, 'rival'));
  assert.ok(shared.declared.every(item => item.status.includes('non vérifiée')), 'déclaré jamais présenté comme attesté');
  space = await okay(get('/api/v1/car/me', 's1'));
  await okay(post('revoke', 's1', { consentId: space.consents[0].id }));
  await status(get(`/api/v1/car/profiles/${award.account_id}?companyId=${rival}`, 'rival'), 403, 'accord révoqué');
  assert.ok((await database.query("SELECT 1 FROM unoa.recruiter_access WHERE company_id = $1 AND resource = 'profile'", [rival])).rows[0], 'consultation journalisée');

  // 7. Export and anonymised statistics.
  const exported = await okay(get('/api/v1/car/export', 's1'));
  assert.equal(exported.format, 'unoa-career/1');
  assert.ok(exported.cvs.length === 1 && exported.skills.length >= 2);
  overview = await okay(get(`/api/v1/car/scopes?scopeId=${univ.id}`, 'officer'));
  const row = overview.statistics.find(item => item.kind === 'internship');
  assert.equal(row.applications, null, 'effectif inférieur à 5 masqué');
  await status(get(`/api/v1/car/scopes?scopeId=${univ.id}`, 'recruiter'), 403, 'statistiques réservées');
}
