import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Admissions: campaign built without code, candidate file with documents,
// receipt, complement, administrative and academic instruction, decision,
// acceptance, appeal ruled by another person, and isolation between candidates.
// The catalogue workflow itself is covered by the academic fixture; here the
// published, authorized programme is seeded directly.
export async function exerciseAdmissions({ database, issuer, login, call, origin }) {
  const names = ['manager', 'reviewer', 'decider', 'appeals', 'first', 'second', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  await database.query(`
    INSERT INTO unoa.access_role VALUES ('adm_manager'), ('adm_reviewer'), ('adm_decider'), ('adm_appeals');
    INSERT INTO unoa.permission VALUES ('adm.read'), ('adm.manage'), ('adm.review'), ('adm.decide'), ('adm.appeal');
    INSERT INTO unoa.role_permission VALUES ('adm_manager', 'adm.read'), ('adm_manager', 'adm.manage'),
      ('adm_reviewer', 'adm.read'), ('adm_reviewer', 'adm.review'), ('adm_decider', 'adm.read'), ('adm_decider', 'adm.decide'),
      ('adm_appeals', 'adm.read'), ('adm_appeals', 'adm.appeal');
  `);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id) VALUES ($1)', [id]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'adm-' + name, id]);
  }
  await database.query(`
    INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants)
    VALUES ($1, $5, 'adm_manager', now(), true), ($2, $5, 'adm_reviewer', now(), true), ($3, $5, 'adm_decider', now(), true),
           ($4, $5, 'adm_appeals', now(), true)
  `, [ids.manager, ids.reviewer, ids.decider, ids.appeals, univ.id]);
  const program = randomUUID();
  const version = randomUUID();
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.program_kind(code, label, degree_awarding) VALUES ('adm_certificat', 'Certificat de recette', false);
    INSERT INTO unoa.program(id, owner_scope_id, institution_id, kind_code, code, title, created_by)
      VALUES ('${program}', '${univ.id}', '${univ.id}', 'adm_certificat', 'ADM-CERT', 'Certificat fictif', '${ids.manager}');
    INSERT INTO unoa.program_authorization(program_id, status, authority, evidence, valid_from, recorded_by, verified_by, verified_at)
      VALUES ('${program}', 'non_degree', 'Établissement fictif', 'Délibération fictive SANDBOX', now() - interval '1 day', '${ids.manager}', '${ids.decider}', now());
    INSERT INTO unoa.program_version(id, program_id, number, state, title, organisation, duration, delivery_mode, credit_unit, author_id, published_at, admission_open)
      VALUES ('${version}', '${program}', 1, 'published', 'Certificat fictif de recette', 'Semestres', '6 mois', 'À distance', 'ECTS', '${ids.manager}', now(), true);
    COMMIT;`);

  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('adm-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (path, who, data) => call(path, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  const upload = (applicationId, who, key, name, bytes) => {
    const body = new FormData();
    body.set('key', key);
    body.set('return', '/candidature/' + applicationId);
    body.set('file', new Blob([bytes]), name);
    return call(`${api}applications/${applicationId}/documents`, { method: 'POST', headers: { Origin: origin, Cookie: cookies[who] }, body, redirect: 'manual' });
  };
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = (response, expected, label) => assert.equal(response.status, expected, label);
  const api = '/api/v1/admissions/';
  const at = hours => new Date(Date.now() + hours * 3_600_000).toISOString();
  const pdf = new TextEncoder().encode('%PDF-1.4\n% pièce fictive\n');

  // 1. A campaign is configured without code; invalid rules are refused.
  const rules = {
    versionId: version, label: 'Rentrée de recette', opensAt: at(-1), closesAt: at(48),
    form: 'nom | Nom complet | text | oui\ncourriel | Courriel | email | oui\nserie | Série du baccalauréat | choice | oui | A ; C ; D\nmotivation | Motivation | textarea | non',
    documents: 'releve | Relevé de notes | pdf | 64 | oui\nphoto | Photo | jpg,png | 64 | non',
    criteria: 'dossier | Dossier scolaire | 60 | 20\nmotivation | Motivation | 40 | 10',
    instructions: 'Consignes de recette.',
  };
  await status(await post(api + 'rounds', 'reviewer', rules), 403, 'création sans adm.manage');
  await status(await post(api + 'rounds', 'manager', { ...rules, form: 'Nom invalide | x | text' }), 400, 'formulaire invalide');
  await status(await post(api + 'rounds', 'manager', { ...rules, criteria: 'dossier | Dossier | 0 | 20' }), 400, 'critère invalide');
  const round = (await okay(await post(api + 'rounds', 'manager', rules))).id;
  const { rows: site } = await database.query('SELECT site_id FROM unoa.site_host WHERE host = $1', [new URL(origin).host]);
  const rounds = () => database.query('SELECT round_id FROM unoa.public_rounds($1, $2)', [site[0].site_id, program]);
  assert.equal((await rounds()).rowCount, 0, 'brouillon non publié');
  await status(await post(`${api}rounds/${round}/apply`, 'first', {}), 422, 'candidature sur un brouillon');
  await okay(await post(`${api}rounds/${round}/open`, 'manager', {}));
  assert.equal((await rounds()).rowCount, 1);
  assert.match(await (await get(`/formations/${program}`)).text(), /Rentrée de recette/);
  await assert.rejects(database.query("UPDATE unoa.admission_round SET form = '[]' WHERE id = $1", [round]), /keeps its form/);

  // 2. Candidate file: answers, documents checked by type and signature, completeness.
  const first = (await okay(await post(`${api}rounds/${round}/apply`, 'first', {}))).id;
  assert.equal((await okay(await post(`${api}rounds/${round}/apply`, 'first', {}))).id, first, 'une candidature par campagne');
  const second = (await okay(await post(`${api}rounds/${round}/apply`, 'second', {}))).id;
  await status(await post(`${api}applications/${first}/answers`, 'first', { nom: 'Candidat Un', courriel: 'pas-un-courriel', serie: 'C' }), 400, 'courriel');
  await status(await post(`${api}applications/${first}/answers`, 'first', { nom: 'Candidat Un', courriel: 'un@example.test', serie: 'Z' }), 400, 'choix hors liste');
  await okay(await post(`${api}applications/${first}/answers`, 'first', { nom: 'Candidat Un', courriel: 'un@example.test', serie: 'C' }));
  await status(await post(`${api}applications/${first}/answers`, 'second', { nom: 'Intrus' }), 403, 'dossier d’un autre candidat');
  await status(await get(`${api}applications/${first}`, 'second'), 403, 'lecture croisée');
  await status(await get(`${api}applications/${first}`, 'outsider'), 403, 'lecture sans droit');
  await status(await post(`${api}applications/${first}/submit`, 'first', {}), 422, 'pièce obligatoire manquante');
  let sent = await upload(first, 'first', 'releve', 'releve.pdf', new TextEncoder().encode('<html>faux</html>'));
  assert.match(sent.headers.get('location'), /error=400/, 'signature refusée');
  sent = await upload(first, 'first', 'releve', 'releve.exe', pdf);
  assert.match(sent.headers.get('location'), /error=400/, 'extension refusée');
  sent = await upload(first, 'first', 'releve', 'gros.pdf', new Uint8Array([...pdf, ...new Uint8Array(70 * 1024)]));
  assert.match(sent.headers.get('location'), /error=413/, 'taille');
  assert.match((await upload(first, 'second', 'releve', 'r.pdf', pdf)).headers.get('location'), /error=403/, 'dépôt croisé');
  sent = await upload(first, 'first', 'releve', 'releve.pdf', pdf);
  assert.match(sent.headers.get('location'), /\/candidature\/.*message=saved/);
  await upload(first, 'first', 'releve', 'releve-v2.pdf', pdf);
  let view = await okay(await get(`${api}applications/${first}`, 'first'));
  assert.equal(view.documents.length, 1, 'la pièce remplacée sort du dossier courant');
  assert.equal(view.completeness.complete, true);
  assert.equal(view.reviews.length, 0);
  const document = view.documents[0].id;
  await status(await get(`/api/v1/admissions-documents/${document}`, 'second'), 403, 'pièce d’un autre candidat');
  const file = await get(`/api/v1/admissions-documents/${document}`, 'reviewer');
  assert.equal(file.headers.get('content-type'), 'application/pdf');
  assert.match(file.headers.get('content-disposition'), /^attachment/);
  await assert.rejects(database.query("UPDATE unoa.application_document SET filename = 'x' WHERE id = $1", [document]), /never rewritten/);

  // 3. Submission: receipt and notification; the file is then frozen.
  await okay(await post(`${api}applications/${first}/submit`, 'first', {}));
  view = await okay(await get(`${api}applications/${first}`, 'first'));
  assert.equal(view.application.state, 'submitted');
  assert.match(view.application.receipt, /^ADM-\d{4}-[0-9A-F]{12}$/);
  assert.equal(view.revisions.length, 1);
  await status(await post(`${api}applications/${first}/answers`, 'first', { nom: 'Après dépôt', courriel: 'un@example.test', serie: 'C' }), 409, 'dossier figé');
  const { rows: inbox } = await database.query("SELECT title FROM unoa.notification WHERE account_id = $1 AND kind = 'adm.update'", [ids.first]);
  assert.match(inbox[0].title, /Accusé de réception/);

  // 4. Instruction: complement, re-submission, document check, reviews.
  await status(await post(`${api}applications/${first}/request`, 'manager', { message: 'x' }), 403, 'complément sans adm.review');
  await okay(await post(`${api}applications/${first}/request`, 'reviewer', { message: 'Joindre une photo lisible.' }));
  view = await okay(await get(`${api}applications/${first}`, 'first'));
  assert.equal(view.application.state, 'incomplete');
  await okay(await post(`${api}applications/${first}/answers`, 'first', { nom: 'Candidat Un', courriel: 'un@example.test', serie: 'C', motivation: 'Projet professionnel.' }));
  await okay(await post(`${api}applications/${first}/submit`, 'first', {}));
  view = await okay(await get(`${api}applications/${first}`, 'reviewer'));
  assert.equal(view.revisions.length, 2);
  assert.ok(view.requests.every(item => item.answered_at));
  await status(await post(`${api}applications/${first}/document`, 'reviewer', { documentId: document, state: 'rejected' }), 400, 'rejet non motivé');
  await okay(await post(`${api}applications/${first}/document`, 'reviewer', { documentId: document, state: 'verified' }));
  await status(await post(`${api}applications/${first}/decide`, 'decider', { decision: 'admitted', reason: 'x' }), 422, 'décision sans instruction');
  await status(await post(`${api}applications/${first}/review`, 'reviewer', { kind: 'academic', score_dossier: 25, score_motivation: 5, recommendation: 'favourable', note: 'x' }), 400, 'note hors barème');
  await okay(await post(`${api}applications/${first}/review`, 'reviewer', { kind: 'academic', score_dossier: 15, score_motivation: 8, recommendation: 'favourable', note: 'Bon dossier.' }));
  await okay(await post(`${api}applications/${first}/review`, 'reviewer', { kind: 'administrative', recommendation: 'favourable', note: 'Pièces conformes.' }));
  await okay(await post(`${api}applications/${first}/interview`, 'reviewer', { kind: 'Entretien', scheduledAt: at(24), place: 'https://visio.recette.invalid/entretien' }));
  view = await okay(await get(`${api}applications/${first}`, 'decider'));
  assert.equal(Number(view.reviews.find(item => item.kind === 'academic').score), 77, '60×15/20 + 40×8/10');
  assert.equal(view.application.state, 'review');
  const candidateView = await okay(await get(`${api}applications/${first}`, 'first'));
  assert.equal(candidateView.reviews.length, 0, 'avis internes non communiqués');

  // 5. Decision, appeal by the candidate, ruling by another person.
  await status(await post(`${api}applications/${first}/decide`, 'reviewer', { decision: 'admitted', reason: 'x' }), 403, 'décision sans adm.decide');
  await status(await post(`${api}applications/${first}/decide`, 'decider', { decision: 'conditional', reason: 'Niveau' }), 400, 'conditions requises');
  await okay(await post(`${api}applications/${first}/decide`, 'decider', { decision: 'waitlisted', reason: 'Capacité atteinte.' }));
  await assert.rejects(database.query("UPDATE unoa.application_decision SET reason = 'x' WHERE application_id = $1", [first]), /append|history|immutable/i);
  await status(await post(`${api}applications/${first}/accept`, 'first', {}), 422, 'liste d’attente non acceptable');
  await okay(await post(`${api}applications/${first}/appeal`, 'first', { reason: 'Erreur de calcul de la moyenne.' }));
  await status(await post(`${api}applications/${first}/rule`, 'decider', { ruling: 'granted', note: 'x' }), 403, 'recours sans adm.appeal');
  await database.query("INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, 'adm_appeals', now(), true)", [ids.decider, univ.id]);
  await status(await post(`${api}applications/${first}/rule`, 'decider', { ruling: 'granted', note: 'x' }), 422, 'auteur de la décision');
  await okay(await post(`${api}applications/${first}/rule`, 'appeals', { ruling: 'granted', note: 'Moyenne recalculée.' }));
  await okay(await post(`${api}applications/${first}/decide`, 'decider', { decision: 'admitted', reason: 'Réexamen favorable.' }));
  await okay(await post(`${api}applications/${first}/accept`, 'first', {}));
  view = await okay(await get(`${api}applications/${first}`, 'first'));
  assert.equal(view.application.state, 'accepted');
  assert.deepEqual(view.decisions.map(item => item.decision), ['waitlisted', 'admitted']);

  // 6. Withdrawal, dashboard, staff screens and menus.
  await okay(await post(`${api}applications/${second}/withdraw`, 'second', {}));
  const listing = await okay(await get(`${api}rounds/${round}`, 'reviewer'));
  assert.deepEqual(listing.applications.map(item => item.applicant), ['Candidat Un'], 'les brouillons et retraits sans dépôt restent privés');
  assert.equal((await get(`${api}rounds/${round}`, 'outsider')).status, 403);
  const overview = await okay(await get(`${api}scopes?scopeId=${univ.id}`, 'manager'));
  assert.equal(overview.rounds.find(item => item.id === round).counts.accepted, 1);
  assert.match(await (await get(`/administration/admissions?application=${first}`, 'decider')).text(), /Réexamen favorable/);
  assert.match(await (await get(`/candidature/${first}`, 'first')).text(), /Admission acceptée/);
  assert.equal((await get(`/candidature/${first}`, 'second')).status, 404);
  assert.match(await (await get('/', 'manager')).text(), /href="\/administration\/admissions"/);
  assert.doesNotMatch(await (await get('/', 'outsider')).text(), /href="\/administration\/admissions"/);
  await okay(await post(`${api}rounds/${round}/close`, 'manager', {}));
  await status(await post(`${api}rounds/${round}/apply`, 'outsider', {}), 422, 'campagne close');
  const { rows: audits } = await database.query("SELECT DISTINCT action FROM unoa.audit_event WHERE action LIKE 'adm.%' ORDER BY action");
  for (const action of ['adm.access', 'adm.application_submit', 'adm.decide', 'adm.document_deposited', 'adm.round_created', 'adm.round_open', 'adm.rule']) {
    assert.ok(audits.some(row => row.action === action), action);
  }
}
