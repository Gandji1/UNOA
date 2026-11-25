import type { Metadata } from 'next';
import { iamSettings } from '@/lib/iam/settings';
import { currentSite } from '@/lib/site/store';
import { modalityLabels, publicCatalogue } from '@/lib/short/store';
import { ActionForm } from '../administration/forms';

export const metadata: Metadata = { title: 'Formations courtes' };
export const dynamic = 'force-dynamic';

export default async function FormationsCourtes({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const settings = iamSettings();
  const site = settings ? await currentSite() : null;
  const courses = settings ? await publicCatalogue(settings, site?.scope_id ?? null).catch(() => []) : [];
  const search = await searchParams;
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Formations courtes</h1>
        <p>Formations professionnelles et parcours qualifiants, ouverts à tous et aux salariés d’entreprises clientes. Elles donnent lieu à une attestation
          privée de l’établissement ou à un badge, <strong>jamais à un diplôme d’État</strong>.</p>
        {search.error && <p className="studio-notice" role="alert">Inscription impossible : connectez-vous, ou la session est close, complète ou réservée.</p>}
        {search.message === 'saved' && <p className="studio-notice success" role="status">Inscription enregistrée. Retrouvez-la dans « Mes formations courtes ».</p>}
        {courses.length === 0 ? <p>Aucune formation courte publiée.</p> : courses.map(course => (
          <article key={course.id} className="program-card">
            <p className="eyebrow">{course.scope_label} · {Number(course.duration_hours)} h</p>
            <h2>{course.title}</h2>
            <p>{course.description}</p>
            {course.audience && <p className="muted">Public : {course.audience}</p>}
            {course.competencies.length > 0 && <p>Compétences : {course.competencies.join(', ')}</p>}
            <ul>{course.modules.map((module, index) => <li key={index}>{module.title} ({module.hours} h)</li>)}</ul>
            {course.sessions.length === 0 ? <p className="muted">Aucune session ouverte.</p> : <ul>{course.sessions.map(session => (
              <li key={session.id}>{session.label} — {modalityLabels[session.modality]}, du {session.starts_on} au {session.ends_on} · {session.priceText}
                {session.seats !== null ? ` · ${Math.max(0, session.seats)} place(s)` : ''}
                <ActionForm inline action="/api/v1/short/enrol" back="/formations-courtes" hidden={{ sessionId: session.id }} submit="S’inscrire" /></li>
            ))}</ul>}
          </article>
        ))}
        <p><a href="/formations-courtes/mes">Mes formations courtes</a></p>
      </section>
    </main>
  );
}
