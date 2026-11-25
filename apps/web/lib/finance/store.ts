import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { allowanceAmount, FinanceError, formatMinor, instalments, minorUnits, signEvent, toMinor, verifyEvent } from '@unoa/domain/finance';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, integer, optional, Problem, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';
import { dispatch } from '@/lib/notifications/store';

// Finance (module FIN). Every balance is the sum of append-only ledger entries;
// a payment is credited only when a signed provider event confirms it, once.
// Staff act through scope permissions on the establishment; a payer sees only
// their own invoices, payments and receipts.

type Right = 'read' | 'tariff' | 'approve' | 'invoice' | 'reconcile' | 'export';
export const kindLabels: Record<string, string> = { application_fee: 'Frais de dossier', tuition: 'Frais de scolarité', recurring: 'Frais récurrents', service: 'Service' };
export const recurrenceLabels: Record<string, string> = { once: 'Une fois', per_period: 'Par période', monthly: 'Mensuel' };
export const allowanceLabels: Record<string, string> = { discount: 'Remise', scholarship: 'Bourse', employer: 'Financement employeur' };
export const paymentStates: Record<string, string> = { pending_provider: 'En attente du prestataire', confirmed: 'Confirmé', failed: 'Échoué', cancelled: 'Annulé', refunded: 'Remboursé', chargeback: 'Contesté (rétrofacturation)' };
export const holdEffects: Record<string, string> = { reminder: 'Relance seulement', withhold_internal_documents: 'Suspension de la délivrance des attestations internes' };

const wrap = <T>(work: () => T) => {
  try { return work(); } catch (error) { if (error instanceof FinanceError) throw new Problem(400, error.message); throw error; }
};
export const money = (amount: number | string, currency: string) => formatMinor(Number(amount), currency);
// Amount in major units for a form field (e.g. 12500 XOF → "12500", 1250 EUR → "12.50").
export const major = (amount: number | string, currency: string) => (Number(amount) / 10 ** minorUnits(currency)).toFixed(minorUnits(currency));
const sha = (value: string) => createHash('sha256').update(value).digest('hex');

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`SELECT unoa.has_scope_permission($1, 'fin.read', $2) AS read, unoa.has_scope_permission($1, 'fin.tariff', $2) AS tariff,
    unoa.has_scope_permission($1, 'fin.approve', $2) AS approve, unoa.has_scope_permission($1, 'fin.invoice', $2) AS invoice,
    unoa.has_scope_permission($1, 'fin.reconcile', $2) AS reconcile, unoa.has_scope_permission($1, 'fin.export', $2) AS export`, [actor, scopeId]);
  return rows[0];
}
async function require(store: Queryable, actor: string, scopeId: string, right: Right) {
  const granted = await rights(store, actor, scopeId);
  ensure(granted?.[right], 403, 'Action financière réservée aux personnes habilitées');
  return granted;
}
// Invoices, payments and the ledger belong to an establishment (legal entity).
async function institutionOf(store: Queryable, scopeId: string) {
  const { rows } = await store.query<{ id: string }>(`WITH RECURSIVE up AS (
      SELECT scope.id, scope.parent_id, 0 AS depth FROM unoa.scope WHERE id = $1
      UNION ALL SELECT scope.id, scope.parent_id, up.depth + 1 FROM unoa.scope JOIN up ON scope.id = up.parent_id)
    SELECT up.id FROM up JOIN unoa.scope ON scope.id = up.id JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE kind.nature = 'institution' ORDER BY depth LIMIT 1`, [scopeId]);
  ensure(rows[0], 422, 'Les opérations financières relèvent d’un établissement');
  return rows[0].id;
}
async function nextNumber(store: Queryable, institution: string, series: 'FAC' | 'AV' | 'REC') {
  const year = new Date().getUTCFullYear();
  const { rows } = await store.query<{ value: string }>(`INSERT INTO unoa.fin_counter(institution_id, series, year, next_value) VALUES ($1, $2, $3, 2)
    ON CONFLICT (institution_id, series, year) DO UPDATE SET next_value = fin_counter.next_value + 1 RETURNING next_value - 1 AS value`, [institution, series, year]);
  return `${series}-${year}-${String(rows[0].value).padStart(6, '0')}`;
}
const ledger = (store: Queryable, entry: { institution: string; account: string; currency: string; amount: number; kind: string; invoice?: string | null;
  payment?: string | null; allowance?: string | null; refund?: string | null; label: string }) =>
  store.query(`INSERT INTO unoa.ledger_entry(institution_id, account_id, currency, amount_minor, kind, invoice_id, payment_id, allowance_id, refund_id, label)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`, [entry.institution, entry.account, entry.currency, entry.amount, entry.kind, entry.invoice ?? null,
    entry.payment ?? null, entry.allowance ?? null, entry.refund ?? null, entry.label.slice(0, 200)]);
async function remaining(store: Queryable, invoiceId: string) {
  const { rows } = await store.query<{ total: string | null }>('SELECT sum(amount_minor) AS total FROM unoa.ledger_entry WHERE invoice_id = $1', [invoiceId]);
  return Number(rows[0].total ?? 0);
}

interface InvoiceRow { id: string; institution_id: string; number: string; kind: string; account_id: string; currency: string; total_minor: string; credit_of: string | null }
async function invoiceOf(store: Queryable, id: unknown, lock = false) {
  const invoiceId = uuid(id);
  // Invoices are append-only: operations on one invoice are serialised by an advisory lock.
  if (lock) await store.query("SELECT pg_advisory_xact_lock(hashtextextended('unoa.fin.invoice.' || $1, 0))", [invoiceId]);
  const { rows } = await store.query<InvoiceRow>("SELECT id, institution_id, number, kind, account_id, currency, total_minor, credit_of FROM unoa.invoice WHERE id = $1 AND kind = 'invoice'", [invoiceId]);
  ensure(rows[0], 404, 'Facture introuvable');
  return rows[0];
}

// ----------------------------------------------------------------- tariffs

