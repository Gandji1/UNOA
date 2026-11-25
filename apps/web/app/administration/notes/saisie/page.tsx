import type { Metadata } from 'next';
import { gradeSheet, sessionLabels } from '@/lib/grades/store';
import { ActionForm, Badge, Editor, Notice, Panel, Table } from '../../forms';
import { learner, refusedAs } from '../../../apprendre/session';

export const metadata: Metadata = { title: 'Saisie des notes' };
export const dynamic = 'force-dynamic';

const api = '/api/v1/grd/';
const absenceLabels: Record<string, string> = { justified: 'Absence justifiée', unjustified: 'Absence injustifiée' };

export default async function Saisie({ searchParams }: { searchParams: Promise<{ cohorte?: string; periode?: string; error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = search.cohorte && search.periode ? await gradeSheet(settings, actor, search.cohorte, search.periode).catch(refusedAs(null)) : null;
  if (!data) {
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration/notes">Notes et jurys</a> › <span aria-current="page">Saisie</span></nav>
        <section className="studio-heading"><h1>Saisie des notes</h1></section>
        <p className="studio-notice" role="alert">Cohorte ou période introuvable, ou hors de vos habilitations.</p>
      </main>
    );
  }
  const back = `/administration/notes/saisie?cohorte=${data.cohort.id}&periode=${data.period.id}`;
  const canEnter = (unitId: string) => data.rights?.enter || data.teaching.includes(unitId);
  const entry = (registration: string, unit: string, session: string) => data.entries.find(item => item.registration_id === registration && item.unit_id === unit && item.session === session);
  const shown = (item: ReturnType<typeof entry>) => !item ? '—' : item.absence !== 'none' ? absenceLabels[item.absence] : String(Number(item.mark));
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <a href={`/administration/notes?scope=${data.cohort.owner_scope_id}`}>Notes et jurys</a> › <span aria-current="page">{data.cohort.label} · {data.period.label}</span></nav>
      <section className="studio-heading"><p className="eyebrow">{data.cohort.label}</p><h1>Notes — {data.period.label}</h1>
        <p>{data.policy ? `Règle en vigueur : ${data.policy.label} (sur ${Number(data.policy.scale_max)}, seuil ${Number(data.policy.unit_pass_mark)}).` : 'Aucune règle de notation publiée : la saisie est impossible.'}
          {' '}Une note saisie est provisoire jusqu’à sa validation par une autre personne ; toute modification garde l’historique et son motif.</p></section>
      <Notice error={search.error} message={search.message} />
      {data.units.length === 0 ? <p>Aucune unité dans cette période.</p> : data.units.map(unit => {
        const registered = data.registrations.filter(item => item.units.includes(unit.id));
        return (
          <Panel key={unit.id} title={`${unit.code} — ${unit.title}`} id={'u' + unit.id.slice(0, 8)}
            actions={data.rights?.validate ? <ActionForm inline action={api + 'validate-all'} back={back} hidden={{ cohortId: data.cohort.id, unitId: unit.id, session: 'first' }} submit="Valider les notes provisoires" /> : undefined}>
            <p className="muted">{Number(unit.credits)} crédit(s) · coefficient {Number(unit.coefficient)}</p>
            {registered.length === 0 ? <p>Aucun étudiant inscrit à cette unité.</p> : (
              <Table label={'Notes de ' + unit.code} head={['Étudiant', sessionLabels.first, sessionLabels.resit, 'Saisir']}>
                {registered.map(student => {
                  const first = entry(student.id, unit.id, 'first');
                  const resit = entry(student.id, unit.id, 'resit');
                  return (
                    <tr key={student.id}><td>{student.name}<br /><span className="muted">{student.matricule}</span></td>
                      <td>{shown(first)} {first && <Badge tone={first.state === 'validated' ? 'ok' : 'warn'}>{first.state === 'validated' ? 'validée' : 'provisoire'}</Badge>}
                        {data.rights?.validate && first?.state === 'provisional' && first.author_id !== actor && <ActionForm inline action={api + 'validate'} back={back} hidden={{ registrationId: student.id, unitId: unit.id, session: 'first' }} submit="Valider" />}</td>
                      <td>{shown(resit)} {resit && <Badge tone={resit.state === 'validated' ? 'ok' : 'warn'}>{resit.state === 'validated' ? 'validée' : 'provisoire'}</Badge>}
                        {data.rights?.validate && resit?.state === 'provisional' && resit.author_id !== actor && <ActionForm inline action={api + 'validate'} back={back} hidden={{ registrationId: student.id, unitId: unit.id, session: 'resit' }} submit="Valider" />}</td>
                      <td>{canEnter(unit.id) && data.policy && (
                        <Editor summary="Saisir une note">
                          <ActionForm action={api + 'grade'} back={back} hidden={{ registrationId: student.id, unitId: unit.id }} submit="Enregistrer (provisoire)">
                            <label>Session<select name="session"><option value="first">{sessionLabels.first}</option><option value="resit">{sessionLabels.resit}</option></select></label>
                            <label>Note (sur {Number(data.policy.scale_max)})<input name="mark" inputMode="decimal" /></label>
                            <label>Absence<select name="absence"><option value="none">Présent</option><option value="justified">Absence justifiée</option><option value="unjustified">Absence injustifiée</option></select></label>
                            <label className="studio-wide">Motif (obligatoire pour une modification)<input name="reason" maxLength={1000} /></label>
                          </ActionForm>
                        </Editor>
                      )}</td></tr>
                  );
                })}
              </Table>
            )}
          </Panel>
        );
      })}
    </main>
  );
}
