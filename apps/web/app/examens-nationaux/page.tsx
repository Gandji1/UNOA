import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { currentSite } from '@/lib/site/store';
import { publicExams } from '@/lib/external/store';

export const metadata: Metadata = { title: 'Examens nationaux' };
export const dynamic = 'force-dynamic';

// Official information only: the authority named on each item organises the
// examination and issues its results and diplomas.
export default async function ExamensNationaux() {
  const settings = iamSettings();
  const site = settings ? await currentSite() : null;
  const exams = settings ? await publicExams(settings, site?.scope_id ?? null).catch(() => []) : [];
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Examens nationaux</h1>
        <p><strong>Ces examens sont organisés par les autorités officielles indiquées.</strong> L’université ne les organise pas, ne calcule
          aucun résultat et ne délivre aucun diplôme d’État. Elle enregistre seulement, à votre demande, votre participation et la copie
          du document officiel que vous déposez, puis en vérifie l’authenticité auprès de l’autorité.</p>
        <p>Les examens et devoirs de vos cours relèvent de l’espace « Mes évaluations » : ce sont des évaluations internes, distinctes des examens nationaux.</p>
        {exams.length === 0 ? <p>Aucune information publiée.</p> : (
          <ul className="program-grid">{exams.map(item => (
            <li key={item.id} className="program-card">
              <p className="eyebrow">Autorité organisatrice : {item.authority}</p>
              <h2>{item.title}</h2>
              <p className="muted">{item.session_label} · information publiée par {item.scope_label}</p>
              <p>{item.description}</p>
              {item.official_url && <p><a href={item.official_url} rel="noopener noreferrer">Source officielle de l’autorité</a></p>}
            </li>
          ))}</ul>
        )}
        <p><a className="action" href="/examens-nationaux/suivi">Déclarer ma participation et déposer un document officiel</a></p>
      </section>
    </main>
  );
}
