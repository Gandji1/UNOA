import { iamSettings } from '@/lib/iam/settings';
import { publicPrograms } from '@/lib/catalog/public';
import { currentSite } from '@/lib/site/store';
import { SiteMissing } from './site-missing';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const site = await currentSite();
  if (!site) return <SiteMissing />;
  const settings = iamSettings()!;
  const programs = await publicPrograms(settings, site.site_id).catch(() => []);
  return (
    <main id="contenu">
      <section className="welcome">
        <div>
          {site.tagline && <p className="eyebrow">{site.tagline}</p>}
          <h1>{site.hero_title ?? site.name}</h1>
          {site.hero_text && <p>{site.hero_text}</p>}
          <p className="hero-actions"><a className="action" href="/formations">Consulter les formations</a>
            <a className="secondary on-dark" href="/structures">Découvrir les structures</a></p>
        </div>
        <img src={site.hero_image_url ?? '/campus.webp'} alt="" width="950" height="520" />
      </section>
      <section id="formations" aria-labelledby="formations-title">
        <div className="section-head"><h2 id="formations-title">Formations</h2>{programs.length > 0 && <a href="/formations">Tout le catalogue</a>}</div>
        {programs.length === 0 ? (
          <p>Aucune formation n’est encore publiée.</p>
        ) : (
          <ul className="program-grid">
            {programs.slice(0, 6).map(item => (
              <li key={item.program_id} className="program-card">
                <p className="eyebrow">{item.kind_label}</p>
                <h3><a href={`/formations/${item.program_id}`}>{item.title}</a></h3>
                <p className="muted">{item.owner_label} · {item.duration} · {item.delivery_mode}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