async function tariffAction(store: Queryable, actor: string, action: string, input: Input) {
  if (action === 'rules') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'tariff');
    const currency = String(input.currency ?? '').toUpperCase();
    wrap(() => minorUnits(currency));
    const versionId = optional(input.programVersionId, uuid);
    if (versionId) {
      const { rows } = await store.query(`SELECT 1 FROM unoa.program_version AS version JOIN unoa.program ON program.id = version.program_id
        WHERE version.id = $1 AND (unoa.scope_within(program.owner_scope_id, $2) OR unoa.scope_within($2, program.owner_scope_id))`, [versionId, scopeId]);
      ensure(rows[0], 422, 'La formation relève de cette portée');
    }
    const year = optional(input.academicYear, value => { ensure(typeof value === 'string' && /^[0-9]{4}-[0-9]{4}$/.test(value), 400, 'Année universitaire AAAA-AAAA'); return value; });
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.price_rule(scope_id, program_version_id, academic_year, profile, kind, recurrence, label, amount_minor, currency,
      instalments, interval_days, effective_from, effective_until, author_id) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`, [scopeId, versionId, year,
      optional(input.profile, text(60, 'Profil')), choice(input.kind, ['application_fee', 'tuition', 'recurring', 'service'] as const, 'Nature'),
      choice(input.recurrence ?? 'once', ['once', 'per_period', 'monthly'] as const, 'Périodicité'), boundedText(input.label, 160, 'Libellé'),
      wrap(() => toMinor(String(input.amount ?? ''), currency)), currency, input.instalments ? integer(input.instalments, 'Échéances', 1, 24) : 1,
      input.intervalDays ? integer(input.intervalDays, 'Intervalle', 1, 366) : 30, day(input.effectiveFrom, 'Date d’effet'),
      optional(input.effectiveUntil, value => day(value, 'Fin de validité')), actor]).catch(error => {
      if (error?.code === '23514') throw new Problem(422, 'Période de validité incohérente');
      throw error;
    });
    return { scopeId, subject: rows[0].id };
  }
  if (action === 'holds') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'tariff');
    const currency = String(input.currency ?? '').toUpperCase();
    wrap(() => minorUnits(currency));
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.hold_rule(scope_id, label, min_overdue_days, min_amount_minor, currency, effect, legal_basis, author_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`, [scopeId, boundedText(input.label, 160, 'Libellé'), integer(input.minOverdueDays, 'Retard minimal', 0, 3650),
      wrap(() => toMinor(String(input.minAmount ?? '0'), currency)), currency, choice(input.effect, ['reminder', 'withhold_internal_documents'] as const, 'Effet'),
      boundedText(input.legalBasis, 1000, 'Fondement légal ou réglementaire'), actor]);
    return { scopeId, subject: rows[0].id };
  }
  const table = action.endsWith('-hold') ? 'hold_rule' : 'price_rule';
  const { rows: [rule] } = await store.query<{ id: string; scope_id: string; state: string; author_id: string }>(`SELECT id, scope_id, state, author_id FROM unoa.${table} WHERE id = $1 FOR UPDATE`, [uuid(input.ruleId)]);
  ensure(rule, 404, 'Règle introuvable');
  if (action === 'publish-rule' || action === 'publish-hold') {
    await require(store, actor, rule.scope_id, 'approve');
    ensure(rule.state === 'draft', 409, 'Déjà publiée');
    ensure(rule.author_id !== actor, 403, 'L’approbation revient à une autre personne que l’auteur');
    await store.query(`UPDATE unoa.${table} SET state = 'published', publisher_id = $2, published_at = now() WHERE id = $1`, [rule.id, actor]);
  } else if (action === 'retire-rule' || action === 'retire-hold') {
    await require(store, actor, rule.scope_id, 'approve');
    ensure(rule.state === 'published', 409, 'Seule une règle publiée se retire');
    await store.query(`UPDATE unoa.${table} SET state = 'retired' WHERE id = $1`, [rule.id]);
  } else throw new Problem(404, 'Opération inconnue');
  return { scopeId: rule.scope_id, subject: rule.id };
}

// ---------------------------------------------------------------- invoices

interface RuleRow { id: string; scope_id: string; program_version_id: string | null; academic_year: string | null; profile: string | null; label: string; amount_minor: string;
  currency: string; instalments: number; interval_days: number }
async function publishedRule(store: Queryable, id: unknown) {
  const { rows } = await store.query<RuleRow>(`SELECT * FROM unoa.price_rule WHERE id = $1 AND state = 'published' AND effective_from <= current_date
    AND (effective_until IS NULL OR effective_until > current_date)`, [uuid(id)]);
  ensure(rows[0], 422, 'Tarif non approuvé ou hors de sa période de validité');
  return rows[0];
}

async function issueInvoice(store: Queryable, actor: string, institution: string, rule: RuleRow, payer: string, input: { quantity: number; period: string | null; profile: string | null; firstDue: string }, correlation: string) {
  ensure(!rule.profile || rule.profile === input.profile, 422, `Tarif réservé au profil « ${rule.profile} »`);
  if (rule.program_version_id) {
    const { rows } = await store.query(`SELECT 1 FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id JOIN unoa.cohort ON cohort.id = registration.cohort_id
      WHERE student.account_id = $1 AND cohort.version_id = $2 AND registration.state <> 'cancelled' AND ($3::text IS NULL OR registration.academic_year = $3)`,
      [payer, rule.program_version_id, rule.academic_year]);
    ensure(rows[0], 422, 'Le payeur n’est pas inscrit à la formation de ce tarif');
  }
  const total = Number(rule.amount_minor) * input.quantity;
  const plan = wrap(() => instalments(total, rule.instalments, input.firstDue, rule.interval_days));
  const id = randomUUID();
  const number = await nextNumber(store, institution, 'FAC');
  const inserted = await store.query(`INSERT INTO unoa.invoice(id, institution_id, number, kind, account_id, price_rule_id, billing_period, profile, currency, total_minor, issued_by)
    VALUES ($1, $2, $3, 'invoice', $4, $5, $6, $7, $8, $9, $10) ON CONFLICT (price_rule_id, account_id, billing_period) WHERE kind = 'invoice' AND billing_period IS NOT NULL DO NOTHING RETURNING id`,
    [id, institution, number, payer, rule.id, input.period, input.profile, rule.currency, total, actor]);
  if (!inserted.rows[0]) return null;
  await store.query('INSERT INTO unoa.invoice_line(invoice_id, ordinal, label, quantity, unit_minor, amount_minor) VALUES ($1, 1, $2, $3, $4, $5)',
    [id, rule.label + (input.period ? ` — ${input.period}` : ''), input.quantity, Number(rule.amount_minor), total]);
  for (const item of plan) await store.query('INSERT INTO unoa.instalment(invoice_id, ordinal, due_on, amount_minor) VALUES ($1, $2, $3, $4)', [id, item.ordinal, item.dueOn, item.amount]);
  await ledger(store, { institution, account: payer, currency: rule.currency, amount: total, kind: 'invoice', invoice: id, label: 'Facture ' + number });
  await audit(store, actor, institution, 'fin.invoice_issued', correlation, id);
  await dispatch(store, { event: 'fin.invoice_issued', scopeId: institution, recipients: [payer], correlation, values: { number, amount: money(total, rule.currency) }, link: '/finances' });
  return { id, number };
}

