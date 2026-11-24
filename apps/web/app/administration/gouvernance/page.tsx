import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { majorityLabels } from '@unoa/domain/governance';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { councilDetails, govContexts, govOverview, meetingDetails } from '@/lib/governance/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';
import { MeetingView, meetingStates } from './meeting';

export const metadata: Metadata = { title: 'Conseils et décisions' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/gouvernance';
const api = '/api/v1/gov/';
const offices: Record<string, string> = { chair: 'Président', secretary: 'Secrétaire', member: 'Membre', guest: 'Invité' };

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Gouvernance({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const denied = <main id="contenu" className="studio"><section className="studio-panel"><h1>Conseils et décisions</h1>{notice}<p>Élément inaccessible.</p></section></main>;
  const crumbs = (...parts: [string, string?][]) => <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <a href={path}>Conseils et décisions</a>
    {parts.map(([label, href], index) => <span key={index}> › {href ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}</span>)}</nav>;

  const meetingId = field(search.seance);
  if (scopeIdFormat.test(meetingId)) {
    const data = await meetingDetails(settings, actor, meetingId).catch(refused);
    if (!data) return denied;
    return (
      <main id="contenu" className="studio">
        {crumbs([data.council.name, `${path}?conseil=${data.council.id}`], [data.meeting.title])}
        {notice}
        <MeetingView data={data} back={`${path}?seance=${meetingId}`} />
      </main>
    );
  }

  const councilId = field(search.conseil);
  if (scopeIdFormat.test(councilId)) {
    const data = await councilDetails(settings, actor, councilId).catch(refused);
    if (!data) return denied;
    const { council, rights } = data;
    const back = `${path}?conseil=${council.id}`;
    const active = data.members.filter(item => !item.ends_on || item.ends_on > new Date().toISOString().slice(0, 10));
    return (
      <main id="contenu" className="studio">
        {crumbs([council.scope_label, `${path}?scope=${council.scope_id}`], [council.name])}
        <section className="studio-heading"><p className="eyebrow">{council.kind} · {council.scope_label}</p><h1>{council.name}</h1>
          <p className="muted">Quorum {council.quorum_percent} % · {majorityLabels[council.majority]}</p></section>
        {notice}
        <Panel title="Séances" id="seances">
          {data.meetings.length === 0 ? <p>Aucune séance.</p> : (
            <Table label="Séances" head={['Séance', 'Date', 'Lieu', 'État']}>
              {data.meetings.map(item => <tr key={item.id}><td><a href={`${path}?seance=${item.id}`}>{item.title}</a></td><td>{formatTime(item.scheduled_at)}</td>
                <td>{item.place}</td><td><Badge tone={meetingStates[item.state][1]}>{meetingStates[item.state][0]}</Badge></td></tr>)}
            </Table>
          )}
          {rights?.secretary && (
            <Editor summary="Préparer une séance">
              <ActionForm action={api + 'meetings'} back={back} hidden={{ councilId: council.id }} submit="Créer la séance (brouillon)">
                <label className="studio-wide">Intitulé<input name="title" required maxLength={200} placeholder="ex. Séance ordinaire de rentrée" /></label>
                <label>Date et heure (UTC)<input name="scheduledAt" type="datetime-local" required /></label>
                <label>Lieu ou lien de visioconférence<input name="place" required maxLength={500} /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
        <Panel title="Membres et mandats" id="membres">
          <Table label="Membres" head={['Membre', 'Fonction', 'Vote', 'Mandat', '']}>
            {data.members.map(item => (
              <tr key={item.id}><td>{item.name ?? '—'}</td><td>{offices[item.office]}</td><td>{item.voting ? 'Oui' : 'Non'}</td>
                <td>{item.starts_on} → {item.ends_on ?? 'en cours'}</td>
                <td>{rights?.manage && (!item.ends_on || item.ends_on > new Date().toISOString().slice(0, 10)) && (
                  <ActionForm inline action={api + 'end-member'} back={back} hidden={{ councilId: council.id, memberId: item.id }} submit="Terminer le mandat">
                    <input name="endsOn" type="date" required aria-label={'Fin du mandat de ' + (item.name ?? '')} /></ActionForm>
                )}</td></tr>
            ))}
          </Table>
          {rights?.manage && (
            <Editor summary="Nommer un membre">
              {data.candidates.length === 0 ? <p>Aucun compte dans ce périmètre : invitez d’abord la personne (Utilisateurs et rôles).</p> : (
                <ActionForm action={api + 'members'} back={back} hidden={{ councilId: council.id, voting: 'true' }} submit="Nommer">
                  <label>Personne<select name="accountId">{data.candidates.map(item => <option key={item.id} value={item.id}>{item.display_name ?? item.id.slice(0, 8)}</option>)}</select></label>
                  <label>Fonction<select name="office">{Object.entries(offices).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
                  <label>Début du mandat<input name="startsOn" type="date" required /></label>
                  <label>Fin du mandat (facultative)<input name="endsOn" type="date" /></label>
                </ActionForm>
              )}
            </Editor>
          )}
        </Panel>
        <Panel title="Délégations de signature" id="delegations">
          {data.delegations.length === 0 ? <p>Aucune délégation : le président signe les procès-verbaux.</p> :
            <ul>{data.delegations.map(item => <li key={item.id}>{item.name} — du {item.starts_on} au {item.ends_on} — {item.reason}</li>)}</ul>}
          {rights?.manage && active.length > 0 && (
            <ActionForm inline action={api + 'delegations'} back={back} hidden={{ councilId: council.id }} submit="Déléguer la signature">
              <select name="memberId" aria-label="Délégataire">{active.filter(item => item.voting).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
              <input name="startsOn" type="date" required aria-label="Début" /><input name="endsOn" type="date" required aria-label="Fin" />
              <input name="reason" required maxLength={500} placeholder="Motif" aria-label="Motif de la délégation" />
            </ActionForm>
          )}
        </Panel>
      </main>
    );
  }

  const scopeId = field(search.scope);
  if (scopeIdFormat.test(scopeId)) {
    const data = await govOverview(settings, actor, scopeId).catch(refused);
    if (!data) return denied;
    return (
      <main id="contenu" className="studio">
        {crumbs([data.scope.label])}
        <section className="studio-heading"><p className="eyebrow">Gouvernance</p><h1>Conseils — {data.scope.label}</h1>
          <p>Convocation → ordre du jour → quorum → délibération → procès-verbal signé → publication.</p></section>
        {notice}
        <Panel title="Conseils" id="conseils">
          {data.councils.length === 0 ? <p>Aucun conseil.</p> : (
            <Table label="Conseils" head={['Conseil', 'Nature', 'Périmètre', 'Membres', 'Séances']}>
              {data.councils.map(item => <tr key={item.id}><td><a href={`${path}?conseil=${item.id}`}>{item.name}</a></td><td>{item.kind}</td>
                <td>{item.scope_label}</td><td>{item.members}</td><td>{item.meetings}</td></tr>)}
            </Table>
          )}
        </Panel>
        {data.rights.manage && (
          <Editor summary="Créer un conseil">
            <ActionForm action={api + 'councils'} back={`${path}?scope=${scopeId}`} hidden={{ scopeId }} submit="Créer le conseil">
              <label className="studio-wide">Nom<input name="name" required maxLength={200} placeholder="ex. Conseil de faculté" /></label>
              <label>Nature<input name="kind" required maxLength={120} placeholder="ex. Conseil d’administration, scientifique, pédagogique…" /></label>
              <label>Quorum (%)<input name="quorumPercent" type="number" min={1} max={100} defaultValue={50} required /></label>
              <label>Majorité<select name="majority">{Object.entries(majorityLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            </ActionForm>
          </Editor>
        )}
      </main>
    );
  }

  const scopes = await govContexts(settings, actor);
  return (
    <main id="contenu" className="studio">
      {crumbs()}
      <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Conseils et décisions</h1><p>Choisissez un établissement, une faculté ou un département.</p></section>
      {notice}
      {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : (
        <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>
      )}
    </main>
  );
}
