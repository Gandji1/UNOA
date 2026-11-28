import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { applicationDetail, applicationStates, documentKinds, kindLabels, levelLabels, recruitingSpace, sharedProfile } from '@/lib/careers/store';
import { ActionForm, Badge, Editor, Notice, Panel, Table } from '../../administration/forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Recrutement' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const api = '/api/v1/car/';
const path = '/entreprise/recrutement';
const offerStates: Record<string, string> = { draft: 'Brouillon', review: 'En revue par l’établissement', published: 'Publiée', suspended: 'Suspendue', closed: 'Close' };
const next: Record<string, [string, string][]> = { submitted: [['shortlisted', 'Présélectionner'], ['rejected', 'Ne pas retenir']], shortlisted: [['rejected', 'Ne pas retenir']], interview: [['offer', 'Faire une proposition'], ['rejected', 'Ne pas retenir']] };
const when = (value: string | Date) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
type Snapshot = { name?: string | null; profile?: { headline?: string | null; summary?: string | null } | null; skills?: { label: string; level: string; evidence: string }[];
  declared?: { label: string; level: string }[]; portfolio?: { title: string; kind: string; status: string }[]; retire?: boolean };

export default async function Recrutement({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const crumbs = (label?: string) => <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/entreprise">Mon entreprise</a> › {label ? <><a href={path}>Recrutement</a> › <span aria-current="page">{label}</span></> : <span aria-current="page">Recrutement</span>}</nav>;
  const applicationId = field(search.application);
  if (scopeIdFormat.test(applicationId)) {
    const data = await applicationDetail(settings, actor, applicationId).catch(refusedAs(null));
    if (data && !data.own) {
      const snapshot = (data.snapshot ?? {}) as Snapshot;
      const back = `${path}?application=${applicationId}`;
      return (
        <main id="contenu" className="studio">{crumbs(data.application.title)}
          <section className="studio-heading"><p className="eyebrow">Candidature</p><h1>{snapshot.name ?? 'Candidature retirée'}</h1>
            <p>{data.application.title} · <Badge tone="info">{applicationStates[data.application.state]}</Badge> · reçue le {data.submitted_at && when(data.submitted_at)}</p></section>
          {notice}
          <p className="muted">Consultation enregistrée et visible par le candidat. Instantané figé à l’envoi (empreinte {data.snapshot_sha256?.slice(0, 12)}…).</p>
          {snapshot.retire ? <p>Le candidat a retiré sa candidature : ses données ont été effacées.</p> : (
            <Panel title="Profil au moment de l’envoi" id="profil">
              {snapshot.profile?.headline && <p><strong>{snapshot.profile.headline}</strong></p>}
              {snapshot.profile?.summary && <p>{snapshot.profile.summary}</p>}
              {snapshot.skills && snapshot.skills.length > 0 && <ul>{snapshot.skills.map(skill => <li key={skill.label}>{skill.label} — {levelLabels[skill.level]} <span className="muted">({skill.evidence})</span></li>)}</ul>}
              {snapshot.declared && snapshot.declared.length > 0 && <p className="muted">Déclarées, non vérifiées : {snapshot.declared.map(skill => skill.label).join(', ')}</p>}
              {snapshot.portfolio && snapshot.portfolio.length > 0 && <ul>{snapshot.portfolio.map(item => <li key={item.title}>{item.title} ({item.status})</li>)}</ul>}
              {data.letter && <><h3>Lettre</h3><p style={{ whiteSpace: 'pre-wrap' }}>{data.letter}</p></>}
              <p>{data.cv_version_id && <a href={api + 'cvs/' + data.cv_version_id}>CV (PDF)</a>} {data.documents.map(doc => <span key={doc.id}> · {doc.purged ? documentKinds[doc.kind] + ' (effacé)' : <a href={api + 'documents/' + doc.id}>{documentKinds[doc.kind]}</a>}</span>)}</p>
            </Panel>
          )}
          <Panel title="Suivi" id="suivi">
            <ul>{data.events.map((event, index) => <li key={index}>{applicationStates[event.state]} — {when(event.created_at)}{event.note ? ' · ' + event.note : ''}</li>)}</ul>
            {(next[data.application.state] ?? []).map(([state, label]) => <ActionForm key={state} inline action={api + 'application-status'} back={back} hidden={{ applicationId, state }} submit={label} />)}
            {data.interviews.map(interview => <p key={interview.id}>Entretien le {when(interview.starts_at)} ({interview.duration_minutes} min) · {interview.state === 'proposed' ? 'proposé' : interview.state === 'confirmed' ? 'confirmé par le candidat' : 'annulé'}
              {interview.state !== 'cancelled' && <ActionForm inline action={api + 'cancel-interview'} back={back} hidden={{ interviewId: interview.id }} submit="Annuler"><input name="reason" required placeholder="Motif" aria-label="Motif" /></ActionForm>}</p>)}
            {['shortlisted', 'interview'].includes(data.application.state) && (
              <Editor summary="Proposer un entretien">
                <ActionForm action={api + 'interviews'} back={back} hidden={{ applicationId }} submit="Proposer">
                  <label>Date et heure (UTC)<input type="datetime-local" name="startsAt" required /></label>
                  <label>Durée (minutes)<input name="durationMinutes" defaultValue="45" inputMode="numeric" /></label>
                  <label>Modalité<select name="mode"><option value="online">En ligne</option><option value="onsite">Sur place</option><option value="phone">Téléphone</option></select></label>
                  <label className="studio-wide">Lieu ou lien<input name="place" maxLength={500} /></label>
                </ActionForm>
              </Editor>
            )}
          </Panel>
        </main>
      );
    }
  }
  const profileId = field(search.profile); const companyParam = field(search.company);
  if (scopeIdFormat.test(profileId) && scopeIdFormat.test(companyParam)) {
    const shared = await sharedProfile(settings, actor, profileId, companyParam).catch(refusedAs(null));
    if (shared) return (
      <main id="contenu" className="studio">{crumbs(shared.name ?? 'Profil')}
        <section className="studio-heading"><p className="eyebrow">Profil partagé avec votre accord</p><h1>{shared.name}</h1>{shared.profile?.headline && <p>{shared.profile.headline}</p>}</section>
        <p className="muted">Consultation enregistrée et visible par la personne.</p>
        <Panel title="Compétences" id="competences"><ul>{shared.skills.map(skill => <li key={skill.competency_id}>{skill.label} — {levelLabels[skill.level]} <span className="muted">({skill.evidence})</span></li>)}</ul>
          {shared.declared.length > 0 && <p className="muted">Déclarées, non vérifiées : {shared.declared.map(skill => skill.label).join(', ')}</p>}</Panel>
        {shared.portfolio.length > 0 && <Panel title="Parcours partagé" id="parcours"><ul>{shared.portfolio.map(item => <li key={item.id}>{item.title}{item.organisation ? ', ' + item.organisation : ''} ({item.status})</li>)}</ul></Panel>}
      </main>
    );
  }
  const data = await recruitingSpace(settings, actor);
  return (
    <main id="contenu" className="studio">{crumbs()}
      <section className="studio-heading"><p className="eyebrow">Entreprise</p><h1>Recrutement</h1><p>Publiez vos offres, suivez les candidatures et organisez les entretiens.</p></section>
      {notice}
      {data.companies.length === 0 && <p className="card-note">Seuls les responsables et recruteurs d’une entreprise approuvée publient des offres.</p>}
      {data.companies.map(company => (
        <section key={company.id} className="studio-panel" aria-labelledby={'r-' + company.id}>
          <h2 id={'r-' + company.id}>{company.name}</h2>
          {company.state === 'approved' && (
            <Editor summary="Publier une offre">
              <ActionForm action={api + 'opportunities'} back={path} hidden={{ companyId: company.id }} submit="Publier">
                <label>Nature<select name="kind">{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="studio-wide">Intitulé<input name="title" required maxLength={300} /></label>
                <label className="studio-wide">Description<textarea name="description" required rows={6} maxLength={10000} /></label>
                <label className="studio-wide">Critères de candidature<textarea name="criteria" rows={3} maxLength={4000} /></label>
                <label>Pays<input name="country" required defaultValue={company.country} maxLength={100} /></label>
                <label>Ville<input name="city" maxLength={200} /></label>
                <label className="studio-check"><input type="checkbox" name="remote" /> Télétravail possible</label>
                <label>Langues (fr, en…)<input name="languages" /></label>
                <label>Début prévu<input type="date" name="startsOn" /></label>
                <label>Clôture des candidatures (UTC)<input type="datetime-local" name="closesAt" required /></label>
                <fieldset className="studio-wide"><legend>Pièces exigées</legend>{Object.entries(documentKinds).map(([value, label]) => <label key={value} className="studio-check"><input type="checkbox" name="requiredDocuments" value={value} defaultChecked={value === 'cv'} /> {label}</label>)}</fieldset>
                {data.competencies.length > 0 && <label className="studio-wide">Compétences recherchées<select name="competencies" multiple size={6}>{data.competencies.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>}
              </ActionForm>
            </Editor>
          )}
          {company.offers.length === 0 ? <p>Aucune offre.</p> : company.offers.map(offer => (
            <div key={offer.id} className="studio-panel">
              <h3><a href={'/offres?id=' + offer.id}>{offer.title}</a> <Badge tone={offer.state === 'published' ? 'ok' : offer.state === 'review' ? 'warn' : 'muted'}>{offerStates[offer.state]}</Badge></h3>
              {offer.risk_flags.length > 0 && <p className="muted">Points vérifiés par l’établissement : {offer.risk_flags.join(', ')}</p>}
              {offer.moderation_note && <p className="muted">Observation : {offer.moderation_note}</p>}
              {offer.applications.length === 0 ? <p>Aucune candidature.</p> : (
                <Table label="Candidatures" head={['Candidat', 'Reçue le', 'Statut']}>
                  {offer.applications.map(item => <tr key={item.id}><td>{item.name ? <a href={`${path}?application=${item.id}`}>{item.name}</a> : 'Candidature retirée'}</td><td>{when(item.submitted_at)}</td><td>{applicationStates[item.state]}</td></tr>)}
                </Table>
              )}
              {offer.state !== 'closed' && <ActionForm inline action={api + 'opportunity-close'} back={path} hidden={{ opportunityId: offer.id }} submit="Clore l’offre" confirm="Plus aucune candidature ne sera reçue." />}
            </div>
          ))}
          {company.consents.length > 0 && <><h3>Profils partagés avec votre entreprise</h3><ul>{company.consents.map(item => <li key={item.account_id}><a href={`${path}?profile=${item.account_id}&company=${company.id}`}>{item.name}</a></li>)}</ul></>}
        </section>
      ))}
    </main>
  );
}