async function invoiceAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'invoices' || action === 'bill-cohort') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'invoice');
    const institution = await institutionOf(store, scopeId);
    const rule = await publishedRule(store, input.priceRuleId);
    const { rows: [applies] } = await store.query<{ ok: boolean }>('SELECT unoa.scope_within($1, $2) OR unoa.scope_within($2, $1) AS ok', [institution, rule.scope_id]);
    ensure(applies.ok, 422, 'Ce tarif ne s’applique pas à cet établissement');
    const period = optional(input.billingPeriod, text(40, 'Période facturée'));
    const firstDue = day(input.firstDueOn, 'Première échéance');
    const profile = optional(input.profile, text(60, 'Profil'));
    if (action === 'invoices') {
      const payer = uuid(input.accountId);
      ensure((await store.query('SELECT 1 FROM unoa.account WHERE id = $1 AND disabled_at IS NULL', [payer])).rows[0], 404, 'Payeur introuvable');
      const issued = await issueInvoice(store, actor, institution, rule, payer, { quantity: input.quantity ? integer(input.quantity, 'Quantité', 1, 1000) : 1, period, profile, firstDue }, correlation);
      ensure(issued, 409, 'Ce tarif est déjà facturé à ce payeur pour cette période');
      return { scopeId, subject: issued.id, invoiceId: issued.id, number: issued.number };
    }
    ensure(period, 400, 'Période facturée requise pour une facturation de cohorte');
    const cohortId = uuid(input.cohortId);
    const { rows: payers } = await store.query<{ account_id: string }>(`SELECT DISTINCT student.account_id FROM unoa.registration JOIN unoa.student ON student.id = registration.student_id
      JOIN unoa.cohort ON cohort.id = registration.cohort_id WHERE registration.cohort_id = $1 AND registration.state = 'validated' AND unoa.scope_within(cohort.owner_scope_id, $2)`, [cohortId, institution]);
    let count = 0;
    for (const payer of payers) if (await issueInvoice(store, actor, institution, rule, payer.account_id, { quantity: 1, period, profile, firstDue }, correlation)) count++;
    return { scopeId, subject: cohortId, issued: count, skipped: payers.length - count };
  }
  const invoice = await invoiceOf(store, input.invoiceId, true);
  if (action === 'credit-notes') {
    await require(store, actor, invoice.institution_id, 'invoice');
    const amount = wrap(() => toMinor(String(input.amount ?? ''), invoice.currency));
    const { rows: [credited] } = await store.query<{ total: string | null }>("SELECT sum(total_minor) AS total FROM unoa.invoice WHERE credit_of = $1", [invoice.id]);
    ensure(amount <= Number(invoice.total_minor) - Number(credited.total ?? 0), 422, 'L’avoir dépasse le montant restant de la facture');
    const id = randomUUID();
    const number = await nextNumber(store, invoice.institution_id, 'AV');
    await store.query(`INSERT INTO unoa.invoice(id, institution_id, number, kind, credit_of, account_id, currency, total_minor, reason, issued_by)
      VALUES ($1, $2, $3, 'credit_note', $4, $5, $6, $7, $8, $9)`, [id, invoice.institution_id, number, invoice.id, invoice.account_id, invoice.currency, amount,
      boundedText(input.reason, 1000, 'Motif de l’avoir'), actor]);
    await store.query('INSERT INTO unoa.invoice_line(invoice_id, ordinal, label, quantity, unit_minor, amount_minor) VALUES ($1, 1, $2, 1, $3, $3)', [id, 'Avoir sur ' + invoice.number, amount]);
    await ledger(store, { institution: invoice.institution_id, account: invoice.account_id, currency: invoice.currency, amount: -amount, kind: 'credit_note', invoice: invoice.id, label: `Avoir ${number} sur ${invoice.number}` });
    await audit(store, actor, invoice.institution_id, 'fin.credit_note_issued', correlation, id);
    return { scopeId: invoice.institution_id, subject: id, number };
  }
  if (action === 'allowances') {
    await require(store, actor, invoice.institution_id, 'invoice');
    const kind = choice(input.kind, ['discount', 'scholarship', 'employer'] as const, 'Nature');
    const basis = choice(input.basis, ['amount', 'percent'] as const, 'Base');
    const value = basis === 'percent' ? Number(String(input.value ?? '').replace(',', '.')) : wrap(() => toMinor(String(input.value ?? ''), invoice.currency));
    const amount = wrap(() => allowanceAmount(Number(invoice.total_minor), basis, value));
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.allowance(invoice_id, kind, label, funder, basis, value, amount_minor, proposed_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
      [invoice.id, kind, boundedText(input.label, 160, 'Libellé'), kind === 'employer' ? boundedText(input.funder, 200, 'Employeur financeur') : optional(input.funder, text(200, 'Financeur')),
        basis, value, amount, actor]);
    await audit(store, actor, invoice.institution_id, 'fin.allowance_proposed', correlation, rows[0].id);
    return { scopeId: invoice.institution_id, subject: rows[0].id };
  }
  throw new Problem(404, 'Opération inconnue');
}

async function decideAllowance(store: Queryable, actor: string, input: Input, correlation: string) {
  const { rows: [allowance] } = await store.query<{ id: string; state: string; proposed_by: string; amount_minor: string; invoice_id: string; label: string; kind: string }>(
    'SELECT id, state, proposed_by, amount_minor, invoice_id, label, kind FROM unoa.allowance WHERE id = $1 FOR UPDATE', [uuid(input.allowanceId)]);
  ensure(allowance, 404, 'Remise introuvable');
  const invoice = await invoiceOf(store, allowance.invoice_id, true);
  await require(store, actor, invoice.institution_id, 'approve');
  ensure(allowance.state === 'proposed', 409, 'Déjà décidée');
  ensure(allowance.proposed_by !== actor, 403, 'L’approbation revient à une autre personne que l’auteur');
  const decision = choice(input.decision, ['approved', 'rejected'] as const, 'Décision');
  if (decision === 'approved') {
    const left = await remaining(store, invoice.id);
    ensure(Number(allowance.amount_minor) <= left, 422, 'La remise dépasse le reste dû de la facture');
    await ledger(store, { institution: invoice.institution_id, account: invoice.account_id, currency: invoice.currency, amount: -Number(allowance.amount_minor), kind: 'allowance',
      invoice: invoice.id, allowance: allowance.id, label: `${allowanceLabels[allowance.kind]} : ${allowance.label}` });
  }
  await store.query('UPDATE unoa.allowance SET state = $2, decided_by = $3, decided_at = now(), decision_note = $4 WHERE id = $1',
    [allowance.id, decision, actor, optional(input.note, text(1000, 'Observation'))]);
  await audit(store, actor, invoice.institution_id, 'fin.allowance_' + decision, correlation, allowance.id);
  return { scopeId: invoice.institution_id, subject: allowance.id };
}

// ---------------------------------------------------------------- payments

// Configured payment adapter: the sandbox (a real signed-event flow with a
// fictitious provider) or nothing; production providers are not configured.
export function paymentProvider() {
  const adapter = process.env.UNOA_PAYMENT_ADAPTER ?? '';
  const secret = process.env.UNOA_PAYMENT_SANDBOX_SECRET ?? '';
  return adapter === 'sandbox' && secret.length >= 32 ? { name: 'sandbox', secret } : null;
}
const providerSecret = (provider: string) => provider === 'sandbox' ? paymentProvider()?.secret ?? null : null;

export async function startPayment(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const provider = paymentProvider();
  ensure(provider, 503, 'Paiement en ligne non configuré pour cet établissement');
  const key = String(input.idempotencyKey ?? '');
  ensure(/^[A-Za-z0-9_-]{16,120}$/.test(key), 400, 'Clé d’idempotence requise');
  return transaction(settings, 'unoa.fin.pay.' + key, async store => {
    const { rows: [existing] } = await store.query<{ id: string; provider_ref: string; account_id: string }>('SELECT id, provider_ref, account_id FROM unoa.payment WHERE idempotency_key = $1', [key]);
    if (existing) {
      ensure(existing.account_id === actor, 403, 'Paiement d’un autre payeur');
      return { paymentId: existing.id, ref: existing.provider_ref, replay: true };
    }
    const invoice = await invoiceOf(store, input.invoiceId, true);
    ensure(invoice.account_id === actor, 403, 'Paiement réservé au payeur de la facture');
    const amount = wrap(() => toMinor(String(input.amount ?? ''), invoice.currency));
    const { rows: [pending] } = await store.query<{ total: string | null }>("SELECT sum(amount_minor) AS total FROM unoa.payment WHERE invoice_id = $1 AND state = 'pending_provider'", [invoice.id]);
    ensure(amount <= await remaining(store, invoice.id) - Number(pending.total ?? 0), 422, 'Le montant dépasse le reste dû (paiements en attente compris)');
    const ref = 'sbx_' + randomUUID().replace(/-/g, '');
    const { rows } = await store.query<{ id: string }>(`INSERT INTO unoa.payment(institution_id, invoice_id, account_id, amount_minor, currency, provider, provider_ref, idempotency_key, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $3) RETURNING id`, [invoice.institution_id, invoice.id, actor, amount, invoice.currency, provider.name, ref, key]);
    await audit(store, actor, invoice.institution_id, 'fin.payment_started', correlation, rows[0].id);
    return { paymentId: rows[0].id, ref };
  });
}

