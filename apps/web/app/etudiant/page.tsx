import type { Metadata } from 'next';
import { myStudentRecords } from '@/lib/students/store';
import { Badge, formatTime, Notice, Panel, Table } from '../administration/forms';
import { learner } from '../apprendre/session';

export const metadata: Metadata = { title: 'Mon dossier étudiant' };
export const dynamic = 'force-dynamic';

const registrationStates: Record<string, [string, 'ok' | 'warn' | 'muted']> = { pending: ['En attente de validation', 'warn'], validated: ['Validée', 'ok'], cancelled: ['Annulée', 'muted'] };
const unitStates: Record<string, string> = { registered: 'Inscrit', withdrawn: 'Non suivi', validated: 'Acquis' };

export default async function Etudiant({ searchParams }: { searchParams: Promise<{ error?: string; message?: string }> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const records = await myStudentRecords(settings, actor);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Mon dossier étudiant</span></nav>
      <section className="studio-heading"><p className="eyebrow">Espace étudiant</p><h1>Mon tableau de bord</h1>
        <p>Matricule, inscriptions, unités d’enseignement, crédits, calendrier et historique de votre dossier.</p></section>
      <Notice error={search.error} message={search.message} />
      {records.length === 0 && <p className="card-note">Aucun dossier étudiant : il est ouvert par la scolarité après l’acceptation de votre admission.
        Suivez vos <a href="/candidature">candidatures</a>.</p>}
      {records.map(record => {
        const current = record.registrations.find(item => item.state !== 'cancelled');
        return (
          <section key={record.student.id} aria-labelledby={'dossier-' + record.student.id}>
            <h2 id={'dossier-' + record.student.id}>{record.student.institution}</h2>
            <section className="facts" aria-label="Synthèse">
              <div><span>Matricule</span><strong>{record.student.matricule}</strong></div>
              <div><span>Statut</span><strong>{record.statusLabels[record.student.status]}</strong></div>
              <div><span>Formation</span><strong>{current?.program_title ?? '—'}</strong></div>
              <div><span>Cohorte</span><strong>{current ? `${current.cohort} · ${current.academic_year}` : '—'}</strong></div>
              <div><span>Crédits acquis</span><strong>{record.credits.acquired} / {record.credits.required}</strong></div>
              <div><span>Crédits en cours</span><strong>{record.credits.pending}</strong></div>
            </section>
            <Panel title="Inscriptions" id={'inscriptions-' + record.student.id}>
              <Table label="Inscriptions" head={['Année', 'Formation', 'Cohorte', 'Calendrier', 'État']}>
                {record.registrations.map(item => (
                  <tr key={item.id}><td>{item.academic_year}</td><td>{item.program_title}</td><td>{item.cohort}{item.group_label ? ' · ' + item.group_label : ''}</td>
                    <td>{item.starts_on} → {item.ends_on}</td>
                    <td><Badge tone={registrationStates[item.state][1]}>{registrationStates[item.state][0]}</Badge>{item.conditions && <p className="muted">{item.conditions}</p>}</td></tr>
                ))}
              </Table>
            </Panel>
            <Panel title="Unités d’enseignement" id={'ue-' + record.student.id}>
              {record.units.length === 0 ? <p>Les unités apparaissent après la validation de l’inscription.</p> : (
                <Table label="Unités d’enseignement" head={['Période', 'Code', 'Unité', 'Crédits', 'Situation']}>
                  {record.units.map(unit => <tr key={unit.registration_id + unit.unit_id}><td>{unit.period}</td><td>{unit.code}</td>
                    <td>{unit.title}{unit.optional && <Badge tone="info">option</Badge>}</td><td>{Number(unit.credits)}</td><td>{unit.state ? unitStates[unit.state] : 'Non choisie'}</td></tr>)}
                </Table>
              )}
            </Panel>
            <Panel title="Historique du dossier" id={'historique-' + record.student.id}>
              <ul>{record.events.map((item, index) => <li key={index}>{formatTime(item.occurred_at)} — {item.detail ?? item.kind}</li>)}</ul>
              <p><a href={`/api/v1/sis/students/${record.student.id}/export`}>Exporter mon dossier (JSON)</a></p>
            </Panel>
          </section>
        );
      })}
    </main>
  );
}
