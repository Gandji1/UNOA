import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

// Councils: dated mandates, convocation and versioned agenda, quorum, conflicts
// of interest, votes and majority, decisions, minutes signed by the chair (not
// the drafter), publication on the public site, appeal ruled by another person.
export async function exerciseGovernance({ database, issuer, login, call, origin }) {
  const names = ['admin', 'chair', 'second', 'third', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('gov_test');
    INSERT INTO unoa.role_permission VALUES ('gov_test', 'gov.read'), ('gov_test', 'gov.manage'), ('gov_test', 'gov.secretary'), ('gov_test', 'gov.publish'), ('gov_test', 'iam.read');
  `);
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Conseil ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'gov-' + name, id]);
    if (name !== 'outsider') await database.query("INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)",
      [id, univ.id, name === 'admin' ? 'gov_test' : 'teacher']);
  }
  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('gov-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/gov/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: who ? { Cookie: cookies[who] } : {} });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = (response, expected, label) => assert.equal(response.status, expected, label);
  const today = new Date().toISOString().slice(0, 10);

  // 1. Council configured by its scope; members with dated mandates.
  await status(await post('councils', 'chair', { scopeId: univ.id, name: 'X', kind: 'X' }), 403, 'création réservée');
  const council = (await okay(await post('councils', 'admin', { scopeId: univ.id, name: 'Conseil de recette', kind: 'Conseil scientifique', quorumPercent: 60, majority: 'simple' }))).id;
  const member = (who, office = 'member') => post('members', 'admin', { councilId: council, accountId: ids[who], office, startsOn: '2026-01-01', voting: true });
  await okay(await member('chair', 'chair'));
  await okay(await member('second'));
  await okay(await member('third'));
  await status(await member('second'), 409, 'mandat en double');
  let detail = await okay(await get(`/api/v1/gov/councils/${council}`, 'admin'));
  const memberOf = who => detail.members.find(item => item.account_id === ids[who]).id;

  // 2. Meeting, agenda versioned once convened, notifications.
  const meeting = (await okay(await post('meetings', 'admin', { councilId: council, title: 'Séance de recette', scheduledAt: new Date(Date.now() + 3_600_000).toISOString(), place: 'Salle du conseil' }))).meetingId;
  await status(await post('convene', 'admin', { meetingId: meeting }), 422, 'ordre du jour vide');
  await okay(await post('items', 'admin', { meetingId: meeting, title: 'Approbation du budget', kind: 'vote' }));
  await okay(await post('items', 'admin', { meetingId: meeting, title: 'Rapport d’activité', kind: 'information' }));
  await okay(await post('convene', 'admin', { meetingId: meeting }));
  assert.equal((await database.query("SELECT count(*)::int AS total FROM unoa.notification WHERE kind = 'gov.convened' AND account_id = ANY($1)", [[ids.chair, ids.second, ids.third]])).rows[0].total, 3);
  await okay(await post('items', 'admin', { meetingId: meeting, title: 'Point ajouté', kind: 'vote' }));
  let view = await okay(await get(`/api/v1/gov/meetings/${meeting}`, 'chair'));
  assert.equal(view.meeting.agenda_version, 2);
  const added = view.items.find(item => item.title === 'Point ajouté');
  assert.equal(added.added_in_version, 2);
  await okay(await post('withdraw-item', 'admin', { meetingId: meeting, itemId: added.id }));
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE kind = 'gov.agenda_changed' AND account_id = $1", [ids.second])).rows[0]);
  await status(await get(`/api/v1/gov/meetings/${meeting}`, 'outsider'), 403, 'séance réservée');

  // 3. Quorum: 60 % of 3 voting members means 2 present.
  const present = (who, value = true) => post('attendance', 'admin', { meetingId: meeting, memberId: memberOf(who), present: value });
  await okay(await present('chair'));
  await status(await post('open', 'admin', { meetingId: meeting }), 422, 'quorum non atteint');
  await okay(await present('second'));
  await okay(await present('third', false));
  await okay(await post('open', 'admin', { meetingId: meeting }));
  await status(await post('items', 'admin', { meetingId: meeting, title: 'Tardif', kind: 'vote' }), 409, 'ordre du jour figé');

  // 4. Conflict of interest, votes, majority, decision.
  view = await okay(await get(`/api/v1/gov/meetings/${meeting}`, 'chair'));
  const budget = view.items.find(item => item.title === 'Approbation du budget').id;
  const report = view.items.find(item => item.title === 'Rapport d’activité').id;
  await status(await post('vote', 'chair', { meetingId: meeting, itemId: budget, choice: 'for' }), 422, 'vote non ouvert');
  await okay(await post('open-vote', 'admin', { meetingId: meeting, itemId: budget }));
  await okay(await post('conflict', 'second', { meetingId: meeting, itemId: budget, reason: 'Bénéficiaire du budget' }));
  await status(await post('vote', 'second', { meetingId: meeting, itemId: budget, choice: 'for' }), 422, 'conflit d’intérêts');
  await status(await post('vote', 'third', { meetingId: meeting, itemId: budget, choice: 'against' }), 422, 'membre absent');
  await status(await post('vote', 'outsider', { meetingId: meeting, itemId: budget, choice: 'for' }), 403, 'non-membre');
  await okay(await post('vote', 'chair', { meetingId: meeting, itemId: budget, choice: 'for' }));
  await status(await post('vote', 'chair', { meetingId: meeting, itemId: budget, choice: 'against' }), 409, 'vote unique');
  await assert.rejects(database.query("UPDATE unoa.council_vote SET choice = 'against' WHERE item_id = $1", [budget]), /append-only/);
  await okay(await post('close-item', 'admin', { meetingId: meeting, itemId: budget, text: 'Le budget est approuvé.', effectiveOn: today }));
  await okay(await post('close-item', 'admin', { meetingId: meeting, itemId: report }));
  view = await okay(await get(`/api/v1/gov/meetings/${meeting}`, 'chair'));
  const decision = view.decisions.find(item => item.item_id === budget);
  assert.deepEqual([decision.outcome, decision.votes_for, decision.votes_against, decision.present], ['adopted', 1, 0, 2]);
  assert.equal(view.decisions.find(item => item.item_id === report).outcome, 'noted');
  await okay(await post('close-meeting', 'admin', { meetingId: meeting }));

  // 5. Minutes: drafted by the secretary, signed by the chair only, then frozen.
  await okay(await post('minutes', 'admin', { meetingId: meeting, body: 'Procès-verbal de la séance de recette.' }));
  await status(await post('sign', 'admin', { meetingId: meeting }), 403, 'signature par le président');
  await status(await post('publish', 'admin', { meetingId: meeting, decisionId: decision.id, summary: 'Budget approuvé.' }), 422, 'publication avant signature');
  await okay(await post('sign', 'chair', { meetingId: meeting }));
  await status(await post('sign', 'chair', { meetingId: meeting }), 409);
  await status(await post('minutes', 'admin', { meetingId: meeting, body: 'Réécrit' }), 422, 'procès-verbal figé');
  view = await okay(await get(`/api/v1/gov/meetings/${meeting}`, 'second'));
  assert.match(view.minutes.sha256, /^[0-9a-f]{64}$/);

  // 6. Partial publication on the public site, appeal ruled by another person.
  await okay(await post('publish', 'admin', { meetingId: meeting, decisionId: decision.id, summary: 'Le budget de recette est approuvé.' }));
  assert.match(await (await get('/decisions')).text(), /Le budget de recette est approuvé/);
  assert.doesNotMatch(await (await get('/decisions')).text(), /Rapport d’activité/, 'seules les décisions publiées');
  await okay(await post('appeal', 'third', { meetingId: meeting, decisionId: decision.id, reason: 'Quorum contesté' }));
  view = await okay(await get(`/api/v1/gov/meetings/${meeting}`, 'admin'));
  await okay(await post('rule-appeal', 'admin', { meetingId: meeting, appealId: view.appeals[0].id, ruling: 'upheld', note: 'Quorum vérifié : 2 présents sur 2 requis.' }));
  await okay(await post('archive', 'admin', { meetingId: meeting }));

  // 7. Screens.
  assert.match(await (await get('/conseils', 'second')).text(), /Conseil de recette/);
  assert.match(await (await get(`/administration/gouvernance?seance=${meeting}`, 'admin')).text(), /Signé/);
  assert.match(await (await get('/', 'admin')).text(), /href="\/administration\/gouvernance"/);
}
