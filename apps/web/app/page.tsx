import { iamSettings } from '@/lib/iam/settings';
import { publicPrograms } from '@/lib/catalog/public';
import { currentSite } from '@/lib/site/store';
import { SiteMissing } from './site-missing';
import { ProgramCard } from './program-card';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const site = await currentSite();
  if (!site) return <SiteMissing />;
  const programs = await publicPrograms(iamSettings()!, site.site_id).catch(() => []);
  const kinds = [...new Set(programs.map(item => item.kind_label))].sort((a, b) => a.localeCompare(b, site.language));
  return (
    <main id="contenu" className="page">
      <section className="campus-welcome">
        <div className="welcome-copy">
          {site.tagline && <span className="intro-loc">{site.tagline}</span>}
          <h1>{site.hero_title ?? site.name}</h1>
          {site.hero_text && <p>{site.hero_text}</p>}
          <div className="welcome-tools">
            <a className="admit" href="/formations">Consulter les formations</a>
            {kinds.length > 0 && (
              <details className="orient">
                <summary>M’orienter</summary>
                <div className="orient-panel">
                  <img src="/orientation-diplomee.webp" alt="" width="90" height="122" />
                  <div><p>Quel type de formation souhaitez-vous explorer ?</p>
                    <ul>{kinds.map(kind => <li key={kind}><a href={'/formations?nature=' + encodeURIComponent(kind)}>{kind}</a></li>)}</ul></div>
                </div>
              </details>
            )}
          </div>
        </div>
        <div className="hero-photo"><img src={site.hero_image_url ?? '/accueil-diplomee.webp'} alt="" width="378" height="381" /></div>
      </section>

      <section className="panel" aria-labelledby="catalogue-title">
        <div className="panel-top">
          <div><h2 id="catalogue-title">Catalogue des formations</h2>
            <p className="muted">Formations publiées par l’établissement, avec leur statut réglementaire vérifié.</p></div>
          {programs.length > 0 && <a className="secondary" href="/formations">Rechercher et comparer</a>}
        </div>
        {programs.length === 0 ? (
          <p>Les formations diplômantes s’afficheront ici dès leur publication officielle. En attendant, découvrez <a href="/structures">nos facultés et départements</a>.</p>
        ) : (
          <>
            <form method="get" action="/formations" className="filters compact" role="search" aria-label="Rechercher une formation">
              <label className="grow">Recherche<input type="search" name="q" placeholder="Filière, code, structure…" /></label>
              <label>Niveau ou nature<select name="nature" defaultValue=""><option value="">Tous</option>{kinds.map(kind => <option key={kind}>{kind}</option>)}</select></label>
              <button className="action" type="submit">Rechercher</button>
            </form>
            <ul className="program-grid">{programs.slice(0, 6).map(item => <ProgramCard key={item.program_id} item={item} />)}</ul>
          </>
        )}
      </section>
    </main>
  );
}
