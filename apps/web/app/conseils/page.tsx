import type { Metadata } from 'next';
import { meetingDetails, myCouncils } from '@/lib/governance/store';
import { scopeIdFormat } from '@/lib/iam/settings';
import { Problem } from '@/lib/shared/validation';
import { Badge, formatTime, Notice } from '../administration/forms';
import { MeetingView } from '../administration/gouvernance/meeting';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mes conseils' };
export const dynamic = 'force-dynamic';

const offices: Record<string, string> = { chair: 'Président', secretary: 'Secrétaire', member: 'Membre', guest: 'Invité' };

export default async function Conseils({ searchParams }: { searchParams: Promise<{ seance?: string; error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={search.error} message={search.message} />;
  if (search.seance && scopeIdFormat.test(search.seance)) {
    const data = await meetingDetails(settings, actor, search.seance).catch(error => { if (error instanceof Problem) return null; throw error; });
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/conseils">Mes conseils</a> › <span aria-current="page">Séance</span></nav>
        {notice}
        {data ? <MeetingView data={data} back={`/conseils?seance=${search.seance}`} /> : <p>Séance inaccessible.</p>}
      </main>
    );
  }
  const councils = await myCouncils(settings, actor);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes conseils</span></nav>
      <section className="studio-heading"><p className="eyebrow">Gouvernance</p><h1>Mes conseils</h1>
        <p>Convocations, ordres du jour, votes, conflits d’intérêts, procès-verbaux et recours des conseils dont vous êtes membre.</p></section>
      {notice}
      {councils.length === 0 ? <p className="card-note">Vous n’êtes membre d’aucun conseil.</p> : (
        <ul className="program-grid">{councils.map(item => (
          <li key={item.council_id} className="program-card"><p className="eyebrow">{item.scope_label} · {offices[item.office]}{item.voting ? '' : ' (sans vote)'}</p>
            <h2>{item.name}</h2>
            {item.next_meeting ? <p><a href={`/conseils?seance=${item.next_meeting}`}>{item.next_title}</a> — {formatTime(item.next_at)}</p> : <p className="muted">Aucune séance convoquée.</p>}
            {item.next_meeting && <Badge tone="info">Convocation</Badge>}
          </li>
        ))}</ul>
      )}
    </main>
  );
}
