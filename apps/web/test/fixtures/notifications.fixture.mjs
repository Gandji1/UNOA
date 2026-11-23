import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

// Laboratory SMS relay: a local HTTP server standing for the production
// provider (it proves the adapter contract, not a real delivery).
export async function startRelay() {
  const relay = { requests: [], answers: [], token: 'relay-' + randomUUID() };
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      relay.requests.push({ authorization: request.headers.authorization, key: request.headers['idempotency-key'], body: JSON.parse(body || '{}') });
      const status = relay.answers.shift() ?? 200;
      response.writeHead(status, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify(status === 200 ? { id: 'relay-' + relay.requests.length } : { error: 'test' }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  relay.url = `http://127.0.0.1:${server.address().port}/send`;
  relay.close = () => new Promise(resolve => server.close(resolve));
  return relay;
}

// Templates by scope and language, consents and preferences, outbox and worker,
// sandbox email and HTTP SMS relay, retries, dead jobs and replay, no leak of a
// sensitive event, consent withdrawal, export and rights.
export async function exerciseNotifications({ database, issuer, login, call, origin, relay, jobsToken }) {
  const names = ['editor', 'publisher', 'manager', 'reviewer', 'candidate', 'quiet'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('notif_editor'), ('notif_publisher');
    INSERT INTO unoa.role_permission VALUES ('notif_editor', 'not.read'), ('notif_editor', 'not.manage'),
      ('notif_publisher', 'not.read'), ('notif_publisher', 'not.publish'), ('notif_publisher', 'not.manage'), ('notif_publisher', 'ops.jobs');
  `);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id) VALUES ($1)', [id]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'not-' + name, id]);
  }
  await database.query(`
    INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants)
    VALUES ($1, $5, 'notif_editor', now(), true), ($2, $5, 'notif_publisher', now(), true),
           ($3, $5, 'adm_manager', now(), true), ($4, $5, 'adm_reviewer', now(), true)
  `, [ids.editor, ids.publisher, ids.manager, ids.reviewer, univ.id]);
  const program = randomUUID();
  const version = randomUUID();
  await database.query(`BEGIN; SET LOCAL session_replication_role = replica;
    INSERT INTO unoa.program(id, owner_scope_id, institution_id, kind_code, code, title, created_by)
      VALUES ('${program}', '${univ.id}', '${univ.id}', 'adm_certificat', 'NOT-CERT', 'Certificate in testing', '${ids.manager}');
    INSERT INTO unoa.program_authorization(program_id, status, authority, evidence, valid_from, recorded_by, verified_by, verified_at)
      VALUES ('${program}', 'non_degree', 'Établissement fictif', 'Délibération fictive SANDBOX', now() - interval '1 day', '${ids.manager}', '${ids.reviewer}', now());
    INSERT INTO unoa.program_version(id, program_id, number, state, title, organisation, duration, delivery_mode, credit_unit, author_id, published_at, admission_open)
      VALUES ('${version}', '${program}', 1, 'published', 'Certificate in testing', 'Semestres', '6 mois', 'À distance', 'ECTS', '${ids.manager}', now(), true);
    COMMIT;`);

  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('not-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (path, who, data) => call(path, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = (response, expected, label) => assert.equal(response.status, expected, label);
  const api = '/api/v1/notifications/';
  const adm = '/api/v1/admissions/';
  const run = () => call('/api/v1/jobs/run', { method: 'POST', headers: { Authorization: 'Bearer ' + jobsToken } });
  const jobsOf = async event => (await database.query(
    "SELECT id, state, payload, attempts FROM unoa.job WHERE payload->>'accountId' = $1 AND payload->>'event' = $2 ORDER BY payload->>'channel'",
    [ids.candidate, event])).rows;
  async function settle(event, expected) {
    for (let attempt = 0; attempt < 50; attempt++) {
      await okay(await run());
      const jobs = await jobsOf(event);
      if (jobs.length === Object.keys(expected).length && jobs.every(job => expected[job.payload.channel] === job.state)) return jobs;
      await delay(100);
    }
    assert.deepEqual(Object.fromEntries((await jobsOf(event)).map(job => [job.payload.channel, job.state])), expected, event);
  }

  // 1. Templates: declared variables only, plain text, published by another person.
  const draft = data => post(api + 'templates', 'editor', { scopeId: univ.id, event: 'adm.receipt', channel: 'internal', language: 'en', ...data });
  await status(await draft({ subject: 'Receipt {{unknown}}' }), 400, 'variable inconnue');
  await status(await draft({ subject: '<b>Receipt</b>' }), 400, 'balisage refusé');
  await status(await draft({ subject: 'Receipt', channel: 'fax' }), 400, 'canal inconnu');
  const internal = (await okay(await draft({ subject: 'Receipt {{receipt}} for {{program}}', body: 'Version {{revision}} received.' }))).id;
  const email = (await okay(await draft({ channel: 'email', subject: 'UNOA receipt {{receipt}}', body: 'Your file for {{program}} is registered.' }))).id;
  await status(await post(api + 'publish', 'editor', { templateId: internal }), 403, 'publication sans droit');
  const own = (await okay(await post(api + 'templates', 'publisher', { scopeId: univ.id, event: 'adm.receipt', channel: 'sms', language: 'en', subject: 'x', body: 'Receipt {{receipt}}' }))).id;
  await status(await post(api + 'publish', 'publisher', { templateId: own }), 403, 'auto-publication');
  await okay(await post(api + 'publish', 'publisher', { templateId: internal }));
  await okay(await post(api + 'publish', 'publisher', { templateId: email }));
  await assert.rejects(database.query("UPDATE unoa.notification_template SET body = 'x' WHERE id = $1", [internal]), /immutable/);

  // 2. The candidate's language, contacts, consents and preferences.
  await okay(await post('/api/v1/iam/profile', 'candidate', { displayName: 'Candidate Two', email: 'candidate@example.test' }));
  await status(await post(api + 'contact', 'candidate', { language: 'en', phone: '0190000012' }), 400, 'format international');
  await okay(await post(api + 'contact', 'candidate', { language: 'en', phone: '+229 90 00 00 12' }));
  await okay(await post(api + 'consent', 'candidate', { channel: 'email', granted: true }));
  await okay(await post(api + 'consent', 'candidate', { channel: 'sms', granted: true }));
  await okay(await post(api + 'preference', 'candidate', { event: 'adm.complement', channel: 'sms', enabled: false }));
  await status(await post(api + 'preference', 'candidate', { event: 'inconnu', channel: 'sms', enabled: false }), 400);
  await okay(await post('/api/v1/iam/profile', 'quiet', { displayName: 'Quiet', email: 'quiet@example.test' }));

  // 3. Events of an application: internal message rendered, external jobs queued.
  const rules = { versionId: version, label: 'Notification round', opensAt: new Date(Date.now() - 3_600_000).toISOString(),
    closesAt: new Date(Date.now() + 86_400_000).toISOString(), form: 'nom | Name | text | oui', documents: '', criteria: '' };
  const round = (await okay(await post(adm + 'rounds', 'manager', rules))).id;
  await okay(await post(`${adm}rounds/${round}/open`, 'manager', {}));
  const application = (await okay(await post(`${adm}rounds/${round}/apply`, 'candidate', {}))).id;
  await okay(await post(`${adm}applications/${application}/answers`, 'candidate', { nom: 'Candidate Two' }));
  const quiet = (await okay(await post(`${adm}rounds/${round}/apply`, 'quiet', {}))).id;
  await okay(await post(`${adm}applications/${quiet}/answers`, 'quiet', { nom: 'Quiet' }));
  await okay(await post(`${adm}applications/${quiet}/submit`, 'quiet', {}));
  const { rows: quietJobs } = await database.query("SELECT 1 FROM unoa.job WHERE payload->>'accountId' = $1", [ids.quiet]);
  assert.equal(quietJobs.length, 0, 'sans consentement, aucun envoi externe');
  assert.match((await database.query("SELECT title FROM unoa.notification WHERE account_id = $1", [ids.quiet])).rows[0].title, /^Accusé de réception/,
    'langue par défaut et texte du logiciel');

  relay.answers.push(503);
  await okay(await post(`${adm}applications/${application}/submit`, 'candidate', {}));
  const { rows: [inbox] } = await database.query("SELECT title, body, template_id, language FROM unoa.notification WHERE account_id = $1 AND kind = 'adm.receipt'", [ids.candidate]);
  assert.match(inbox.title, /^Receipt ADM-\d{4}-[0-9A-F]{12} for Certificate in testing$/);
  assert.deepEqual([inbox.body, inbox.template_id, inbox.language], ['Version 1 received.', internal, 'en']);
  await status(await call('/api/v1/jobs/run', { method: 'POST' }), 401, 'jeton de traitement requis');
  await status(await call('/api/v1/jobs/run', { method: 'POST', headers: { Authorization: 'Bearer ' + 'x'.repeat(40) } }), 401);
  let jobs = await settle('adm.receipt', { email: 'done', sms: 'failed' });
  const { rows: [mail] } = await database.query('SELECT recipient, subject, body FROM unoa.sandbox_message WHERE job_id = $1',
    [jobs.find(job => job.payload.channel === 'email').id]);
  assert.equal(mail.recipient, 'candidate@example.test');
  assert.match(mail.subject, /^UNOA receipt ADM-/);
  assert.match(mail.body, new RegExp(`${origin.replace(/[.:/]/g, '\\$&')}/candidature/${application}`));
  const sms = jobs.find(job => job.payload.channel === 'sms');
  await database.query('UPDATE unoa.job SET run_after = now() WHERE id = $1', [sms.id]); // test-only: skip the backoff delay
  jobs = await settle('adm.receipt', { email: 'done', sms: 'done' });
  const smsRequests = relay.requests.filter(item => item.body.channel === 'sms');
  assert.equal(smsRequests.at(-1).authorization, 'Bearer ' + relay.token);
  assert.equal(smsRequests.at(-1).key, 'deliver:' + sms.payload.notificationId + ':sms', 'clé d’idempotence transmise');
  assert.equal(smsRequests.at(-1).body.to, '+22990000012');
  assert.match(smsRequests.at(-1).body.text, /^Certificate in testing — application submitted \(version 1\)\./, 'sans modèle SMS publié : texte du logiciel, en anglais');
  const { rows: attempts } = await database.query('SELECT status, recipient_masked FROM unoa.delivery_attempt WHERE job_id = $1 ORDER BY attempted_at', [sms.id]);
  assert.deepEqual(attempts.map(item => [item.status, item.recipient_masked]), [['failed', '+229****12'], ['sent', '+229****12']]);
  await assert.rejects(database.query("INSERT INTO unoa.job(kind, payload, idempotency_key, correlation_id) VALUES ('deliver', '{}', $1, gen_random_uuid())",
    ['deliver:' + sms.payload.notificationId + ':sms']), /duplicate key/);

  // 4. A permanent refusal leads to a dead job, replayed by an operator.
  relay.answers.push(400);
  await okay(await post(`${adm}applications/${application}/interview`, 'reviewer', { kind: 'Interview', scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), place: 'Room 2' }));
  jobs = await settle('adm.interview', { email: 'done', sms: 'dead' });
  const dead = jobs.find(job => job.payload.channel === 'sms');
  await status(await post(api + 'replay', 'editor', { jobId: dead.id }), 403, 'rejeu réservé');
  await okay(await post(api + 'replay', 'publisher', { jobId: dead.id }));
  await status(await post(api + 'replay', 'publisher', { jobId: dead.id }), 409, 'rejeu unique');
  await settle('adm.interview', { email: 'done', sms: 'done' });

  // 5. A sensitive event leaves only a generic notice; preferences and withdrawals apply.
  await okay(await post(api + 'consent', 'candidate', { channel: 'email', granted: false }));
  await okay(await post(api + 'consent', 'candidate', { channel: 'email', granted: true }));
  await okay(await post(`${adm}applications/${application}/request`, 'reviewer', { message: 'Secret detail: provide transcript' }));
  jobs = await jobsOf('adm.complement');
  assert.deepEqual(jobs.map(job => job.payload.channel), ['email'], 'SMS désactivé pour cet événement');
  assert.doesNotMatch(JSON.stringify(jobs[0].payload), /Secret detail/, 'aucune fuite du contenu sensible');
  assert.equal(jobs[0].payload.subject, 'New notification');
  await okay(await post(api + 'consent', 'candidate', { channel: 'email', granted: false }));
  assert.equal((await jobsOf('adm.complement'))[0].state, 'skipped', 'retrait du consentement : envoi annulé');
  assert.match((await database.query("SELECT body FROM unoa.notification WHERE account_id = $1 AND kind = 'adm.complement'", [ids.candidate])).rows[0].body,
    /Secret detail/, 'le contenu reste dans l’espace personnel');

  // 6. Export, screens and rights.
  const exported = await get(api + 'contact/export', 'candidate');
  assert.match(exported.headers.get('content-disposition'), /attachment/);
  const file = await exported.json();
  assert.deepEqual(file.consents.map(item => [item.channel, item.granted]).slice(0, 2), [['email', false], ['email', true]]);
  assert.equal(file.preferences[0].enabled, false);
  const screen = await (await get(`/administration/notifications?scope=${univ.id}`, 'publisher')).text();
  assert.match(screen, /Journal des envois/);
  assert.match(screen, /\+229\*\*\*\*12/);
  assert.doesNotMatch(screen, /\+22990000012/, 'destinataire masqué dans le journal');
  assert.match(await (await get(`/administration/notifications?scope=${univ.id}`, 'candidate')).text(), /Périmètre inaccessible/);
  await status(await get(`${api}scopes?scopeId=${univ.id}`, 'candidate'), 403);
  assert.match(await (await get('/espace', 'candidate')).text(), /Retirer mon consentement/);
  assert.match(await (await get('/', 'publisher')).text(), /href="\/administration\/notifications"/);
  const { rows: audits } = await database.query("SELECT DISTINCT action FROM unoa.audit_event WHERE action LIKE 'not.%' OR action LIKE 'ops.%'");
  for (const action of ['not.template_drafted', 'not.template_published', 'not.contact_consent', 'ops.job_replayed', 'not.access']) {
    assert.ok(audits.some(row => row.action === action), action);
  }
}
