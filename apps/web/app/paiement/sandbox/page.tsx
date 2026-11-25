import type { Metadata } from 'next';
import { money, paymentForCheckout, paymentStates } from '@/lib/finance/store';
import { ActionForm, Notice } from '../../administration/forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Paiement fictif' };
export const dynamic = 'force-dynamic';

// Checkout of the fictitious sandbox provider: the choice made here reaches the
// platform only as a signed provider event, exactly like a real provider's.
export default async function Sandbox({ searchParams }: { searchParams: Promise<{ ref?: string; error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const payment = search.ref ? await paymentForCheckout(settings, actor, search.ref).catch(refusedAs(null)) : null;
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <p className="eyebrow">Bac à sable — aucun argent réel</p>
        <h1>Paiement fictif</h1>
        <Notice error={search.error} />
        {!payment ? <p role="alert">Paiement introuvable.</p> : <>
          <p>Facture {payment.number} · {money(payment.amount_minor, payment.currency)} · état : {paymentStates[payment.state]}</p>
          {payment.state === 'pending_provider' ? (
            <div className="studio-actions">
              <ActionForm inline action="/api/v1/fin/sandbox" back="/finances" hidden={{ ref: payment.provider_ref, outcome: 'succeeded' }} submit="Confirmer le paiement fictif" />
              <ActionForm inline action="/api/v1/fin/sandbox" back="/finances" hidden={{ ref: payment.provider_ref, outcome: 'failed', reason: 'mobile_money_insufficient_funds' }} submit="Simuler un échec (solde insuffisant)" />
            </div>
          ) : <p><a href="/finances">Retour à mes finances</a></p>}
        </>}
      </section>
    </main>
  );
}
