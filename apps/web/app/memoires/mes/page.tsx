import type { Metadata } from 'next';
import { levelLabels, mySpace, projectStates } from '@/lib/theses/store';
import { ActionForm, Badge, Notice, Panel, Table } from '../../administration/forms';
import { learner } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Mes mémoires et thèses' };
export const dynamic = 'force-dynamic';

const relations: Record<string, string> = { author: 'Auteur', supervisor: 'Encadrant', jury: 'Membre du jury' };

export default async function Mes({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await mySpace(settings, actor);
  const back = '/memoires/mes';
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mémoires et thèses</span></nav>
      <section className="studio-heading"><p className="eyebrow">Recherche</p><h1>Mes mémoires et thèses</h1>
        <p>Sujet → validation du protocole → encadrement et versions successives → contrôle d’intégrité → jury et soutenance → dépôt définitif.</p></section>
      <Notice error={search.error} message={search.message} />
      <Panel title="Mes travaux" id="travaux">
        {data.projects.length === 0 ? <p>Aucun travail.</p> : (
          <Table label="Travaux" head={['Titre', 'Niveau', 'Mon rôle', 'État']}>
            {data.projects.map(item => <tr key={item.id + item.relation}><td><a href={`/memoires/projet?id=${item.id}`}>{item.title}</a></td><td>{levelLabels[item.level]}</td>
              <td>{relations[item.relation]}</td><td><Badge tone={item.state === 'archived' ? 'ok' : item.state === 'rejected' ? 'danger' : 'info'}>{projectStates[item.state]}</Badge></td></tr>)}
          </Table>
        )}
      </Panel>
      <Panel title="Démarrer un projet" id="demarrer">
        <ActionForm action="/api/v1/thesis/projects" back={back} submit="Créer le projet">
          <label>Sujet proposé (facultatif)<select name="topicId"><option value="">Mon propre sujet</option>{data.topics.map(topic => <option key={topic.id} value={topic.id}>{topic.title} — {levelLabels[topic.level]} ({topic.scope})</option>)}</select></label>
          <label>Inscription concernée<select name="registrationId"><option value="">—</option>{data.registrations.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>Unité du mémoire (crédits)<select name="unitId"><option value="">—</option>{data.registrations.flatMap(item => item.units).map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>
          <label>Établissement (si sujet propre)<select name="scopeId"><option value="">—</option>{[...new Map(data.registrations.map(item => [item.scope_id, item.label] as const)).entries()].map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
          <label>Niveau (si sujet propre)<select name="level">{Object.entries(levelLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="studio-wide">Titre<input name="title" required maxLength={300} /></label>
          <label className="studio-wide">Résumé<textarea name="abstract" maxLength={6000} /></label>
          <label className="studio-check"><input type="checkbox" name="confidential" /> Travail confidentiel (non publié dans l’archive)</label>
        </ActionForm>
      </Panel>
    </main>
  );
}
