import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { publicCompanies } from '@/lib/companies/store';
import { currentSite } from '@/lib/site/store';

export const metadata: Metadata = { title: 'Entreprises partenaires' };
export const dynamic = 'force-dynamic';

export default async function Entreprises() {
  const site = await currentSite();
  const settings = iamSettings();
  const companies = settings ? await publicCompanies(settings, site?.scope_id ?? null).catch(() => []) : [];
  return (
    <main id="contenu" className="page">
      <section className="panel">
        <div className="panel-top">
          <div><h1>Entreprises partenaires</h1>
            <p className="muted">Entreprises vérifiées par l’établissement, qui accueillent des stagiaires.</p></div>
          <a className="secondary" href="/entreprises/inscription">Inscrire mon entreprise</a>
        </div>
        {companies.length === 0 ? <p>Aucune entreprise partenaire n’est encore publiée.</p> : (
          <ul className="program-grid">
            {companies.map(item => (
              <li key={item.id} className="program-card">
                <h2>{item.name}</h2>
                <p className="muted">{[item.sector, item.city].filter(Boolean).join(' · ')}</p>
                {item.description && <p>{item.description.slice(0, 280)}</p>}
                {item.website && <p><a href={item.website} rel="noopener noreferrer">Site de l’entreprise</a></p>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
