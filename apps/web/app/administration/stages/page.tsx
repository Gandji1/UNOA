import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { internshipContexts, internshipsOverview, internshipStates } from '@/lib/internships/store';
import { ActionForm, Badge, Editor, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Stages' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/stages';
const api = '/api/v1/stg/';

export default async function StagesAdmin({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await internshipsOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  const crumbs = <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {data ? <><a href={path}>Stages</a> › <span aria-current="page">{data.scope.label}</span></> : <span aria-current="page">Stages</span>}</nav>;
  if (!data) {
    const scopes = await internshipContexts(settings, actor);
    return (
      <main id="contenu" className="studio">{crumbs}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Stages</h1><p>Choisissez un établissement ou une composante.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const can = data.rights;
  const statistics = data.statistics as { region: string | null; state: string; total: number }[];
  const regions = [...new Set(statistics.map(row => row.region ?? 'Sans territoire'))];
  return (
    <main id="contenu" className="studio">{crumbs}
      <section className="studio-heading"><p className="eyebrow">Stages</p><h1>Stages — {data.scope.label}</h1>
        <p>Modèles de convention, grilles d’évaluation, demandes, conventions et validation académique.</p></section>
      {notice}
      <Panel title="Demandes et stages" id="stages">
        {data.internships.length === 0 ? <p>Aucun stage.</p> : (
          <Table label="Stages" head={['Stage', 'Stagiaire', 'Entreprise', 'Période', 'État']}>
            {data.internships.map(item => <tr key={item.id}><td><a href={'/stages?id=' + item.id}>{item.title}</a></td><td>{item.student}</td><td>{item.company}</td>
              <td>{item.starts_on} → {item.ends_on}</td><td><Badge tone={item.state === 'requested' ? 'info' : item.state === 'validated' ? 'ok' : 'muted'}>{internshipStates[item.state]}</Badge></td></tr>)}
          </Table>
        )}
      </Panel>
      <Panel title="Modèles de convention" id="modeles">
        <p className="muted">Un modèle n’est utilisable qu’après approbation par une autre personne que son auteur. Repères disponibles : {'{{etudiant}} {{entreprise}} {{representant}} {{titre}} {{missions}} {{lieu}} {{debut}} {{fin}} {{heures}} {{maitre_de_stage}} {{encadreur}} {{etablissement}} {{formation}}'}.</p>
        {data.templates.length === 0 ? <p>Aucun modèle.</p> : (
          <ul>{data.templates.map(row => <li key={row.id}>{row.title} — {row.legal_reference} <span className="muted">({row.author})</span>{' '}
            {row.retired_at ? <Badge tone="muted">Retiré</Badge> : row.approved_at ? <Badge tone="ok">Approuvé</Badge> : <Badge tone="warn">À approuver</Badge>}
            {can.sign && !row.own && !row.approved_at && !row.retired_at && <ActionForm inline action={api + 'approve-template'} back={back} hidden={{ templateId: row.id }} submit="Approuver" />}
            {can.manage && !row.retired_at && <ActionForm inline action={api + 'retire-template'} back={back} hidden={{ templateId: row.id }} submit="Retirer" confirm="Le modèle ne servira plus aux nouvelles conventions." />}</li>)}</ul>
        )}
        {can.manage && (
          <Editor summary="Nouveau modèle de convention">
            <ActionForm action={api + 'templates'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer le modèle">
              <label className="studio-wide">Intitulé<input name="title" required maxLength={200} /></label>
              <label className="studio-wide">Référence juridique (texte applicable)<input name="legalReference" required maxLength={1000} /></label>
              <label className="studio-wide">Texte de la convention<textarea name="body" required rows={10} maxLength={40000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>
      <Panel title="Grilles d’évaluation" id="grilles">
        {data.grids.length === 0 ? <p>Aucune grille.</p> : <ul>{data.grids.map(row => <li key={row.id}>{row.title} (sur {row.scale}) — {row.criteria.map(item => `${item.label} ×${item.weight}`).join(', ')}</li>)}</ul>}
        {can.manage && (
          <Editor summary="Nouvelle grille">
            <ActionForm action={api + 'grids'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer la grille">
              <label>Intitulé<input name="title" required maxLength={200} /></label>
              <label>Barème<input name="scale" required inputMode="decimal" defaultValue="20" /></label>
              <label className="studio-wide">Critères (un par ligne : « Intitulé = poids »)<textarea name="criteria" required rows={5} placeholder={'Savoir-faire technique = 3\nComportement professionnel = 2\nRapport écrit = 2'} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>
      <Panel title="Statistiques par territoire" id="statistiques">
        {statistics.length === 0 ? <p>Aucune donnée.</p> : (
          <Table label="Statistiques" head={['Territoire', ...Object.values(internshipStates)]}>
            {regions.map(region => <tr key={region}><td>{region}</td>{Object.keys(internshipStates).map(state => <td key={state}>{statistics.find(row => (row.region ?? 'Sans territoire') === region && row.state === state)?.total ?? 0}</td>)}</tr>)}
          </Table>
        )}
      </Panel>
    </main>
  );
}
