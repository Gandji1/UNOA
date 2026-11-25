import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { allowanceLabels, finContexts, finOverview, holdEffects, kindLabels, major, money, overdue, paymentStates, recurrenceLabels } from '@/lib/finance/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Finances' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/finances';
const api = '/api/v1/fin/';
const ruleStates: Record<string, [string, 'warn' | 'ok' | 'muted']> = { draft: ['À approuver', 'warn'], published: ['En vigueur', 'ok'], retired: ['Retiré', 'muted'] };
const refundStates: Record<string, string> = { requested: 'À approuver', rejected: 'Refusé', sent: 'Transmis au prestataire', succeeded: 'Effectué', failed: 'Échoué' };
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export default async function FinancesAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await finOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>Finances</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">Finances</span>}</nav>;
  if (!data) {
    const scopes = await finContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Finances</h1><p>Choisissez un pays ou un établissement.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const can = data.rights;
  const rules = data.rules as Row[];
  const published = rules.filter(rule => rule.state === 'published');
  const unmatched = (data.lines as Row[]).filter(line => !line.matched_payment_id);
  const toReconcile = (data.payments as Row[]).filter(payment => ['confirmed', 'refunded'].includes(payment.state) && !payment.reconciled);
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Finances</p><h1>Finances — {data.scope.label}</h1>
        <p>Tarif approuvé → facture numérotée → échéances → paiement confirmé par le prestataire → reçu → rapprochement bancaire. Tous les soldes sont calculés à partir d’écritures non modifiables.</p></section>
      {notice}

      <Panel title="Tarifs" id="tarifs">
        {rules.length === 0 ? <p>Aucun tarif.</p> : (
          <Table label="Tarifs" head={['Tarif', 'Portée', 'Montant', 'Échéances', 'Validité', 'État', '']}>
            {rules.map(rule => <tr key={rule.id}><td>{rule.label}<br /><span className="muted">{kindLabels[rule.kind]} · {recurrenceLabels[rule.recurrence]}{rule.profile ? ` · profil ${rule.profile}` : ''}{rule.academic_year ? ` · ${rule.academic_year}` : ''}</span></td>
              <td>{rule.scope_label}</td><td>{money(rule.amount_minor, rule.currency)}</td><td>{rule.instalments} × tous les {rule.interval_days} j</td>
              <td>{rule.effective_from}{rule.effective_until ? ` → ${rule.effective_until}` : ''}</td><td><Badge tone={ruleStates[rule.state][1]}>{ruleStates[rule.state][0]}</Badge></td>
              <td>{can.approve && rule.state === 'draft' && rule.author_id !== actor && <ActionForm inline action={api + 'publish-rule'} back={back} hidden={{ ruleId: rule.id }} submit="Approuver" />}
                {can.approve && rule.state === 'published' && <ActionForm inline action={api + 'retire-rule'} back={back} hidden={{ ruleId: rule.id }} submit="Retirer" />}</td></tr>)}
          </Table>
        )}
        {can.tariff && (
          <Editor summary="Nouveau tarif (approbation par une autre personne)">
            <ActionForm action={api + 'rules'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer le tarif">
              <label>Libellé<input name="label" required maxLength={160} /></label>
              <label>Nature<select name="kind">{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Périodicité<select name="recurrence">{Object.entries(recurrenceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Montant<input name="amount" required inputMode="decimal" /></label>
              <label>Devise (ISO 4217)<input name="currency" required maxLength={3} pattern="[A-Za-z]{3}" /></label>
              <label>Formation (facultatif)<select name="programVersionId"><option value="">Toutes</option>{data.versions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <label>Année universitaire (facultatif)<input name="academicYear" placeholder="AAAA-AAAA" /></label>
              <label>Profil (facultatif)<input name="profile" maxLength={60} /></label>
              <label>Nombre d’échéances<input name="instalments" inputMode="numeric" defaultValue="1" /></label>
              <label>Jours entre échéances<input name="intervalDays" inputMode="numeric" defaultValue="30" /></label>
              <label>Date d’effet<input type="date" name="effectiveFrom" required /></label>
              <label>Fin de validité (facultatif)<input type="date" name="effectiveUntil" /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Règles de retenue" id="retenues">
        <p className="studio-help">Effets limités à une relance ou à la suspension des attestations internes, avec fondement légal ; jamais d’accès aux cours, examens ou données personnelles retiré.</p>
        {(data.holds as Row[]).length === 0 ? <p>Aucune règle.</p> : <ul>{(data.holds as Row[]).map(hold => <li key={hold.id}>{hold.label} — {holdEffects[hold.effect]} au-delà de {hold.min_overdue_days} j et {money(hold.min_amount_minor, hold.currency)} · {hold.legal_basis}{' '}
          <Badge tone={ruleStates[hold.state][1]}>{ruleStates[hold.state][0]}</Badge>
          {can.approve && hold.state === 'draft' && hold.author_id !== actor && <ActionForm inline action={api + 'publish-hold'} back={back} hidden={{ ruleId: hold.id }} submit="Approuver" />}
          {can.approve && hold.state === 'published' && <ActionForm inline action={api + 'retire-hold'} back={back} hidden={{ ruleId: hold.id }} submit="Retirer" />}</li>)}</ul>}
        {can.tariff && (
          <Editor summary="Nouvelle règle de retenue">
            <ActionForm action={api + 'holds'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer la règle">
              <label>Libellé<input name="label" required maxLength={160} /></label>
              <label>Effet<select name="effect">{Object.entries(holdEffects).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Retard minimal (jours)<input name="minOverdueDays" required inputMode="numeric" /></label>
              <label>Montant minimal en retard<input name="minAmount" required inputMode="decimal" /></label>
              <label>Devise<input name="currency" required maxLength={3} /></label>
              <label className="studio-wide">Fondement légal ou réglementaire<textarea name="legalBasis" required maxLength={1000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      {can.invoice && data.scope.institution && published.length > 0 && (
        <Panel title="Facturer" id="facturer">
          <ActionForm action={api + 'invoices'} back={back} hidden={{ scopeId: data.scope.id }} submit="Émettre la facture">
            <label>Payeur<select name="accountId">{data.payers.map(item => <option key={item.id} value={item.id}>{item.name ?? item.id.slice(0, 8)}{item.matricule ? ` · ${item.matricule}` : ''}</option>)}</select></label>
            <label>Tarif<select name="priceRuleId">{published.map(rule => <option key={rule.id} value={rule.id}>{rule.label} — {money(rule.amount_minor, rule.currency)}</option>)}</select></label>
            <label>Quantité<input name="quantity" inputMode="numeric" defaultValue="1" /></label>
            <label>Période facturée (facultatif)<input name="billingPeriod" maxLength={40} /></label>
            <label>Profil du payeur (facultatif)<input name="profile" maxLength={60} /></label>
            <label>Première échéance<input type="date" name="firstDueOn" required /></label>
          </ActionForm>
          <Editor summary="Facturer toute une cohorte">
            <ActionForm action={api + 'bill-cohort'} back={back} hidden={{ scopeId: data.scope.id }} submit="Facturer la cohorte">
              <label>Cohorte<select name="cohortId">{data.cohorts.map(item => <option key={item.id} value={item.id}>{item.label} · {item.academic_year}</option>)}</select></label>
              <label>Tarif<select name="priceRuleId">{published.map(rule => <option key={rule.id} value={rule.id}>{rule.label}</option>)}</select></label>
              <label>Période facturée<input name="billingPeriod" required maxLength={40} /></label>
              <label>Première échéance<input type="date" name="firstDueOn" required /></label>
            </ActionForm>
          </Editor>
        </Panel>
      )}

      <Panel title="Factures et avoirs" id="factures">
        {data.invoices.length === 0 ? <p>Aucune facture.</p> : (
          <Table label="Factures" head={['Numéro', 'Payeur', 'Montant', 'Reste dû', 'Retard', '']}>
            {data.invoices.map(invoice => {
              const late = invoice.kind === 'invoice' ? overdue(invoice) : null;
              return (
                <tr key={invoice.id}><td>{invoice.number}<br /><span className="muted">{invoice.kind === 'credit_note' ? 'Avoir' : 'Facture'} · {formatTime(invoice.issued_at)}</span></td>
                  <td>{invoice.payer}</td><td>{money(invoice.total_minor, invoice.currency)}</td><td>{invoice.kind === 'invoice' ? money(invoice.remaining, invoice.currency) : '—'}</td>
                  <td>{late?.amount ? `${money(late.amount, invoice.currency)} depuis ${late.days} j` : '—'}</td>
                  <td>{can.invoice && invoice.kind === 'invoice' && <>
                    <Editor summary="Avoir">
                      <ActionForm action={api + 'credit-notes'} back={back} hidden={{ invoiceId: invoice.id }} submit="Émettre l’avoir">
                        <label>Montant<input name="amount" required inputMode="decimal" /></label>
                        <label className="studio-wide">Motif<input name="reason" required maxLength={1000} /></label>
                      </ActionForm>
                    </Editor>
                    <Editor summary="Remise, bourse ou financement">
                      <ActionForm action={api + 'allowances'} back={back} hidden={{ invoiceId: invoice.id }} submit="Proposer">
                        <label>Nature<select name="kind">{Object.entries(allowanceLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                        <label>Libellé<input name="label" required maxLength={160} /></label>
                        <label>Financeur (obligatoire pour un employeur)<input name="funder" maxLength={200} /></label>
                        <label>Base<select name="basis"><option value="amount">Montant</option><option value="percent">Pourcentage</option></select></label>
                        <label>Valeur<input name="value" required inputMode="decimal" /></label>
                      </ActionForm>
                    </Editor>
                  </>}</td></tr>
              );
            })}
          </Table>
        )}
      </Panel>

      <Panel title="Remises, bourses et financements" id="remises">
        {(data.allowances as Row[]).length === 0 ? <p>Aucune proposition.</p> : (
          <Table label="Remises" head={['Facture', 'Payeur', 'Nature', 'Montant', 'État', '']}>
            {(data.allowances as Row[]).map(item => <tr key={item.id}><td>{item.number}</td><td>{item.payer}</td><td>{allowanceLabels[item.kind]} — {item.label}{item.funder ? ` (${item.funder})` : ''}</td>
              <td>{money(item.amount_minor, item.currency)}</td><td>{item.state === 'proposed' ? 'À approuver' : item.state === 'approved' ? 'Approuvée' : 'Refusée'}</td>
              <td>{can.approve && item.state === 'proposed' && item.proposed_by !== actor && <div className="studio-actions">
                <ActionForm inline action={api + 'decide-allowance'} back={back} hidden={{ allowanceId: item.id, decision: 'approved' }} submit="Approuver" />
                <ActionForm inline action={api + 'decide-allowance'} back={back} hidden={{ allowanceId: item.id, decision: 'rejected' }} submit="Refuser" /></div>}</td></tr>)}
          </Table>
        )}
      </Panel>

      <Panel title="Paiements" id="paiements">
        {(data.payments as Row[]).length === 0 ? <p>Aucun paiement.</p> : (
          <Table label="Paiements" head={['Date', 'Payeur', 'Facture', 'Montant', 'État', 'Reçu', '']}>
            {(data.payments as Row[]).map(item => <tr key={item.id}><td>{formatTime(item.created_at)}</td><td>{item.payer}</td><td>{item.number}</td><td>{money(item.amount_minor, item.currency)}</td>
              <td>{paymentStates[item.state]}{item.failure ? ` (${item.failure})` : ''}{item.reconciled && <> <Badge tone="ok">rapproché</Badge></>}<br /><span className="muted">{item.provider} · {item.provider_ref}</span></td>
              <td>{item.receipt_id ? <a href={`${api}receipts/${item.receipt_id}`}>{item.receipt}</a> : '—'}</td>
              <td>{can.invoice && item.state === 'confirmed' && Number(item.refund_engaged) < Number(item.amount_minor) && (
                <Editor summary="Remboursement">
                  <ActionForm action={api + 'refunds'} back={back} hidden={{ paymentId: item.id }} submit="Demander">
                    <label>Montant<input name="amount" required inputMode="decimal" defaultValue={major(Number(item.amount_minor) - Number(item.refund_engaged), item.currency)} /></label>
                    <label className="studio-wide">Motif (trop-perçu, annulation…)<input name="reason" required maxLength={1000} /></label>
                  </ActionForm>
                </Editor>
              )}{can.approve && data.provider === 'sandbox' && item.provider === 'sandbox' && item.state === 'confirmed' && (
                <ActionForm inline action={api + 'sandbox'} back={back} hidden={{ ref: item.provider_ref, outcome: 'chargeback' }} submit="Simuler une rétrofacturation" />
              )}</td></tr>)}
          </Table>
        )}
      </Panel>

      <Panel title="Remboursements" id="remboursements">
        {(data.refunds as Row[]).length === 0 ? <p>Aucun remboursement.</p> : (
          <Table label="Remboursements" head={['Payeur', 'Paiement', 'Montant', 'Motif', 'État', '']}>
            {(data.refunds as Row[]).map(item => <tr key={item.id}><td>{item.payer}</td><td>{item.payment_ref}</td><td>{money(item.amount_minor, item.currency)}</td><td>{item.reason}</td>
              <td>{refundStates[item.state]}{item.failure ? ` (${item.failure})` : ''}</td>
              <td>{can.approve && item.state === 'requested' && item.requested_by !== actor && <div className="studio-actions">
                <ActionForm inline action={api + 'decide-refund'} back={back} hidden={{ refundId: item.id, decision: 'approved' }} submit="Approuver et transmettre" />
                <ActionForm inline action={api + 'decide-refund'} back={back} hidden={{ refundId: item.id, decision: 'rejected' }} submit="Refuser" /></div>}
                {can.approve && item.state === 'sent' && data.provider === 'sandbox' && <div className="studio-actions">
                  <ActionForm inline action={api + 'sandbox'} back={back} hidden={{ refundId: item.id, outcome: 'succeeded' }} submit="Bac à sable : effectué" />
                  <ActionForm inline action={api + 'sandbox'} back={back} hidden={{ refundId: item.id, outcome: 'failed' }} submit="Bac à sable : échec" /></div>}</td></tr>)}
          </Table>
        )}
      </Panel>

      <Panel title="Rapprochement bancaire" id="rapprochement">
        {can.reconcile && data.scope.institution && (
          <Editor summary="Importer un relevé">
            <ActionForm action={api + 'bank-import'} back={back} hidden={{ scopeId: data.scope.id }} submit="Importer et rapprocher">
              <label>Relevé<input name="statementLabel" required maxLength={120} /></label>
              <label className="studio-wide">Lignes « AAAA-MM-JJ;montant;devise;référence »<textarea name="lines" required rows={5} /></label>
            </ActionForm>
          </Editor>
        )}
        <h3>Écarts</h3>
        <p>{unmatched.length} ligne(s) bancaire(s) sans paiement · {toReconcile.length} paiement(s) confirmé(s) sans ligne bancaire</p>
        {unmatched.length > 0 && (
          <Table label="Lignes non rapprochées" head={['Date', 'Montant', 'Référence', 'Relevé', '']}>
            {unmatched.map(line => <tr key={line.id}><td>{line.booked_on}</td><td>{money(line.amount_minor, line.currency)}</td><td>{line.reference}</td><td>{line.statement_label}</td>
              <td>{can.reconcile && toReconcile.length > 0 && (
                <ActionForm inline action={api + 'bank-match'} back={back} hidden={{ lineId: line.id }} submit="Rapprocher">
                  <label>Paiement<select name="paymentId">{toReconcile.map(payment => <option key={payment.id} value={payment.id}>{payment.provider_ref} — {money(payment.amount_minor, payment.currency)}</option>)}</select></label>
                  <label>Justification d’écart<input name="note" maxLength={500} /></label>
                </ActionForm>
              )}</td></tr>)}
          </Table>
        )}
      </Panel>

      <Panel title="Soldes et exports" id="soldes" actions={can.export ? <div className="studio-actions">
        <a className="secondary" href={`${api}export?scopeId=${data.scope.id}&kind=journal`}>Journal (CSV)</a>
        <a className="secondary" href={`${api}export?scopeId=${data.scope.id}&kind=balances`}>Soldes (CSV)</a></div> : undefined}>
        {data.balances.length === 0 ? <p>Aucune écriture.</p> : (
          <Table label="Soldes" head={['Payeur', 'Solde']}>
            {data.balances.map(item => <tr key={item.account_id + item.currency}><td>{item.payer}</td><td>{Number(item.balance) >= 0 ? money(item.balance, item.currency) : `Trop-perçu ${money(-Number(item.balance), item.currency)}`}</td></tr>)}
          </Table>
        )}
      </Panel>

      {data.events.length > 0 && (
        <Panel title="Notifications du prestataire" id="evenements">
          <Table label="Événements prestataire" head={['Reçu le', 'Prestataire', 'Type', 'Signature', 'Traitement']}>
            {(data.events as Row[]).map((item, index) => <tr key={index}><td>{formatTime(item.received_at)}</td><td>{item.provider}</td><td>{item.type ?? '—'}</td>
              <td>{item.signature_valid ? 'valide' : <Badge tone="danger">invalide</Badge>}</td><td>{item.outcome}</td></tr>)}
          </Table>
        </Panel>
      )}
    </main>
  );
}
