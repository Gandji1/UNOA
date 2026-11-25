import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';

// Finance: approved price rules (ISO 4217 minor units, profile and programme
// conditions), numbered invoices and credit notes, instalments, allowances
// approved by another person, payments credited only by a verified provider
// event processed once, receipts, overpayment and refund, chargeback,
// mobile-money failure, holds, bank reconciliation, exports, access limits,
// append-only ledger. Runs after the students and grades fixtures.
export async function exerciseFinance({ database, issuer, login, call, origin, paymentSecret }) {
  const { rows: [univ] } = await database.query("SELECT id FROM unoa.scope WHERE label = 'Université Alpha'");
  const { rows: [cohort] } = await database.query('SELECT id, version_id FROM unoa.cohort WHERE unoa.scope_within(owner_scope_id, $1) ORDER BY created_at LIMIT 1', [univ.id]);
  const names = ['officer', 'controller', 'both', 'payer', 'payer2', 'outsider'];
  const ids = Object.fromEntries(names.map(name => [name, randomUUID()]));
  await database.query(`
    INSERT INTO unoa.access_role(code) VALUES ('fin_officer_t'), ('fin_controller_t'), ('fin_both_t');
    INSERT INTO unoa.role_permission VALUES ('fin_officer_t', 'fin.read'), ('fin_officer_t', 'fin.tariff'), ('fin_officer_t', 'fin.invoice'), ('fin_officer_t', 'fin.reconcile'), ('fin_officer_t', 'fin.export'),
      ('fin_controller_t', 'fin.read'), ('fin_controller_t', 'fin.approve'), ('fin_controller_t', 'fin.export'),
      ('fin_both_t', 'fin.read'), ('fin_both_t', 'fin.invoice'), ('fin_both_t', 'fin.approve'), ('fin_both_t', 'fin.tariff');
  `);
  const roles = { officer: 'fin_officer_t', controller: 'fin_controller_t', both: 'fin_both_t' };
  for (const [name, id] of Object.entries(ids)) {
    await database.query('INSERT INTO unoa.account (id, display_name) VALUES ($1, $2)', [id, 'Finances ' + name]);
    await database.query('INSERT INTO unoa.login_identity VALUES ($1, $2, $3)', [issuer.origin, 'fin-' + name, id]);
    if (roles[name]) await database.query('INSERT INTO unoa.role_grant(account_id, scope_id, role_code, effective_from, include_descendants) VALUES ($1, $2, $3, now(), true)', [id, univ.id, roles[name]]);
  }
  const cookies = {};
  for (const name of names) {
    issuer.useIdentity('fin-' + name, 'test-mfa');
    cookies[name] = (await login()).headers.getSetCookie().find(cookie => cookie.startsWith('unoa_session=')).split(';', 1)[0];
  }
  const post = (action, who, data) => call('/api/v1/fin/' + action, {
    method: 'POST', headers: { Origin: origin, Cookie: cookies[who], 'Content-Type': 'application/json' }, body: JSON.stringify(data),
  });
  const get = (path, who) => call(path, { headers: { Cookie: cookies[who] } });
  async function okay(response) {
    assert.equal(response.status, 200, response.ok ? '' : JSON.stringify(await response.clone().json()));
    return response.json();
  }
  const status = async (response, expected, label) => {
    const result = await response;
    assert.equal(result.status, expected, label + (result.status === expected ? '' : ' — ' + (await result.text()).slice(0, 300)));
  };
  const day = offset => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const webhook = (event, secret = paymentSecret, timestamp = Math.floor(Date.now() / 1000)) => {
    const body = JSON.stringify(event);
    const signature = `t=${timestamp},v1=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
    return call('/api/v1/fin/webhooks/sandbox', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Unoa-Signature': signature }, body });
  };
  const balance = async who => (await okay(await get('/api/v1/fin/me', who))).balances.find(item => item.currency === 'XOF');

  // 1. Price rules: ISO 4217 minor units, approval by another person, immutability.
  const rule = { scopeId: univ.id, label: 'Frais de scolarité (test)', kind: 'tuition', recurrence: 'per_period', amount: '150000', currency: 'XOF', instalments: 3, intervalDays: 30, effectiveFrom: day(0) };
  await status(post('rules', 'outsider', rule), 403, 'tarif réservé');
  await status(post('rules', 'officer', { ...rule, currency: 'ABC' }), 400, 'devise inconnue');
  await status(post('rules', 'officer', { ...rule, amount: '10.5' }), 400, 'pas de décimale en XOF');
  await okay(await post('rules', 'officer', rule));
  await okay(await post('rules', 'officer', { ...rule, label: 'Frais en euros (test)', amount: '1250,50', currency: 'EUR', instalments: 1 }));
  await okay(await post('rules', 'officer', { ...rule, label: 'Tarif international (test)', profile: 'international', instalments: 1 }));
  await okay(await post('rules', 'officer', { ...rule, label: 'Tarif de la formation (test)', programVersionId: cohort.version_id, instalments: 1 }));
  await okay(await post('rules', 'both', { ...rule, label: 'Tarif auto-approuvé (test)' }));
  const ruleId = label => database.query('SELECT id, amount_minor FROM unoa.price_rule WHERE label = $1', [label]).then(result => result.rows[0]);
  const tuition = await ruleId('Frais de scolarité (test)');
  assert.equal(Number((await ruleId('Frais en euros (test)')).amount_minor), 125050, 'unités mineures');
  const invoice = data => post('invoices', 'officer', { scopeId: univ.id, priceRuleId: tuition.id, firstDueOn: day(-90), ...data });
  await status(invoice({ accountId: ids.payer }), 422, 'tarif non approuvé');
  await status(post('publish-rule', 'both', { ruleId: (await ruleId('Tarif auto-approuvé (test)')).id }), 403, 'pas d’approbation de son propre tarif');
  for (const label of ['Frais de scolarité (test)', 'Frais en euros (test)', 'Tarif international (test)', 'Tarif de la formation (test)']) {
    await okay(await post('publish-rule', 'controller', { ruleId: (await ruleId(label)).id }));
  }
  await assert.rejects(database.query('UPDATE unoa.price_rule SET amount_minor = 1 WHERE id = $1', [tuition.id]), /immutable/);

  // 2. Invoices: numbering, instalments, once per period, profile and programme conditions, cohort billing.
  const first = await okay(await invoice({ accountId: ids.payer, billingPeriod: '2026-2027' }));
  assert.match(first.number, /^FAC-\d{4}-\d{6}$/);
  await status(invoice({ accountId: ids.payer, billingPeriod: '2026-2027' }), 409, 'une fois par période');
  await status(post('invoices', 'officer', { scopeId: univ.id, priceRuleId: (await ruleId('Tarif international (test)')).id, accountId: ids.payer, firstDueOn: day(0) }), 422, 'profil exigé');
  await status(post('invoices', 'officer', { scopeId: univ.id, priceRuleId: (await ruleId('Tarif de la formation (test)')).id, accountId: ids.payer, firstDueOn: day(0) }), 422, 'payeur non inscrit');
  const { rows: plan } = await database.query('SELECT amount_minor FROM unoa.instalment WHERE invoice_id = $1 ORDER BY ordinal', [first.invoiceId]);
  assert.deepEqual(plan.map(row => Number(row.amount_minor)), [50000, 50000, 50000]);
  const cohortBill = await okay(await post('bill-cohort', 'officer', { scopeId: univ.id, priceRuleId: tuition.id, cohortId: cohort.id, billingPeriod: 'cohorte-test', firstDueOn: day(30) }));
  assert.ok(cohortBill.issued >= 1);
  assert.equal((await okay(await post('bill-cohort', 'officer', { scopeId: univ.id, priceRuleId: tuition.id, cohortId: cohort.id, billingPeriod: 'cohorte-test', firstDueOn: day(30) }))).issued, 0, 'facturation idempotente');
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'fin.invoice_issued'", [ids.payer])).rows[0]);

  // 3. Credit note and allowance approved by another person.
  const credit = await okay(await post('credit-notes', 'officer', { invoiceId: first.invoiceId, amount: '20000', reason: 'Erreur de tarif (test)' }));
  assert.match(credit.number, /^AV-\d{4}-\d{6}$/);
  await status(post('credit-notes', 'officer', { invoiceId: first.invoiceId, amount: '200000', reason: 'x' }), 422, 'avoir plafonné');
  await okay(await post('allowances', 'both', { invoiceId: first.invoiceId, kind: 'scholarship', label: 'Bourse sociale (test)', basis: 'percent', value: '10' }));
  await status(post('allowances', 'officer', { invoiceId: first.invoiceId, kind: 'employer', label: 'Prise en charge', basis: 'amount', value: '1000' }), 400, 'employeur financeur exigé');
  const { rows: [allowance] } = await database.query("SELECT id FROM unoa.allowance WHERE label = 'Bourse sociale (test)'");
  await status(post('decide-allowance', 'both', { allowanceId: allowance.id, decision: 'approved' }), 403, 'pas d’approbation de sa propre remise');
  await okay(await post('decide-allowance', 'controller', { allowanceId: allowance.id, decision: 'approved' }));
  assert.equal(Number((await balance('payer')).balance), 150000 - 20000 - 15000);

  // 4. Payment: only a verified provider event credits it, once.
  const checkout = data => call('/api/v1/fin/checkout', { method: 'POST', headers: { Origin: origin, Cookie: cookies[data.who ?? 'payer'], 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId: first.invoiceId, ...data, who: undefined }) });
  await status(checkout({ amount: '200000', idempotencyKey: randomUUID().replace(/-/g, '') }), 422, 'au-delà du reste dû');
  await status(checkout({ who: 'payer2', amount: '1000', idempotencyKey: randomUUID().replace(/-/g, '') }), 403, 'facture d’un autre payeur');
  await status(checkout({ amount: '1000', idempotencyKey: 'court' }), 400, 'clé d’idempotence');
  const key = randomUUID().replace(/-/g, '');
  const started = await okay(await checkout({ amount: '50000', idempotencyKey: key }));
  assert.equal((await okay(await checkout({ amount: '50000', idempotencyKey: key }))).ref, started.ref, 'réessai idempotent');
  assert.equal((await database.query('SELECT state FROM unoa.payment WHERE provider_ref = $1', [started.ref])).rows[0].state, 'pending_provider', 'le retour navigateur ne confirme rien');
  const event = (type, data, id = 'evt_' + randomUUID()) => ({ id, type, data });
  await status(webhook(event('payment.succeeded', { payment_ref: started.ref, amount_minor: 50000, currency: 'XOF' }), 'mauvais-secret'), 401, 'signature invalide');
  await status(webhook(event('payment.succeeded', { payment_ref: started.ref, amount_minor: 50000, currency: 'XOF' }), paymentSecret, Math.floor(Date.now() / 1000) - 3600), 401, 'rejeu ancien');
  assert.ok((await database.query("SELECT 1 FROM unoa.provider_event WHERE NOT signature_valid AND outcome = 'invalid_signature'")).rows[0], 'tentative journalisée');
  assert.equal((await okay(await webhook(event('payment.succeeded', { payment_ref: started.ref, amount_minor: 99999, currency: 'XOF' })))).outcome, 'amount_mismatch');
  const success = event('payment.succeeded', { payment_ref: started.ref, amount_minor: 50000, currency: 'XOF' });
  assert.equal((await okay(await webhook(success))).outcome, 'confirmed');
  assert.equal((await okay(await webhook(success))).outcome, 'duplicate', 'webhook dupliqué sans effet');
  assert.equal(Number((await balance('payer')).balance), 65000);
  let mine = await okay(await get('/api/v1/fin/me', 'payer'));
  const paid = mine.payments.find(item => item.state === 'confirmed');
  assert.match(paid.receipt, /^REC-\d{4}-\d{6}$/);
  const receipt = await (await get(`/api/v1/fin/receipts/${paid.receipt_id}`, 'payer')).text();
  assert.match(receipt, /REÇU DE PAIEMENT[\s\S]*Empreinte de vérification : [0-9a-f]{64}/);
  await status(get(`/api/v1/fin/receipts/${paid.receipt_id}`, 'payer2'), 403, 'reçu réservé');

  // 5. Mobile-money failure through the sandbox checkout, then an overpayment refunded.
  const failing = await okay(await checkout({ amount: '10000', idempotencyKey: randomUUID().replace(/-/g, '') }));
  await status(post('sandbox', 'payer2', { ref: failing.ref, outcome: 'succeeded' }), 403, 'paiement d’un autre payeur');
  assert.equal((await okay(await post('sandbox', 'payer', { ref: failing.ref, outcome: 'failed', reason: 'mobile_money_insufficient_funds' }))).outcome, 'failed');
  assert.ok((await database.query("SELECT 1 FROM unoa.notification WHERE account_id = $1 AND kind = 'fin.payment_failed'", [ids.payer])).rows[0]);
  const rest = await okay(await checkout({ amount: '65000', idempotencyKey: randomUUID().replace(/-/g, '') }));
  await okay(await post('credit-notes', 'officer', { invoiceId: first.invoiceId, amount: '10000', reason: 'Geste commercial (test)' }));
  assert.equal((await okay(await post('sandbox', 'payer', { ref: rest.ref, outcome: 'succeeded' }))).outcome, 'confirmed');
  assert.equal(Number((await balance('payer')).balance), -10000, 'trop-perçu');
  const { rows: [restPayment] } = await database.query('SELECT id FROM unoa.payment WHERE provider_ref = $1', [rest.ref]);
  await status(post('refunds', 'officer', { paymentId: restPayment.id, amount: '70000', reason: 'x' }), 422, 'remboursement plafonné');
  await okay(await post('refunds', 'officer', { paymentId: restPayment.id, amount: '10000', reason: 'Remboursement du trop-perçu (test)' }));
  const { rows: [refund] } = await database.query("SELECT id FROM unoa.refund WHERE reason = 'Remboursement du trop-perçu (test)'");
  await okay(await post('decide-refund', 'controller', { refundId: refund.id, decision: 'approved' }));
  assert.equal((await okay(await post('sandbox', 'controller', { refundId: refund.id, outcome: 'succeeded' }))).outcome, 'refunded');
  assert.equal(Number((await balance('payer')).balance), 0, 'solde nul après remboursement');
  await okay(await post('refunds', 'officer', { paymentId: restPayment.id, amount: '5000', reason: 'Second remboursement (test)' }));
  const { rows: [second] } = await database.query("SELECT id FROM unoa.refund WHERE reason = 'Second remboursement (test)'");
  await okay(await post('decide-refund', 'controller', { refundId: second.id, decision: 'approved' }));
  assert.equal((await okay(await post('sandbox', 'controller', { refundId: second.id, outcome: 'failed' }))).outcome, 'refund_failed');
  assert.equal(Number((await balance('payer')).balance), 0, 'échec de remboursement sans écriture');

  // 6. Chargeback.
  await status(post('sandbox', 'payer', { ref: started.ref, outcome: 'chargeback' }), 403, 'simulation réservée');
  assert.equal((await okay(await post('sandbox', 'controller', { ref: started.ref, outcome: 'chargeback' }))).outcome, 'chargeback');
  assert.equal(Number((await balance('payer')).balance), 50000, 'rétrofacturation remise en dette');

  // 7. Hold limited to internal documents, with a legal basis, approved by another person.
  await okay(await post('holds', 'officer', { scopeId: univ.id, label: 'Retard de paiement (test)', effect: 'withhold_internal_documents', minOverdueDays: 15, minAmount: '1000', currency: 'XOF', legalBasis: 'Règlement financier de l’établissement, art. 12 (test)' }));
  await status(post('holds', 'officer', { scopeId: univ.id, label: 'x', effect: 'block_courses', minOverdueDays: 1, minAmount: '1', currency: 'XOF', legalBasis: 'x' }), 400, 'effet non admis');
  const { rows: [hold] } = await database.query("SELECT id FROM unoa.hold_rule WHERE label = 'Retard de paiement (test)'");
  await okay(await post('publish-hold', 'controller', { ruleId: hold.id }));
  mine = await okay(await get('/api/v1/fin/me', 'payer'));
  assert.equal(mine.holds.length, 1, 'retenue en vigueur');

  // 8. Bank reconciliation: automatic match, duplicate import, documented manual match.
  const other = await okay(await post('invoices', 'officer', { scopeId: univ.id, priceRuleId: tuition.id, accountId: ids.payer2, firstDueOn: day(10), billingPeriod: 'payer2' }));
  const payer2 = await okay(await call('/api/v1/fin/checkout', { method: 'POST', headers: { Origin: origin, Cookie: cookies.payer2, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoiceId: other.invoiceId, amount: '30000', idempotencyKey: randomUUID().replace(/-/g, '') }) }));
  await okay(await post('sandbox', 'payer2', { ref: payer2.ref, outcome: 'succeeded' }));
  const lines = `${day(0)};65000;XOF;${rest.ref}\n${day(0)};29900;XOF;VIREMENT-INCONNU`;
  const imported = await okay(await post('bank-import', 'officer', { scopeId: univ.id, statementLabel: 'Relevé test', lines }));
  assert.deepEqual([imported.imported, imported.matched], [2, 1]);
  assert.equal((await okay(await post('bank-import', 'officer', { scopeId: univ.id, statementLabel: 'Relevé test', lines }))).duplicates, 2, 'import idempotent');
  const { rows: [unknown] } = await database.query("SELECT id FROM unoa.bank_line WHERE reference = 'VIREMENT-INCONNU'");
  const { rows: [payment2] } = await database.query('SELECT id FROM unoa.payment WHERE provider_ref = $1', [payer2.ref]);
  await status(post('bank-match', 'officer', { lineId: unknown.id, paymentId: payment2.id }), 422, 'écart non justifié');
  await okay(await post('bank-match', 'officer', { lineId: unknown.id, paymentId: payment2.id, note: 'Frais bancaires de 100 XOF retenus (test)' }));
  await status(post('bank-match', 'officer', { lineId: unknown.id, paymentId: payment2.id, note: 'x' }), 409);

  // 9. Exports, access limits, append-only records.
  const journal = await (await get(`/api/v1/fin/export?scopeId=${univ.id}&kind=journal`, 'controller')).text();
  assert.match(journal, /Date;Nature;Libellé;Payeur;Facture;Reçu;Devise;Débit;Crédit/);
  assert.match(journal, new RegExp(first.number));
  assert.match(await (await get(`/api/v1/fin/export?scopeId=${univ.id}&kind=balances`, 'officer')).text(), /Finances payer;;XOF;50000/);
  await status(get(`/api/v1/fin/export?scopeId=${univ.id}&kind=journal`, 'payer'), 403, 'export réservé');
  await status(get(`/api/v1/fin/scopes?scopeId=${univ.id}`, 'payer'), 403, 'données financières réservées');
  assert.equal((await okay(await get('/api/v1/fin/me', 'payer2'))).invoices.every(item => item.id !== first.invoiceId), true, 'isolation des payeurs');
  await assert.rejects(database.query("UPDATE unoa.ledger_entry SET amount_minor = 1 WHERE account_id = $1", [ids.payer]), /append-only/);
  await assert.rejects(database.query("UPDATE unoa.invoice SET total_minor = 1 WHERE id = $1", [first.invoiceId]), /append-only/);
  const overview = await okay(await get(`/api/v1/fin/scopes?scopeId=${univ.id}`, 'controller'));
  assert.ok(overview.events.some(item => item.outcome === 'duplicate' || item.outcome === 'confirmed'));
  assert.match(await (await get('/finances', 'payer')).text(), /Mes finances/);
  assert.match(await (await get(`/administration/finances?scope=${univ.id}`, 'officer')).text(), /Rapprochement bancaire/);
  assert.match(await (await get(`/paiement/sandbox?ref=${failing.ref}`, 'payer')).text(), /aucun argent réel/);
}