// Fictitious provider checkout: the payer's choice becomes a signed event sent
// through the same verification as any provider notification.
export async function sandboxOutcome(settings: IamSettings, actor: string, input: Input) {
  const provider = paymentProvider();
  ensure(provider, 503, 'Bac à sable de paiement non configuré');
  const store = database(settings);
  let event: Record<string, unknown>;
  if (input.ref) {
    const { rows: [payment] } = await store.query<{ account_id: string; amount_minor: string; currency: string; provider_ref: string; state: string }>(
      "SELECT account_id, amount_minor, currency, provider_ref, state FROM unoa.payment WHERE provider = 'sandbox' AND provider_ref = $1", [String(input.ref)]);
    ensure(payment, 404, 'Paiement introuvable');
    const outcome = choice(input.outcome, ['succeeded', 'failed', 'chargeback'] as const, 'Issue');
    if (outcome === 'chargeback') {
      const { rows: [staff] } = await store.query<{ ok: boolean }>("SELECT unoa.has_scope_permission($1, 'fin.approve', institution_id) AS ok FROM unoa.payment WHERE provider_ref = $2", [actor, payment.provider_ref]);
      ensure(staff?.ok, 403, 'Simulation réservée');
    } else ensure(payment.account_id === actor, 403, 'Paiement d’un autre payeur');
    event = { id: 'evt_' + randomUUID(), type: outcome === 'chargeback' ? 'chargeback' : 'payment.' + outcome,
      data: { payment_ref: payment.provider_ref, amount_minor: Number(payment.amount_minor), currency: payment.currency, reason: outcome === 'failed' ? String(input.reason ?? 'declined').slice(0, 80) : undefined } };
  } else {
    const { rows: [refund] } = await store.query<{ provider_ref: string; institution_id: string }>(`SELECT refund.provider_ref, payment.institution_id FROM unoa.refund JOIN unoa.payment ON payment.id = refund.payment_id
      WHERE refund.id = $1 AND refund.state = 'sent'`, [uuid(input.refundId)]);
    ensure(refund, 404, 'Remboursement non transmis');
    await require(store, actor, refund.institution_id, 'approve');
    const outcome = choice(input.outcome, ['succeeded', 'failed'] as const, 'Issue');
    event = { id: 'evt_' + randomUUID(), type: 'refund.' + outcome, data: { refund_ref: refund.provider_ref, reason: outcome === 'failed' ? 'account_closed' : undefined } };
  }
  const body = JSON.stringify(event);
  return processProviderEvent(settings, 'sandbox', body, signEvent(provider.secret, body));
}

// Provider notification (FIN-007/008): verified signature, processed once, never trusted for amounts it does not match.
export async function processProviderEvent(settings: IamSettings, provider: string, body: string, signature: string | null) {
  const secret = providerSecret(provider);
  ensure(secret, 503, 'Prestataire non configuré');
  let event: { id?: unknown; type?: unknown; data?: Record<string, unknown> } | null = null;
  try { event = JSON.parse(body); } catch { event = null; }
  const valid = verifyEvent(secret, body, signature);
  const eventId = typeof event?.id === 'string' && event.id.length <= 120 ? event.id : null;
  if (!valid || !eventId || !event?.data) {
    await database(settings).query('INSERT INTO unoa.provider_event(provider, event_id, type, payload, signature_valid, outcome) VALUES ($1, $2, $3, NULL, false, $4)',
      [provider, eventId, typeof event?.type === 'string' ? event.type.slice(0, 60) : null, valid ? 'malformed' : 'invalid_signature']);
    throw new Problem(valid ? 400 : 401, valid ? 'Événement malformé' : 'Signature invalide');
  }
  const type = String(event.type ?? '');
  const data = event.data;
  return transaction(settings, 'unoa.fin.event.' + provider + '.' + eventId, async store => {
    const { rows: [seen] } = await store.query<{ outcome: string }>('SELECT outcome FROM unoa.provider_event WHERE provider = $1 AND event_id = $2 AND signature_valid', [provider, eventId]);
    if (seen) return { outcome: 'duplicate', first: seen.outcome };
    const outcome = await applyEvent(store, provider, type, data);
    await store.query('INSERT INTO unoa.provider_event(provider, event_id, type, payload, signature_valid, outcome) VALUES ($1, $2, $3, $4, true, $5)',
      [provider, eventId, type.slice(0, 60), JSON.stringify(event), outcome]);
    return { outcome };
  });
}

async function applyEvent(store: Queryable, provider: string, type: string, data: Record<string, unknown>) {
  if (type.startsWith('payment.') || type === 'chargeback') {
    const { rows: [payment] } = await store.query<{ id: string; institution_id: string; invoice_id: string; account_id: string; amount_minor: string; currency: string; state: string }>(
      'SELECT id, institution_id, invoice_id, account_id, amount_minor, currency, state FROM unoa.payment WHERE provider = $1 AND provider_ref = $2 FOR UPDATE', [provider, String(data.payment_ref ?? '')]);
    if (!payment) return 'unknown_payment';
    const amount = Number(payment.amount_minor);
    const label = money(amount, payment.currency);
    if (type === 'payment.succeeded') {
      if (payment.state !== 'pending_provider') return 'ignored_state_' + payment.state;
      if (Number(data.amount_minor) !== amount || data.currency !== payment.currency) return 'amount_mismatch';
      await store.query("UPDATE unoa.payment SET state = 'confirmed', confirmed_at = now() WHERE id = $1", [payment.id]);
      await ledger(store, { institution: payment.institution_id, account: payment.account_id, currency: payment.currency, amount: -amount, kind: 'payment',
        invoice: payment.invoice_id, payment: payment.id, label: `Paiement ${provider} ${String(data.payment_ref)}` });
      const number = await nextNumber(store, payment.institution_id, 'REC');
      const content = receiptText(number, payment.id, amount, payment.currency, String(data.payment_ref), new Date().toISOString());
      await store.query('INSERT INTO unoa.receipt(institution_id, number, payment_id, sha256) VALUES ($1, $2, $3, $4)', [payment.institution_id, number, payment.id, sha(content)]);
      await dispatch(store, { event: 'fin.payment_confirmed', scopeId: payment.institution_id, recipients: [payment.account_id], correlation: randomUUID(),
        values: { receipt: number, amount: label }, link: '/finances' });
      return 'confirmed';
    }
    if (type === 'payment.failed') {
      if (payment.state !== 'pending_provider') return 'ignored_state_' + payment.state;
      await store.query("UPDATE unoa.payment SET state = 'failed', failure = $2 WHERE id = $1", [payment.id, String(data.reason ?? 'unknown').slice(0, 200)]);
      await dispatch(store, { event: 'fin.payment_failed', scopeId: payment.institution_id, recipients: [payment.account_id], correlation: randomUUID(), values: { amount: label }, link: '/finances' });
      return 'failed';
    }
    if (type === 'chargeback') {
      if (payment.state !== 'confirmed') return 'ignored_state_' + payment.state;
      await store.query("UPDATE unoa.payment SET state = 'chargeback' WHERE id = $1", [payment.id]);
      await ledger(store, { institution: payment.institution_id, account: payment.account_id, currency: payment.currency, amount, kind: 'chargeback',
        invoice: payment.invoice_id, payment: payment.id, label: 'Rétrofacturation ' + String(data.payment_ref) });
      return 'chargeback';
    }
    return 'ignored_type';
  }
  if (type === 'refund.succeeded' || type === 'refund.failed') {
    const { rows: [refund] } = await store.query<{ id: string; state: string; amount_minor: string; payment_id: string }>(
      'SELECT id, state, amount_minor, payment_id FROM unoa.refund WHERE provider_ref = $1 FOR UPDATE', [String(data.refund_ref ?? '')]);
    if (!refund) return 'unknown_refund';
    if (refund.state !== 'sent') return 'ignored_state_' + refund.state;
    if (type === 'refund.failed') {
      await store.query("UPDATE unoa.refund SET state = 'failed', failure = $2, updated_at = now() WHERE id = $1", [refund.id, String(data.reason ?? 'unknown').slice(0, 200)]);
      return 'refund_failed';
    }
    const { rows: [payment] } = await store.query<{ institution_id: string; invoice_id: string; account_id: string; currency: string; amount_minor: string; provider_ref: string }>(
      'SELECT institution_id, invoice_id, account_id, currency, amount_minor, provider_ref FROM unoa.payment WHERE id = $1 FOR UPDATE', [refund.payment_id]);
    await store.query("UPDATE unoa.refund SET state = 'succeeded', updated_at = now() WHERE id = $1", [refund.id]);
    await ledger(store, { institution: payment.institution_id, account: payment.account_id, currency: payment.currency, amount: Number(refund.amount_minor), kind: 'refund',
      invoice: payment.invoice_id, payment: refund.payment_id, refund: refund.id, label: 'Remboursement sur ' + payment.provider_ref });
    const { rows: [total] } = await store.query<{ total: string }>("SELECT coalesce(sum(amount_minor), 0) AS total FROM unoa.refund WHERE payment_id = $1 AND state = 'succeeded'", [refund.payment_id]);
    if (Number(total.total) >= Number(payment.amount_minor)) await store.query("UPDATE unoa.payment SET state = 'refunded' WHERE id = $1 AND state = 'confirmed'", [refund.payment_id]);
    return 'refunded';
  }
  return 'ignored_type';
}

