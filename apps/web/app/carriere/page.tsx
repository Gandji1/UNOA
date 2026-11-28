import type { Metadata } from 'next';
import { applicationStates, careerSpace, declaredLevels, kindLabels, levelLabels, portfolioKinds } from '@/lib/careers/store';
import { ActionForm, Badge, Editor, Notice, Panel, Table } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Ma carrière' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/car/';
const back = '/carriere';
const resources: Record<string, string> = { profile: 'profil', application: 'candidature', document: 'pièce', cv: 'CV' };
const modes: Record<string, string> = { onsite: 'sur place', online: 'en ligne', phone: 'par téléphone' };
const tones: Record<string, 'ok' | 'info' | 'muted' | 'warn'> = { certified: 'ok', validated: 'ok', assessed: 'info', taught: 'muted', declared: 'warn' };
const when = (value: string | Date) => new Date(value).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });

export default async function Carriere({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await careerSpace(settings, actor);
  const profile = data.profile;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Ma carrière</span></nav>
      <section className="studio-heading"><p className="eyebrow">Carrière</p><h1>Ma carrière</h1>
        <p>Vos compétences prouvées, votre parcours, vos CV et vos candidatures. Rien n’est partagé avec une entreprise sans votre accord.</p></section>
      <Notice error={search.error} message={search.message} />

      {data.suggestions.length > 0 && (
        <Panel title="Offres suggérées" id="suggestions">
          <ul>{data.suggestions.map(item => <li key={item.id}><a href={'/offres?id=' + item.id}>{item.title}</a> — {item.company} ({kindLabels[item.kind]}) <span className="muted">· pourquoi : {item.reasons.join(', ')}</span></li>)}</ul>
        </Panel>
      )}

      <Panel title="Mon profil" id="profil">
        <ActionForm action={api + 'profile'} back={back} submit="Enregistrer le profil">
          <label className="studio-wide">Titre<input name="headline" defaultValue={profile?.headline ?? ''} maxLength={200} placeholder="Étudiant en IA appliquée, à la recherche d’un stage" /></label>
          <label>Pays<input name="country" defaultValue={profile?.country ?? ''} maxLength={100} /></label>
          <label>Langues (fr, en…)<input name="languages" defaultValue={profile?.languages.join(', ') ?? ''} /></label>
          <label>Disponibilité<input name="availability" defaultValue={profile?.availability ?? ''} maxLength={300} /></label>
          <label className="studio-check"><input type="checkbox" name="openToOffers" defaultChecked={profile?.open_to_offers} /> Ouvert aux offres</label>
          <label className="studio-wide">Présentation<textarea name="summary" defaultValue={profile?.summary ?? ''} rows={4} maxLength={4000} /></label>
        </ActionForm>
      </Panel>

      <Panel title="Mes compétences" id="competences">
        <p className="muted">Niveaux établis par la plateforme à partir de preuves : enseignée, évaluée, validée (crédits du jury), certifiée (document délivré). Une compétence déclarée n’a pas valeur de diplôme.</p>
        {data.skills.length === 0 ? <p>Aucune compétence attestée pour le moment.</p> : (
          <Table label="Compétences attestées" head={['Compétence', 'Niveau', 'Preuve']}>
            {data.skills.map(skill => <tr key={skill.competency_id}><td>{skill.label}</td><td><Badge tone={tones[skill.level]}>{levelLabels[skill.level]}</Badge></td><td>{skill.evidence}</td></tr>)}
          </Table>
        )}
        {data.declared.length > 0 && <ul>{data.declared.map(skill => <li key={skill.id}>{skill.label} — {declaredLevels[skill.level]} <Badge tone="warn">déclarée</Badge>
          <ActionForm inline action={api + 'undeclare'} back={back} hidden={{ skillId: skill.id }} submit="Retirer" /></li>)}</ul>}
        <Editor summary="Déclarer une compétence">
          <ActionForm action={api + 'declare'} back={back} submit="Ajouter">
            <label>Du référentiel<select name="competencyId" defaultValue=""><option value="">—</option>{data.competencies.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label>Ou libre<input name="label" maxLength={200} /></label>
            <label>Niveau<select name="level">{Object.entries(declaredLevels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          </ActionForm>
        </Editor>
      </Panel>

      <Panel title="Parcours et réalisations" id="portfolio">
        {data.portfolio.length === 0 ? <p>Aucun élément.</p> : data.portfolio.map(item => (
          <div key={item.id} className="studio-panel">
            <h3>{portfolioKinds[item.kind]} — {item.title}{item.organisation ? ', ' + item.organisation : ''} {item.verified ? <Badge tone="ok">vérifié</Badge> : <Badge tone="warn">non vérifié</Badge>} {item.shared ? <Badge tone="info">partagé</Badge> : <Badge tone="muted">privé</Badge>}</h3>
            {(item.starts_on || item.ends_on) && <p className="muted">{item.starts_on ?? '…'} → {item.ends_on ?? 'en cours'}</p>}
            {item.description && <p>{item.description}</p>}
            <div className="studio-actions">
              <ActionForm inline action={api + 'portfolio-share'} back={back} hidden={{ itemId: item.id, shared: item.shared ? '' : 'on' }} submit={item.shared ? 'Rendre privé' : 'Partager avec les entreprises autorisées'} />
              <ActionForm inline action={api + 'portfolio-remove'} back={back} hidden={{ itemId: item.id }} submit="Supprimer" confirm="L’élément sera retiré de votre portfolio." />
            </div>
          </div>
        ))}
        <Editor summary="Ajouter un élément">
          <ActionForm action={api + 'portfolio'} back={back} submit="Ajouter">
            <label>Nature<select name="kind">{Object.entries(portfolioKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Intitulé<input name="title" required maxLength={300} /></label>
            <label>Organisation<input name="organisation" maxLength={300} /></label>
            <label>Début<input type="date" name="startsOn" /></label>
            <label>Fin<input type="date" name="endsOn" /></label>
            <label>Lien<input name="url" type="url" placeholder="https://" /></label>
            <label className="studio-check"><input type="checkbox" name="shared" /> Partager avec les entreprises autorisées</label>
            <label className="studio-wide">Description<textarea name="description" rows={3} maxLength={4000} /></label>
          </ActionForm>
        </Editor>
      </Panel>

      <Panel title="Mes CV" id="cv">
        {data.cvs.length === 0 ? <p>Aucun CV généré.</p> : <ul>{data.cvs.map(cv => <li key={cv.id}><a href={api + 'cvs/' + cv.id}>{cv.title} — version {cv.version} (PDF)</a> <span className="muted">{when(cv.created_at)}</span></li>)}</ul>}
        <ActionForm inline action={api + 'cv'} back={back} submit="Générer un CV à partir de mon profil">
          <label>Intitulé<input name="title" required maxLength={200} defaultValue="CV" /></label>
        </ActionForm>
        <p><a href={api + 'export'}>Exporter toutes mes données carrière (JSON)</a></p>
      </Panel>

      <Panel title="Mes candidatures" id="candidatures">
        {data.applications.length === 0 ? <p>Aucune candidature. <a href="/offres">Voir les offres</a></p> : data.applications.map(item => (
          <div key={item.id} className="studio-panel">
            <h3>{item.title} — {item.company} <Badge tone={item.state === 'offer' ? 'ok' : item.state === 'rejected' || item.state === 'withdrawn' ? 'muted' : 'info'}>{applicationStates[item.state]}</Badge></h3>
            <p className="muted">{item.events.map(event => `${applicationStates[event.state]} le ${when(event.at)}${event.note ? ' (' + event.note + ')' : ''}`).join(' → ')}</p>
            {item.interviews.map(interview => <p key={interview.id}>Entretien {modes[interview.mode]} le {when(interview.starts_at)}{interview.place ? ' — ' + interview.place : ''} · {interview.state === 'proposed' ? 'à confirmer' : interview.state === 'confirmed' ? 'confirmé' : 'annulé'}
              {interview.state === 'proposed' && <ActionForm inline action={api + 'confirm-interview'} back={back} hidden={{ interviewId: interview.id }} submit="Confirmer" />}</p>)}
            {!['withdrawn', 'rejected'].includes(item.state) && <ActionForm inline action={api + 'withdraw'} back={back} hidden={{ applicationId: item.id }} submit="Retirer ma candidature" confirm="Vos pièces et l’instantané de votre profil seront effacés." />}
          </div>
        ))}
      </Panel>

      <Panel title="Favoris et alertes" id="alertes">
        {data.favorites.length > 0 && <ul>{data.favorites.map(item => <li key={item.id}><a href={'/offres?id=' + item.id}>{item.title}</a> — {item.company}</li>)}</ul>}
        {data.alerts.length === 0 ? <p>Aucune alerte.</p> : <ul>{data.alerts.map(item => <li key={item.id}>{item.label} <span className="muted">({[item.kind && kindLabels[item.kind], item.country, item.language, item.keywords].filter(Boolean).join(' · ') || 'toutes les offres'})</span>
          <ActionForm inline action={api + 'alert-remove'} back={back} hidden={{ alertId: item.id }} submit="Supprimer" /></li>)}</ul>}
        <Editor summary="Créer une alerte (vous serez prévenu des nouvelles offres)">
          <ActionForm action={api + 'alert'} back={back} submit="Créer l’alerte">
            <label>Nom<input name="label" required maxLength={200} /></label>
            <label>Nature<select name="kind" defaultValue=""><option value="">Toutes</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label>Pays<input name="country" maxLength={100} /></label>
            <label>Langue<input name="language" maxLength={3} placeholder="fr" /></label>
            <label>Mots-clés<input name="keywords" maxLength={200} /></label>
          </ActionForm>
        </Editor>
      </Panel>

      <Panel title="Partage avec les entreprises" id="partage">
        <p className="muted">Une entreprise ne voit votre profil que si vous l’y autorisez. Vous pouvez révoquer à tout moment ; chaque consultation est enregistrée ci-dessous.</p>
        {data.consents.length > 0 && <ul>{data.consents.map(item => <li key={item.id}>{item.company} — accordé le {when(item.granted_at)}{item.revoked_at ? `, révoqué le ${when(item.revoked_at)}` : ''}
          {!item.revoked_at && <ActionForm inline action={api + 'revoke'} back={back} hidden={{ consentId: item.id }} submit="Révoquer" />}</li>)}</ul>}
        {data.companies.length > 0 && (
          <ActionForm inline action={api + 'consent'} back={back} submit="Autoriser">
            <label>Entreprise<select name="companyId">{data.companies.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="studio-check"><input type="checkbox" name="agree" required /> J’autorise cette entreprise à consulter mon profil carrière jusqu’à révocation</label>
          </ActionForm>
        )}
        <h3>Consultations de mes données</h3>
        {data.access.length === 0 ? <p>Aucune consultation.</p> : <ul>{data.access.map((row, index) => <li key={index}>{when(row.created_at)} — {row.recruiter} ({row.company}) a consulté : {resources[row.resource]}</li>)}</ul>}
      </Panel>
    </main>
  );
}
