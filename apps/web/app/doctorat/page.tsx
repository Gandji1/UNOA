import type { Metadata } from 'next';
import { doctoralSpace } from '@/lib/doctorate/store';
import { ActionForm, Badge, Notice, Panel } from '../administration/forms';
import { learner } from '../apprendre/session';
import { DoctoralFile } from './dossier';

export const metadata: Metadata = { title: 'Doctorat' };
export const dynamic = 'force-dynamic';

const states: Record<string, string> = { submitted: 'En instruction', accepted: 'Admis', rejected: 'Non retenu' };

export default async function Doctorat({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await doctoralSpace(settings, actor);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Doctorat</span></nav>
      <section className="studio-heading"><p className="eyebrow">Recherche</p><h1>Doctorat</h1>
        <p>Candidature scientifique → admission → inscriptions annuelles → suivi (comité, rapports, formations, publications, éthique) → autorisation et soutenance → archive.
          Le diplôme de doctorat n’est délivré que sous habilitation vérifiée.</p></section>
      <Notice error={search.error} message={search.message} />
      {data.theses.length > 0 && <Panel title="Mes thèses" id="theses">{data.theses.map(item => <DoctoralFile key={item.project.id} item={item} back="/doctorat" actor={actor} />)}</Panel>}
      <Panel title="Mes candidatures" id="candidatures">
        {data.applications.length === 0 ? <p>Aucune candidature.</p> : <ul>{data.applications.map(item => <li key={item.id}>{item.title} — {item.school} <Badge tone={item.state === 'accepted' ? 'ok' : item.state === 'rejected' ? 'danger' : 'info'}>{states[item.state]}</Badge>{item.decision_note ? ` ${item.decision_note}` : ''}</li>)}</ul>}
        {data.labs.length > 0 && (
          <ActionForm action="/api/v1/phd/apply" back="/doctorat" submit="Déposer ma candidature">
            <label>Laboratoire d’accueil<select name="labId">{data.labs.map(lab => <option key={lab.id} value={lab.id}>{lab.name} — {lab.school}</option>)}</select></label>
            <label>Directeur pressenti<select name="proposedDirectorId">{data.directors.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
            <label className="studio-wide">Titre du projet<input name="title" required maxLength={300} /></label>
            <label className="studio-wide">Dossier scientifique (état de l’art, objectifs, méthode, calendrier)<textarea name="dossier" required rows={6} maxLength={20000} /></label>
            <label className="studio-wide">Financement envisagé (facultatif)<input name="funding" maxLength={2000} /></label>
          </ActionForm>
        )}
      </Panel>
    </main>
  );
}
