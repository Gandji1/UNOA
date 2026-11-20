import type { Metadata } from 'next';
import { myApplications } from '@/lib/admissions/store';
import { Badge, formatTime, Notice } from '../administration/forms';
import { learner } from '../apprendre/session';
import { applicationStates, decisionLabels } from './labels';

export const metadata: Metadata = { title: 'Mes candidatures' };
export const dynamic = 'force-dynamic';

export default async function Candidatures({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const items = await myApplications(settings, actor);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes candidatures</span></nav>
      <section className="studio-heading"><p className="eyebrow">Espace candidat</p><h1>Mes candidatures</h1>
        <p>Dossiers, pièces, accusés de réception, demandes de complément, décisions et recours.</p></section>
      <Notice error={search.error} message={search.message} />
      {items.length === 0 ? <p className="card-note">Aucune candidature. Choisissez une formation dans le <a href="/formations">catalogue</a>.</p> : (
        <ul className="program-grid">
          {items.map(item => (
            <li key={item.id} className="program-card">
              <p className="eyebrow">{item.label}</p>
              <h2><a href={`/candidature/${item.id}`}>{item.program_title}</a></h2>
              <p><Badge tone={applicationStates[item.state][1]}>{applicationStates[item.state][0]}</Badge>
                {item.decision && <Badge tone="info">{decisionLabels[item.decision]}</Badge>}</p>
              <p className="muted">{item.receipt ? 'Accusé ' + item.receipt : 'Clôture le ' + formatTime(item.closes_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
