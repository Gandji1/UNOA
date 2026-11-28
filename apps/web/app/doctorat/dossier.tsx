import { ethicsLabels, reviewLabels } from '@/lib/doctorate/store';
import { ActionForm, Badge, Editor, formatTime, Table } from '../administration/forms';

type Dossier = Awaited<ReturnType<typeof import('@/lib/doctorate/store').doctoralSpace>>['theses'][number];

// A doctoral file, shown to the doctoral candidate, the director, the committee and the school.
export function DoctoralFile({ item, back, actor, manage, authorize, ethics }: { item: Dossier; back: string; actor: string; manage?: boolean; authorize?: boolean; ethics?: boolean }) {
  const api = '/api/v1/phd/';
  const hidden = { projectId: item.project.id };
  const own = item.project.author_id === actor;
  const committee = item.committee.some(member => member.account_id === actor);
  const pending = item.reviews.find(review => !review.decision);
  return (
    <section className="studio-panel">
      <h3><a href={`/memoires/projet?id=${item.project.id}`}>{item.project.title}</a> {item.active ? <Badge tone="ok">inscrit {item.active.academic_year}</Badge> : <Badge tone="danger">inscription périmée</Badge>}
        {item.authorization && <> <Badge tone="ok">soutenance autorisée</Badge></>}</h3>
      <p className="muted">{item.school} · {item.lab} · depuis le {item.meta.started_on}</p>
      <Table label="Conditions de soutenance" head={['Condition', 'État']}>
        {item.conditions.map(condition => <tr key={condition.label}><td>{condition.label}</td><td>{condition.met ? <Badge tone="ok">remplie</Badge> : <Badge tone="warn">à remplir</Badge>}</td></tr>)}
      </Table>
      <p>Inscriptions : {item.enrollments.map(row => `${row.academic_year} (jusqu’au ${row.valid_until})`).join(', ')}</p>
      <p>Comité de suivi : {item.committee.map(member => member.name).join(', ') || 'à désigner'}</p>
      <ul>{item.reviews.map(review => <li key={review.academic_year}>{review.academic_year} — {review.decision ? `${reviewLabels[review.decision]} : ${review.opinion}` : 'rapport en attente d’avis'}</li>)}</ul>
      <p>Formations : {item.trainings.map(training => `${training.title} (${training.hours} h${training.validated_at ? ', validée' : ', à valider'})`).join(' ; ') || 'aucune'}</p>
      <p>Publications : {item.publications.map(publication => `${publication.title} — ${publication.venue}, ${publication.year} (${publication.status})`).join(' ; ') || 'aucune'}</p>
      <p>Éthique : {item.ethics.map(review => `${ethicsLabels[review.decision]} — ${review.committee}, réf. ${review.reference} (${formatTime(review.recorded_at)})`).join(' ; ') || 'aucun avis'}</p>
      {own && <div className="studio-actions">
        <Editor summary="Déposer le rapport annuel">
          <ActionForm action={api + 'annual-report'} back={back} hidden={hidden} submit="Déposer">
            <label>Année universitaire<input name="academicYear" required defaultValue={item.active?.academic_year ?? ''} /></label>
            <label className="studio-wide">Rapport<textarea name="report" required rows={5} maxLength={20000} /></label>
          </ActionForm>
        </Editor>
        <Editor summary="Déclarer une formation">
          <ActionForm action={api + 'trainings'} back={back} hidden={hidden} submit="Déclarer">
            <label>Nature<select name="kind"><option value="course">Cours</option><option value="seminar">Séminaire</option><option value="school">École thématique</option><option value="other">Autre</option></select></label>
            <label>Intitulé<input name="title" required maxLength={300} /></label><label>Heures<input name="hours" required inputMode="numeric" /></label>
            <label className="studio-wide">Justificatif<input name="evidence" required maxLength={1000} /></label>
          </ActionForm>
        </Editor>
        <Editor summary="Déclarer une publication">
          <ActionForm action={api + 'publications'} back={back} hidden={hidden} submit="Déclarer">
            <label>Nature<select name="kind"><option value="article">Article</option><option value="conference">Communication</option><option value="poster">Poster</option><option value="book">Ouvrage</option><option value="other">Autre</option></select></label>
            <label>Titre<input name="title" required maxLength={400} /></label><label>Revue ou manifestation<input name="venue" required maxLength={300} /></label>
            <label>Année<input name="year" required inputMode="numeric" /></label>
            <label>Statut<select name="status"><option value="submitted">Soumise</option><option value="accepted">Acceptée</option><option value="published">Publiée</option></select></label>
            <label>DOI<input name="doi" maxLength={200} /></label>
          </ActionForm>
        </Editor>
      </div>}
      {committee && pending && (
        <ActionForm action={api + 'review'} back={back} hidden={{ ...hidden, academicYear: pending.academic_year }} submit="Rendre l’avis du comité">
          <p className="studio-wide">{pending.report}</p>
          <label>Décision<select name="decision">{Object.entries(reviewLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="studio-wide">Avis motivé<textarea name="opinion" required maxLength={8000} /></label>
        </ActionForm>
      )}
      {manage && <div className="studio-actions">
        {item.trainings.filter(training => !training.validated_at).map(training => <ActionForm key={training.id} inline action={api + 'validate-training'} back={back} hidden={{ ...hidden, trainingId: training.id }} submit={`Valider « ${training.title} »`} />)}
        <Editor summary="Réinscrire">
          <ActionForm action={api + 'reenrol'} back={back} hidden={hidden} submit="Réinscrire">
            <label>Année<input name="academicYear" required /></label><label>Début<input type="date" name="validFrom" required /></label><label>Fin<input type="date" name="validUntil" required /></label>
          </ActionForm>
        </Editor>
      </div>}
      {ethics && (
        <Editor summary="Enregistrer un avis éthique">
          <ActionForm action={api + 'ethics'} back={back} hidden={hidden} submit="Enregistrer">
            <label>Comité<input name="committee" required maxLength={200} /></label><label>Référence<input name="reference" required maxLength={120} /></label>
            <label>Avis<select name="decision">{Object.entries(ethicsLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="studio-wide">Observations<textarea name="note" required maxLength={4000} /></label>
          </ActionForm>
        </Editor>
      )}
      {authorize && !item.authorization && !own && <ActionForm inline action={api + 'authorize'} back={back} hidden={hidden} submit="Autoriser la soutenance" />}
    </section>
  );
}
