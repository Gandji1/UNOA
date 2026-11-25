import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { allowanceLabels, holdEffects, major, money, myFinances, overdue, paymentStates } from '@/lib/finance/store';
import { formatTime, Hidden, Notice, Panel, Table, Badge } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mes finances' };
export const dynamic = 'force-dynamic';

export default async function Finances({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await myFinances(settings, actor);
  const invoices = data.invoices.filter(item => item.kind === 'invoice');
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes finances</span></nav>
      <section className="studio-heading"><p className="eyebrow">Finances</p><h1>Mes finances</h1>
        <p>Factures, échéances, remises et bourses, paiements et reçus. Un paiement n’est enregistré qu’après confirmation par le prestataire.</p></section>
      <Notice error={search.error} message={search.message} />
      <section className="facts">{data.balances.length === 0 ? <div><span>Solde</span><strong>Aucune facture</strong></div> : data.balances.map(item => (
        <div key={item.institution_id + item.currency}><span>{item.institution}</span><strong>{Number(item.balance) >= 0 ? `Reste dû : ${money(item.balance, item.currency)}` : `Trop-perçu : ${money(-Number(item.balance), item.currency)}`}</strong></div>
      ))}</section>
      {data.holds.length > 0 && <p className="studio-notice" role="alert">{data.holds.map(hold => `${hold.label} — ${holdEffects[hold.effect]} (fondement : ${hold.legal_basis})`).join(' · ')}</p>}
      <Panel title="Factures" id="factures">
        {invoices.length === 0 ? <p>Aucune facture.</p> : invoices.map(invoice => {
          const late = overdue(invoice);
          const credits = data.invoices.filter(item => item.credit_of === invoice.id);
          const allowances = data.allowances.filter(item => item.invoice_id === invoice.id);
          return (
            <section key={invoice.id} className="studio-panel">
              <h3>{invoice.number} — {money(invoice.total_minor, invoice.currency)} {Number(invoice.remaining) <= 0 ? <Badge tone="ok">soldée</Badge> : late.amount > 0 ? <Badge tone="danger">en retard</Badge> : <Badge tone="warn">à régler</Badge>}</h3>
              <p className="muted">{invoice.institution} · émise le {formatTime(invoice.issued_at)}{invoice.billing_period ? ` · période ${invoice.billing_period}` : ''} · reste dû {money(Math.max(0, Number(invoice.remaining)), invoice.currency)}</p>
              <ul>{invoice.lines.map((line, index) => <li key={index}>{line.label} × {line.quantity} — {money(line.amount_minor, invoice.currency)}</li>)}</ul>
              {credits.map(item => <p key={item.id} className="muted">Avoir {item.number} : −{money(item.total_minor, item.currency)}</p>)}
              {allowances.map((item, index) => <p key={index} className="muted">{allowanceLabels[item.kind]} « {item.label} » : −{money(item.amount_minor, invoice.currency)}</p>)}
              <Table label={'Échéancier ' + invoice.number} head={['Échéance', 'Montant']}>
                {invoice.instalments.map(item => <tr key={item.ordinal}><td>{item.due_on}</td><td>{money(item.amount_minor, invoice.currency)}</td></tr>)}
              </Table>
              {Number(invoice.remaining) > 0 && (data.provider ? (
                <form method="post" action="/api/v1/fin/checkout" className="studio-inline">
                  <Hidden values={{ invoiceId: invoice.id, idempotencyKey: randomUUID().replace(/-/g, '') }} />
                  <label>Montant à payer<input name="amount" required inputMode="decimal" defaultValue={major(invoice.remaining, invoice.currency)} /></label>
                  <button className="action" type="submit">Payer en ligne</button>
                </form>
              ) : <p className="muted">Paiement en ligne non configuré : réglez auprès du service financier de l’établissement.</p>)}
            </section>
          );
        })}
      </Panel>
      <Panel title="Paiements et reçus" id="paiements">
        {data.payments.length === 0 ? <p>Aucun paiement.</p> : (
          <Table label="Paiements" head={['Date', 'Montant', 'État', 'Reçu']}>
            {data.payments.map(item => <tr key={item.id}><td>{formatTime(item.created_at)}</td><td>{money(item.amount_minor, item.currency)}</td>
              <td>{paymentStates[item.state]}{item.failure ? ` (${item.failure})` : ''}</td><td>{item.receipt_id ? <a href={`/api/v1/fin/receipts/${item.receipt_id}`}>{item.receipt}</a> : '—'}</td></tr>)}
          </Table>
        )}
      </Panel>
    </main>
  );
}
