import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// External national examinations: official information that names the
// organising authority, voluntary declaration, deposit of an official copy,
// verification by another person with a reasoned proof, no presumed success,
// no national result or diploma produced, limited access to the files.
export async function exerciseExternal({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const names = ['manager', 'verifier', 'student', 'other'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('exn_manager'), ('exn_verifier');
    INSERT INTO unoa.role_permission VALUES ('exn_manager', 'exn.read'), ('exn_manager', 'exn.manage'), ('exn_verifier', 'exn.read'), ('exn_verifier', 'exn.verify');
  `);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Examen national ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'exn-' + name, id]);
    if (name === 'manager' || name === 'verifier') await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)',
      [id, univ.id, 'exn_' + name]);
  }
  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('exn-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/exn/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const multipart = (action, who, fields, files) => {
    const body = new FormData();
    for (const [key, value] of Object.entries({ return: '/examens-nationaux/suivi', ...fields })) body.set(key, value);
    for (const [key, [bytes, name]] of Object.entries(files)) body.set(key, new Blob([bytes]), name);
    return call('/api/v1/exn/' + action, { method: 'POST', headers: { Origin: origin, Cookie: cookies[who] }, body, redirect: 'manual' });
  };
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => assert.equal((await response).status, expected, label);
  const outcome = response => new URL(response.headers.get('location')).searchParams;
  const pdf = text => new TextEncoder().encode('%PDF-1.4\n% ' + text + '\n');

  // 1. Official information, naming the authority.
  const exam = { scopeId: univ.id, title: 'Baccalauréat (test)', authority: 'Office national des examens (fictif)', sessionLabel: 'Session 2026',
    officialUrl: 'https://examens.example.org', description: 'Calendrier et inscriptions auprès de l’Office (information de test).' };
  await status(post('exams', 'student', exam), 403, 'information réservée');
  await status(post('exams', 'manager', { ...exam, officialUrl: 'http://examens.example.org' }), 400, 'lien officiel HTTPS');
  const examId = (await okay(await post('exams', 'manager', exam))).examId;
  const draft = (await okay(await post('exams', 'manager', { ...exam, title: 'Brouillon (test)' }))).examId;
  assert.doesNotMatch(await (await get('/examens-nationaux')).text(), /Baccalauréat \(test\)/, 'brouillon non public');
  await okay(await post('publish', 'manager', { examId }));
  const page = await (await get('/examens-nationaux')).text();
  assert.match(page, /Baccalauréat \(test\)/);
  assert.match(page, /Autorité organisatrice : (<!-- -->)?Office national des examens \(fictif\)/);
  assert.match(page, /ne les organise pas/);
  assert.match(page, /évaluations internes, distinctes des examens nationaux/);

  // 2. Voluntary declaration; nothing presumed without a verified document.
  await status(post('declare', 'student', { examId: draft }), 404, 'déclaration sur information publiée seulement');
  const participation = (await okay(await post('declare', 'student', { examId, candidateNumber: 'C-0042' }))).participationId;
  let mine = (await okay(await get('/api/v1/exn/me', 'student'))).declarations;
  assert.match(mine[0].status, /^Non communiqué/, 'absence de données : pas de réussite présumée');

  // 3. Deposit of the official copy: format, owner, duplicate.
  assert.equal(outcome(await multipart('evidence', 'student', { participationId: participation, kind: 'diploma', issuingAuthority: 'Office national des examens (fictif)' },
    { file: [new TextEncoder().encode('<html>'), 'diplome.pdf'] })).get('error'), '400', 'signature de fichier');
  assert.equal(outcome(await multipart('evidence', 'other', { participationId: participation, kind: 'diploma', issuingAuthority: 'X' }, { file: [pdf('a'), 'd.pdf'] })).get('error'), '403');
  const deposit = (kind, text) => multipart('evidence', 'student', { participationId: participation, kind, issuingAuthority: 'Office national des examens (fictif)',
    documentReference: 'REF-' + text, statedOutcome: 'Admis (mention portée sur le document)' }, { file: [pdf(text), kind + '.pdf'] });
  assert.equal(outcome(await deposit('diploma', 'original')).get('message'), 'saved');
  assert.equal(outcome(await deposit('diploma', 'original')).get('error'), '409', 'même fichier déjà déposé');
  const { rows: [evidence] } = await database.query('SELECT id FROM unoa.external_evidence WHERE participation_id = $1', [participation]);

  // 4. Verification by another person, with method and reasoned note.
  await status(post('verify', 'manager', { evidenceId: evidence.id, step: 'verified', method: 'authority_register', note: 'x' }), 403, 'vérification réservée');
  const own = (await okay(await post('declare', 'verifier', { examId }))).participationId;
  await multipart('evidence', 'verifier', { participationId: own, kind: 'result', issuingAuthority: 'Office' }, { file: [pdf('own'), 'own.pdf'] });
  const { rows: [ownEvidence] } = await database.query('SELECT id FROM unoa.external_evidence WHERE participation_id = $1', [own]);
  await status(post('verify', 'verifier', { evidenceId: ownEvidence.id, step: 'verified', method: 'authority_register', note: 'Auto' }), 403, 'pas de vérification de sa propre pièce');
  await okay(await post('verify', 'verifier', { evidenceId: evidence.id, step: 'in_review', method: 'authority_contact', note: 'Demande écrite à l’Office.' }));
  await status(post('verify', 'verifier', { evidenceId: evidence.id, step: 'verified', method: 'other', note: 'Sans preuve' }), 422, 'méthode « autre » sans preuve');
  await okay(await post('verify', 'verifier', { evidenceId: evidence.id, step: 'verified', method: 'authority_register', note: 'Numéro REF-original présent au registre officiel.' }));
  await status(post('verify', 'verifier', { evidenceId: evidence.id, step: 'rejected', method: 'other', note: 'x' }), 409, 'vérification close');
  await assert.rejects(database.query("UPDATE unoa.external_evidence SET stated_outcome = 'Mention très bien' WHERE id = $1", [evidence.id]), /kept as deposited/);
  mine = (await okay(await get('/api/v1/exn/me', 'student'))).declarations;
  assert.match(mine[0].status, /^Pièce vérifiée — Diplôme délivré par Office national des examens \(fictif\)/);
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'exn.verified'", [ids.student])).rows[0]);

  // 5. A false document is rejected with its proof, kept internal.
  await deposit('result', 'faux');
  const { rows: [fake] } = await database.query("SELECT id FROM unoa.external_evidence WHERE participation_id = $1 AND document_reference = 'REF-faux'", [participation]);
  const rejected = await multipart('verify', 'verifier', { evidenceId: fake.id, step: 'rejected', method: 'authority_contact', note: 'L’Office déclare ce numéro inconnu.', return: '/administration/examens-nationaux' },
    { proof: [pdf('courrier'), 'reponse-office.pdf'] });
  assert.equal(outcome(rejected).get('message'), 'saved');
  const { rows: [proof] } = await database.query("SELECT id FROM unoa.external_verification WHERE evidence_id = $1 AND step = 'rejected'", [fake.id]);
  await status(get(`/api/v1/exn/proofs/${proof.id}`, 'student'), 403, 'preuve interne');
  assert.equal((await get(`/api/v1/exn/proofs/${proof.id}`, 'verifier')).status, 200);
  await status(get(`/api/v1/exn/evidence/${evidence.id}`, 'other'), 403, 'pièce réservée');
  assert.equal((await get(`/api/v1/exn/evidence/${evidence.id}`, 'student')).status, 200);

  // 6. No national result or diploma can be produced; history is complete.
  await status(post('results', 'manager', { participationId: participation, outcome: 'passed' }), 404, 'aucune génération de résultat national');
  await status(post('diplomas', 'manager', { participationId: participation }), 404, 'aucune émission de diplôme d’État');
  const columns = (await database.query("SELECT column_name FROM information_schema.columns WHERE table_schema = 'unoa' AND table_name LIKE 'external_%'")).rows.map(row => row.column_name);
  assert.ok(!columns.some(name => /mark|grade|score|average/.test(name)), 'aucune note stockée');
  mine = (await okay(await get('/api/v1/exn/me', 'student'))).declarations;
  assert.deepEqual(mine[0].history.map(item => item.kind), ['declared', 'evidence_deposited', 'evidence_in_review', 'evidence_verified', 'evidence_deposited', 'evidence_rejected']);
  const overview = await okay(await get(`/api/v1/exn/scopes?scopeId=${univ.id}`, 'verifier'));
  assert.ok(overview.evidence.length >= 3);
  await status(get(`/api/v1/exn/scopes?scopeId=${univ.id}`, 'student'), 403);
  assert.match(await (await get('/examens-nationaux/suivi', 'student')).text(), /Pièce vérifiée/);
  assert.match(await (await get(`/administration/examens-nationaux?scope=${univ.id}`, 'verifier')).text(), /Pièces déposées et vérifications/);
}
