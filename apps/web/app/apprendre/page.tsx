import type { Metadata } from 'next';
import { formatInZone } from '@unoa/domain/time';
import { myOfferings } from '@/lib/lms/offerings';
import { notifications } from '@/lib/notifications/store';
import { ActionForm, Badge, formatTime, Notice } from '../administration/forms';
import { learner, roleLabels } from './session';

export const metadata: Metadata = { title: 'Mes cours · UNOA' };
export const dynamic = 'force-dynamic';

export default async function Apprendre({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const [offerings, inbox] = await Promise.all([myOfferings(settings, actor), notifications(settings, actor)]);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes cours</span></nav>
      <section className="studio-heading"><p className="eyebrow">Apprendre et enseigner</p><h1>Mes cours</h1>
        <p>Leçons, vidéos, activités, séances en visioconférence et discussions de vos promotions.</p></section>
      <Notice error={search.error} message={search.message} />
      {offerings.length === 0 ? <p className="card-note">Vous n’êtes inscrit à aucune offre de cours.</p> : (
        <ul className="program-grid">
          {offerings.map(item => (
            <li key={item.id} className="program-card">
              <p className="eyebrow">{roleLabels[item.role]} · {item.label}</p>
              <h2><a href={`/apprendre/${item.id}`}>{item.title}</a></h2>
              {item.role === 'learner' && item.lessons > 0 && (
                <div className="progress" aria-label={`Progression ${item.progress} sur ${item.lessons}`}>
                  <span className="track"><i style={{ width: `${Math.round(100 * item.progress / item.lessons)}%` }} /></span>
                  {item.progress}/{item.lessons}
                </div>
              )}
              <p className="muted">{item.next_session ? 'Prochaine séance : ' + formatInZone(item.next_session, item.time_zone) : 'Aucune séance planifiée'}</p>
              {item.state !== 'open' && <Badge tone="muted">offre close</Badge>}
            </li>
          ))}
        </ul>
      )}
      <section className="studio-panel" aria-labelledby="notifications">
        <h2 id="notifications">Notifications</h2>
        {inbox.length === 0 ? <p>Aucune notification.</p> : (
          <ul className="inbox">
            {inbox.map(item => (
              <li key={item.id} className={item.read_at ? 'read' : undefined}>
                <strong>{item.link ? <a href={item.link}>{item.title}</a> : item.title}</strong>
                {item.body && <p>{item.body}</p>}
                <span className="muted">{formatTime(item.created_at)}</span>
                {!item.read_at && <ActionForm inline action={`/api/v1/lms/notifications/${item.id}/read`} back="/apprendre" submit="Marquer comme lue" />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
