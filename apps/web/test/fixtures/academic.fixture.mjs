import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { exerciseSites } from './site.fixture.mjs';

// Builds two fictitious establishments from an empty academic base: Alpha in
// semesters with fractional credits, Bêta in modules with another credit unit.
// Every structure, programme and course is created through the HTTP API.
export async function exerciseAcademic({ database, issuer, login, call, origin, root, alpha, beta }) {
  const admin = randomUUID();
  const reviewer = randomUUID();
  const agent = randomUUID();
  await database.query(`
    INSERT INTO unoa.access_role VALUES ('academic_admin'), ('academic_reviewer'), ('academic_local');
    INSERT INTO unoa.permission VALUES ('org.read'), ('org.write'), ('org.approve'),
      ('catalog.read'), ('catalog.write'), ('catalog.review'), ('catalog.publish'), ('catalog.authorize'), ('catalog.define'),
      ('site.read'), ('site.write'), ('site.publish') ON CONFLICT DO NOTHING;
    INSERT INTO unoa.role_permission (role_code, permission_code)
      SELECT 'academic_admin', code FROM unoa.permission WHERE code LIKE 'org.%' OR code LIKE 'catalog.%' OR code IN ('site.read', 'site.write');
    INSERT INTO unoa.role_permission VALUES
      ('academic_reviewer', 'org.read'), ('academic_reviewer', 'org.approve'), ('academic_reviewer', 'catalog.read'),
      ('academic_reviewer', 'catalog.review'), ('academic_reviewer', 'site.read'), ('academic_reviewer', 'site.publish'), ('academic_reviewer', 'catalog.publish'), ('academic_reviewer', 'catalog.authorize'),
      ('academic_local', 'org.read'), ('academic_local', 'org.write'), ('academic_local', 'catalog.read'), ('academic_local', 'catalog.write');
  `);
  // Establishments are dated earlier so that units may start now.
  await database.query(`
    UPDATE unoa.scope SET present_from = now() - interval '3 days' WHERE parent_id IS NULL;
    UPDATE unoa.scope SET present_from = now() - interval '2 days' WHERE type_code = 'territory';
    INSERT INTO unoa.scope_type(code, label, nature) VALUES ('etab', 'Établissement', 'institution'),
      ('faculte', 'Faculté', 'academic_unit'), ('departement', 'Département', 'academic_unit'), ('labo', 'Laboratoire', 'academic_unit');
    INSERT INTO unoa.scope_type_parent VALUES ('etab', 'territory'), ('faculte', 'etab'), ('departement', 'faculte'), ('labo', 'departement');
  `);
  const alphaUniv = randomUUID();
  const betaUniv = randomUUID();
  await database.query(`
    INSERT INTO unoa.scope(id, type_code, parent_id, label, present_from)
    VALUES ($1, 'etab', $3, 'Université Alpha', now() - interval '1 day'), ($2, 'etab', $4, 'Université Bêta', now() - interval '1 day')
  `, [alphaUniv, betaUniv, alpha, beta]);
  await database.query('INSERT INTO unoa.account (id) VALUES ($1), ($2), ($3)', [admin, reviewer, agent]);
  await database.query(`
    INSERT INTO unoa.login_identity VALUES ($1, 'academic-admin-fixture', $2), ($1, 'academic-reviewer-fixture', $3), ($1, 'academic-agent-fixture', $4)
  `, [issuer.origin, admin, reviewer, agent]);
  await database.query(`
    INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants)
    VALUES ($1, $4, 'academic_admin', now(), true), ($2, $4, 'academic_reviewer', now(), true), ($3, $5, 'academic_local', now(), true)
  `, [admin, reviewer, agent, root, betaUniv]);

  async function signIn(subject) {
    issuer.useIdentity(subject, 'test-mfa');
    const result = await login();
    assert.match(result.headers.get('location'), /\/espace$/);
    return result.headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const A = await signIn('academic-admin-fixture');
  const R = await signIn('academic-reviewer-fixture');
  const B = await signIn('academic-agent-fixture');
  const post = (path, cookie, data) => call(path, {
    method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, cookie, extra = {}) => call(path, { headers: { ...(cookie ? { Cookie: cookie } : {}), ...extra } });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => assert.equal(response.status, expected, label);
  const at = hours => new Date(Date.now() + hours * 3_600_000).toISOString().slice(0, 16);
  const now = at(0);

  // 0. Without a site no institutional text is shown; then each site starts empty.
  assert.equal((await get('/api/v1/public/programs/all')).status, 404);
  assert.match(await (await get('/')).text(), /Site public non configuré/);
  const { betaOrigin } = await exerciseSites({ database, post, get, okay, status, origin, author: A, publisher: R, alphaUniv, betaUniv });
  assert.deepEqual((await okay(await get('/api/v1/public/programs/all'))).programs, []);
  assert.match(await (await get('/formations')).text(), /Aucune formation n’est encore publiée/);
  assert.match(await (await get('/structures')).text(), /Aucune composante n’est encore publiée/);

  // 1. Units are proposed, then approved by another person.
  const org = '/api/v1/org/';
  const propose = (parentId, data, cookie = A) => post(org + 'units', cookie, { parentId, presentFrom: now, ...data });
  const faculty = await okay(await propose(alphaUniv, { typeCode: 'faculte', code: 'FSA', label: 'Faculté des sciences appliquées', public: true, mission: 'Sciences appliquées' }));
  await status(await propose(faculty.scopeId, { typeCode: 'departement', code: 'DINF', label: 'Informatique' }), 422, 'mère non active');
  await status(await post(`${org}units/${faculty.scopeId}/decide`, A, { decision: 'approve' }), 403, 'auto-validation');
  await okay(await post(`${org}units/${faculty.scopeId}/decide`, R, { decision: 'approve' }));
  await status(await post(`${org}units/${faculty.scopeId}/decide`, R, { decision: 'approve' }), 409, 'double décision');
  await status(await propose(alphaUniv, { typeCode: 'labo', code: 'LAB', label: 'Hors hiérarchie' }), 422, 'hiérarchie non déclarée');
  await status(await propose(alphaUniv, { typeCode: 'faculte', code: 'FSA', label: 'Doublon' }), 409, 'code en double');
  await status(await propose(alphaUniv, { typeCode: 'faculte', code: 'X', label: 'Territoire', presentFrom: '2020-01-01T00:00' }), 422, 'présence hors mère');
  const department = await okay(await propose(faculty.scopeId, { typeCode: 'departement', code: 'DINF', label: 'Département d’informatique', public: true }));
  await okay(await post(`${org}units/${department.scopeId}/decide`, R, { decision: 'approve' }));
  const second = await okay(await propose(alphaUniv, { typeCode: 'faculte', code: 'FST', label: 'Faculté des sciences et techniques', public: true }));
  await okay(await post(`${org}units/${second.scopeId}/decide`, R, { decision: 'approve' }));
  // Bêta reuses the same code in its own establishment, and sees nothing of Alpha.
  const betaFaculty = await okay(await propose(betaUniv, { typeCode: 'faculte', code: 'FSA', label: 'Faculté Bêta' }, B));
  await status(await propose(alphaUniv, { typeCode: 'faculte', code: 'INT', label: 'Intrusion' }, B), 403, 'écriture transverse');
  const crossRead = await get(`${org}units?scopeId=${faculty.scopeId}`, B);
  await status(crossRead, 403, 'lecture transverse');
  const { correlationId } = await crossRead.json();
  assert.equal((await database.query("SELECT action FROM unoa.audit_event WHERE correlation_id = $1 AND outcome = 'denied'", [correlationId])).rows[0].action, 'org.access');
  assert.ok((await okay(await get(org + 'units', B))).scopes.every(item => item.id !== faculty.scopeId));
  assert.ok(betaFaculty.scopeId);

  // 2. Positions, dated appointments, vacancies and multiple assignments.
  const dean = await okay(await post(`${org}units/${faculty.scopeId}/positions`, A, { title: 'Doyen', isHead: true, seats: 1, public: true }));
  const appoint = (id, data, cookie = A) => post(`${org}positions/${id}/appointments`, cookie, { reason: 'Arrêté fictif de recette', effectiveFrom: now, ...data });
  let details = await okay(await get(`${org}units?scopeId=${faculty.scopeId}`, A));
  assert.deepEqual(details.vacancies, ['Doyen']);
  await okay(await appoint(dean.id, { accountId: admin, capacity: 'titular', publicName: 'Pr Alpha Fictif' }));
  await status(await appoint(dean.id, { accountId: admin, capacity: 'deputy' }), 409, 'double responsabilité');
  await status(await appoint(dean.id, { accountId: reviewer, capacity: 'titular' }), 422, 'siège occupé');
  await status(await appoint(dean.id, { accountId: reviewer, capacity: 'deputy', effectiveFrom: '2020-01-01T00:00' }), 422, 'nomination rétroactive');
  const deputy = await okay(await appoint(dean.id, { accountId: reviewer, capacity: 'deputy' }));
  const head = await okay(await post(`${org}units/${department.scopeId}/positions`, A, { title: 'Chef de département', isHead: true }));
  await okay(await appoint(head.id, { accountId: admin, capacity: 'interim', reason: 'Vacance, intérim' }));
  await status(await post(`${org}appointments/${deputy.id}/end`, A, { effectiveUntil: '2020-01-01T00:00' }), 422, 'fin rétroactive');
  await okay(await post(`${org}appointments/${deputy.id}/end`, A, { effectiveUntil: at(24) }));
  await okay(await post(`${org}units/${faculty.scopeId}/capacities`, A, { resource: 'Places en amphithéâtre virtuel', quantity: 500, measure: 'places', reason: 'Plan de charge', effectiveFrom: now }));
  details = await okay(await get(`${org}units?scopeId=${faculty.scopeId}`, A));
  assert.deepEqual(details.vacancies, []);
  assert.equal(details.capacity[0].resource, 'Places en amphithéâtre virtuel');
  const chart = await okay(await get('/api/v1/public/organisation'));
  assert.ok(chart.units.some(unit => unit.label === 'Faculté des sciences appliquées'));
  assert.ok(chart.positions.some(item => item.holder === 'Pr Alpha Fictif'));
  assert.ok(!chart.units.some(unit => unit.label === 'Faculté Bêta'), 'unité proposée et non publique');
  assert.match(await (await get('/structures')).text(), /Pr Alpha Fictif/);

  // 3. Reorganisation keeps the lineage; the requester never approves.
  const transfer = await okay(await post(`${org}units/${department.scopeId}/reorganize`, A,
    { kind: 'transfer', targetId: second.scopeId, reason: 'Regroupement des sciences et techniques', effectiveAt: at(1) }));
  await status(await post(`${org}units/${department.scopeId}/reorganize`, A,
    { kind: 'closure', reason: 'Doublon de demande', effectiveAt: at(1) }), 409, 'demande déjà en cours');
  await status(await post(`${org}changes/${transfer.id}/decide`, A, { decision: 'approve' }), 403, 'auto-approbation');
  const moved = await okay(await post(`${org}changes/${transfer.id}/decide`, R, { decision: 'approve', note: 'Avis favorable' }));
  assert.notEqual(moved.scopeId, department.scopeId);
  const lineage = await database.query('SELECT kind FROM unoa.org_succession WHERE predecessor_id = $1 AND successor_id = $2', [department.scopeId, moved.scopeId]);
  assert.equal(lineage.rows[0].kind, 'transfer');
  const ended = await database.query(`
    SELECT count(*)::int AS total FROM unoa.org_appointment WHERE position_id = $1 AND effective_until IS NOT NULL
  `, [head.id]);
  assert.equal(ended.rows[0].total, 1);
  const closure = await okay(await post(`${org}units/${second.scopeId}/reorganize`, A, { kind: 'closure', reason: 'Essai', effectiveAt: at(2) }));
  await status(await post(`${org}changes/${closure.id}/decide`, R, { decision: 'approve' }), 422, 'fermeture d’une unité active ayant des filles');
  await okay(await post(`${org}changes/${closure.id}/decide`, R, { decision: 'reject', note: 'Composantes encore actives' }));

  // 4. Catalogue references are declared at the platform root only.
  const cat = '/api/v1/catalog/';
  await status(await post(cat + 'program-kinds', B, { code: 'licence', label: 'Licence', degreeAwarding: true }), 403, 'définition locale');
  await okay(await post(cat + 'program-kinds', A, { code: 'licence', label: 'Licence', degreeAwarding: true }));
  await okay(await post(cat + 'program-kinds', A, { code: 'certificat', label: 'Certificat', degreeAwarding: false }));
  await status(await post(cat + 'program-kinds', A, { code: 'licence', label: 'Doublon', degreeAwarding: true }), 409, 'nature en double');
  await okay(await post(cat + 'field-types', A, { code: 'domaine', label: 'Domaine', rootAllowed: true }));
  await okay(await post(cat + 'field-types', A, { code: 'filiere', label: 'Filière', parentTypes: ['domaine'] }));
  await okay(await post(cat + 'field-types', A, { code: 'specialite', label: 'Spécialité', parentTypes: ['filiere'] }));
  const field = (data, cookie = A) => post(cat + 'fields', cookie, { scopeId: alphaUniv, ...data });
  const domain = await okay(await field({ typeCode: 'domaine', code: 'D-SCI', label: 'Sciences et technologies' }));
  const branch = await okay(await field({ typeCode: 'filiere', code: 'F-INFO', label: 'Informatique', parentId: domain.id }));
  const speciality = await okay(await field({ typeCode: 'specialite', code: 'S-RES', label: 'Réseaux', parentId: branch.id }));
  await status(await field({ typeCode: 'specialite', code: 'S-ROOT', label: 'Sans parent' }), 422, 'spécialité sans filière');
  await status(await field({ typeCode: 'filiere', code: 'F-SUB', label: 'Filière sous filière', parentId: branch.id }), 422, 'taxonomie non déclarée');

  const course = (code, title, scopeId = alphaUniv, cookie = A) => post(cat + 'courses', cookie, { scopeId, code, title });
  const algo = await okay(await course('C-ALGO', 'Algorithmique'));
  const nets = await okay(await course('C-RES', 'Réseaux'));
  const skill = await okay(await post(cat + 'competencies', A, { scopeId: alphaUniv, code: 'K1', label: 'Concevoir un algorithme' }));

  // 5. A programme is drafted under an active faculty with its own rules.
  const program = await okay(await post(cat + 'programs', A, {
    scopeId: second.scopeId, kindCode: 'licence', fieldId: speciality.id, code: 'L-INFO', title: 'Licence d’informatique',
    organisation: 'Semestrielle', duration: 'Deux semestres', deliveryMode: 'À distance', creditUnit: 'crédits',
    expectedCredits: 12, languages: ['fr', 'en'],
  }));
  await status(await post(cat + 'programs', A, { scopeId: faculty.scopeId, kindCode: 'licence', code: 'L-INFO', title: 'Doublon',
    organisation: 'S', duration: 'D', deliveryMode: 'M', creditUnit: 'c' }), 409, 'code de programme en double');
  const v1 = program.versionId;
  const edit = (versionId, part, data, cookie = A) => post(`${cat}program-versions/${versionId}/${part}`, cookie, data);
  const s1 = await okay(await edit(v1, 'periods', { ordinal: 1, label: 'Semestre 1' }));
  await status(await edit(v1, 'periods', { ordinal: 1, label: 'Doublon' }), 409, 'rang en double');
  const s2 = await okay(await edit(v1, 'periods', { ordinal: 2, label: 'Semestre 2' }));
  const detail = async (versionId, cookie = A) => okay(await get(`${cat}program-versions/${versionId}`, cookie));
  let draft = await detail(v1);
  const period = label => draft.periods.find(item => item.label === label).id;
  await okay(await edit(v1, 'groups', { periodId: period('Semestre 2'), label: 'Options S2', minChoices: 1, maxChoices: 1 }));
  draft = await detail(v1);
  const group = draft.groups[0].id;
  const unit = data => edit(v1, 'units', data);
  await okay(await unit({ periodId: period('Semestre 1'), code: 'U1', title: 'Fondements', credits: 5 }));
  await okay(await unit({ periodId: period('Semestre 1'), code: 'U2', title: 'Mathématiques', credits: 2.5, coefficient: 1.5 }));
  await okay(await unit({ periodId: period('Semestre 1'), code: 'U2B', title: 'Méthodologie', credits: 0.5 }));
  await okay(await unit({ periodId: period('Semestre 2'), code: 'U3', title: 'Réseaux', credits: 4, optionGroupId: group }));
  await okay(await unit({ periodId: period('Semestre 2'), code: 'U4', title: 'Bases de données', credits: 4, optionGroupId: group }));
  await okay(await unit({ periodId: period('Semestre 2'), code: 'U5', title: 'Sans crédit', credits: 0 }));
  await status(await unit({ periodId: period('Semestre 1'), code: 'U6', title: 'Groupe d’une autre période', credits: 1, optionGroupId: group }), 422, 'option hors période');
  draft = await detail(v1);
  const id = code => draft.units.find(item => item.code === code).id;
  await okay(await edit(v1, 'prerequisites', { unitId: id('U3'), requiredUnitId: id('U1') }));
  await status(await edit(v1, 'prerequisites', { unitId: id('U1'), requiredUnitId: id('U3') }), 422, 'cycle de prérequis');
  await status(await edit(v1, 'prerequisites', { unitId: id('U2'), requiredUnitId: id('U1') }), 422, 'prérequis de même période');
  await okay(await edit(v1, 'volumes', { unitId: id('U1'), activity: 'Cours', hours: 24 }));
  await okay(await edit(v1, 'volumes', { unitId: id('U1'), activity: 'TP', hours: 12 }));
  await okay(await edit(v1, 'courses', { unitId: id('U1'), courseId: algo.id }));
  await okay(await edit(v1, 'courses', { unitId: id('U3'), courseId: nets.id }));
  await okay(await edit(v1, 'competencies', { competencyId: skill.id, unitId: id('U1'), level: 'Maîtrise' }));
  await okay(await edit(v1, 'requirements', { kind: 'internship', label: 'Stage d’initiation', credits: 0, mandatory: true, periodId: period('Semestre 2') }));
  const zones = (await detail(v1)).zones;
  assert.deepEqual(zones.map(zone => zone.label), ['Alpha']);
  await okay(await edit(v1, 'territories', { territoryId: alpha }));
  await status(await edit(v1, 'territories', { territoryId: alphaUniv }), 422, 'zone non territoriale');

  // UE without credits blocks submission until it is removed.
  draft = await detail(v1);
  assert.deepEqual(draft.issues.map(issue => issue.code), ['unit_without_credits']);
  await status(await post(`${cat}program-versions/${v1}/submit`, A, {}), 422, 'UE sans crédits');
  await okay(await post(`${cat}program-versions/${v1}/remove`, A, { kind: 'unit', itemId: id('U5') }));
  const simulated = await okay(await post(`${cat}program-versions/${v1}/simulate`, A, { choices: [id('U3')] }));
  assert.equal(simulated.total, 12);
  assert.deepEqual(simulated.issues, []);
  const incomplete = await okay(await post(`${cat}program-versions/${v1}/simulate`, A, { choices: [] }));
  assert.ok(incomplete.issues.some(issue => issue.code === 'group_below_min'));

  // 6. Review by another person, then immutable publication.
  await okay(await post(`${cat}program-versions/${v1}/submit`, A, {}));
  await status(await edit(v1, 'periods', { ordinal: 3, label: 'Hors brouillon' }), 409, 'modification en revue');
  await status(await post(`${cat}program-versions/${v1}/review`, A, { decision: 'approve' }), 403, 'auteur réviseur');
  await status(await post(`${cat}program-versions/${v1}/review`, R, { decision: 'reject' }), 400, 'renvoi non motivé');
  await okay(await post(`${cat}program-versions/${v1}/review`, R, { decision: 'approve' }));
  await status(await post(`${cat}program-versions/${v1}/publish`, B, {}), 403, 'publication transverse');
  await okay(await post(`${cat}program-versions/${v1}/publish`, R, {}));
  await status(await edit(v1, 'units', { periodId: period('Semestre 1'), code: 'U9', title: 'Après publication', credits: 1 }), 409, 'version publiée');
  await assert.rejects(database.query("UPDATE unoa.teaching_unit SET credits = 99 WHERE version_id = $1", [v1]), /Only a draft version is edited/);
  await assert.rejects(database.query("UPDATE unoa.program_version SET title = 'Réécrit' WHERE id = $1", [v1]), /Only a draft version is edited/);

  // 7. The public sheet shows the published version and an honest regulatory status.
  let listing = (await okay(await get('/api/v1/public/programs/all'))).programs;
  assert.equal(listing.length, 1);
  assert.equal(listing[0].regulatory_status, 'unverified');
  assert.equal(listing[0].admission_open, false);
  const sheet = await okay(await get(`/api/v1/public/programs/${program.id}`));
  assert.deepEqual(sheet.periods.map(item => item.units.length), [3, 2]);
  assert.deepEqual(sheet.territories, ['Alpha']);
  const publicPlan = await okay(await get(`/api/v1/public/programs/${program.id}/simulate?choice=${id('U4')}`));
  assert.equal(publicPlan.total, 12);
  // Tenant isolation: the Bêta site exposes nothing of Alpha.
  assert.deepEqual((await (await fetch(betaOrigin + '/api/v1/public/programs/all')).json()).programs, []);
  assert.equal((await fetch(betaOrigin + `/api/v1/public/programs/${program.id}`)).status, 404);
  assert.doesNotMatch(await (await fetch(betaOrigin + '/structures')).text(), /Faculté des sciences appliquées/);
  const page = await (await get(`/formations/${program.id}`)).text();
  assert.match(page, /Licence d’informatique/);
  assert.match(page, /Statut réglementaire non vérifié/);
  assert.match(await (await get('/formations?nature=Licence&langue=en&zone=Alpha')).text(), /Licence d’informatique/);
  assert.doesNotMatch(await (await get('/formations?nature=Certificat')).text(), /Licence d’informatique/);

  // 8. Admissions open only on a verified, valid authorization.
  const versionAction = (action, data, cookie = R) => post(`${cat}program-versions/${v1}/${action}`, cookie, data);
  await status(await versionAction('admission', { open: true }), 422, 'ouverture sans autorisation');
  await okay(await post(`${cat}programs/${program.id}/authorizations`, A, {
    status: 'authorized', authority: 'Autorité fictive de recette', evidence: 'Pièce fictive SANDBOX-001', validFrom: at(-1), territoryId: alpha,
  }));
  await status(await versionAction('admission', { open: true }), 422, 'autorisation non vérifiée');
  let record = (await okay(await get(`${cat}programs/${program.id}`, A))).authorizations[0];
  await status(await post(`${cat}authorizations/${record.id}/verify`, A, { programId: program.id }), 403, 'vérification par l’auteur');
  await okay(await post(`${cat}authorizations/${record.id}/verify`, R, { programId: program.id }));
  await status(await post(`${cat}authorizations/${record.id}/verify`, R, { programId: program.id }), 409, 'double vérification');
  await okay(await versionAction('admission', { open: true }));
  listing = (await okay(await get('/api/v1/public/programs/all'))).programs;
  assert.equal(listing[0].regulatory_status, 'authorized');
  assert.equal(listing[0].admission_open, true);
  await okay(await post(`${cat}programs/${program.id}/authorizations`, A, {
    status: 'suspended', authority: 'Autorité fictive de recette', evidence: 'Suspension fictive SANDBOX-002', validFrom: now,
  }));
  record = (await okay(await get(`${cat}programs/${program.id}`, A))).authorizations.find(item => item.status === 'suspended');
  await okay(await post(`${cat}authorizations/${record.id}/verify`, R, { programId: program.id }));
  listing = (await okay(await get('/api/v1/public/programs/all'))).programs;
  assert.equal(listing[0].regulatory_status, 'suspended');
  assert.equal(listing[0].admission_open, false, 'suspension effective sans action manuelle');
  await assert.rejects(database.query('UPDATE unoa.program_authorization SET evidence = $2 WHERE id = $1', [record.id, 'x']), /superseded/);

  // 9. A new version is a copy; equivalences link it to the previous one.
  const derived = await okay(await versionAction('derive', {}, A));
  const v2 = derived.id;
  await status(await versionAction('derive', {}, A), 409, 'une seule version de travail');
  const copy = await detail(v2);
  assert.deepEqual(copy.units.map(item => item.code).sort(), ['U1', 'U2', 'U2B', 'U3', 'U4']);
  assert.equal(copy.units.find(item => item.code === 'U3').requires.length, 1);
  assert.equal(copy.territories.length, 1);
  const source = copy.equivalenceSources.find(item => item.label.includes('U1 '));
  await okay(await edit(v2, 'equivalences', { targetUnitId: copy.units.find(item => item.code === 'U1').id,
    sourceVersionId: source.version_id, sourceUnitId: source.unit_id, note: 'Contenu identique' }));
  await okay(await edit(v2, 'update', { title: 'Licence d’informatique (2029)', organisation: 'Semestrielle', duration: 'Deux semestres',
    deliveryMode: 'Hybride', creditUnit: 'crédits', expectedCredits: 12, languages: ['fr'] }));
  await okay(await post(`${cat}program-versions/${v2}/submit`, A, {}));
  await okay(await post(`${cat}program-versions/${v2}/review`, R, { decision: 'approve' }));
  await okay(await post(`${cat}program-versions/${v2}/publish`, R, {}));
  const versions = (await okay(await get(`${cat}programs/${program.id}`, A))).versions;
  assert.deepEqual(versions.map(item => [item.number, item.state]), [[2, 'published'], [1, 'retired']]);
  assert.equal((await okay(await get(`/api/v1/public/programs/${program.id}`))).version.title, 'Licence d’informatique (2029)');
  assert.equal((await detail(v1)).units.length, 5, 'l’ancienne version reste intacte');

  // 10. Shared courses stay within the establishment; Bêta keeps its own rules.
  const other = await okay(await post(cat + 'programs', A, {
    scopeId: alphaUniv, kindCode: 'certificat', code: 'C-ALG', title: 'Certificat d’algorithmique',
    organisation: 'Modulaire', duration: 'Six semaines', deliveryMode: 'À distance', creditUnit: 'unités',
  }));
  const otherPeriod = await okay(await edit(other.versionId, 'periods', { ordinal: 1, label: 'Module unique' }));
  assert.ok(otherPeriod.id);
  const otherDraft = await detail(other.versionId);
  await okay(await edit(other.versionId, 'units', { periodId: otherDraft.periods[0].id, code: 'M1', title: 'Module', credits: 3 }));
  const otherUnit = (await detail(other.versionId)).units[0].id;
  await okay(await edit(other.versionId, 'courses', { unitId: otherUnit, courseId: algo.id }));
  const overview = await okay(await get(`${cat}scopes?scopeId=${alphaUniv}`, A));
  assert.equal(overview.courses.find(item => item.code === 'C-ALGO').programs, 2);

  const betaProgram = await okay(await post(cat + 'programs', B, {
    scopeId: betaUniv, kindCode: 'certificat', code: 'C-B1', title: 'Certificat Bêta',
    organisation: 'Trimestrielle', duration: 'Un trimestre', deliveryMode: 'Présentiel', creditUnit: 'unités de valeur',
  }));
  const betaDraft = await detail(betaProgram.versionId, B);
  await okay(await edit(betaProgram.versionId, 'periods', { ordinal: 1, label: 'Trimestre 1' }, B));
  const betaPeriod = (await detail(betaProgram.versionId, B)).periods[0].id;
  await okay(await edit(betaProgram.versionId, 'units', { periodId: betaPeriod, code: 'B1', title: 'Bêta', credits: 6 }, B));
  const betaUnit = (await detail(betaProgram.versionId, B)).units[0].id;
  await status(await edit(betaProgram.versionId, 'courses', { unitId: betaUnit, courseId: algo.id }, B), 422, 'cours d’un autre établissement');
  assert.equal(betaDraft.version.credit_unit, 'unités de valeur');
  await status(await get(`${cat}programs/${program.id}`, B), 403, 'programme d’Alpha invisible');
  await status(await post(cat + 'programs', B, { scopeId: second.scopeId, kindCode: 'certificat', code: 'X', title: 'Intrusion',
    organisation: 'S', duration: 'D', deliveryMode: 'M', creditUnit: 'c' }), 403, 'création transverse');
  await status(await course('C-X', 'Intrusion', alphaUniv, B), 403, 'cours transverse');
  await status(await post(`${cat}program-versions/${v2}/simulate`, B, { choices: [] }), 403, 'simulation transverse');

  // 11. Studios render through the server with their permissions.
  const studio = await (await get(`/administration/catalogue?version=${v2}`, A)).text();
  assert.match(studio, /Licence d’informatique \(2029\)/);
  assert.match(studio, /Publiée/);
  assert.doesNotMatch(await (await get(`/administration/catalogue?version=${v2}`, B)).text(), /Licence d’informatique \(2029\)/);
  assert.match(await (await get(`/administration/structures?scope=${faculty.scopeId}`, A)).text(), /Doyen/);
  assert.match(await (await get(`/administration/catalogue?version=${v1}&simuler=1&choice=${id('U3')}`, A)).text(), /Plan conforme à la maquette/);
  // Menus follow permissions; the routes remain protected on the server.
  assert.match(await (await get('/', A)).text(), /href="\/administration\/site"/);
  const localMenu = await (await get('/', B)).text();
  assert.doesNotMatch(localMenu, /href="\/administration\/site"/);
  assert.match(localMenu, /href="\/administration\/catalogue"/);
  assert.doesNotMatch(await (await get('/')).text(), /href="\/administration\//);
  assert.equal((await get('/administration/site', B)).status, 200);
  assert.match(await (await get('/administration/site', B)).text(), /Aucun périmètre ne vous est attribué/);
  const espace = await (await get('/espace', A)).text();
  assert.match(espace, /Facultés et départements/);
  assert.match(espace, /Filières et formations/);
  const form = await call('/api/v1/catalog/program-versions/' + v2 + '/periods', {
    method: 'POST', headers: { Origin: origin, Cookie: A, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ return: 'https://evil.example/x', ordinal: '9', label: 'x' }),
  });
  assert.equal(form.status, 303);
  assert.equal(new URL(form.headers.get('location')).origin, origin, 'aucune redirection externe');
  assert.match(form.headers.get('location'), /error=409/);

  const trail = await database.query(`
    SELECT DISTINCT action FROM unoa.audit_event WHERE action LIKE 'org.%' OR action LIKE 'catalog.%' ORDER BY action
  `);
  assert.deepEqual(trail.rows.map(row => row.action), [
    'catalog.access', 'catalog.admission_changed', 'catalog.authorization_recorded', 'catalog.authorization_verified',
    'catalog.competency_created', 'catalog.course_created', 'catalog.field_created', 'catalog.field_type_defined',
    'catalog.kind_defined', 'catalog.program_created', 'catalog.version_created', 'catalog.version_edited',
    'catalog.version_published', 'catalog.version_reviewed', 'catalog.version_submitted',
    'org.access', 'org.appointed', 'org.appointment_ended', 'org.capacity_recorded', 'org.change_decided',
    'org.change_requested', 'org.position_created', 'org.unit_decided', 'org.unit_proposed',
  ]);
}
