import type { Metadata } from 'next';
import { enrollmentStates, modalityLabels, mySpace, publicCatalogue, rplStates } from '@/lib/short/store';
import { ActionForm, Badge, Notice, Panel, Table } from '../../administration/forms';
import { learner } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Mes formations courtes' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/short/';
const back = '/formations-courtes/mes';

export default async function Mes({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const [data, catalogue] = await Promise.all([mySpace(settings, actor), publicCatalogue(settings, null)]);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mes formations courtes</span></nav>
      <section className="studio-heading"><p className="eyebrow">Formation continue</p><h1>Mes formations courtes</h1>
        <p>Progression validée par le formateur, attestation à la réussite, avis sur la formation et demande de reconnaissance des acquis.</p></section>
      <Notice error={search.error} message={search.message} />
      {data.enrollments.length === 0 ? <Panel title="Inscriptions" id="inscriptions"><p>Aucune inscription. <a href="/formations-courtes">Voir le catalogue</a></p></Panel> : data.enrollments.map(item => (
        <Panel key={item.id} title={item.title} id={'e' + item.id.slice(0, 8)}>
          <p>{item.session} · {modalityLabels[item.modality]} · du {item.starts_on} au {item.ends_on} <Badge tone={item.state === 'completed' ? 'ok' : item.state === 'enrolled' ? 'info' : 'muted'}>{enrollmentStates[item.state]}</Badge></p>
          <Table label={'Progression — ' + item.title} head={['Module', 'Résultat']}>
            {item.progress.modules.map(module => <tr key={module.id}><td>{module.title}</td><td>{module.score === null ? 'à venir' : `${module.score} / 100`}</td></tr>)}
          </Table>
          <p className="muted">Réussite : chaque module à {item.pass_threshold} / 100 au moins.</p>
          {item.certificate && <p><a className="action" href={`/documents/voir?id=${item.certificate}`}>Voir mon attestation</a></p>}
          {item.state === 'enrolled' && <ActionForm inline action={api + 'withdraw'} back={back} hidden={{ enrollmentId: item.id }} submit="Me retirer" />}
          {['completed', 'not_passed'].includes(item.state) && !item.rated && (
            <ActionForm action={api + 'feedback'} back={back} hidden={{ enrollmentId: item.id }} submit="Donner mon avis">
              <label>Satisfaction (1 à 5)<select name="rating"><option value="5">5</option><option value="4">4</option><option value="3">3</option><option value="2">2</option><option value="1">1</option></select></label>
              <label className="studio-wide">Commentaire<textarea name="comment" maxLength={2000} /></label>
            </ActionForm>
          )}
        </Panel>
      ))}
      <Panel title="Reconnaissance des acquis" id="acquis">
        <p className="studio-help">Votre expérience est examinée par une personne habilitée ; aucune reconnaissance n’est automatique.</p>
        {data.rpl.length > 0 && <ul>{data.rpl.map(item => <li key={item.id}>{item.target} — {rplStates[item.state]}{item.decision ? ` : ${item.decision}` : ''}</li>)}</ul>}
        {catalogue.length > 0 && (
          <ActionForm action={api + 'rpl'} back={back} submit="Déposer la demande">
            <label>Formation concernée<select name="courseId">{catalogue.map(course => <option key={course.id} value={course.id}>{course.title}</option>)}</select></label>
            <label>Compétence ou objectif visé<input name="target" required maxLength={200} /></label>
            <label className="studio-wide">Expérience et acquis<textarea name="experience" required rows={4} maxLength={6000} /></label>
          </ActionForm>
        )}
      </Panel>
    </main>
  );
}
