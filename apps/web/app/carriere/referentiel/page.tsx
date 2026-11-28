import type { Metadata } from 'next';
import { referential } from '@/lib/careers/store';
import { ActionForm, Notice, Panel } from '../../administration/forms';
import { learner } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Référentiel de compétences' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/car/';
const back = '/carriere/referentiel';

export default async function Referentiel({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await referential(settings, actor);
  const label = (id: string) => data.competencies.find(item => item.id === id)?.label ?? id;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <span aria-current="page">Référentiel de compétences</span></nav>
      <section className="studio-heading"><p className="eyebrow">Compétences</p><h1>Référentiel de compétences</h1>
        <p>Les compétences se créent dans le catalogue de chaque formation. Ici, traduisez-les et reliez-les aux cours et aux évaluations : les niveaux des étudiants en découlent.</p></section>
      <Notice error={search.error} message={search.message} />
      <Panel title="Compétences et traductions" id="competences">
        {data.competencies.length === 0 ? <p>Aucune compétence dans le catalogue.</p> : <ul>{data.competencies.map(item => <li key={item.id}><strong>{item.code}</strong> — {item.label} <span className="muted">({item.scope}{item.labels.length ? ' · ' + item.labels.map(row => `${row.language} : ${row.label}`).join(' · ') : ''})</span>
          {item.editable && <ActionForm inline action={api + 'competency-label'} back={back} hidden={{ competencyId: item.id }} submit="Traduire"><input name="language" required maxLength={6} placeholder="en" aria-label="Langue" /><input name="label" required maxLength={200} placeholder="Libellé" aria-label="Libellé traduit" /></ActionForm>}</li>)}</ul>}
      </Panel>
      {data.courses.length > 0 && data.competencies.length > 0 && (
        <Panel title="Cours" id="cours">
          {data.courses.map(course => <div key={course.id}><p><strong>{course.code}</strong> — {course.title} : {course.linked.length ? course.linked.map(label).join(', ') : 'aucune compétence'}</p>
            <ActionForm inline action={api + 'link-course'} back={back} hidden={{ courseId: course.id }} submit="Relier"><select name="competencyId" aria-label="Compétence">{data.competencies.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></ActionForm></div>)}
        </Panel>
      )}
      {data.assessments.length > 0 && data.competencies.length > 0 && (
        <Panel title="Mes évaluations" id="evaluations">
          {data.assessments.map(item => <div key={item.id}><p><strong>{item.title}</strong> ({item.offering}) : {item.linked.length ? item.linked.map(label).join(', ') : 'aucune compétence'}</p>
            <ActionForm inline action={api + 'link-assessment'} back={back} hidden={{ assessmentId: item.id }} submit="Relier"><select name="competencyId" aria-label="Compétence">{data.competencies.map(row => <option key={row.id} value={row.id}>{row.label}</option>)}</select></ActionForm></div>)}
        </Panel>
      )}
    </main>
  );
}
