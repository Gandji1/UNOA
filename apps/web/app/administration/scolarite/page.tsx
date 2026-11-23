import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { sisContexts, sisOverview, studentRecord } from '@/lib/students/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';

export const metadata: Metadata = { title: 'Scolarité' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/scolarite';
const api = '/api/v1/sis/';
const registrationStates: Record<string, [string, 'ok' | 'warn' | 'muted']> = { pending: ['En attente', 'warn'], validated: ['Validée', 'ok'], cancelled: ['Annulée', 'muted'] };
const kinds: Record<string, string> = { first: 'Première inscription', renewal: 'Réinscription', change: 'Réorientation' };
const statusActions: [string, string, string[]][] = [
  ['suspend', 'Suspendre', ['active']], ['resume', 'Reprendre', ['suspended', 'interrupted']], ['interrupt', 'Interrompre', ['active', 'suspended']],
  ['withdraw', 'Clore (sortie)', ['active', 'suspended', 'interrupted']], ['graduate', 'Diplômé — passage Alumni', ['active']],
];

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Scolarite({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const denied = <main id="contenu" className="studio"><section className="studio-panel"><h1>Scolarité</h1>{notice}<p>Élément inaccessible avec vos habilitations.</p></section></main>;
  const crumbs = (...parts: [string, string?][]) => <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <a href={path}>Scolarité</a>
    {parts.map(([label, href], index) => <span key={index}> › {href ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}</span>)}</nav>;

  // ------------------------------------------------------------- student
  const studentId = field(search.etudiant);
  if (scopeIdFormat.test(studentId)) {
    const data = await studentRecord(settings, actor, studentId).catch(refused);
    if (!data || !data.rights?.read) return denied;
    const { student } = data;
    const back = `${path}?etudiant=${student.id}`;
    return (
      <main id="contenu" className="studio">
        {crumbs([student.institution, `${path}?etablissement=${student.institution_id}`], [student.matricule])}
        <section className="studio-heading"><p className="eyebrow">Dossier étudiant · {student.matricule}</p><h1>{student.name ?? 'Étudiant'}</h1>
          <p><Badge tone={student.status === 'active' ? 'ok' : 'muted'}>{data.statusLabels[student.status]}</Badge>
            <span className="muted"> {student.email ?? ''} · ouvert le {formatTime(student.created_at)}</span></p></section>
        {notice}
        <section className="facts" aria-label="Crédits">
          <div><span>Crédits acquis</span><strong>{data.credits.acquired}</strong></div>
          <div><span>Crédits en cours</span><strong>{data.credits.pending}</strong></div>
          <div><span>Crédits obligatoires du programme</span><strong>{data.credits.required}</strong></div>
        </section>
        <Panel title="Inscriptions administratives" id="inscriptions">
          <Table label="Inscriptions" head={['Année', 'Nature', 'Formation', 'Cohorte', 'État', '']}>
            {data.registrations.map(item => (
              <tr key={item.id}><td>{item.academic_year}</td><td>{kinds[item.kind]}</td><td>{item.program_title}</td><td>{item.cohort}</td>
                <td><Badge tone={registrationStates[item.state][1]}>{registrationStates[item.state][0]}</Badge>{item.conditions && <p className="muted">{item.conditions}</p>}</td>
                <td>{data.rights?.validate && item.state === 'pending' && item.created_by !== actor && (
                  <ActionForm inline action={api + 'validate'} back={back} hidden={{ registrationId: item.id }} submit="Valider">
                    <input name="conditions" maxLength={1000} placeholder="Conditions (facultatif)" aria-label="Conditions" />
                  </ActionForm>
                )}{data.rights?.validate && item.state !== 'cancelled' && item.created_by !== actor && (
                  <ActionForm inline action={api + 'cancel'} back={back} hidden={{ registrationId: item.id }} submit="Annuler">
                    <input name="reason" required maxLength={1000} placeholder="Motif" aria-label="Motif d’annulation" />
                  </ActionForm>
                )}{item.state === 'pending' && item.created_by === actor && <span className="muted">Validation par une autre personne</span>}</td></tr>
            ))}
          </Table>
          {(data.rights?.enrol || data.rights?.status) && data.cohorts.length > 0 && (
            <Editor summary="Réinscription ou réorientation">
              <ActionForm action={api + 'register'} back={back} hidden={{ studentId: student.id }} submit="Enregistrer la demande">
                <label>Cohorte<select name="cohortId">{data.cohorts.map(item => <option key={item.id} value={item.id}>{item.label} · {item.academic_year}</option>)}</select></label>
                <label>Nature<select name="kind"><option value="renewal">Réinscription</option>{data.rights?.status && <option value="change">Réorientation (changement de programme)</option>}</select></label>
                <label className="studio-wide">Motif (réorientation)<input name="reason" maxLength={1000} /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
        <Panel title="Inscription pédagogique" id="ue">
          {data.units.length === 0 ? <p>Disponible après la validation de l’inscription administrative.</p> : (
            <Table label="Unités" head={['Période', 'Unité', 'Crédits', 'Situation', '']}>
              {data.units.map(unit => (
                <tr key={unit.registration_id + unit.unit_id}><td>{unit.period}</td><td>{unit.code} — {unit.title}{unit.optional && <Badge tone="info">option</Badge>}</td>
                  <td>{Number(unit.credits)}</td><td>{unit.state === 'registered' ? 'Inscrit' : unit.state === 'validated' ? 'Acquis' : unit.state === 'withdrawn' ? 'Non suivi' : 'Non choisie'}</td>
                  <td>{data.rights?.enrol && unit.state !== 'validated' && (
                    <ActionForm inline action={api + 'units'} back={back} hidden={{ registrationId: unit.registration_id, unitId: unit.unit_id, state: unit.state === 'registered' ? 'withdrawn' : 'registered' }}
                      submit={unit.state === 'registered' ? 'Retirer' : 'Inscrire'} />
                  )}</td></tr>
              ))}
            </Table>
          )}
        </Panel>
        {data.rights?.status && (
          <Panel title="Statut" id="statut">
            <div className="studio-actions">
              {statusActions.filter(([, , from]) => from.includes(student.status)).map(([action, label]) => (
                <ActionForm key={action} inline action={api + action} back={back} hidden={{ studentId: student.id }} submit={label}>
                  <input name="reason" required maxLength={1000} placeholder="Motif" aria-label={'Motif : ' + label} />
                </ActionForm>
              ))}
            </div>
          </Panel>
        )}
        <Panel title="Historique" id="historique">
          <ul>{data.events.map((item, index) => <li key={index}>{formatTime(item.occurred_at)} — <code>{item.kind}</code> {item.detail} {item.actor && <span className="muted">· {item.actor}</span>}</li>)}</ul>
          <p><a href={`${api}students/${student.id}/export`}>Exporter le dossier (JSON)</a></p>
        </Panel>
      </main>
    );
  }

  // --------------------------------------------------------- institution
  const institutionId = field(search.etablissement);
  if (scopeIdFormat.test(institutionId)) {
    const data = await sisOverview(settings, actor, institutionId, field(search.q)).catch(refused);
    if (!data) return denied;
    const back = `${path}?etablissement=${institutionId}`;
    const openCohorts = data.cohorts.filter(item => item.state === 'open');
    return (
      <main id="contenu" className="studio">
        {crumbs([data.institution.label])}
        <section className="studio-heading"><p className="eyebrow">Scolarité</p><h1>{data.institution.label}</h1>
          <p>Admission acceptée → dossier et matricule → inscription administrative validée par une autre personne → inscription pédagogique.</p></section>
        {notice}
        <Panel title="Matricule" id="matricule">
          <p>{data.rule ? <>Motif en vigueur : <code>{data.rule.pattern}</code> · prochain numéro : {data.rule.next_value}</> : 'Aucun motif : configurez-le avant la première inscription.'}</p>
          {data.rights.manage && (
            <ActionForm inline action={api + 'rule'} back={back} hidden={{ institutionId }} submit="Enregistrer le motif">
              <input name="pattern" required maxLength={60} defaultValue={data.rule?.pattern ?? ''} placeholder="ex. {AAAA}-{SEQ:5}" aria-label="Motif de matricule ({AAAA}, {AA}, {SEQ:n})" />
            </ActionForm>
          )}
        </Panel>
        <Panel title="Cohortes" id="cohortes">
          {data.cohorts.length === 0 ? <p>Aucune cohorte.</p> : (
            <Table label="Cohortes" head={['Cohorte', 'Formation', 'Année', 'Période', 'Inscrits', 'Groupes', 'État', '']}>
              {data.cohorts.map(item => (
                <tr key={item.id}><td>{item.label} <code>{item.code}</code></td><td>{item.program_code}</td><td>{item.academic_year}</td>
                  <td>{item.starts_on} → {item.ends_on}</td><td>{item.registered}{item.capacity ? ' / ' + item.capacity : ''}</td><td>{item.groups.join(', ') || '—'}</td>
                  <td>{item.state === 'open' ? <Badge tone="ok">Ouverte</Badge> : <Badge tone="muted">Close</Badge>}</td>
                  <td>{data.rights.manage && item.state === 'open' && <>
                    <ActionForm inline action={api + 'groups'} back={back} hidden={{ cohortId: item.id }} submit="Ajouter un groupe">
                      <input name="label" required maxLength={120} placeholder="Groupe" aria-label={'Nouveau groupe de ' + item.label} />
                    </ActionForm>
                    <ActionForm inline action={api + 'close-cohort'} back={back} hidden={{ cohortId: item.id }} submit="Clore" />
                  </>}</td></tr>
              ))}
            </Table>
          )}
          {data.rights.manage && (
            <Editor summary="Nouvelle cohorte">
              {data.versions.length === 0 ? <p>Aucune formation publiée dans cet établissement.</p> : (
                <ActionForm action={api + 'cohorts'} back={back} submit="Créer la cohorte">
                  <label>Formation<select name="versionId">{data.versions.map(item => <option key={item.id} value={item.id}>{item.code} — {item.title} (v{item.number})</option>)}</select></label>
                  <label>Code<input name="code" required maxLength={32} /></label>
                  <label>Intitulé<input name="label" required maxLength={160} /></label>
                  <label>Année académique<input name="academicYear" required pattern="[0-9]{4}-[0-9]{4}" placeholder="2026-2027" /></label>
                  <label>Début<input type="date" name="startsOn" required /></label>
                  <label>Fin<input type="date" name="endsOn" required /></label>
                  <label>Capacité (facultative)<input type="number" name="capacity" min={1} /></label>
                </ActionForm>
              )}
            </Editor>
          )}
        </Panel>
        <Panel title="Admis à inscrire" id="admis">
          {data.admitted.length === 0 ? <p>Aucune admission acceptée en attente d’inscription.</p> : (
            <Table label="Admis" head={['Candidat', 'Accusé', 'Formation', 'Inscription']}>
              {data.admitted.map(item => (
                <tr key={item.id}><td>{item.name ?? '—'}</td><td>{item.receipt}</td><td>{item.program_title}</td>
                  <td>{data.rights.enrol && (openCohorts.filter(cohort => cohort.version_id === item.version_id).length === 0 ? <span className="muted">Aucune cohorte ouverte pour cette formation</span> : (
                    <ActionForm inline action={api + 'enrol'} back={back} hidden={{ applicationId: item.id }} submit="Inscrire">
                      <select name="cohortId" aria-label="Cohorte">{openCohorts.filter(cohort => cohort.version_id === item.version_id).map(cohort => <option key={cohort.id} value={cohort.id}>{cohort.label} · {cohort.academic_year}</option>)}</select>
                    </ActionForm>
                  ))}</td></tr>
              ))}
            </Table>
          )}
        </Panel>
        {data.pending.length > 0 && (
          <Panel title="Inscriptions à valider" id="a-valider">
            <Table label="À valider" head={['Matricule', 'Étudiant', 'Cohorte', 'Année', 'Nature']}>
              {data.pending.map(item => <tr key={item.id}><td>{item.matricule}</td><td>{item.name ?? '—'}</td><td>{item.cohort}</td><td>{item.academic_year}</td><td>{kinds[item.kind]}</td></tr>)}
            </Table>
          </Panel>
        )}
        <Panel title="Étudiants" id="etudiants" actions={
          <form method="get" action={path} className="studio-inline"><input type="hidden" name="etablissement" value={institutionId} />
            <input name="q" defaultValue={field(search.q)} placeholder="Matricule ou nom" aria-label="Rechercher un étudiant" maxLength={80} />
            <button className="secondary" type="submit">Rechercher</button></form>}>
          {data.students.length === 0 ? <p>Aucun étudiant.</p> : (
            <Table label="Étudiants" head={['Matricule', 'Nom', 'Statut', 'Ouvert le']}>
              {data.students.map(item => <tr key={item.id}><td><a href={`${path}?etudiant=${item.id}`}>{item.matricule}</a></td><td>{item.name ?? '—'}</td><td>{item.status}</td><td>{formatTime(item.created_at)}</td></tr>)}
            </Table>
          )}
        </Panel>
      </main>
    );
  }

  const institutions = await sisContexts(settings, actor);
  return (
    <main id="contenu" className="studio">
      {crumbs()}
      <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Scolarité</h1><p>Choisissez un établissement.</p></section>
      {notice}
      {institutions.length === 0 ? <p className="card-note">Aucun établissement accessible. Créez d’abord un établissement dans Territoires.</p> : (
        <ul className="program-grid">{institutions.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?etablissement=${item.id}`}>{item.label}</a></h2></li>)}</ul>
      )}
    </main>
  );
}