const receiptText = (number: string, paymentId: string, amount: number, currency: string, ref: string, at: string) =>
  ['REÇU DE PAIEMENT', `Numéro : ${number}`, `Paiement : ${paymentId}`, `Montant : ${formatMinor(amount, currency)}`, `Référence prestataire : ${ref}`, `Confirmé le : ${at}`].join('\n');

async function refundAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'refunds') {
    const { rows: [payment] } = await store.query<{ id: string; institution_id: string; amount_minor: string; currency: string; state: string }>(
      'SELECT id, institution_id, amount_minor, currency, state FROM unoa.payment WHERE id = $1 FOR UPDATE', [uuid(input.paymentId)]);
    ensure(payment, 404, 'Paiement introuvable');
    await require(store, actor, payment.institution_id, 'invoice');
    ensure(payment.state === 'confirmed', 409, 'Seul un paiement confirmé se rembourse');
    const amount = wrap(() => toMinor(String(input.amount ?? ''), payment.currency));
    const { rows: [engaged] } = await store.query<{ total: string }>("SELECT coalesce(sum(amount_minor), 0) AS total FROM unoa.refund WHERE payment_id = $1 AND state IN ('requested', 'sent', 'succeeded')", [payment.id]);
    ensure(amount <= Number(payment.amount_minor) - Number(engaged.total), 422, 'Le remboursement dépasse le montant payé non remboursé');
    const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.refund(payment_id, amount_minor, reason, requested_by) VALUES ($1, $2, $3, $4) RETURNING id',
      [payment.id, amount, boundedText(input.reason, 1000, 'Motif'), actor]);
    await audit(store, actor, payment.institution_id, 'fin.refund_requested', correlation, rows[0].id);
    return { scopeId: payment.institution_id, subject: rows[0].id };
  }
  const { rows: [refund] } = await store.query<{ id: string; state: string; requested_by: string; institution_id: string; provider: string }>(`SELECT refund.id, refund.state, refund.requested_by,
    payment.institution_id, payment.provider FROM unoa.refund JOIN unoa.payment ON payment.id = refund.payment_id WHERE refund.id = $1 FOR UPDATE OF refund`, [uuid(input.refundId)]);
  ensure(refund, 404, 'Remboursement introuvable');
  await require(store, actor, refund.institution_id, 'approve');
  ensure(refund.state === 'requested', 409, 'Déjà décidé');
  ensure(refund.requested_by !== actor, 403, 'L’approbation revient à une autre personne que le demandeur');
  const decision = choice(input.decision, ['approved', 'rejected'] as const, 'Décision');
  if (decision === 'approved') {
    ensure(providerSecret(refund.provider), 503, 'Prestataire du paiement non configuré');
    await store.query("UPDATE unoa.refund SET state = 'sent', approved_by = $2, provider_ref = $3, updated_at = now() WHERE id = $1", [refund.id, actor, 'sbx_rf_' + randomUUID().replace(/-/g, '')]);
  } else await store.query("UPDATE unoa.refund SET state = 'rejected', approved_by = $2, updated_at = now() WHERE id = $1", [refund.id, actor]);
  await audit(store, actor, refund.institution_id, 'fin.refund_' + decision, correlation, refund.id);
  return { scopeId: refund.institution_id, subject: refund.id };
}

// ------------------------------------------------------------ reconciliation

