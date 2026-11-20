import { iamSettings } from '@/lib/iam/settings';
import { publicPrograms } from '@/lib/catalog/store';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const settings = iamSettings();
  const programs = settings ? await publicPrograms(settings).catch(() => []) : [];
  return (
    <main id="contenu">
      <section className="welcome">
        <div>
          <p className="eyebrow">Université numérique ouest-africaine</p>
          <h1>Le campus numérique</h1>
          <p>Formations, cours en ligne, classes virtuelles et services universitaires, accessibles depuis un téléphone comme depuis un poste de travail.</p>
          <p className="hero-actions"><a className="action" href="/formations">Consulter les formations</a>
            <a className="secondary on-dark" href="/structures">Découvrir les structures</a></p>
        </div>
        <img src="/campus.webp" alt="" width="950" height="520" />
      </section>
      <section id="formations" aria-labelledby="formations-title">
        <div className="section-head"><h2 id="formations-title">Formations</h2>{programs.length > 0 && <a href="/formations">Tout le catalogue</a>}</div>
        {programs.length === 0 ? (
          <p>Le catalogue ouvrira après la publication des premières formations par l’université.</p>
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
