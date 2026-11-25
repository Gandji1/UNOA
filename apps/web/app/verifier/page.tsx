import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'Vérifier un document' };
export const dynamic = 'force-dynamic';

export default async function Verifier({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  if (code && /^[A-Za-z2-7]{26}$/.test(code.trim())) redirect('/verifier/' + code.trim().toUpperCase());
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Vérifier un document</h1>
        <p>Saisissez le code de vérification imprimé sous le QR code d’une attestation, d’un diplôme d’établissement ou d’un badge. Le registre n’affiche que le
          strict nécessaire : type, établissement, numéro, date et validité.</p>
        {code && <p className="studio-notice" role="alert">Code invalide : 26 caractères (lettres A à Z, chiffres 2 à 7).</p>}
        <form method="get" action="/verifier" className="studio-inline">
          <label>Code de vérification<input name="code" required maxLength={26} autoComplete="off" /></label>
          <button className="action" type="submit">Vérifier</button>
        </form>
      </section>
    </main>
  );
}