async function reconcileAction(store: Queryable, actor: string, action: string, input: Input, correlation: string) {
  if (action === 'bank-import') {
    const scopeId = uuid(input.scopeId);
    await require(store, actor, scopeId, 'reconcile');
    const institution = await institutionOf(store, scopeId);
    const label = boundedText(input.statementLabel, 120, 'Relevé');
    const lines = String(input.lines ?? '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    ensure(lines.length > 0 && lines.length <= 500, 400, 'De 1 à 500 lignes « AAAA-MM-JJ;montant;devise;référence »');
    let imported = 0; let matched = 0; let duplicates = 0;
    for (const line of lines) {
      const [date, amountText, currencyText, reference] = line.split(';').map(part => part?.trim());
      const currency = (currencyText ?? '').toUpperCase();
      const amount = wrap(() => toMinor(String(amountText ?? '').replace(/^-/, ''), currency)) * (String(amountText).startsWith('-') ? -1 : 1);
      ensure(reference, 400, 'Référence manquante : ' + line.slice(0, 60));
      const inserted = await store.query<{ id: string }>(`INSERT INTO unoa.bank_line(institution_id, statement_label, booked_on, amount_minor, currency, reference, fingerprint, imported_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (institution_id, fingerprint) DO NOTHING RETURNING id`,
        [institution, label, day(date, 'Date'), amount, currency, reference.slice(0, 120), sha(label + '|' + line), actor]);
      if (!inserted.rows[0]) { duplicates++; continue; }
      imported++;
      // Automatic match: same reference (provider or receipt), amount and currency, not yet matched.
      const { rows: [payment] } = await store.query<{ id: string }>(`SELECT payment.id FROM unoa.payment LEFT JOIN unoa.receipt ON receipt.payment_id = payment.id
        WHERE payment.institution_id = $1 AND payment.state IN ('confirmed', 'refunded') AND payment.amount_minor = $2 AND payment.currency = $3 AND (payment.provider_ref = $4 OR receipt.number = $4)
        AND NOT EXISTS (SELECT 1 FROM unoa.bank_line WHERE matched_payment_id = payment.id) LIMIT 1`, [institution, amount, currency, reference]);
      if (payment) {
        await store.query('UPDATE unoa.bank_line SET matched_payment_id = $2, matched_by = $3, matched_at = now() WHERE id = $1', [inserted.rows[0].id, payment.id, actor]);
        matched++;
      }
    }
    await audit(store, actor, institution, 'fin.bank_imported', correlation, null);
    return { scopeId, imported, matched, duplicates };
  }
  if (action === 'bank-match') {
    const { rows: [line] } = await store.query<{ id: string; institution_id: string; amount_minor: string; currency: string; matched_payment_id: string | null }>(
      'SELECT id, institution_id, amount_minor, currency, matched_payment_id FROM unoa.bank_line WHERE id = $1 FOR UPDATE', [uuid(input.lineId)]);
    ensure(line, 404, 'Ligne introuvable');
    await require(store, actor, line.institution_id, 'reconcile');
    ensure(!line.matched_payment_id, 409, 'Ligne déjà rapprochée');
    const { rows: [payment] } = await store.query<{ id: string; amount_minor: string; currency: string }>(`SELECT id, amount_minor, currency FROM unoa.payment WHERE id = $1 AND institution_id = $2
      AND state IN ('confirmed', 'refunded') AND NOT EXISTS (SELECT 1 FROM unoa.bank_line WHERE matched_payment_id = payment.id)`, [uuid(input.paymentId), line.institution_id]);
    ensure(payment, 422, 'Paiement confirmé non rapproché introuvable');
    ensure(payment.currency === line.currency, 422, 'Devises différentes');
    const note = optional(input.note, text(500, 'Justification'));
    ensure(Number(payment.amount_minor) === Number(line.amount_minor) || note, 422, 'Un écart de montant exige une justification');
    await store.query('UPDATE unoa.bank_line SET matched_payment_id = $2, matched_by = $3, matched_at = now(), note = $4 WHERE id = $1', [line.id, payment.id, actor, note]);
    await audit(store, actor, line.institution_id, 'fin.bank_matched', correlation, line.id);
    return { scopeId: line.institution_id, subject: line.id };
  }
  throw new Problem(404, 'Opération inconnue');
}

export async function finAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.fin.' + action, async store => {
    let result: { scopeId?: string; subject?: string; [key: string]: unknown };
    if (['rules', 'publish-rule', 'retire-rule', 'holds', 'publish-hold', 'retire-hold'].includes(action)) result = await tariffAction(store, actor, action, input);
    else if (['invoices', 'bill-cohort', 'credit-notes', 'allowances'].includes(action)) result = await invoiceAction(store, actor, action, input, correlation);
    else if (action === 'decide-allowance') result = await decideAllowance(store, actor, input, correlation);
    else if (action === 'refunds' || action === 'decide-refund') result = await refundAction(store, actor, action, input, correlation);
    else if (action === 'bank-import' || action === 'bank-match') result = await reconcileAction(store, actor, action, input, correlation);
    else throw new Problem(404, 'Opération inconnue');
    if (['rules', 'publish-rule', 'retire-rule', 'holds', 'publish-hold', 'retire-hold', 'bill-cohort'].includes(action)) {
      await audit(store, actor, result.scopeId ?? null, 'fin.' + action.replace(/-/g, '_'), correlation, result.subject ?? null);
    }
    return result;
  });
}

// -------------------------------------------------------------------- views

interface InvoiceView { id: string; number: string; kind: string; currency: string; total_minor: string; issued_at: Date; billing_period: string | null; remaining: string; credit_of: string | null;
  instalments: { ordinal: number; due_on: string; amount_minor: number }[]; lines: { label: string; quantity: number; amount_minor: number }[] }
const invoiceColumns = `invoice.id, invoice.number, invoice.kind, invoice.currency, invoice.total_minor, invoice.issued_at, invoice.billing_period, invoice.credit_of,
  coalesce((SELECT sum(amount_minor) FROM unoa.ledger_entry WHERE invoice_id = invoice.id), 0) AS remaining,
  coalesce((SELECT jsonb_agg(jsonb_build_object('ordinal', ordinal, 'due_on', due_on, 'amount_minor', amount_minor) ORDER BY ordinal) FROM unoa.instalment WHERE invoice_id = invoice.id), '[]') AS instalments,
  coalesce((SELECT jsonb_agg(jsonb_build_object('label', label, 'quantity', quantity, 'amount_minor', amount_minor) ORDER BY ordinal) FROM unoa.invoice_line WHERE invoice_id = invoice.id), '[]') AS lines`;

// Overdue: instalments due to date not covered by what was paid or credited.
export function overdue(invoice: Pick<InvoiceView, 'total_minor' | 'remaining' | 'instalments'>, today = new Date().toISOString().slice(0, 10)) {
  let covered = Number(invoice.total_minor) - Number(invoice.remaining);
  let amount = 0; let oldest: string | null = null;
  for (const item of invoice.instalments) {
    const open = Math.max(0, item.amount_minor - covered);
    covered = Math.max(0, covered - item.amount_minor);
    if (open > 0 && item.due_on <= today) { amount += open; oldest ??= item.due_on; }
  }
  return { amount, oldest, days: oldest ? Math.floor((Date.parse(today) - Date.parse(oldest)) / 86_400_000) : 0 };
}

// Holds in force for a payer in an establishment (used by document issuance).
export async function activeHolds(store: Queryable, account: string, institution: string) {
  const { rows: invoices } = await store.query<InvoiceView>(`SELECT ${invoiceColumns} FROM unoa.invoice WHERE invoice.account_id = $1 AND invoice.institution_id = $2 AND invoice.kind = 'invoice'`, [account, institution]);
  const { rows: rules } = await store.query<{ id: string; label: string; min_overdue_days: number; min_amount_minor: string; currency: string; effect: string; legal_basis: string }>(`
    WITH RECURSIVE up AS (SELECT id, parent_id FROM unoa.scope WHERE id = $1 UNION ALL SELECT scope.id, scope.parent_id FROM unoa.scope JOIN up ON scope.id = up.parent_id)
    SELECT id, label, min_overdue_days, min_amount_minor, currency, effect, legal_basis FROM unoa.hold_rule WHERE state = 'published' AND scope_id IN (SELECT id FROM up)`, [institution]);
  return rules.filter(rule => {
    const late = invoices.filter(invoice => invoice.currency === rule.currency).map(invoice => overdue(invoice));
    const amount = late.reduce((sum, item) => sum + item.amount, 0);
    const days = Math.max(0, ...late.map(item => item.days));
    return amount > 0 && amount >= Number(rule.min_amount_minor) && days >= rule.min_overdue_days;
  });
}

