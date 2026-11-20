import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { readableScopes } from '@/lib/config/store';
import { readableTerritories } from '@/lib/territory/store';
import { orgContexts } from '@/lib/org/store';
import { catalogContexts } from '@/lib/catalog/access';
import { myOfferings } from '@/lib/lms/offerings';
import { siteContexts } from '@/lib/site/store';
import { lmsContexts } from '@/lib/lms/studio';
import { sessionAccount } from '@/lib/iam/sessions';

export const metadata: Metadata = { title: 'Mon espace' };
export const dynamic = 'force-dynamic';

export default async function Espace({ searchParams }: { searchParams: Promise<{ statut?: string }> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const token = (await cookies()).get(cookieName(settings, 'session'))?.value;
  let account: string | null;
  try {
    account = await sessionAccount(settings, token);
  } catch {
    redirect('/connexion?statut=indisponible');
  }
  if (!account) redirect('/connexion');

  const { statut } = await searchParams;
  const [configuration, territories, structures, catalogue] = await Promise.all([
    readableScopes(settings, account).catch(() => []),
    readableTerritories(settings, account).catch(() => []),
    orgContexts(settings, account).catch(() => []),
    catalogContexts(settings, account).catch(() => []),
  ]);
  const [learning, studio, sites] = await Promise.all([
    myOfferings(settings, account).catch(() => []),
    lmsContexts(settings, account).catch(() => []),
    siteContexts(settings, account).catch(() => []),
  ]);
  return (
    <main id="contenu">
      <section className="account-panel">
        <h1>Mon espace</h1>
        {statut === 'indisponible'
          ? <p role="status">La déconnexion a échoué. Réessayez.</p>
          : <p>Votre session institutionnelle est active.</p>}
        {configuration.length > 0 && <p><a href="/administration/parametres">Paramètres et versions</a></p>}
        {territories.length > 0 && <p><a href="/administration/territoires">Territoires et implantations</a></p>}
        {structures.length > 0 && <p><a href="/administration/structures">Structures académiques</a></p>}
        {catalogue.length > 0 && <p><a href="/administration/catalogue">Catalogue des formations</a></p>}
        {studio.length > 0 && <p><a href="/administration/cours">Studio des cours</a></p>}
        {sites.length > 0 && <p><a href="/administration/site">Site public</a></p>}
        <p><a href="/apprendre">Mes cours{learning.length > 0 ? ` (${learning.length})` : ''}</a></p>
        <form action="/api/v1/auth/logout" method="post">
          <button className="action" type="submit">Se déconnecter</button>
        </form>
      </section>
    </main>
  );
}
