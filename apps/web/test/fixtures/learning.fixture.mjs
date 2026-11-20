import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { jwtVerify } from 'jose';

// Course studio, offering for a cohort, learner progress, forum and live
// sessions through the Jitsi-compatible adapter configured with a test key.
// Runs after the academic fixture, which declared the establishment type.
export async function exerciseLearning({ database, issuer, login, call, origin, alpha, live }) {
  const ids = Object.fromEntries(['author', 'reviewer', 'teacher', 'first', 'second', 'outsider'].map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role VALUES ('lms_author'), ('lms_reviewer');
    INSERT INTO unoa.permission VALUES ('lms.read'), ('lms.write'), ('lms.review'), ('lms.manage') ON CONFLICT DO NOTHING;
    INSERT INTO unoa.role_permission VALUES ('lms_author', 'lms.read'), ('lms_author', 'lms.write'), ('lms_author', 'lms.manage'),
      ('lms_reviewer', 'lms.read'), ('lms_reviewer', 'lms.review');
  `);
  const gamma = randomUUID();
  await database.query("INSERT INTO unoa.scope(id, type_code, parent_id, label, present_from) VALUES ($1, 'etab', $2, 'Université Gamma', now() - interval '1 day')", [gamma, alpha]);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id) VALUES ($1)', [id]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'lms-' + name, id]);
  }
  await database.query(`
    INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants)
    VALUES ($1, $3, 'lms_author', now(), true), ($2, $3, 'lms_reviewer', now(), true)
  `, [ids.author, ids.reviewer, gamma]);
  const course = randomUUID();
  await database.query("INSERT INTO unoa.course(id, owner_scope_id, code, title, created_by) VALUES ($1, $2, 'G-WEB', 'Développement web', $3)",
    [course, gamma, ids.author]);

  const cookies = {};
  for (const name of Object.keys(ids)) {
    issuer.useIdentity('lms-' + name, 'test-mfa');
    const result = await login();
    cookies[name] = result.headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (path, who, data) => call(path, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: { Cookie: cookies[who] } });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => assert.equal(response.status, expected, label);
  const lms = '/api/v1/lms/';
  const liveApi = '/api/v1/live/';
  const back = hours => { const at = new Date(Date.now() - hours * 3_600_000); return at; };
  async function travel(sessionId, startHoursAgo, endHoursAgo) {
    // Test-only time travel: the triggers forbid moving a session into the past.
    await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
      UPDATE unoa.live_session SET starts_at = '${back(startHoursAgo).toISOString()}', ends_at = '${back(endHoursAgo).toISOString()}' WHERE id = '${sessionId}';
      COMMIT;`);
  }
  // Wall-clock time in Porto-Novo, as typed in the form.
  const local = minutes => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Africa/Porto-Novo', dateStyle: 'short', timeStyle: 'short' })
    .format(new Date(Date.now() + minutes * 60_000)).replace(' ', 'T');

  // 1. Draft, syllabus, modules and lessons.
  const created = await okay(await post(`${lms}courses/${course}/versions`, 'author', {
    language: 'fr', title: 'Développement web', objectives: 'Construire une application web accessible.',
    prerequisites: 'Algorithmique', bibliography: 'Références fournies par l’enseignant',
  }));
  const v = created.id;
  const edit = (part, data, who = 'author') => post(`${lms}course-versions/${v}/${part}`, who, data);
  await status(await post(`${lms}course-versions/${v}/submit`, 'author', {}), 422, 'version vide');
  await okay(await edit('modules', { ordinal: 1, title: 'Fondamentaux', accessMode: 'sequential' }));
  await okay(await edit('modules', { ordinal: 2, title: 'Pratique', accessMode: 'free' }));
  let detail = await okay(await get(`${lms}course-versions/${v}`, 'author'));
  const [m1, m2] = detail.modules.map(item => item.id);
  const lesson = data => edit('lessons', { rights: 'Œuvre originale de l’équipe, licence CC BY 4.0', ...data });
  await okay(await lesson({ moduleId: m1, ordinal: 1, kind: 'page', title: 'Introduction',
    body: '# Bienvenue\nUn **cours** avec un [lien](https://example.test/doc).\n\n<script>alert(1)</script>' }));
  await status(await lesson({ moduleId: m1, ordinal: 2, kind: 'video', title: 'Sans média' }), 400, 'vidéo sans média');
  await status(await lesson({ moduleId: m1, ordinal: 2, kind: 'video', title: 'HTTP', mediaUrl: 'http://example.test/v.mp4' }), 400, 'média non HTTPS');
  await status(await lesson({ moduleId: m1, ordinal: 2, kind: 'video', title: 'Chapitres', mediaUrl: 'https://example.test/v.mp4', chapters: '02:00 B\n01:00 A' }), 400, 'chapitres');
  await okay(await lesson({ moduleId: m1, ordinal: 2, kind: 'video', title: 'Démonstration', mediaUrl: 'https://example.test/v.mp4',
    captionsUrl: 'https://example.test/v.vtt', captionsLanguage: 'fr', chapters: '00:00 Introduction\n01:30 Démonstration', transcript: 'Texte intégral.' }));
  detail = await okay(await get(`${lms}course-versions/${v}`, 'author'));
  const video = detail.lessons.find(item => item.kind === 'video');
  assert.deepEqual(video.chapters, [{ at: 0, title: 'Introduction' }, { at: 90, title: 'Démonstration' }]);
  await okay(await lesson({ moduleId: m2, ordinal: 1, kind: 'activity', title: 'Exercice guidé', body: 'Réalisez la page décrite.', requiresLessonId: video.id }));
  detail = await okay(await get(`${lms}course-versions/${v}`, 'author'));
  const [intro, , exercise] = detail.lessons.map(item => item.id);

  // 2. Validation by another person with three attestations, then immutability.
  await okay(await post(`${lms}course-versions/${v}/submit`, 'author', {}));
  await status(await edit('modules', { ordinal: 3, title: 'Tardif' }), 409, 'modification en revue');
  await status(await post(`${lms}course-versions/${v}/review`, 'author', { decision: 'approve', discipline: true, pedagogy: true, rights: true }), 403, 'auteur');
  await status(await post(`${lms}course-versions/${v}/review`, 'reviewer', { decision: 'approve', discipline: true, pedagogy: true }), 422, 'droits non vérifiés');
  await okay(await post(`${lms}course-versions/${v}/review`, 'reviewer', { decision: 'approve', discipline: true, pedagogy: true, rights: true }));
  await assert.rejects(database.query("UPDATE unoa.lesson SET title = 'Réécrit' WHERE version_id = $1", [v]), /Only a draft version is edited/);
  await status(await edit('modules', { ordinal: 3, title: 'Après publication' }), 409, 'version publiée');

  // 3. Export, restoration and regional variant.
  const exported = await okay(await get(`${lms}course-versions/${v}/export`, 'author'));
  assert.equal(exported.modules.length, 2);
  const restored = await okay(await post(`${lms}courses/${course}/import`, 'author', exported));
  const restoredDetail = await okay(await get(`${lms}course-versions/${restored.id}`, 'author'));
  assert.equal(restoredDetail.lessons.length, 3);
  assert.equal(restoredDetail.version.state, 'draft');
  await status(await post(`${lms}courses/${course}/import`, 'author', { ...exported, format: 'autre' }), 400, 'export corrompu');
  await status(await post(`${lms}courses/${course}/import`, 'reviewer', exported), 403, 'import sans droit');
  const variant = await okay(await post(`${lms}course-versions/${v}/derive`, 'author', { language: 'en', variantNote: 'Version anglaise' }));
  const variantDetail = await okay(await get(`${lms}course-versions/${variant.id}`, 'author'));
  assert.equal(variantDetail.version.variant_of, v);
  assert.equal(variantDetail.lessons.length, 3);

  // 4. Offering for a cohort and its members.
  const offer = data => post(`${lms}course-versions/${v}/offerings`, 'author', { label: 'Promotion 2027 · groupe A', startsOn: '2027-01-04', endsOn: '2027-06-30', ...data });
  await status(await offer({ timeZone: 'Afrique/Nulle' }), 400, 'fuseau inconnu');
  await status(await post(`${lms}course-versions/${restored.id}/offerings`, 'author', { label: 'X', timeZone: 'UTC', startsOn: '2027-01-01', endsOn: '2027-01-02' }), 422, 'version non publiée');
  const offering = (await okay(await offer({ timeZone: 'Africa/Porto-Novo' }))).id;
  const member = (accountId, role, displayName) => post(`${lms}offerings/${offering}/members`, 'author', { accountId, role, displayName });
  await okay(await member(ids.teacher, 'teacher', 'Pr Enseignant'));
  await okay(await member(ids.first, 'learner', 'Apprenant Un'));
  await okay(await member(ids.second, 'learner', 'Apprenant Deux'));
  await status(await member(ids.first, 'learner'), 409, 'inscription en double');
  await status(await post(`${lms}offerings/${offering}/members`, 'teacher', { accountId: ids.outsider, role: 'learner' }), 403, 'enseignant non gestionnaire');
  const denied = await get(`${lms}offerings/${offering}`, 'outsider');
  await status(denied, 403, 'non-membre');
  assert.equal((await database.query("SELECT action FROM unoa.audit_event WHERE correlation_id = $1", [(await denied.json()).correlationId])).rows[0].action, 'lms.access');

  // 5. Sequential and conditional access, progress distinct from grades.
  let view = await okay(await get(`${lms}offerings/${offering}`, 'first'));
  assert.deepEqual([intro, video.id, exercise].map(id => view.access[id].open), [true, false, false]);
  assert.equal(view.access[exercise].reason, 'condition');
  await status(await get(`${lms}offerings/${offering}/lessons/${video.id}`, 'first'), 423, 'leçon verrouillée');
  await status(await post(`${lms}offerings/${offering}/progress`, 'first', { lessonId: video.id }), 423, 'progression verrouillée');
  await okay(await post(`${lms}offerings/${offering}/progress`, 'first', { lessonId: intro }));
  await okay(await post(`${lms}offerings/${offering}/progress`, 'first', { lessonId: intro }));
  await okay(await post(`${lms}offerings/${offering}/progress`, 'first', { lessonId: video.id }));
  view = await okay(await get(`${lms}offerings/${offering}`, 'first'));
  assert.ok(view.access[exercise].open);
  assert.equal(view.completed.length, 2);
  await status(await post(`${lms}offerings/${offering}/progress`, 'teacher', { lessonId: intro }), 403, 'progression enseignant');
  assert.ok((await okay(await get(`${lms}offerings/${offering}`, 'teacher'))).access[exercise].open, 'l’enseignant voit tout');

  // 6. Private notes and bookmarks.
  await okay(await post(`${lms}offerings/${offering}/notes`, 'first', { lessonId: intro, body: 'Note personnelle', bookmarked: true }));
  assert.equal((await okay(await get(`${lms}offerings/${offering}/lessons/${intro}`, 'first'))).note.body, 'Note personnelle');
  assert.equal((await okay(await get(`${lms}offerings/${offering}/lessons/${intro}`, 'second'))).note, null);

  // 7. Moderated forum.
  const thread = (await okay(await post(`${lms}offerings/${offering}/threads`, 'first', { title: 'Question sur l’exercice', body: 'Comment commencer ?' }))).id;
  const reply = (await okay(await post(`${lms}offerings/${offering}/posts`, 'second', { threadId: thread, body: 'Message hors sujet' }))).id;
  await status(await post(`${lms}offerings/${offering}/hide`, 'first', { threadId: thread, postId: reply, reason: 'Hors sujet' }), 403, 'modération apprenant');
  await okay(await post(`${lms}offerings/${offering}/hide`, 'teacher', { threadId: thread, postId: reply, reason: 'Hors sujet' }));
  const learnerThread = await okay(await get(`${lms}offerings/${offering}/threads/${thread}`, 'first'));
  assert.equal(learnerThread.posts.find(item => item.id === reply).body, null);
  assert.equal((await okay(await get(`${lms}offerings/${offering}/threads/${thread}`, 'teacher'))).posts.find(item => item.id === reply).body, 'Message hors sujet');
  await okay(await post(`${lms}offerings/${offering}/lock`, 'teacher', { threadId: thread }));
  await status(await post(`${lms}offerings/${offering}/posts`, 'first', { threadId: thread, body: 'Après verrouillage' }), 422, 'discussion verrouillée');
  await assert.rejects(database.query("UPDATE unoa.forum_post SET body = 'réécrit' WHERE id = $1", [reply]), /moderated/);

  // 8. Due dates are typed in the offering's time zone.
  await okay(await post(`${lms}offerings/${offering}/dues`, 'teacher', { lessonId: exercise, dueAt: '2027-01-15T10:00' }));
  assert.equal((await database.query('SELECT due_at FROM unoa.lesson_due WHERE lesson_id = $1', [exercise])).rows[0].due_at.toISOString(), '2027-01-15T09:00:00.000Z');

  // 9. Live sessions: scheduling, convocation, signed join links.
  const schedule = (data, who = 'teacher') => post(`${liveApi}offerings/${offering}/sessions`, who, { title: 'Séance de lancement', durationMinutes: 60, ...data });
  await status(await schedule({ startsAt: local(-60) }), 422, 'séance passée');
  await status(await schedule({ startsAt: local(10) }, 'first'), 403, 'planification apprenant');
  const first = (await okay(await schedule({ startsAt: local(10), agenda: 'Présentation du cours' }))).id;
  const inbox = async who => (await okay(await get(`${lms}notifications`, who))).notifications;
  assert.ok((await inbox('first')).some(item => item.kind === 'live.scheduled'));
  assert.ok(!(await inbox('teacher')).some(item => item.kind === 'live.scheduled'), 'pas d’auto-notification');
  const join = (sessionId, who) => post(`${liveApi}sessions/${sessionId}/join`, who, {});
  await status(await join(first, 'outsider'), 403, 'lien refusé aux non-membres');
  const learnerLink = new URL((await okay(await join(first, 'first'))).url);
  assert.equal(learnerLink.hostname, live.domain);
  const { payload } = await jwtVerify(learnerLink.searchParams.get('jwt'), new TextEncoder().encode(live.secret), { issuer: live.appId, audience: 'jitsi' });
  assert.match(payload.room, /^[a-f0-9]{40}$/);
  assert.equal(learnerLink.pathname, '/' + payload.room);
  assert.equal(payload.context.user.moderator, false);
  assert.equal(payload.context.user.name, 'Apprenant Un');
  assert.ok(payload.exp * 1000 < Date.now() + 3 * 3_600_000, 'lien à durée courte');
  const teacherLink = new URL((await okay(await join(first, 'teacher'))).url);
  assert.equal((await jwtVerify(teacherLink.searchParams.get('jwt'), new TextEncoder().encode(live.secret))).payload.context.user.moderator, true);
  assert.equal((await database.query('SELECT joins FROM unoa.live_attendance WHERE session_id = $1 AND account_id = $2', [first, ids.first])).rows[0].joins, 1);

  // Recording requires an announcement and individual consent.
  await okay(await post(`${liveApi}sessions/${first}/recording`, 'teacher', { reason: 'Replay pour les absents' }));
  await status(await join(first, 'first'), 428, 'consentement requis');
  await okay(await post(`${liveApi}sessions/${first}/consent`, 'first', { decision: 'granted' }));
  await okay(await post(`${liveApi}sessions/${first}/consent`, 'second', { decision: 'refused' }));
  await okay(await join(first, 'first'));
  assert.equal((await database.query('SELECT joins FROM unoa.live_attendance WHERE session_id = $1 AND account_id = $2', [first, ids.first])).rows[0].joins, 2);
  const page = await (await get(`/apprendre/${offering}`, 'first')).text();
  assert.match(page, /Rejoindre la séance/);
  assert.match(page, /enregistrement annoncé/);

  await status(await post(`${liveApi}sessions/${first}/reschedule`, 'teacher', { startsAt: local(30), durationMinutes: 45 }), 400, 'report non motivé');
  await okay(await post(`${liveApi}sessions/${first}/reschedule`, 'teacher', { startsAt: local(30), durationMinutes: 45, reason: 'Conflit d’horaire' }));
  assert.ok((await inbox('second')).some(item => item.kind === 'live.rescheduled'));
  await travel(first, 2, 1);
  await status(await join(first, 'first'), 425, 'salle fermée');
  await okay(await post(`${liveApi}sessions/${first}/attendance`, 'teacher', { accountId: ids.first, status: 'present' }));
  await okay(await post(`${liveApi}sessions/${first}/attendance`, 'teacher', { accountId: ids.second, status: 'excused' }));
  await status(await post(`${liveApi}sessions/${first}/replay`, 'teacher', { url: 'https://example.test/replay-1' }), 422, 'refus d’enregistrement');
  const roster = await okay(await get(`${liveApi}sessions/${first}/attendance`, 'teacher'));
  assert.equal(roster.attendance.find(row => row.account_id === ids.first).status, 'present');
  assert.deepEqual(roster.events.map(item => item.kind), ['scheduled', 'recording_announced', 'rescheduled']);
  await status(await get(`${liveApi}sessions/${first}/attendance`, 'first'), 403, 'présences réservées');

  const second = (await okay(await schedule({ startsAt: local(20), recordingPlanned: true, title: 'Atelier' }))).id;
  await okay(await post(`${liveApi}sessions/${second}/consent`, 'first', { decision: 'granted' }));
  await status(await post(`${liveApi}sessions/${second}/replay`, 'teacher', { url: 'https://example.test/replay-2' }), 422, 'séance non terminée');
  await travel(second, 3, 2);
  await okay(await post(`${liveApi}sessions/${second}/replay`, 'teacher', { url: 'https://example.test/replay-2' }));
  assert.ok((await inbox('first')).some(item => item.kind === 'live.replay'));

  const third = (await okay(await schedule({ startsAt: local(40), title: 'Révision' }))).id;
  await okay(await post(`${liveApi}sessions/${third}/cancel`, 'teacher', { reason: 'Enseignant indisponible' }));
  assert.ok((await inbox('first')).some(item => item.kind === 'live.cancelled'));
  await status(await join(third, 'first'), 410, 'séance annulée');
  await status(await post(`${liveApi}sessions/${third}/reschedule`, 'teacher', { startsAt: local(60), durationMinutes: 30, reason: 'x' }), 409, 'report d’une séance annulée');

  // 10. Pages render through the server; authored tags stay text.
  const lessonPage = await (await get(`/apprendre/${offering}/lecon/${intro}`, 'first')).text();
  assert.match(lessonPage, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(lessonPage, /<script>alert\(1\)/);
  assert.match(await (await get(`/apprendre/${offering}/lecon/${video.id}`, 'first')).text(), /<track/);
  assert.match(await (await get('/apprendre', 'first')).text(), /Séance planifiée/);
  assert.match(await (await get(`/administration/cours?version=${v}`, 'author')).text(), /Développement web/);
  assert.doesNotMatch(await (await get(`/apprendre/${offering}`, 'outsider')).text(), /Rejoindre la séance/);
  const formJoin = await call(`${liveApi}sessions/${third}/join`, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies.first, 'Content-Type': 'application/x-www-form-urlencoded' }, body: '',
  });
  assert.equal(formJoin.status, 303);
  assert.match(formJoin.headers.get('location'), /error=410/);

  const trail = await database.query(`SELECT DISTINCT action FROM unoa.audit_event WHERE action LIKE 'lms.%' OR action LIKE 'live.%' ORDER BY action`);
  for (const action of ['lms.access', 'lms.lesson_completed', 'lms.member_added', 'lms.offering_created', 'lms.post_hidden',
    'lms.version_imported', 'lms.version_published', 'lms.version_submitted', 'live.access', 'live.consent_recorded',
    'live.session_cancel', 'live.session_joined', 'live.session_replay', 'live.session_scheduled']) {
    assert.ok(trail.rows.some(row => row.action === action), action);
  }
}
