import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Doctorate: school and laboratory, scientific application, admission decided
// by a person outside the project with funding validation, director authorised
// to supervise research, independent monitoring committee, annual reports and
// decisions, re-enrolment within the configured duration, expired enrolment
// and lost supervision blocking the follow-up, training hours, publications,
// ethics review, authorisation to defend only when every condition is met,
// then the shared jury, defence, minutes and embargoed archive; no diploma
// produced. Runs after the theses fixture.
export async function exerciseDoctorate({ database, issuer, login, call, origin }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const names = ['school', 'hdr', 'hdr2', 'nohdr', 'committee', 'ethics', 'checker', 'candidate', 'candidate2', 'president', 'rapporteur', 'rapporteur2', 'external', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('phd_school_t'), ('phd_hdr_t'), ('phd_nohdr_t'), ('phd_ethics_t'), ('phd_checker_t'), ('phd_member_t');
    INSERT INTO unoa.role_permission VALUES ('phd_school_t', 'phd.read'), ('phd_school_t', 'phd.manage'), ('phd_school_t', 'phd.decide'), ('phd_school_t', 'phd.authorize'),
      ('phd_school_t', 'thesis.read'), ('phd_school_t', 'thesis.manage'), ('phd_hdr_t', 'phd.read'), ('phd_hdr_t', 'phd.direct'), ('phd_hdr_t', 'thesis.read'),
      ('phd_nohdr_t', 'thesis.supervise'), ('phd_ethics_t', 'phd.read'), ('phd_ethics_t', 'phd.ethics'), ('phd_checker_t', 'thesis.read'), ('phd_checker_t', 'thesis.integrity'), ('phd_member_t', 'thesis.read');
  `);
  const roles = { school: 'phd_school_t', hdr: 'phd_hdr_t', hdr2: 'phd_hdr_t', nohdr: 'phd_nohdr_t', committee: 'phd_member_t', ethics: 'phd_ethics_t', checker: 'phd_checker_t',
    president: 'phd_member_t', rapporteur: 'phd_member_t', rapporteur2: 'phd_member_t', external: 'phd_member_t' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Doctorat ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'phd-' + name, id]);
    if (roles[name]) await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)', [id, univ.id, roles[name]]);
  }
  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('phd-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const send = (module, action, who, data) => call(`/api/v1/${module}/${action}`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const post = (action, who, data) => send('phd', action, who, data);
  const thesis = (action, who, data) => send('thesis', action, who, data);
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => {
    const result = await response;
    assert.equal(result.status, expected, label + (result.status === expected ? '' : ' — ' + (await result.text()).slice(0, 300)));
  };
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getUTCFullYear();
  const y = offset => `${year + offset}-${year + offset + 1}`;
  const conditions = async (who, projectId) => (await okay(await get('/api/v1/phd/me', who))).theses.find(item => item.project.id === projectId).conditions;

  // 1. Regulation of the doctorate, school and laboratory.
  await okay(await thesis('rules', 'school', { scopeId: univ.id, level: 'doctorat', minJury: 4, rapporteurs: 2, externalMember: true, similarityThreshold: 20, maxEmbargoYears: 5,
    noticeDays: 0, maxYears: 2, trainingHours: 20, effectiveFrom: today }));
  await status(post('schools', 'outsider', { scopeId: univ.id, name: 'X' }), 403);
  const school = (await okay(await post('schools', 'school', { scopeId: univ.id, name: 'École doctorale sciences (test)', directorId: ids.school }))).subject;
  const lab = (await okay(await post('labs', 'school', { schoolId: school, code: 'LAB-IA', name: 'Laboratoire d’intelligence artificielle (test)' }))).subject;

  // 2. Application and admission.
  const application = { labId: lab, title: 'Modèles frugaux pour langues peu dotées (test)', dossier: 'État de l’art, objectifs, méthode, calendrier (test).', funding: 'Contrat doctoral (test)' };
  await status(post('apply', 'candidate', { ...application, proposedDirectorId: ids.nohdr }), 422, 'directeur non habilité');
  const applied = (await okay(await post('apply', 'candidate', { ...application, proposedDirectorId: ids.hdr }))).applicationId;
  await status(post('decide', 'hdr', { applicationId: applied, decision: 'accepted', academicYear: y(0) }), 403, 'décision hors du projet');
  await status(post('decide', 'school', { applicationId: applied, decision: 'rejected' }), 400, 'refus motivé');
  await okay(await post('decide', 'school', { applicationId: applied, decision: 'accepted', fundingStatus: 'validated', academicYear: y(0), ethicsNeeded: true }));
  let space = await okay(await get('/api/v1/phd/me', 'candidate'));
  const file = space.theses[0];
  const project = file.project.id;
  assert.ok(file.active, 'première inscription en cours');
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'phd.admission'", [ids.candidate])).rows[0]);
  await status(thesis('supervise', 'school', { projectId: project, accountId: ids.nohdr, role: 'co_director', qualification: 'Docteur' }), 422, 'codirection réservée aux habilités');

  // 3. Committee, annual report, decision, re-enrolment within the duration.
  await status(post('committee', 'school', { projectId: project, accountId: ids.hdr }), 403, 'comité indépendant du directeur');
  await okay(await post('committee', 'school', { projectId: project, accountId: ids.committee }));
  await okay(await post('annual-report', 'candidate', { projectId: project, academicYear: y(0), report: 'Avancement de la première année (test).' }));
  await status(post('review', 'candidate', { projectId: project, academicYear: y(0), decision: 'continue', opinion: 'x' }), 403);
  await status(post('reenrol', 'school', { projectId: project, academicYear: y(1), validFrom: today, validUntil: today }), 422, 'réinscription après avis du comité');
  await okay(await post('review', 'committee', { projectId: project, academicYear: y(0), decision: 'continue', opinion: 'Progression conforme (test).' }));
  const next = new Date(Date.now() + 366 * 864e5).toISOString().slice(0, 10); const end = new Date(Date.now() + 730 * 864e5).toISOString().slice(0, 10);
  await okay(await post('reenrol', 'school', { projectId: project, academicYear: y(1), validFrom: next, validUntil: end }));
  await okay(await post('annual-report', 'candidate', { projectId: project, academicYear: y(1), report: 'Avancement de la deuxième année (test).' }));
  await okay(await post('review', 'committee', { projectId: project, academicYear: y(1), decision: 'continue_with_conditions', opinion: 'Rédaction à accélérer (test).' }));
  await status(post('reenrol', 'school', { projectId: project, academicYear: y(2), validFrom: end, validUntil: end }), 422, 'durée maximale configurée');

  // 4. Lost supervision and expired enrolment block the follow-up (second candidate).
  const second = (await okay(await post('apply', 'candidate2', { ...application, title: 'Thèse de contrôle (test)', funding: undefined, proposedDirectorId: ids.hdr2 }))).applicationId;
  await okay(await post('decide', 'school', { applicationId: second, decision: 'accepted', academicYear: y(0) }));
  const other = (await okay(await get('/api/v1/phd/me', 'candidate2'))).theses[0].project.id;
  await okay(await thesis('end-supervision', 'school', { projectId: other, accountId: ids.hdr2, reason: 'Départ de l’établissement (test)' }));
  await status(post('annual-report', 'candidate2', { projectId: other, academicYear: y(0), report: 'x' }), 422, 'supervision perdue');
  await okay(await thesis('supervise', 'school', { projectId: other, accountId: ids.hdr, role: 'director', qualification: 'HDR' }));
  // Test-only: time passes beyond the enrolment period.
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    UPDATE unoa.doctoral_enrollment SET valid_from = current_date - 400, valid_until = current_date - 35 WHERE project_id = '${other}'; COMMIT;`);
  await status(post('annual-report', 'candidate2', { projectId: other, academicYear: y(0), report: 'x' }), 422, 'inscription périmée');

  // 5. Training, publications, ethics; authorisation only when every condition is met.
  await okay(await post('trainings', 'candidate', { projectId: project, kind: 'seminar', title: 'Séminaire d’éthique (test)', hours: 12, evidence: 'Attestation de présence' }));
  await okay(await post('trainings', 'candidate', { projectId: project, kind: 'course', title: 'Méthodologie (test)', hours: 10, evidence: 'Attestation' }));
  space = await okay(await get('/api/v1/phd/me', 'candidate'));
  const [first, second2] = space.theses[0].trainings;
  await status(post('validate-training', 'candidate', { projectId: project, trainingId: first.id }), 403);
  await okay(await post('validate-training', 'school', { projectId: project, trainingId: first.id }));
  await status(post('publications', 'candidate', { projectId: project, kind: 'article', title: 'X', venue: 'Y', year, status: 'submitted', doi: 'pas-un-doi' }), 400);
  await okay(await post('publications', 'candidate', { projectId: project, kind: 'article', title: 'Frugal models (test)', venue: 'Revue de test', year, status: 'accepted', doi: '10.1234/test.2026' }));
  await status(post('authorize', 'school', { projectId: project }), 422, 'conditions non remplies');
  const missing = (await conditions('candidate', project)).filter(item => !item.met).map(item => item.label).join(' | ');
  assert.match(missing, /Formations doctorales validées : 12 h \/ 20 h/);
  assert.match(missing, /Avis éthique favorable/);
  await status(post('ethics', 'school', { projectId: project, committee: 'CER', reference: 'X', decision: 'approved', note: 'x' }), 403, 'avis éthique réservé');
  await okay(await post('ethics', 'ethics', { projectId: project, committee: 'Comité d’éthique (test)', reference: 'CER-2026-01', decision: 'refused', note: 'Consentement des participants à préciser.' }));
  await okay(await post('validate-training', 'school', { projectId: project, trainingId: second2.id }));
  await status(post('authorize', 'school', { projectId: project }), 422, 'non-conformité éthique');
  await okay(await post('ethics', 'ethics', { projectId: project, committee: 'Comité d’éthique (test)', reference: 'CER-2026-01-bis', decision: 'approved', note: 'Protocole de consentement validé.' }));
  const upload = (bytes, kind = 'draft') => {
    const body = new FormData();
    body.set('return', '/memoires/projet?id=' + project); body.set('projectId', project); body.set('kind', kind); body.set('file', new Blob([bytes]), 'these.pdf');
    return call('/api/v1/thesis/drafts', { method: 'POST', headers: { Origin: origin, Cookie: cookies.candidate }, body, redirect: 'manual' });
  };
  await upload(new TextEncoder().encode('%PDF-1.4\n% manuscrit\n'));
  const { rows: [draft] } = await database.query("SELECT id FROM unoa.thesis_draft WHERE project_id = $1 ORDER BY version DESC LIMIT 1", [project]);
  await status(thesis('defenses', 'school', { projectId: project, mode: 'onsite', place: 'Amphi (test)', startsAt: new Date(Date.now() + 864e5).toISOString() }), 422, 'contrôle d’intégrité requis');
  await okay(await thesis('integrity', 'checker', { draftId: draft.id, method: 'similarity_report', similarity: 8, note: 'Rapport de similarité : 8 % (test).' }));
  await status(thesis('defenses', 'school', { projectId: project, mode: 'onsite', place: 'Amphi (test)', startsAt: new Date(Date.now() + 864e5).toISOString() }), 422, 'autorisation de soutenance requise');
  await status(post('authorize', 'hdr', { projectId: project }), 403);
  await okay(await post('authorize', 'school', { projectId: project }));
  await status(post('authorize', 'school', { projectId: project }), 409);

  // 6. Pre-defence reports, jury, defence, minutes, signatures, archive with embargo.
  const defense = (await okay(await thesis('defenses', 'school', { projectId: project, mode: 'hybrid', place: 'Amphi (test)', meetingUrl: 'https://visio.example.org/these', startsAt: new Date(Date.now() + 864e5).toISOString() }))).defenseId;
  for (const [who, role, external] of [['president', 'president', false], ['rapporteur', 'rapporteur', true], ['rapporteur2', 'rapporteur', false], ['hdr', 'supervisor', false]]) {
    await okay(await thesis('jury', 'school', { defenseId: defense, accountId: ids[who], role, external }));
  }
  await okay(await thesis('reports', 'rapporteur', { defenseId: defense, opinion: 'favourable', report: 'Thèse soutenable (test).' }));
  await status(thesis('convene', 'school', { defenseId: defense }), 422, 'tous les rapports favorables');
  await okay(await thesis('reports', 'rapporteur2', { defenseId: defense, opinion: 'favourable', report: 'Thèse soutenable (test).' }));
  await okay(await thesis('convene', 'school', { defenseId: defense }));
  await okay(await thesis('hold', 'president', { defenseId: defense, outcome: 'admitted', present: [ids.president, ids.rapporteur, ids.rapporteur2, ids.hdr], minutes: 'Thèse admise (test).' }));
  for (const who of ['president', 'rapporteur', 'rapporteur2', 'hdr']) await okay(await thesis('sign', who, { defenseId: defense }));
  await upload(new TextEncoder().encode('%PDF-1.4\n% version définitive\n'), 'final');
  await okay(await thesis('accept-deposit', 'hdr', { projectId: project, embargoUntil: new Date(Date.now() + 3 * 366 * 864e5).toISOString().slice(0, 10), embargoReason: 'Publication en cours (test)' }));
  assert.match(await (await get('/memoires')).text(), /Modèles frugaux pour langues peu dotées \(test\)/);

  // 7. No diploma is produced by the doctoral module (PHD-013): diplomas go through the authorised register.
  assert.equal((await database.query('SELECT count(*)::int AS total FROM unoa.credential WHERE holder_id = $1', [ids.candidate])).rows[0].total, 0);
  await assert.rejects(database.query("UPDATE unoa.doctoral_enrollment SET valid_until = current_date + 3000 WHERE project_id = $1", [project]), /append-only/);
  assert.match(await (await get('/doctorat', 'candidate')).text(), /soutenance autorisée/);
  assert.match(await (await get(`/administration/doctorat?scope=${univ.id}`, 'school')).text(), /Doctorants/);
  await status(get(`/api/v1/phd/scopes?scopeId=${univ.id}`, 'candidate'), 403);
}
