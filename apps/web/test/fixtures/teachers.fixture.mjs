import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Teachers: call, profile, application with syllabus and documents, document
// control (falsified diploma), independent reviews, collegial decision, contract
// signed by both parties, assignment to a course offering within the contract
// volume, obligations, remuneration export, end of mission revoking access.
export async function exerciseTeachers({ database, issuer, login, call, origin }) {
  const names = ['admin', 'scientist', 'pedagogue', 'decider', 'candidate', 'forger'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  const { rows: [gamma] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Gamma'");
  const { rows: [offering] } = await database.query("SELECT id FROM unoa.course_offering WHERE owner_scope_id = $1 AND state = 'open' LIMIT 1", [gamma.id]);
  assert.ok(offering, 'une offre de cours ouverte existe (recette des cours)');
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('tea_admin'), ('tea_expert'), ('tea_decider');
    INSERT INTO unoa.role_permission VALUES ('tea_admin', 'tea.read'), ('tea_admin', 'tea.manage'), ('tea_admin', 'tea.verify'),
      ('tea_expert', 'tea.read'), ('tea_expert', 'tea.review'), ('tea_decider', 'tea.read'), ('tea_decider', 'tea.decide');
  `);
  const roles = { admin: 'tea_admin', scientist: 'tea_expert', pedagogue: 'tea_expert', decider: 'tea_decider' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Enseignement ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'tea-' + name, id]);
    if (roles[name]) await database.query("INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)", [id, gamma.id, roles[name]]);
  }
  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('tea-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/tea/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: { Cookie: cookies[who] } });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = (response, expected, label) => assert.equal(response.status, expected, label);
  const pdf = new TextEncoder().encode('%PDF-1.4\n% pièce fictive\n');
  const upload = (who, applicationId, kind, bytes = pdf, name = kind + '.pdf') => {
    const body = new FormData();
    body.set('applicationId', applicationId); body.set('kind', kind); body.set('return', '/enseignement'); body.set('file', new Blob([bytes]), name);
    return call('/api/v1/tea/documents', { method: 'POST', headers: { Origin: origin, Cookie: cookies[who] }, body });
  };
  const at = days => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

  // 1. Call, profile and application with a structured proposal.
  await status(await post('openings', 'candidate', { scopeId: gamma.id, title: 'X', discipline: 'X', level: 'X', description: 'X', closesAt: new Date(Date.now() + 864e5).toISOString() }), 403);
  await okay(await post('openings', 'admin', { scopeId: gamma.id, title: 'Enseignant en développement web', discipline: 'Informatique', level: 'Licence 2',
    region: 'Littoral', description: 'Cours de développement web en ligne.', closesAt: new Date(Date.now() + 864e5 * 10).toISOString() }));
  const { openings } = await okay(await get('/api/v1/tea/me', 'candidate'));
  const opening = openings.find(item => item.title === 'Enseignant en développement web').id;
  await status(await post('apply', 'candidate', { openingId: opening, courseTitle: 'Web' }), 422, 'profil requis');
  await okay(await post('profile', 'candidate', { title: 'Docteur', discipline: 'Informatique', publications: 'Article 2025', availability: 'Soirées' }));
  const application = (await okay(await post('apply', 'candidate', { openingId: opening, courseTitle: 'Développement web' }))).applicationId;
  await status(await post('apply', 'candidate', { openingId: opening, courseTitle: 'Bis' }), 409, 'une candidature par appel');
  await status(await post('submit', 'candidate', { applicationId: application }), 422, 'syllabus exigé');
  await okay(await post('proposal', 'candidate', { applicationId: application, courseTitle: 'Développement web', syllabus: '12 séances, projet final.', pedagogy: 'Classe inversée.' }));
  await status(await post('submit', 'candidate', { applicationId: application }), 422, 'diplôme et CV exigés');
  assert.match((await upload('candidate', application, 'diploma', new TextEncoder().encode('<html>'))).headers.get('location'), /error=400/, 'signature de fichier');
  assert.match((await upload('admin', application, 'diploma')).headers.get('location'), /error=403/, 'dépôt par un tiers');
  await upload('candidate', application, 'diploma');
  await upload('candidate', application, 'cv');
  await okay(await post('submit', 'candidate', { applicationId: application }));

  // 2. Control and independent reviews, collegial decision.
  let detail = await okay(await get(`/api/v1/tea/applications/${application}`, 'admin'));
  const diploma = detail.documents.find(item => item.kind === 'diploma').id;
  await status(await post('verify', 'candidate', { applicationId: application, documentId: diploma, state: 'verified' }), 403, 'auto-contrôle');
  await status(await post('verify', 'admin', { applicationId: application, documentId: diploma, state: 'rejected' }), 400, 'rejet motivé');
  await okay(await post('verify', 'admin', { applicationId: application, documentId: diploma, state: 'verified' }));
  const review = (who, kind) => post('review', who, { applicationId: application, kind, recommendation: 'favourable', note: 'Dossier solide.' });
  await okay(await review('scientist', 'scientific'));
  await status(await review('scientist', 'pedagogical'), 403, 'expertises indépendantes');
  await status(await post('decide', 'decider', { applicationId: application, decision: 'accepted', reason: 'x' }), 422, 'expertise pédagogique manquante');
  await okay(await review('pedagogue', 'pedagogical'));
  await okay(await review('pedagogue', 'interview'));
  await status(await post('decide', 'scientist', { applicationId: application, decision: 'accepted', reason: 'x' }), 403, 'décision sans droit');
  await okay(await post('decide', 'decider', { applicationId: application, decision: 'accepted', reason: 'Recrutement collégial.' }));
  const mine = await okay(await get(`/api/v1/tea/applications/${application}`, 'candidate'));
  assert.equal(mine.reviews.length, 0, 'avis internes non communiqués');
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'tea.application_decided'", [ids.candidate])).rows[0]);

  // 3. Contract signed by both parties, assignment within the volume.
  await okay(await post('contracts', 'admin', { applicationId: application, function: 'teacher', startsOn: at(-1), endsOn: at(120), hours: 20, hourlyRate: 5000, currency: 'XOF' }));
  let overview = await okay(await get(`/api/v1/tea/scopes?scopeId=${gamma.id}`, 'admin'));
  const contract = overview.contracts.find(item => item.name === 'Enseignement candidate').id;
  await status(await post('assign', 'admin', { contractId: contract, offeringId: offering.id, hours: 10 }), 422, 'affectation avant signature');
  await status(await post('sign', 'candidate', { contractId: contract }), 403, 'signature institutionnelle par le titulaire');
  await okay(await post('my-sign', 'candidate', { contractId: contract }));
  await okay(await post('sign', 'decider', { contractId: contract }));
  await okay(await post('assign', 'admin', { contractId: contract, offeringId: offering.id, hours: 10, function: 'teacher' }));
  await status(await post('assign', 'admin', { contractId: contract, offeringId: offering.id, hours: 15, function: 'tutor' }), 422, 'volume dépassé');
  const member = () => database.query('SELECT role, removed_at FROM unoa.offering_member WHERE offering_id = $1 AND account_id = $2 ORDER BY added_at DESC LIMIT 1', [offering.id, ids.candidate]);
  assert.equal((await member()).rows[0].role, 'teacher');
  const space = await okay(await get('/api/v1/tea/me', 'candidate'));
  const assignment = space.assignments[0].id;
  await okay(await post('obligations', 'admin', { contractId: contract, assignmentId: assignment, label: 'Corriger le devoir 1', dueOn: at(14) }));
  const obligation = (await okay(await get('/api/v1/tea/me', 'candidate'))).assignments[0].obligations[0].id;
  await okay(await post('obligation-done', 'candidate', { obligationId: obligation }));
  const csv = await (await get(`/api/v1/tea/remuneration?scopeId=${gamma.id}`, 'admin')).text();
  assert.match(csv, /Enseignement candidate;Enseignant;.*;20\.00;5000\.00;XOF;100000\.00;signed/);
  await status(await get(`/api/v1/tea/remuneration?scopeId=${gamma.id}`, 'candidate'), 403);

  // 4. Falsified diploma stops an application.
  await okay(await post('profile', 'forger', { discipline: 'Informatique' }));
  const forged = (await okay(await post('apply', 'forger', { openingId: opening, courseTitle: 'Réseaux' }))).applicationId;
  await okay(await post('proposal', 'forger', { applicationId: forged, courseTitle: 'Réseaux', syllabus: 'Plan.', pedagogy: 'Cours.' }));
  await upload('forger', forged, 'diploma'); await upload('forger', forged, 'cv');
  await okay(await post('submit', 'forger', { applicationId: forged }));
  detail = await okay(await get(`/api/v1/tea/applications/${forged}`, 'admin'));
  await okay(await post('verify', 'admin', { applicationId: forged, documentId: detail.documents.find(item => item.kind === 'diploma').id, state: 'falsified', note: 'Diplôme non reconnu par l’université émettrice' }));
  detail = await okay(await get(`/api/v1/tea/applications/${forged}`, 'admin'));
  assert.deepEqual([detail.application.state, detail.application.decision], ['decided', 'rejected']);

  // 5. End of mission revokes the teaching access.
  await okay(await post('end', 'admin', { contractId: contract, reason: 'Fin anticipée' }));
  assert.ok((await member()).rows[0].removed_at, 'accès au cours retiré');
  assert.equal(typeof (await database.query('SELECT unoa.expire_teacher_contracts() AS total')).rows[0].total, 'number');
  assert.match(await (await get('/enseignement', 'candidate')).text(), /Espace enseignant/);
  assert.match(await (await get(`/administration/enseignants?scope=${gamma.id}`, 'admin')).text(), /Contrats et affectations/);
}
