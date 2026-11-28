import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { phdContexts, phdOverview } from '@/lib/doctorate/store';
import { ActionForm, Badge, Editor, Notice, Panel } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';
import { DoctoralFile } from '../../doctorat/dossier';

export const metadata: Metadata = { title: 'École doctorale' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/doctorat';
const api = '/api/v1/phd/';
const states: Record<string, string> = { submitted: 'En instruction', accepted: 'Admis', rejected: 'Non retenu' };
const funding: Record<string, string> = { none: 'sans', validated: 'validé', refused: 'refusé' };

export default async function DoctoratAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await phdOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>École doctorale</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">École doctorale</span>}</nav>;
  if (!data) {
    const scopes = await phdContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>École doctorale</h1><p>Choisissez un établissement.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun établissement accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const can = data.rights;
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Doctorat</p><h1>École doctorale — {data.scope.label}</h1>
        <p>Écoles et laboratoires, admissions, inscriptions, comités de suivi, formations, éthique et autorisations de soutenance.</p></section>
      {notice}
      <Panel title="Écoles doctorales et laboratoires" id="ecoles">
        {data.schools.length === 0 ? <p>Aucune école doctorale.</p> : data.schools.map(school => (
          <section key={school.id} className="studio-panel"><h3>{school.name}</h3><p className="muted">Direction : {school.director ?? '—'}</p>
            <ul>{data.labs.filter(lab => lab.school_id === school.id).map(lab => <li key={lab.id}>{lab.name} ({lab.code})</li>)}</ul>
            {can.manage && <ActionForm inline action={api + 'labs'} back={back} hidden={{ schoolId: school.id }} submit="Ajouter le laboratoire">
              <label>Code<input name="code" required maxLength={32} /></label><label>Laboratoire<input name="name" required maxLength={200} /></label></ActionForm>}
          </section>
        ))}
        {can.manage && <Editor summary="Nouvelle école doctorale">
          <ActionForm action={api + 'schools'} back={back} hidden={{ scopeId: data.scope.id }} submit="Créer">
            <label>Nom<input name="name" required maxLength={200} /></label>
            <label>Directeur<select name="directorId"><option value="">—</option>{data.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
          </ActionForm>
        </Editor>}
      </Panel>
      <Panel title="Candidatures" id="candidatures">
        {data.applications.length === 0 ? <p>Aucune candidature.</p> : data.applications.map(item => (
          <section key={item.id} className="studio-panel">
            <h3>{item.title} — {item.name} <Badge tone={item.state === 'accepted' ? 'ok' : item.state === 'rejected' ? 'danger' : 'info'}>{states[item.state]}</Badge></h3>
            <p className="muted">Directeur pressenti : {item.director}{item.funding ? ` · financement : ${item.funding} (${funding[item.funding_status]})` : ''}</p>
            <pre className="minutes">{item.dossier}</pre>
            {can.decide && item.state === 'submitted' && item.account_id !== actor && item.proposed_director_id !== actor && (
              <ActionForm action={api + 'decide'} back={back} hidden={{ applicationId: item.id }} submit="Décider">
                <label>Décision<select name="decision"><option value="accepted">Admettre</option><option value="rejected">Ne pas retenir</option></select></label>
                {item.funding && <label>Financement<select name="fundingStatus"><option value="validated">Validé</option><option value="refused">Refusé</option></select></label>}
                <label>Première inscription (AAAA-AAAA)<input name="academicYear" /></label>
                <label className="studio-check"><input type="checkbox" name="ethicsNeeded" /> Avis éthique nécessaire</label>
                <label className="studio-wide">Motivation (obligatoire en cas de refus)<textarea name="note" maxLength={2000} /></label>
              </ActionForm>
            )}
          </section>
        ))}
      </Panel>
      <Panel title="Doctorants" id="doctorants">
        {data.theses.length === 0 ? <p>Aucun doctorant.</p> : data.theses.map(item => (
          <div key={item.project.id}>
            <DoctoralFile item={item} back={back} actor={actor} manage={can.manage} authorize={can.authorize} ethics={can.ethics} />
            {can.manage && <ActionForm inline action={api + 'committee'} back={back} hidden={{ projectId: item.project.id }} submit="Ajouter au comité de suivi">
              <label>Membre<select name="accountId">{data.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label></ActionForm>}
          </div>
        ))}
      </Panel>
    </main>
  );
}
