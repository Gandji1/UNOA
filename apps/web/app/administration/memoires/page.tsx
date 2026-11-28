import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { levelLabels, projectStates, thesisContexts, thesisOverview } from '@/lib/theses/store';
import { ActionForm, Badge, Editor, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Mémoires et thèses' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/memoires';
const api = '/api/v1/thesis/';
const topicStates: Record<string, string> = { proposed: 'À valider', open: 'Ouvert', taken: 'Attribué', closed: 'Fermé' };

export default async function MemoiresAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await thesisOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>Mémoires et thèses</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">Mémoires et thèses</span>}</nav>;
  if (!data) {
    const scopes = await thesisContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Mémoires et thèses</h1><p>Choisissez un établissement ou une composante.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const can = data.rights;
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Recherche</p><h1>Mémoires et thèses — {data.scope.label}</h1>
        <p>Règlement des soutenances par niveau, catalogue de sujets, validation des projets, encadrement, jurys et archives.</p></section>
      {notice}
      <Panel title="Règlement des soutenances" id="reglement">
        {data.rules.length === 0 ? <p>Aucun règlement : définissez-en un par niveau avant de planifier une soutenance.</p> : (
          <Table label="Règlements" head={['Niveau', 'Portée', 'Jury', 'Rapporteurs', 'Extérieur', 'Similarité', 'Embargo', 'Convocation', 'Doctorat', 'Effet']}>
            {data.rules.map(rule => <tr key={rule.id}><td>{levelLabels[rule.level]}</td><td>{rule.scope}</td><td>{rule.min_jury}</td><td>{rule.rapporteurs}</td><td>{rule.external_member ? 'requis' : 'non'}</td>
              <td>≥ {rule.similarity_threshold} %</td><td>{rule.max_embargo_years} an(s)</td><td>{rule.notice_days} j</td>
              <td>{rule.level === 'doctorat' ? `${rule.max_years ?? '—'} an(s), ${rule.training_hours ?? 0} h, éthique ${rule.ethics_required ? 'requise' : 'selon projet'}` : '—'}</td><td>{rule.effective_from}</td></tr>)}
          </Table>
        )}
        {can.manage && (
          <Editor summary="Nouveau règlement (version datée)">
            <ActionForm action={api + 'rules'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer">
              <label>Niveau<select name="level">{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Membres du jury (minimum)<input name="minJury" required inputMode="numeric" /></label>
              <label>Rapporteurs<input name="rapporteurs" inputMode="numeric" defaultValue="0" /></label>
              <label className="studio-check"><input type="checkbox" name="externalMember" /> Membre extérieur requis</label>
              <label>Seuil de similarité suspect (%)<input name="similarityThreshold" required inputMode="numeric" /></label>
              <label>Embargo maximal (années)<input name="maxEmbargoYears" inputMode="numeric" defaultValue="0" /></label>
              <label>Délai de convocation (jours)<input name="noticeDays" inputMode="numeric" defaultValue="0" /></label>
              <label>Doctorat : durée maximale (années)<input name="maxYears" inputMode="numeric" /></label>
              <label>Doctorat : heures de formation requises<input name="trainingHours" inputMode="numeric" /></label>
              <label className="studio-check"><input type="checkbox" name="ethicsRequired" /> Avis éthique toujours requis</label>
              <label>Date d’effet<input type="date" name="effectiveFrom" required /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>
      <Panel title="Sujets" id="sujets">
        {data.topics.length === 0 ? <p>Aucun sujet.</p> : (
          <Table label="Sujets" head={['Sujet', 'Niveau', 'Proposé par', 'État', '']}>
            {data.topics.map(topic => <tr key={topic.id}><td>{topic.title}</td><td>{levelLabels[topic.level]}</td><td>{topic.name}</td><td>{topicStates[topic.state]}</td>
              <td>{can.validate && topic.state === 'proposed' && topic.proposed_by !== actor && <div className="studio-actions">
                <ActionForm inline action={api + 'validate-topic'} back={back} hidden={{ topicId: topic.id, decision: 'open' }} submit="Ouvrir" />
                <ActionForm inline action={api + 'validate-topic'} back={back} hidden={{ topicId: topic.id, decision: 'closed' }} submit="Refuser" /></div>}</td></tr>)}
          </Table>
        )}
        <Editor summary="Proposer un sujet">
          <ActionForm action={api + 'topics'} back={back} hidden={{ scopeId: data.scope.id }} submit="Proposer">
            <label>Niveau<select name="level">{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="studio-wide">Sujet<input name="title" required maxLength={300} /></label>
            <label className="studio-wide">Présentation<textarea name="summary" required maxLength={6000} /></label>
          </ActionForm>
        </Editor>
      </Panel>
      <Panel title="Projets" id="projets">
        {data.projects.length === 0 ? <p>Aucun projet.</p> : (
          <Table label="Projets" head={['Titre', 'Auteur', 'Niveau', 'Directeur', 'État']}>
            {data.projects.map(item => <tr key={item.id}><td><a href={`/memoires/projet?id=${item.id}`}>{item.title}</a>{item.confidential && <> <Badge tone="muted">confidentiel</Badge></>}</td>
              <td>{item.author}</td><td>{levelLabels[item.level]}</td><td>{item.director ?? <Badge tone="warn">à désigner</Badge>}</td><td>{projectStates[item.state]}</td></tr>)}
          </Table>
        )}
      </Panel>
    </main>
  );
}
