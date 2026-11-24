import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Internal assessments: typed and versioned question banks, an exam with draw,
// duration, accommodation and double grading, drafts, server receipt and
// idempotent submission, automatic scoring limited to suitable questions, human
// grading with feedback, moderation, team work, integrity procedure heard
// contradictorily, sealed archive, isolation from people outside the offering.
export async function exerciseAssessments({ database, issuer, login, call, origin }) {
  const names = ['teacher', 'grader', 'moderator', 'learner', 'mate', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  const { rows: [gamma] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Gamma'");
  const { rows: [offering] } = await database.query("SELECT id FROM unoa.course_offering WHERE owner_scope_id = $1 AND state = 'open' LIMIT 1", [gamma.id]);
  assert.ok(offering, 'une offre de cours ouverte existe');
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('ass_grader'), ('ass_moderator');
    INSERT INTO unoa.role_permission VALUES ('ass_grader', 'ass.read'), ('ass_grader', 'ass.grade'),
      ('ass_moderator', 'ass.read'), ('ass_moderator', 'ass.moderate'), ('ass_moderator', 'ass.integrity');
  `);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Évaluation ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'ass-' + name, id]);
  }
  for (const [name, role] of [['grader', 'ass_grader'], ['moderator', 'ass_moderator']]) {
    await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)', [ids[name], gamma.id, role]);
  }
  for (const [name, role] of [['teacher', 'teacher'], ['learner', 'learner'], ['mate', 'learner']]) {
    await database.query('INSERT INTO unoa.offering_member(offering_id, account_id, role, added_by) VALUES ($1, $2, $3, $4)', [offering.id, ids[name], role, ids.teacher]);
  }
  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('ass-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/ass/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify({ offeringId: offering.id, ...data }),
  });
  const form = (action, who, data) => call('/api/v1/ass/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(data).toString(), redirect: 'manual',
  });
  const get = (path, who) => call(path, { headers: { Cookie: cookies[who] } });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => assert.equal((await response).status, expected, label);
  const iso = minutes => new Date(Date.now() + minutes * 60_000).toISOString();

  // 1. Banks, typed questions, validation and versions.
  await status(post('banks', 'outsider', { title: 'X' }), 403, 'hors de l’équipe pédagogique');
  await status(post('banks', 'learner', { title: 'X' }), 403, 'un apprenant ne crée pas de banque');
  const bank = (await okay(await post('banks', 'teacher', { title: 'Banque web (test)' }))).bankId;
  const add = (kind, prompt, source, points = 1) => post('questions', 'teacher', { bankId: bank, kind, prompt, source, points });
  await status(add('single', 'Deux bonnes ?', '*A\n*B\nC'), 400, 'choix unique : une seule bonne réponse');
  await status(add('numeric', 'Valeur ?', 'beaucoup'), 400, 'valeur numérique attendue');
  const q = {};
  q.single = (await okay(await add('single', 'Balise de titre principal ?', 'p\n*h1\ndiv'))).questionId;
  q.multiple = (await okay(await add('multiple', 'Langages du navigateur ?', '*HTML\n*CSS\nCOBOL'))).questionId;
  q.matching = (await okay(await add('matching', 'Associez', 'GET = lire\nPOST = créer', 2))).questionId;
  q.numeric = (await okay(await add('numeric', 'Code HTTP « introuvable » ?', '404'))).questionId;
  q.text = (await okay(await add('text', 'Expliquez le modèle client-serveur.', '', 4))).questionId;
  q.code = (await okay(await add('code', 'Écrivez une fonction somme.', '', 3))).questionId;
  const revised = (await okay(await post('revise', 'teacher', { questionId: q.numeric, prompt: 'Code HTTP pour « ressource introuvable » ?', source: '404 ± 0', points: 1 }))).questionId;
  await status(post('revise', 'teacher', { questionId: q.numeric, prompt: 'Bis', source: '1', points: 1 }), 404, 'une version retirée ne se révise plus');
  const versions = await database.query('SELECT version, retired_at FROM unoa.question WHERE lineage = (SELECT lineage FROM unoa.question WHERE id = $1) ORDER BY version', [revised]);
  assert.deepEqual(versions.rows.map(row => [row.version, !!row.retired_at]), [[1, true], [2, false]]);
  q.numeric = revised;
  await assert.rejects(database.query("UPDATE unoa.question SET prompt = 'réécrit' WHERE id = $1", [q.single]), /immutable/, 'une version ne se réécrit pas');

  // 2. Exam: draw 5 of 6, duration, accommodation, double grading, rubric; frozen once published.
  await status(post('assessments', 'teacher', { title: 'X', kind: 'exam', opensAt: iso(10), closesAt: iso(5) }), 400, 'fermeture après ouverture');
  const exam = (await okay(await post('assessments', 'teacher', { title: 'Examen web (test)', kind: 'exam', opensAt: iso(-1), closesAt: iso(24 * 60),
    durationMinutes: 30, attemptsAllowed: 1, drawCount: 5, doubleGrading: true, rubric: 'Clarté : 2' }))).assessmentId;
  await status(post('publish', 'teacher', { assessmentId: exam }), 422, 'sujet vide');
  for (const id of Object.values(q)) await okay(await post('add-question', 'teacher', { assessmentId: exam, questionId: id }));
  await status(post('accommodations', 'teacher', { assessmentId: exam, accountId: ids.outsider, extraMinutes: 10, reason: 'x' }), 422, 'aménagement hors offre');
  await status(post('accommodations', 'teacher', { assessmentId: exam, accountId: ids.learner, reason: 'Sans durée' }), 400, 'aménagement sans temps');
  await okay(await post('accommodations', 'teacher', { assessmentId: exam, accountId: ids.learner, extraMinutes: 15, reason: 'Tiers temps documenté (test)' }));
  await okay(await post('publish', 'teacher', { assessmentId: exam }));
  await status(post('add-question', 'teacher', { assessmentId: exam, questionId: q.single }), 409, 'sujet figé après publication');
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'ass.published'", [ids.learner])).rows[0], 'apprenants prévenus');

  // 3. Attempt: drawn subject without answers, draft, receipt, idempotent retry.
  await status(post('start', 'outsider', { assessmentId: exam }), 403, 'réservé aux apprenants de l’offre');
  const attempt = (await okay(await post('start', 'learner', { assessmentId: exam }))).attemptId;
  assert.equal((await okay(await post('start', 'learner', { assessmentId: exam }))).attemptId, attempt, 'reprise de la tentative en cours');
  let copy = await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'learner'));
  assert.equal(copy.subject.length, 5, 'tirage de cinq questions');
  assert.ok(copy.subject.every(item => item.answer === undefined), 'aucune réponse attendue transmise à l’apprenant');
  const minutes = (new Date(copy.attempt.deadline) - new Date(copy.attempt.started_at)) / 60_000;
  assert.ok(minutes > 44 && minutes < 46, 'durée + tiers temps');
  await status(get(`/api/v1/ass/attempts/${attempt}`, 'mate'), 403, 'copie d’un autre apprenant');
  const drawn = new Set(copy.subject.map(item => item.id));
  const correct = { [q.single]: 1, [q.multiple]: [0, 1], [q.matching]: ['lire', 'créer'], [q.numeric]: '404', [q.text]: 'Le client demande, le serveur répond.', [q.code]: 'const somme = (a, b) => a + b;' };
  const answers = Object.fromEntries(Object.entries(correct).filter(([id]) => drawn.has(id)));
  await okay(await post('save', 'learner', { attemptId: attempt, answers: { [q.single]: 0 } }));
  copy = await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'learner'));
  assert.ok(copy.attempt.saved_at, 'brouillon enregistré');
  await okay(await post('save', 'learner', { attemptId: attempt, answers }));
  const submitted = await okay(await post('submit', 'learner', { attemptId: attempt }));
  assert.match(submitted.receipt, /^[0-9a-f]{64}$/, 'accusé de réception');
  const replay = await okay(await post('submit', 'learner', { attemptId: attempt }));
  assert.deepEqual([replay.receipt, replay.replay], [submitted.receipt, true], 'réessai idempotent');
  await status(post('save', 'learner', { attemptId: attempt, answers: {} }), 409, 'copie figée');
  await status(post('start', 'learner', { assessmentId: exam }), 409, 'tentatives épuisées');
  const auto = ['single', 'multiple', 'matching', 'numeric'].filter(kind => drawn.has(q[kind])).reduce((sum, kind) => sum + (kind === 'matching' ? 2 : 1), 0);
  const { rows: [stored] } = await database.query('SELECT auto_score FROM unoa.attempt WHERE id = $1', [attempt]);
  assert.equal(Number(stored.auto_score), auto, 'correction automatique des seules questions adaptées');
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'ass.receipt'", [ids.learner])).rows[0]);
  await assert.rejects(database.query("UPDATE unoa.attempt SET answers = '{}' WHERE id = $1", [attempt]), /immutable/);

  // 4. Grading: human scores within the scale, second grading by another person, moderation.
  const manual = Object.fromEntries(['text', 'code'].filter(kind => drawn.has(q[kind])).map(kind => [q[kind], kind === 'text' ? 4 : 3]));
  await status(post('grade', 'learner', { attemptId: attempt, scores: manual }), 403, 'pas d’auto-correction');
  await status(post('grade', 'teacher', { attemptId: attempt, scores: { ...manual, [Object.keys(manual)[0]]: 99 } }), 400, 'note hors barème');
  await status(post('grade', 'teacher', { attemptId: attempt, round: 'second', scores: manual }), 409, 'la première correction précède');
  await okay(await post('grade', 'teacher', { attemptId: attempt, scores: { ...manual, c0: 2 }, feedback: 'Très bonne copie.' }));
  copy = await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'learner'));
  assert.deepEqual([copy.mark, copy.gradings.length], [null, 0], 'pas de note avant la fin de la double correction');
  await status(post('grade', 'teacher', { attemptId: attempt, round: 'second', scores: manual }), 403, 'seconde correction par une autre personne');
  await okay(await post('grade', 'grader', { attemptId: attempt, round: 'second', scores: {}, feedback: 'Réponses rédigées insuffisantes.' }));
  copy = await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'teacher'));
  assert.equal(copy.pending, 'moderation', 'écart important : modération');
  await status(post('grade', 'grader', { attemptId: attempt, round: 'moderation', scores: manual }), 403, 'modération réservée');
  await okay(await post('grade', 'moderator', { attemptId: attempt, round: 'moderation', scores: { ...manual, c0: 1 }, feedback: 'Note arrêtée après modération.' }));
  copy = await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'learner'));
  const maximum = copy.maximum;
  assert.equal(copy.mark, auto + Object.values(manual).reduce((a, b) => a + b, 0) + 1);
  assert.ok(copy.mark <= maximum && copy.gradings.some(item => item.feedback === 'Note arrêtée après modération.'), 'note finale et commentaires');
  assert.ok(copy.gradings.every(item => item.grader === undefined), 'correcteurs non nommés côté apprenant');
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'ass.graded'", [ids.learner])).rows[0]);

  // 5. Team work: members share a single copy.
  const team = (await okay(await post('assessments', 'teacher', { title: 'Projet en équipe (test)', kind: 'assignment', team: true, opensAt: iso(-1), closesAt: iso(60), rubric: 'Qualité : 10' }))).assessmentId;
  await okay(await post('publish', 'teacher', { assessmentId: team }));
  await status(post('start', 'learner', { assessmentId: team }), 400, 'nom d’équipe exigé');
  const teamAttempt = (await okay(await post('start', 'learner', { assessmentId: team, teamLabel: 'Équipe 1' }))).attemptId;
  assert.equal((await okay(await post('start', 'mate', { assessmentId: team, teamLabel: 'Équipe 1' }))).attemptId, teamAttempt, 'le coéquipier rejoint la copie');
  // Browser form: the draft and the submission come from the same form.
  const saved = await form('save', 'mate', { return: `/evaluations/copie?id=${teamAttempt}`, attemptId: teamAttempt, answersForm: '1' });
  assert.match(saved.headers.get('location'), /message=saved/);
  await okay(await post('submit', 'mate', { attemptId: teamAttempt }));
  await okay(await get(`/api/v1/ass/attempts/${teamAttempt}`, 'learner'));
  await okay(await post('grade', 'teacher', { attemptId: teamAttempt, scores: { c0: 8 }, feedback: 'Bon travail collectif.' }));
  assert.equal((await okay(await get(`/api/v1/ass/attempts/${teamAttempt}`, 'learner'))).mark, 8);

  // 6. Integrity: report, the learner answers, another person decides with reasons.
  await okay(await post('report', 'teacher', { attemptId: attempt, reason: 'Réponse identique à une source en ligne (test).' }));
  const integrity = (await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'learner'))).cases[0];
  assert.equal((await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'learner'))).mark, null, 'note suspendue pendant la procédure');
  await status(post('decide', 'moderator', { caseId: integrity.id, outcome: 'sanctioned', decision: 'x' }), 409, 'droit de réponse préalable');
  await status(post('respond', 'mate', { caseId: integrity.id, response: 'x' }), 403);
  await okay(await post('respond', 'learner', { caseId: integrity.id, response: 'Je cite la source dans ma copie.' }));
  await status(post('decide', 'teacher', { caseId: integrity.id, outcome: 'dismissed', decision: 'x' }), 403, 'décision par une personne habilitée');
  await okay(await post('decide', 'moderator', { caseId: integrity.id, outcome: 'dismissed', decision: 'Source citée : pas de plagiat.' }));
  assert.equal((await okay(await get(`/api/v1/ass/attempts/${attempt}`, 'learner'))).mark, copy.mark, 'note rétablie');
  assert.ok((await database.query("SELECT 1 FROM unoa.audit_event WHERE action = 'ass.integrity_dismissed' AND actor_id = $1", [ids.moderator])).rows[0]);

  // 7. Archive, isolation and screens.
  const archive = await (await get(`/api/v1/ass/archive/${exam}`, 'teacher')).json();
  assert.equal(archive.format, 'unoa.assessment-archive/1');
  assert.match(archive.seal, /^[0-9a-f]{64}$/);
  assert.equal(archive.copies[0].receipt, submitted.receipt);
  assert.equal(archive.copies[0].gradings.length, 3);
  await status(get(`/api/v1/ass/archive/${exam}`, 'learner'), 403, 'archive réservée');
  await status(get(`/api/v1/ass/offerings/${offering.id}`, 'outsider'), 403, 'isolation de l’offre');
  await status(get(`/api/v1/ass/offerings/${offering.id}`, 'learner'), 403);
  const overview = await okay(await get(`/api/v1/ass/offerings/${offering.id}`, 'grader'));
  assert.ok(overview.copies.length >= 2 && overview.questions.every(item => item.answer !== undefined));
  const space = await okay(await get('/api/v1/ass/me', 'learner'));
  assert.ok(space.assessments.some(item => item.id === exam && item.attempts.length === 1));
  assert.match(await (await get('/evaluations', 'learner')).text(), /Mes évaluations/);
  assert.match(await (await get(`/evaluations/gestion?offre=${offering.id}`, 'teacher')).text(), /Banques de questions/);
  assert.match(await (await get(`/evaluations/copie?id=${attempt}`, 'moderator')).text(), /Procédure de fraude/);
  assert.match(await (await get(`/evaluations/gestion?offre=${offering.id}`, 'outsider')).text(), /hors de vos habilitations/);
}
