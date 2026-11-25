import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Documents and diplomas: types naming their authority, versioned templates
// approved by another person, eligibility from the records, financial hold on
// internal attestations, establishment diploma locked without a verified
// authorisation in force, numbering, signatures by other people, QR
// verification with minimal disclosure, revocation and traced reissue, badge
// export, sealed documents. Runs after the grades and finance fixtures.
export async function exerciseCredentials({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id, parent_id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [cohort] } = await database.query(`SELECT cohort.id, version.program_id FROM unoa.cohort JOIN unoa.program_version AS version ON version.id = cohort.version_id
    WHERE unoa.scope_within(cohort.owner_scope_id, $1) ORDER BY cohort.created_at LIMIT 1`, [univ.id]);
  const students = Object.fromEntries((await database.query("SELECT matricule, id, account_id FROM unoa.student WHERE matricule IN ('NOTES-S1', 'NOTES-S2', 'NOTES-S3')")).rows
    .map(row => [row.matricule.slice(-2).toLowerCase(), row]));
  const names = ['designer', 'signatory', 'second', 'prepsign', 'cashier', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('cred_designer_t'), ('cred_signatory_t'), ('cred_prepsign_t');
    INSERT INTO unoa.role_permission VALUES ('cred_designer_t', 'cred.read'), ('cred_designer_t', 'cred.design'), ('cred_designer_t', 'cred.issue'),
      ('cred_signatory_t', 'cred.read'), ('cred_signatory_t', 'cred.sign'), ('cred_signatory_t', 'cred.approve'), ('cred_signatory_t', 'cred.revoke'), ('cred_signatory_t', 'cred.issue'),
      ('cred_prepsign_t', 'cred.read'), ('cred_prepsign_t', 'cred.issue'), ('cred_prepsign_t', 'cred.sign');
  `);
  const roles = { designer: 'cred_designer_t', signatory: 'cred_signatory_t', second: 'cred_signatory_t', prepsign: 'cred_prepsign_t', cashier: 'fin_officer_t' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Documents ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'cred-' + name, id]);
    if (roles[name]) await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)', [id, univ.id, roles[name]]);
  }
  const cookies = {};
  for (const subject of [...names.map(name => 'cred-' + name), 'grd-s1', 'grd-s2', 'grd-s3']) {
    issuer.useIdentity(subject, 'test-mfa');
    cookies[subject.replace(/^(cred|grd)-/, '')] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/cred/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => {
    const result = await response;
    assert.equal(result.status, expected, label + (result.status === expected ? '' : ' — ' + (await result.text()).slice(0, 300)));
  };
  const typeId = code => database.query('SELECT id FROM unoa.credential_type WHERE code = $1 AND scope_id = $2', [code, univ.id]).then(result => result.rows[0].id);
  const credential = async (code, student) => (await database.query(`SELECT credential.* FROM unoa.credential JOIN unoa.credential_type AS kind ON kind.id = credential.type_id
    WHERE kind.code = $1 AND credential.student_id = $2 ORDER BY credential.created_at DESC LIMIT 1`, [code, students[student].id])).rows[0];

  // 1. Types naming their authority; a diploma needs a programme, graduation and two signatures.
  const attestation = { scopeId: univ.id, code: 'ATT', label: 'Attestation d’inscription (test)', category: 'internal_attestation', issuingAuthority: 'Université Alpha', eligibility: 'enrolled', requiredSignatures: 1 };
  await status(post('types', 'outsider', attestation), 403, 'types réservés');
  await status(post('types', 'designer', { ...attestation, scopeId: univ.parent_id }), 403, 'hors périmètre');
  await status(post('types', 'designer', { ...attestation, code: 'DIP', category: 'institutional_diploma', programId: cohort.program_id, eligibility: 'graduated', requiredSignatures: 1 }), 422, 'diplôme : deux signatures');
  await status(post('types', 'designer', { ...attestation, category: 'state_diploma' }), 400, 'aucun titre national modélisable');
  await okay(await post('types', 'designer', attestation));
  await status(post('types', 'designer', attestation), 409, 'code unique');
  await okay(await post('types', 'designer', { ...attestation, code: 'BADGE', label: 'Badge réussite (test)', category: 'badge', eligibility: 'result_published' }));
  await okay(await post('types', 'designer', { ...attestation, code: 'DIP', label: 'Diplôme d’université (test)', category: 'institutional_diploma', programId: cohort.program_id, eligibility: 'graduated', requiredSignatures: 2 }));

  // 2. Templates by language, approved by another person, versioned.
  const template = (code, body, title = 'Document (test)') => typeId(code).then(id => post('templates', 'designer', { typeId: id, language: 'fr', title, body }));
  await status(template('ATT', 'Certifie que {{nom}} est né le {{naissance}}.'), 400, 'champ inconnu');
  for (const code of ['ATT', 'BADGE', 'DIP']) await okay(await template(code, 'Nous certifions que {{nom}} ({{matricule}}) — {{formation}}, {{annee}}. {{type}} n° {{numero}}, {{autorite}}.'));
  const templates = (await database.query("SELECT template.id, kind.code FROM unoa.document_template AS template JOIN unoa.credential_type AS kind ON kind.id = template.type_id WHERE kind.scope_id = $1", [univ.id])).rows;
  await status(post('publish-template', 'designer', { templateId: templates[0].id }), 403, 'approbation par une autre personne');
  for (const item of templates) await okay(await post('publish-template', 'signatory', { templateId: item.id }));
  await okay(await template('ATT', 'Version 2 : {{nom}} est inscrit en {{formation}} ({{annee}}). N° {{numero}}.', 'Attestation v2'));
  const { rows: [v2] } = await database.query("SELECT template.id FROM unoa.document_template AS template JOIN unoa.credential_type AS kind ON kind.id = template.type_id WHERE kind.code = 'ATT' AND kind.scope_id = $1 AND template.version = 2", [univ.id]);
  await okay(await post('publish-template', 'signatory', { templateId: v2.id }));
  assert.deepEqual((await database.query("SELECT template.version, template.state FROM unoa.document_template AS template JOIN unoa.credential_type AS kind ON kind.id = template.type_id WHERE kind.code = 'ATT' AND kind.scope_id = $1 ORDER BY template.version", [univ.id])).rows
    .map(row => [row.version, row.state]), [[1, 'superseded'], [2, 'published']]);
  await status(post('prepare', 'designer', { typeId: await typeId('ATT'), studentId: students.s1.id }), 422, 'type non approuvé');
  for (const code of ['ATT', 'BADGE', 'DIP']) await okay(await post('publish-type', 'signatory', { typeId: await typeId(code) }));

  // 3. Internal attestation: numbering, signature by another person, issuance, printable view with QR.
  const prepared = await okay(await post('prepare', 'designer', { typeId: await typeId('ATT'), studentId: students.s1.id }));
  assert.match(prepared.number, /^ATT-\d{4}-\d{6}$/);
  assert.match((await get(`/documents/voir?id=${prepared.credentialId}`, 's1').then(response => response.text())), /non délivré ou réservé/, 'pas d’impression avant délivrance');
  const own = await okay(await post('prepare', 'prepsign', { typeId: await typeId('ATT'), studentId: students.s2.id }));
  await status(post('sign', 'prepsign', { credentialId: own.credentialId }), 403, 'pas de signature de ce qu’on prépare');
  await status(post('sign', 'designer', { credentialId: prepared.credentialId }), 403, 'signature réservée');
  assert.equal((await okay(await post('sign', 'signatory', { credentialId: prepared.credentialId }))).issued, true);
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'cred.issued'", [students.s1.account_id])).rows[0]);
  const page = await (await get(`/documents/voir?id=${prepared.credentialId}`, 's1')).text();
  assert.match(page, /<svg/, 'QR code');
  assert.match(page, /Version 2 : Notes s1 est inscrit/);
  const issued = await credential('ATT', 's1');
  assert.match(issued.verification_code, /^[A-Z2-7]{26}$/);

  // 4. Public verification with minimal disclosure; lookups logged without personal data.
  const verification = await (await get(`/verifier/${issued.verification_code}`)).text();
  assert.match(verification, /Document authentique et en vigueur/);
  assert.match(verification, /N\. s\./, 'initiales seulement');
  assert.doesNotMatch(verification, /Notes s1|NOTES-S1/, 'aucune donnée personnelle');
  assert.match(await (await get('/verifier/AAAAAAAAAAAAAAAAAAAAAAAAAA')).text(), /Aucun document ne correspond/);
  assert.ok(Number((await database.query('SELECT count(*) FROM unoa.credential_lookup')).rows[0].count) >= 2);

  // 5. Badge from a published result, exported to Open Badges; attestation withheld by a financial hold.
  const badge = await okay(await post('prepare', 'designer', { typeId: await typeId('BADGE'), studentId: students.s2.id }));
  await okay(await post('sign', 'signatory', { credentialId: badge.credentialId }));
  const exported = await okay(await get(`/api/v1/cred/badges/${badge.credentialId}`, 's2'));
  assert.ok(exported.type.includes('OpenBadgeCredential'));
  await status(get(`/api/v1/cred/badges/${prepared.credentialId}`, 's1'), 422, 'une attestation n’est pas un badge');
  await status(get(`/api/v1/cred/badges/${badge.credentialId}`, 's1'), 403, 'export par le titulaire');
  const { rows: [tuition] } = await database.query("SELECT id FROM unoa.price_rule WHERE label = 'Frais de scolarité (test)'");
  const late = await call('/api/v1/fin/invoices', { method: 'POST', headers: { Origin: origin, Cookie: cookies.cashier, 'Content-Type': 'application/json' },
    body: JSON.stringify({ scopeId: univ.id, priceRuleId: tuition.id, accountId: students.s3.account_id, billingPeriod: 'retard-documents', firstDueOn: new Date(Date.now() - 60 * 864e5).toISOString().slice(0, 10) }) });
  assert.equal(late.status, 200);
  await status(post('prepare', 'designer', { typeId: await typeId('ATT'), studentId: students.s3.id }), 423, 'attestation suspendue par une retenue admise');

  // 6. Establishment diploma: graduation, then locked until a verified authorisation is in force.
  await status(post('prepare', 'designer', { typeId: await typeId('DIP'), studentId: students.s1.id }), 422, 'statut diplômé exigé');
  // Test-only: the status decision belongs to the registrar (tested by the students fixture).
  await database.query("UPDATE unoa.student SET status = 'graduated' WHERE id = $1", [students.s1.id]);
  await status(post('prepare', 'designer', { typeId: await typeId('DIP'), studentId: students.s1.id }), 422, 'verrouillé sans habilitation');
  await database.query(`INSERT INTO unoa.program_authorization(program_id, territory_id, status, authority, evidence, valid_from, valid_until, recorded_by)
    VALUES ($1, NULL, 'authorized', 'Ministère (fictif)', 'Arrêté de test', now() - interval '2 years', now() - interval '1 day', $2)`, [cohort.program_id, ids.designer]);
  await database.query("UPDATE unoa.program_authorization SET verified_by = $2, verified_at = now() WHERE program_id = $1 AND verified_by IS NULL", [cohort.program_id, ids.signatory]);
  await status(post('prepare', 'designer', { typeId: await typeId('DIP'), studentId: students.s1.id }), 422, 'habilitation expirée');
  await database.query(`INSERT INTO unoa.program_authorization(program_id, territory_id, status, authority, evidence, valid_from, recorded_by)
    VALUES ($1, NULL, 'authorized', 'Ministère (fictif)', 'Arrêté de test n° 2', now() - interval '1 day', $2)`, [cohort.program_id, ids.designer]);
  await status(post('prepare', 'designer', { typeId: await typeId('DIP'), studentId: students.s1.id }), 422, 'habilitation non vérifiée');
  await database.query("UPDATE unoa.program_authorization SET verified_by = $2, verified_at = now() WHERE program_id = $1 AND verified_by IS NULL", [cohort.program_id, ids.signatory]);
  const diploma = await okay(await post('prepare', 'designer', { typeId: await typeId('DIP'), studentId: students.s1.id }));
  await status(post('prepare', 'designer', { typeId: await typeId('DIP'), studentId: students.s1.id }), 409, 'un diplôme en vigueur');
  assert.equal((await okay(await post('sign', 'signatory', { credentialId: diploma.credentialId }))).issued, false, 'deux signatures requises');
  await status(post('sign', 'signatory', { credentialId: diploma.credentialId }), 409, 'une signature par personne');
  assert.equal((await okay(await post('sign', 'second', { credentialId: diploma.credentialId }))).issued, true);
  assert.match((await credential('DIP', 's1')).rendered, /habilitation : Ministère \(fictif\)/);

  // 7. Revocation and traced reissue.
  const old = await credential('DIP', 's1');
  const reissued = await okay(await post('reissue', 'signatory', { credentialId: diploma.credentialId, reason: 'Erreur d’orthographe du nom (test)' }));
  assert.notEqual(reissued.number, diploma.number);
  await okay(await post('sign', 'second', { credentialId: reissued.credentialId }));
  await status(post('sign', 'signatory', { credentialId: reissued.credentialId }), 403, 'le préparateur de la réémission ne signe pas');
  await okay(await post('sign', 'prepsign', { credentialId: reissued.credentialId }));
  const revokedPage = await (await get(`/verifier/${old.verification_code}`)).text();
  assert.match(revokedPage, /Document révoqué/);
  assert.match(revokedPage, new RegExp(`Remplacé par le document n° (<!-- -->)?${reissued.number}`));
  await status(post('revoke', 'designer', { credentialId: reissued.credentialId, reason: 'x' }), 403, 'révocation réservée');
  await assert.rejects(database.query("UPDATE unoa.credential SET rendered = 'falsifié' WHERE id = $1", [old.id]), /never rewritten/);

  // 8. Holder and register screens.
  const mine = await okay(await get('/api/v1/cred/me', 's1'));
  assert.deepEqual(mine.credentials.map(item => item.state).sort(), ['issued', 'issued', 'revoked']);
  await status(get(`/api/v1/cred/scopes?scopeId=${univ.id}`, 's1'), 403);
  assert.match(await (await get('/documents', 's1')).text(), /Mes documents/);
  assert.match(await (await get(`/administration/documents?scope=${univ.id}`, 'signatory')).text(), /Registre/);
}
