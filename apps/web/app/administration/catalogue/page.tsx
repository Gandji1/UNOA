import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { catalogContexts } from '@/lib/catalog/access';
import { versionDetails } from '@/lib/catalog/curriculum';
import { programDetails } from '@/lib/catalog/programs';
import { catalogOverview } from '@/lib/catalog/references';
import { Notice } from '../forms';
import { Overview } from './overview';
import { ProgramView } from './program';
import { VersionView } from './version';

export const metadata: Metadata = { title: 'Catalogue des formations' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const list = (value: Search[string]) => (Array.isArray(value) ? value : value ? [value] : []).filter(item => scopeIdFormat.test(item));

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Catalogue({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const token = (await cookies()).get(cookieName(settings, 'session'))?.value;
  const actor = await sessionAccount(settings, token).catch(() => null);
  if (!actor) redirect('/connexion');

  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const inaccessible = (
    <main id="contenu" className="studio">
      <section className="studio-panel"><h1>Catalogue des formations</h1>{notice}
        <p>Cet élément est inaccessible avec vos habilitations.</p>
        <p><a href="/administration/catalogue">Revenir au catalogue</a></p></section>
    </main>
  );

  const version = field(search.version);
  if (scopeIdFormat.test(version)) {
    const data = await versionDetails(settings, actor, version).catch(refused);
    return data ? <VersionView data={data} actor={actor} notice={notice} choices={list(search.choice)} simulate={search.simuler === '1'} /> : inaccessible;
  }
  const program = field(search.program);
  if (scopeIdFormat.test(program)) {
    const data = await programDetails(settings, actor, program).catch(refused);
    return data ? <ProgramView data={data} actor={actor} notice={notice} /> : inaccessible;
  }
  const contexts = await catalogContexts(settings, actor);
  const requested = field(search.scope);
  const selected = scopeIdFormat.test(requested) ? requested : contexts[0]?.id;
  if (!selected) {
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › Catalogue</nav>
        <section className="studio-heading"><h1>Catalogue des formations</h1>
          <p>Aucun établissement ni aucune composante active ne vous est attribué pour le catalogue.</p></section>
      </main>
    );
  }
  const data = await catalogOverview(settings, actor, selected).catch(refused);
  return data ? <Overview data={data} contexts={contexts} notice={notice} /> : inaccessible;
}