export async function myFinances(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [invoices, payments, allowances, balances] = await Promise.all([
    store.query<InvoiceView & { institution: string; institution_id: string }>(`SELECT ${invoiceColumns}, scope.label AS institution, invoice.institution_id FROM unoa.invoice
      JOIN unoa.scope ON scope.id = invoice.institution_id WHERE invoice.account_id = $1 ORDER BY invoice.issued_at DESC LIMIT 200`, [actor]),
    store.query<{ id: string; invoice_id: string; amount_minor: string; currency: string; state: string; failure: string | null; created_at: Date; receipt: string | null; receipt_id: string | null }>(`
      SELECT payment.id, payment.invoice_id, payment.amount_minor, payment.currency, payment.state, payment.failure, payment.created_at, receipt.number AS receipt, receipt.id AS receipt_id
      FROM unoa.payment LEFT JOIN unoa.receipt ON receipt.payment_id = payment.id WHERE payment.account_id = $1 ORDER BY payment.created_at DESC LIMIT 200`, [actor]),
    store.query<{ invoice_id: string; kind: string; label: string; amount_minor: string; state: string }>(`SELECT allowance.invoice_id, allowance.kind, allowance.label, allowance.amount_minor, allowance.state
      FROM unoa.allowance JOIN unoa.invoice ON invoice.id = allowance.invoice_id WHERE invoice.account_id = $1 AND allowance.state = 'approved'`, [actor]),
    store.query<{ institution_id: string; institution: string; currency: string; balance: string }>(`SELECT ledger.institution_id, scope.label AS institution, ledger.currency, sum(ledger.amount_minor) AS balance
      FROM unoa.ledger_entry AS ledger JOIN unoa.scope ON scope.id = ledger.institution_id WHERE ledger.account_id = $1 GROUP BY ledger.institution_id, scope.label, ledger.currency`, [actor]),
  ]);
  const holds = [];
  for (const institution of new Set(balances.rows.map(row => row.institution_id))) holds.push(...(await activeHolds(store, actor, institution)));
  return { invoices: invoices.rows, payments: payments.rows, allowances: allowances.rows, balances: balances.rows, holds, provider: paymentProvider()?.name ?? null };
}

export async function paymentForCheckout(settings: IamSettings, actor: string, ref: string) {
  const { rows: [payment] } = await database(settings).query<{ id: string; account_id: string; amount_minor: string; currency: string; state: string; number: string; provider_ref: string }>(`
    SELECT payment.id, payment.account_id, payment.amount_minor, payment.currency, payment.state, invoice.number, payment.provider_ref FROM unoa.payment
    JOIN unoa.invoice ON invoice.id = payment.invoice_id WHERE payment.provider = 'sandbox' AND payment.provider_ref = $1`, [ref]);
  ensure(payment, 404, 'Paiement introuvable');
  ensure(payment.account_id === actor, 403, 'Paiement d’un autre payeur');
  return payment;
}

export async function receiptDocument(settings: IamSettings, actor: string, id: string) {
  const store = database(settings);
  const { rows: [receipt] } = await store.query<{ number: string; sha256: string; institution_id: string; account_id: string; payment_id: string; amount_minor: string; currency: string;
    provider_ref: string; confirmed_at: Date; institution: string; payer: string | null; invoice: string }>(`
    SELECT receipt.number, receipt.sha256, receipt.institution_id, payment.account_id, payment.id AS payment_id, payment.amount_minor, payment.currency, payment.provider_ref,
      payment.confirmed_at, scope.label AS institution, account.display_name AS payer, invoice.number AS invoice FROM unoa.receipt JOIN unoa.payment ON payment.id = receipt.payment_id
    JOIN unoa.scope ON scope.id = receipt.institution_id JOIN unoa.account ON account.id = payment.account_id JOIN unoa.invoice ON invoice.id = payment.invoice_id WHERE receipt.id = $1`, [uuid(id)]);
  ensure(receipt, 404, 'Reçu introuvable');
  ensure(receipt.account_id === actor || (await rights(store, actor, receipt.institution_id))?.read, 403, 'Reçu réservé');
  return ['REÇU DE PAIEMENT', receipt.institution, '', `Numéro : ${receipt.number}`, `Payeur : ${receipt.payer ?? ''}`, `Facture : ${receipt.invoice}`,
    `Montant : ${formatMinor(Number(receipt.amount_minor), receipt.currency)}`, `Référence prestataire : ${receipt.provider_ref}`,
    `Paiement confirmé par le prestataire le : ${receipt.confirmed_at.toISOString()}`, '', `Empreinte de vérification : ${receipt.sha256}`].join('\n');
}

export async function finContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`
    SELECT scope.id, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    WHERE kind.nature IN ('territory', 'jurisdiction', 'institution') AND unoa.has_scope_permission($1, 'fin.read', scope.id) ORDER BY kind.nature, scope.label LIMIT 200`, [actor]);
  return rows;
}

