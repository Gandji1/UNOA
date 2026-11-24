import { majorityLabels } from '@unoa/domain/governance';
import type { meetingDetails } from '@/lib/governance/store';
import { ActionForm, Badge, Editor, formatTime, Panel, Table } from '../forms';

// One meeting, for the secretary (convocation, attendance, votes, minutes) and
// for the members (agenda, conflicts, votes, appeals). The API checks every act.
type Data = Awaited<ReturnType<typeof meetingDetails>>;

export const meetingStates: Record<string, [string, 'ok' | 'warn' | 'muted' | 'info']> = {
  draft: ['Préparation', 'warn'], convened: ['Convoquée', 'info'], opened: ['En séance', 'ok'], closed: ['Close', 'muted'], archived: ['Archivée', 'muted'],
};
const outcomes: Record<string, string> = { adopted: 'Adoptée', rejected: 'Rejetée', noted: 'Prise d’acte' };
const offices: Record<string, string> = { chair: 'Président', secretary: 'Secrétaire', member: 'Membre', guest: 'Invité' };

export function MeetingView({ data, back }: { data: Data; back: string }) {
  const { meeting, council, rights, member } = data;
  const api = '/api/v1/gov/';
  const hidden = { meetingId: meeting.id };
  const secretary = !!rights?.secretary;
  const live = data.items.filter(item => item.withdrawn_in_version === null);
  return (
    <>
      <section className="studio-heading"><p className="eyebrow">{council.name} · {council.kind}</p><h1>{meeting.title}</h1>
        <p><Badge tone={meetingStates[meeting.state][1]}>{meetingStates[meeting.state][0]}</Badge>
          <span className="muted"> {formatTime(meeting.scheduled_at)} · {meeting.place} · ordre du jour v{meeting.agenda_version}</span></p>
        <p className="muted">Quorum : {data.quorum.present} présent(s) sur {data.quorum.in_office} membres votants, {data.quorum.required} requis ({council.quorum_percent} %) —{' '}
          {data.quorum.reached ? <Badge tone="ok">atteint</Badge> : <Badge tone="warn">non atteint</Badge>} · {majorityLabels[council.majority]}</p></section>

      {secretary && (
        <div className="studio-actions">
          {meeting.state === 'draft' && <ActionForm inline action={api + 'convene'} back={back} hidden={hidden} submit="Envoyer la convocation" />}
          {meeting.state === 'convened' && <ActionForm inline action={api + 'open'} back={back} hidden={hidden} submit="Ouvrir la séance (contrôle du quorum)" />}
          {meeting.state === 'opened' && <ActionForm inline action={api + 'close-meeting'} back={back} hidden={hidden} submit="Clore la séance" />}
          {meeting.state === 'closed' && data.minutes?.signed_at && <ActionForm inline action={api + 'archive'} back={back} hidden={hidden} submit="Archiver la séance" />}
        </div>
      )}

      <Panel title="Ordre du jour" id="ordre-du-jour">
        {data.items.length === 0 ? <p>Aucun point.</p> : (
          <ol className="setup-steps">{data.items.map(item => {
            const decision = data.decisions.find(entry => entry.item_id === item.id);
            return (
              <li key={item.id} className={item.withdrawn_in_version ? 'muted' : undefined}>
                <strong>{item.title}</strong> <Badge tone="muted">{item.kind === 'vote' ? 'Délibération' : 'Information'}</Badge>
                {item.withdrawn_in_version && <Badge tone="muted">retiré (v{item.withdrawn_in_version})</Badge>}
                {item.added_in_version > 1 && <Badge tone="info">ajouté en v{item.added_in_version}</Badge>}
                {item.description && <p className="muted">{item.description}</p>}
                {item.kind === 'vote' && item.vote_state !== 'pending' && <p>Pour {item.votes_for} · Contre {item.votes_against} · Abstention {item.votes_abstain}
                  {item.conflicts > 0 && ` · ${item.conflicts} conflit(s) d’intérêts déclaré(s)`}</p>}
                {decision && <p><Badge tone={decision.outcome === 'rejected' ? 'danger' : 'ok'}>{outcomes[decision.outcome]}</Badge> {decision.text}
                  {decision.effective_on && ` · effet le ${decision.effective_on}`}{decision.published_at && <Badge tone="info">publiée</Badge>}</p>}
                <div className="studio-actions">
                  {secretary && ['draft', 'convened'].includes(meeting.state) && !item.withdrawn_in_version &&
                    <ActionForm inline action={api + 'withdraw-item'} back={back} hidden={{ ...hidden, itemId: item.id }} submit="Retirer le point" />}
                  {secretary && meeting.state === 'opened' && item.kind === 'vote' && item.vote_state === 'pending' && !item.withdrawn_in_version &&
                    <ActionForm inline action={api + 'open-vote'} back={back} hidden={{ ...hidden, itemId: item.id }} submit="Ouvrir le vote" />}
                  {secretary && meeting.state === 'opened' && !decision && !item.withdrawn_in_version && (item.kind === 'information' || item.vote_state === 'open') && (
                    <ActionForm inline action={api + 'close-item'} back={back} hidden={{ ...hidden, itemId: item.id }} submit={item.kind === 'vote' ? 'Clore le vote et enregistrer la décision' : 'Prendre acte'}>
                      <input name="text" maxLength={4000} placeholder="Texte de la décision" aria-label={'Texte de la décision : ' + item.title} />
                      <input name="effectiveOn" type="date" aria-label="Date d’effet" />
                    </ActionForm>
                  )}
                  {member?.voting && meeting.state === 'opened' && item.vote_state === 'open' && !item.my_vote && !item.my_conflict && (['for', 'against', 'abstain'] as const).map(choice => (
                    <ActionForm key={choice} inline action={api + 'vote'} back={back} hidden={{ ...hidden, itemId: item.id, choice }}
                      submit={choice === 'for' ? 'Voter pour' : choice === 'against' ? 'Voter contre' : 'S’abstenir'} />
                  ))}
                  {item.my_vote && <Badge tone="info">Votre vote : {item.my_vote === 'for' ? 'pour' : item.my_vote === 'against' ? 'contre' : 'abstention'}</Badge>}
                  {item.my_conflict && <Badge tone="warn">Conflit d’intérêts déclaré : vous ne votez pas</Badge>}
                  {member && item.kind === 'vote' && !item.my_vote && !item.my_conflict && item.vote_state !== 'closed' && ['convened', 'opened'].includes(meeting.state) && (
                    <ActionForm inline action={api + 'conflict'} back={back} hidden={{ ...hidden, itemId: item.id }} submit="Déclarer un conflit d’intérêts">
                      <input name="reason" required maxLength={1000} placeholder="Motif" aria-label={'Motif du conflit : ' + item.title} />
                    </ActionForm>
                  )}
                  {decision && member && !data.appeals.some(appeal => appeal.decision_id === decision.id && appeal.state === 'submitted') && (
                    <ActionForm inline action={api + 'appeal'} back={back} hidden={{ ...hidden, decisionId: decision.id }} submit="Contester la décision">
                      <input name="reason" required maxLength={4000} placeholder="Motif du recours" aria-label="Motif du recours" />
                    </ActionForm>
                  )}
                  {decision && rights?.publish && !decision.published_at && data.minutes?.signed_at && (
                    <ActionForm inline action={api + 'publish'} back={back} hidden={{ ...hidden, decisionId: decision.id }} submit="Publier sur le site">
                      <input name="summary" required maxLength={2000} placeholder="Résumé public" aria-label="Résumé public" defaultValue={decision.text} />
                    </ActionForm>
                  )}
                </div>
              </li>
            );
          })}</ol>
        )}
        {secretary && ['draft', 'convened'].includes(meeting.state) && (
          <Editor summary="Ajouter un point à l’ordre du jour">
            <ActionForm action={api + 'items'} back={back} hidden={hidden} submit="Ajouter" confirm={meeting.state === 'convened' ? 'La séance est convoquée : l’ajout crée une nouvelle version de l’ordre du jour, notifiée aux membres.' : undefined}>
              <label className="studio-wide">Point<input name="title" required maxLength={300} /></label>
              <label>Nature<select name="kind"><option value="vote">Délibération (vote)</option><option value="information">Information</option></select></label>
              <label className="studio-wide">Exposé<textarea name="description" maxLength={4000} /></label>
            </ActionForm>
          </Editor>
        )}
        {live.length === 0 && meeting.state === 'draft' && <p className="muted">Ajoutez au moins un point avant de convoquer.</p>}
      </Panel>

      <Panel title="Présences" id="presences">
        <Table label="Présences" head={['Membre', 'Fonction', 'Vote', 'Présence', '']}>
          {data.attendance.map(row => (
            <tr key={row.member_id}><td>{row.name ?? '—'}</td><td>{offices[row.office]}</td><td>{row.voting ? 'Oui' : 'Non'}</td>
              <td>{row.present === null ? '—' : row.present ? 'Présent' : 'Absent'}</td>
              <td>{secretary && ['convened', 'opened'].includes(meeting.state) && (
                <ActionForm inline action={api + 'attendance'} back={back} hidden={{ ...hidden, memberId: row.member_id, present: row.present ? 'false' : 'true' }}
                  submit={row.present ? 'Marquer absent' : 'Marquer présent'} />
              )}</td></tr>
          ))}
        </Table>
      </Panel>

      <Panel title="Procès-verbal" id="pv">
        {data.minutes ? <>
          <pre className="minutes">{data.minutes.body}</pre>
          {data.minutes.signed_at ? <p><Badge tone="ok">Signé</Badge> par {data.minutes.signer} le {formatTime(data.minutes.signed_at)} · empreinte <code>{data.minutes.sha256?.slice(0, 16)}…</code></p>
            : <p><Badge tone="warn">Non signé</Badge></p>}
          {!data.minutes.signed_at && data.canSign && <ActionForm inline action={api + 'sign'} back={back} hidden={hidden} submit="Signer le procès-verbal" />}
        </> : <p>{meeting.state === 'closed' ? 'À rédiger par le secrétaire.' : 'Rédigé après la clôture de la séance.'}</p>}
        {secretary && meeting.state === 'closed' && !data.minutes?.signed_at && (
          <Editor summary={data.minutes ? 'Modifier le procès-verbal' : 'Rédiger le procès-verbal'}>
            <ActionForm action={api + 'minutes'} back={back} hidden={hidden} submit="Enregistrer">
              <label className="studio-wide">Texte<textarea name="body" required rows={10} maxLength={60000} defaultValue={data.minutes?.body ?? [
                `${council.name} — ${meeting.title}`, `Séance du ${formatTime(meeting.scheduled_at)}, ${meeting.place}.`,
                `Présents : ${data.attendance.filter(row => row.present).map(row => row.name).join(', ')}.`, '',
                ...data.items.filter(item => !item.withdrawn_in_version).map((item, index) => {
                  const decision = data.decisions.find(entry => entry.item_id === item.id);
                  return `${index + 1}. ${item.title}${decision ? ` — ${outcomes[decision.outcome]} (pour ${decision.votes_for}, contre ${decision.votes_against}, abstention ${decision.votes_abstain}) : ${decision.text}` : ''}`;
                })].join('\n')} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      {(data.documents.length > 0 || secretary) && (
        <Panel title="Documents" id="documents">
          {data.documents.length === 0 ? <p>Aucun document.</p> : <ul>{data.documents.map(item => <li key={item.id}><a href={item.url} rel="noopener noreferrer">{item.title}</a></li>)}</ul>}
          {secretary && <ActionForm inline action={api + 'documents'} back={back} hidden={hidden} submit="Ajouter le lien">
            <input name="title" required maxLength={200} placeholder="Titre" aria-label="Titre du document" />
            <input name="url" type="url" required maxLength={2000} placeholder="https://…" aria-label="Adresse du document" /></ActionForm>}
        </Panel>
      )}

      {data.appeals.length > 0 && (
        <Panel title="Recours" id="recours">
          <ul>{data.appeals.map(appeal => <li key={appeal.id}>{formatTime(appeal.filed_at)} — {appeal.reason} — <strong>{appeal.state === 'submitted' ? 'en attente' : appeal.state === 'granted' ? 'accueilli' : 'rejeté'}</strong>
            {appeal.ruling && ' : ' + appeal.ruling}
            {rights?.publish && appeal.state === 'submitted' && (
              <ActionForm inline action={api + 'rule-appeal'} back={back} hidden={{ ...hidden, appealId: appeal.id }} submit="Statuer">
                <select name="ruling" aria-label="Décision sur le recours"><option value="upheld">Maintenir</option><option value="granted">Accueillir</option></select>
                <input name="note" required maxLength={2000} placeholder="Motif" aria-label="Motif de la décision sur le recours" />
              </ActionForm>
            )}</li>)}</ul>
        </Panel>
      )}
    </>
  );
}
