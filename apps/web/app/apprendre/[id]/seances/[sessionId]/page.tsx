import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatInZone } from '@unoa/domain/time';
import { scopeIdFormat } from '@/lib/iam/settings';
import { sessionRoster } from '@/lib/live/store';
import { ActionForm, formatTime, Notice, shortId, Table } from '../../../../administration/forms';
import { learner, refusedAs, roleLabels } from '../../../session';

export const metadata: Metadata = { title: 'Présences · UNOA' };
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; sessionId: string }>; searchParams: Promise<{ error?: string; message?: string }> };
const statusLabels: Record<string, string> = { present: 'Présent', absent: 'Absent', excused: 'Excusé' };
const eventLabels: Record<string, string> = {
  scheduled: 'Planifiée', rescheduled: 'Reportée', cancelled: 'Annulée', recording_announced: 'Enregistrement annoncé', replay_published: 'Replay publié',
};

export default async function Roster({ params, searchParams }: Props) {
  const { id, sessionId } = await params;
  if (!scopeIdFormat.test(id) || !scopeIdFormat.test(sessionId)) notFound();
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await sessionRoster(settings, actor, sessionId).catch(refusedAs(null));
  if (!data) return <main id="contenu" className="studio"><section className="studio-panel"><h1>Présences</h1><p>Accès réservé à l’équipe enseignante.</p></section></main>;
  const { session, offering, attendance, events, consents } = data;
  const back = `/apprendre/${offering.id}/seances/${session.id}`;
  const started = new Date(session.starts_at).getTime() <= Date.now();
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/apprendre">Mes cours</a> › <a href={`/apprendre/${offering.id}`}>{offering.title}</a> › Présences</nav>
      <section className="studio-heading"><h1>{session.title}</h1><p>{formatInZone(session.starts_at, offering.time_zone)}</p></section>
      <Notice error={search.error} message={search.message} />
      <section className="studio-panel">
        <h2>Présences</h2>
        <p className="studio-help">Seuls le premier accès et le nombre de connexions sont conservés ; aucun suivi continu de l’activité.</p>
        <Table label="Présences" head={['Participant', 'Rôle', 'Premier accès', 'Connexions', 'Pointage']}>
          {attendance.map(row => (
            <tr key={row.account_id + row.role}>
              <td>{row.display_name ?? 'Compte ' + shortId(row.account_id)}</td><td>{roleLabels[row.role]}</td>
              <td>{row.first_joined_at ? formatTime(row.first_joined_at) : '—'}</td><td>{row.joins ?? 0}</td>
              <td>{started ? (
                <ActionForm inline action={`/api/v1/live/sessions/${session.id}/attendance`} back={back} hidden={{ accountId: row.account_id }} submit="Pointer">
                  <label className="sr" htmlFor={'status-' + row.account_id + row.role}>Statut</label>
                  <select id={'status-' + row.account_id + row.role} name="status" defaultValue={row.status ?? 'present'}>
                    {Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </ActionForm>
              ) : (row.status ? statusLabels[row.status] : 'Après le début')}</td>
            </tr>
          ))}
        </Table>
        {session.recording_planned && <p>Consentements : {consents.map(item => `${item.decision === 'granted' ? 'acceptés' : 'refusés'} ${item.total}`).join(' · ') || 'aucun'}</p>}
      </section>
      <section className="studio-panel"><h2>Historique</h2>
        <ul>{events.map((item, index) => <li key={index}>{eventLabels[item.kind]} · {formatTime(item.occurred_at)}{item.detail ? ' · ' + item.detail : ''}</li>)}</ul>
      </section>
    </main>
  );
}