export async function finOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const store = database(settings);
  const granted = await require(store, actor, scopeId, 'read');
  const { rows: [nature] } = await store.query<{ nature: string; label: string }>('SELECT kind.nature, scope.label FROM unoa.scope JOIN unoa.scope_type AS kind ON kind.code = scope.type_code WHERE scope.id = $1', [scopeId]);
  ensure(nature, 404, 'Portée introuvable');
  const institution = nature.nature === 'institution' ? scopeId : null;
  const [rules, holds, invoices, allowances, refunds, payments, lines, balances, versions, cohorts, payers, events] = await Promise.all([
    store.query(`WITH RECURSIVE up AS (SELECT id, parent_id FROM unoa.scope WHERE id = $1 UNION ALL SELECT scope.id, scope.parent_id FROM unoa.scope JOIN up ON scope.id = up.parent_id)
      SELECT rule.*, rule.effective_from::text, rule.effective_until::text, scope.label AS scope_label FROM unoa.price_rule AS rule JOIN unoa.scope ON scope.id = rule.scope_id
      WHERE rule.scope_id IN (SELECT id FROM up) OR unoa.scope_within(rule.scope_id, $1) ORDER BY rule.created_at DESC LIMIT 200`, [scopeId]),
    store.query(`WITH RECURSIVE up AS (SELECT id, parent_id FROM unoa.scope WHERE id = $1 UNION ALL SELECT scope.id, scope.parent_id FROM unoa.scope JOIN up ON scope.id = up.parent_id)
      SELECT hold.*, scope.label AS scope_label FROM unoa.hold_rule AS hold JOIN unoa.scope ON scope.id = hold.scope_id WHERE hold.scope_id IN (SELECT id FROM up) OR unoa.scope_within(hold.scope_id, $1)
      ORDER BY hold.created_at DESC LIMIT 100`, [scopeId]),
    store.query<InvoiceView & { payer: string | null; account_id: string }>(`SELECT ${invoiceColumns}, account.display_name AS payer, invoice.account_id FROM unoa.invoice JOIN unoa.account ON account.id = invoice.account_id
      WHERE unoa.scope_within(invoice.institution_id, $1) ORDER BY invoice.issued_at DESC LIMIT 300`, [scopeId]),
    store.query(`SELECT allowance.*, invoice.number, invoice.currency, account.display_name AS payer FROM unoa.allowance JOIN unoa.invoice ON invoice.id = allowance.invoice_id
      JOIN unoa.account ON account.id = invoice.account_id WHERE unoa.scope_within(invoice.institution_id, $1) ORDER BY allowance.created_at DESC LIMIT 200`, [scopeId]),
    store.query(`SELECT refund.*, payment.currency, payment.provider_ref AS payment_ref, account.display_name AS payer FROM unoa.refund JOIN unoa.payment ON payment.id = refund.payment_id
      JOIN unoa.account ON account.id = payment.account_id WHERE unoa.scope_within(payment.institution_id, $1) ORDER BY refund.created_at DESC LIMIT 200`, [scopeId]),
    store.query(`SELECT payment.id, payment.amount_minor, payment.currency, payment.state, payment.provider, payment.provider_ref, payment.failure, payment.created_at, payment.confirmed_at,
      invoice.number, account.display_name AS payer, receipt.number AS receipt, receipt.id AS receipt_id,
      EXISTS (SELECT 1 FROM unoa.bank_line WHERE matched_payment_id = payment.id) AS reconciled,
      coalesce((SELECT sum(amount_minor) FROM unoa.refund WHERE payment_id = payment.id AND state IN ('requested', 'sent', 'succeeded')), 0) AS refund_engaged
      FROM unoa.payment JOIN unoa.invoice ON invoice.id = payment.invoice_id JOIN unoa.account ON account.id = payment.account_id LEFT JOIN unoa.receipt ON receipt.payment_id = payment.id
      WHERE unoa.scope_within(payment.institution_id, $1) ORDER BY payment.created_at DESC LIMIT 300`, [scopeId]),
    store.query(`SELECT line.*, line.booked_on::text, payment.provider_ref AS matched_ref FROM unoa.bank_line AS line LEFT JOIN unoa.payment ON payment.id = line.matched_payment_id
      WHERE unoa.scope_within(line.institution_id, $1) ORDER BY line.booked_on DESC LIMIT 300`, [scopeId]),
    store.query<{ account_id: string; payer: string | null; currency: string; balance: string }>(`SELECT ledger.account_id, account.display_name AS payer, ledger.currency, sum(ledger.amount_minor) AS balance
      FROM unoa.ledger_entry AS ledger JOIN unoa.account ON account.id = ledger.account_id WHERE unoa.scope_within(ledger.institution_id, $1)
      GROUP BY ledger.account_id, account.display_name, ledger.currency ORDER BY account.display_name LIMIT 500`, [scopeId]),
    store.query<{ id: string; title: string }>(`SELECT version.id, program.title || ' — v' || version.number AS title FROM unoa.program_version AS version JOIN unoa.program ON program.id = version.program_id
      WHERE (unoa.scope_within(program.owner_scope_id, $1) OR unoa.scope_within($1, program.owner_scope_id)) AND version.state = 'published' ORDER BY program.title LIMIT 200`, [scopeId]),
    store.query<{ id: string; label: string; academic_year: string }>('SELECT id, label, academic_year FROM unoa.cohort WHERE unoa.scope_within(owner_scope_id, $1) ORDER BY academic_year DESC, label LIMIT 200', [scopeId]),
    institution ? store.query<{ id: string; name: string | null; matricule: string | null }>(`SELECT DISTINCT account.id, account.display_name AS name, student.matricule FROM unoa.student
      JOIN unoa.account ON account.id = student.account_id WHERE student.institution_id = $1 UNION SELECT DISTINCT account.id, account.display_name, NULL FROM unoa.application
      JOIN unoa.account ON account.id = application.applicant_id JOIN unoa.admission_round AS round ON round.id = application.round_id
      JOIN unoa.program_version AS version ON version.id = round.version_id JOIN unoa.program ON program.id = version.program_id
      WHERE program.institution_id = $1 ORDER BY 2 LIMIT 500`, [institution])
      : Promise.resolve({ rows: [] as { id: string; name: string | null; matricule: string | null }[] }),
    // Provider notifications concerning this scope's payments only.
    store.query(`SELECT event.provider, event.event_id, event.type, event.signature_valid, event.outcome, event.received_at FROM unoa.provider_event AS event
      JOIN unoa.payment ON payment.provider = event.provider AND payment.provider_ref = coalesce(event.payload->'data'->>'payment_ref',
        (SELECT payment_row.provider_ref FROM unoa.refund JOIN unoa.payment AS payment_row ON payment_row.id = refund.payment_id WHERE refund.provider_ref = event.payload->'data'->>'refund_ref'))
      WHERE unoa.scope_within(payment.institution_id, $1) ORDER BY event.received_at DESC LIMIT 50`, [scopeId]),
  ]);
  return { scope: { id: scopeId, label: nature.label, institution }, rights: granted, rules: rules.rows, holds: holds.rows, invoices: invoices.rows, allowances: allowances.rows,
    refunds: refunds.rows, payments: payments.rows, lines: lines.rows, balances: balances.rows, versions: versions.rows, cohorts: cohorts.rows, payers: payers.rows,
    events: granted.approve ? events.rows : [], provider: paymentProvider()?.name ?? null };
}

const csv = (rows: (string | number | null)[][]) => '﻿' + rows.map(row => row.map(cell => {
  const value = cell === null ? '' : String(cell);
  return /[;"\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}).join(';')).join('\n');
const decimal = major;

// Accounting exports (FIN-015): journal of ledger entries and payer balances, in the local separator convention.
export async function financeExport(settings: IamSettings, actor: string, scope: string, kind: string, from: string | null, to: string | null) {
  const scopeId = uuid(scope);
  const store = database(settings);
  await require(store, actor, scopeId, 'export');
  if (kind === 'balances') {
    const { rows } = await store.query<{ payer: string | null; matricule: string | null; currency: string; balance: string }>(`SELECT account.display_name AS payer,
      (SELECT matricule FROM unoa.student WHERE account_id = ledger.account_id AND institution_id = ledger.institution_id LIMIT 1) AS matricule, ledger.currency, sum(ledger.amount_minor) AS balance
      FROM unoa.ledger_entry AS ledger JOIN unoa.account ON account.id = ledger.account_id WHERE unoa.scope_within(ledger.institution_id, $1)
      GROUP BY ledger.account_id, ledger.institution_id, account.display_name, ledger.currency ORDER BY account.display_name`, [scopeId]);
    return csv([['Payeur', 'Matricule', 'Devise', 'Solde dû'], ...rows.map(row => [row.payer, row.matricule, row.currency, decimal(row.balance, row.currency)])]);
  }
  const start = from ? day(from, 'Début') : '1970-01-01';
  const end = to ? day(to, 'Fin') : '9999-12-31';
  const { rows } = await store.query<{ created_at: Date; kind: string; label: string; payer: string | null; currency: string; amount_minor: string; invoice: string | null; receipt: string | null }>(`
    SELECT ledger.created_at, ledger.kind, ledger.label, account.display_name AS payer, ledger.currency, ledger.amount_minor, invoice.number AS invoice, receipt.number AS receipt
    FROM unoa.ledger_entry AS ledger JOIN unoa.account ON account.id = ledger.account_id LEFT JOIN unoa.invoice ON invoice.id = ledger.invoice_id
    LEFT JOIN unoa.receipt ON receipt.payment_id = ledger.payment_id AND ledger.kind = 'payment'
    WHERE unoa.scope_within(ledger.institution_id, $1) AND ledger.created_at::date BETWEEN $2 AND $3 ORDER BY ledger.created_at`, [scopeId, start, end]);
  return csv([['Date', 'Nature', 'Libellé', 'Payeur', 'Facture', 'Reçu', 'Devise', 'Débit', 'Crédit'], ...rows.map(row => [row.created_at.toISOString(), row.kind, row.label, row.payer,
    row.invoice, row.receipt, row.currency, Number(row.amount_minor) > 0 ? decimal(row.amount_minor, row.currency) : '', Number(row.amount_minor) < 0 ? decimal(-Number(row.amount_minor), row.currency) : ''])]);
}
