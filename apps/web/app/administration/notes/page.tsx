import type { Metadata } from 'next';
import { scopeIdFormat } from '@/lib/iam/settings';
import { grdContexts, grdOverview, invariants, roundingLabels, sessionLabels } from '@/lib/grades/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';
import { learner, refusedAs } from '../../apprendre/session';

export const metadata: Metadata = { title: 'Notes et jurys' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/notes';
const api = '/api/v1/grd/';
const policyStates: Record<string, [string, 'ok' | 'warn' | 'muted']> = { draft: ['Brouillon', 'warn'], published: ['En vigueur', 'ok'], retired: ['Retirée', 'muted'] };
const juryStates: Record<string, [string, 'ok' | 'warn' | 'info']> = { constituted: ['Constitué', 'warn'], deliberated: ['Délibéré', 'info'], published: ['Publié', 'ok'] };

export default async function Notes({ searchParams }: { searchParams: Promise<Search> }) {
  const { settings, actor } = await learner();
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const crumbs = (label?: string) => <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › {label ? <><a href={path}>Notes et jurys</a> › <span aria-current="page">{label}</span></> : <span aria-current="page">Notes et jurys</span>}</nav>;
  const scopeId = field(search.scope);
  const data = scopeIdFormat.test(scopeId) ? await grdOverview(settings, actor, scopeId).catch(refusedAs(null)) : null;
  if (!data) {
    const scopes = await grdContexts(settings, actor);
    return (
      <main id="contenu" className="studio">
        {crumbs()}
        <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Notes et jurys</h1><p>Choisissez un établissement, une faculté ou un département.</p></section>
        {notice}
        {scopes.length === 0 ? <p className="card-note">Aucun périmètre accessible.</p> : (
          <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>
        )}
      </main>
    );
  }
  const back = `${path}?scope=${data.scope.id}`;
  const anomalies = field(search.controle) ? await invariants(settings, actor, data.scope.id) : null;
  return (
    <main id="contenu" className="studio">
      {crumbs(data.scope.label)}
      <section className="studio-heading"><p className="eyebrow">Notes et jurys</p><h1>{data.scope.label}</h1>
        <p>Note proposée → validation par une autre personne → jury (quorum) → procès-verbal signé → publication à la date prévue → contestation → rectification par avenant.</p></section>
      {notice}

      <Panel title="Règles de notation" id="regles">
        <p className="studio-help">Chaque règle est datée et versionnée ; une règle publiée ne se modifie plus (on en publie une nouvelle). Une règle propre à une formation l’emporte sur celle de l’établissement, qui l’emporte sur celle du pays.</p>
        {data.policies.length === 0 ? <p>Aucune règle : créez-en une avant de saisir des notes.</p> : (
          <Table label="Règles de notation" head={['Règle', 'Portée', 'Échelle et seuils', 'Compensation', 'Session 2', 'Jury', 'Effet', 'État', '']}>
            {data.policies.map(item => <tr key={item.id}><td>{item.label}</td><td>{item.scope_label}{item.version_title ? ' · ' + item.version_title : ''}</td>
              <td>sur {Number(item.scale_max)} · moyenne {Number(item.pass_mark)} · unité {Number(item.unit_pass_mark)}<br /><span className="muted">{roundingLabels[item.rounding]}, {item.decimals} déc.</span></td>
              <td>{item.compensation ? `oui (plancher ${Number(item.compensation_floor)})` : 'non'}</td><td>{item.resit ? (item.resit_rule === 'best' ? 'oui, meilleure note' : 'oui, remplace') : 'non'}</td>
              <td>quorum {item.jury_quorum} · contestation {item.appeal_days} j</td><td>{item.effective_from}</td><td><Badge tone={policyStates[item.state][1]}>{policyStates[item.state][0]}</Badge></td>
              <td>{data.rights.policy && item.state === 'draft' && <ActionForm inline action={api + 'publish-policy'} back={back} hidden={{ policyId: item.id }} submit="Publier" />}
                {data.rights.policy && item.state === 'published' && <ActionForm inline action={api + 'retire-policy'} back={back} hidden={{ policyId: item.id }} submit="Retirer" />}</td></tr>)}
          </Table>
        )}
        {data.rights.policy && (
          <Editor summary="Nouvelle règle de notation">
            <ActionForm action={api + 'policy'} back={back} hidden={{ scopeId: data.scope.id }} submit="Enregistrer le brouillon">
              <label>Libellé<input name="label" required maxLength={160} /></label>
              <label>Formation (facultatif)<select name="programVersionId"><option value="">Toutes les formations de la portée</option>
                {data.versions.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
              <label>Note maximale<input name="scaleMax" required inputMode="decimal" /></label>
              <label>Moyenne d’admission<input name="passMark" required inputMode="decimal" /></label>
              <label>Seuil de validation d’une unité<input name="unitPassMark" required inputMode="decimal" /></label>
              <label>Arrondi<select name="rounding">{Object.entries(roundingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Décimales<input name="decimals" inputMode="numeric" defaultValue="2" /></label>
              <label className="studio-check"><input type="checkbox" name="compensation" /> Compensation entre unités autorisée</label>
              <label>Plancher de compensation<input name="compensationFloor" inputMode="decimal" /></label>
              <label className="studio-check"><input type="checkbox" name="resit" /> Seconde session</label>
              <label>Note retenue en seconde session<select name="resitRule"><option value="best">La meilleure des deux</option><option value="replace">La seconde remplace</option></select></label>
              <label>Quorum du jury (membres présents)<input name="juryQuorum" required inputMode="numeric" /></label>
              <label>Délai de contestation (jours)<input name="appealDays" inputMode="numeric" defaultValue="15" /></label>
              <label>Date d’effet<input type="date" name="effectiveFrom" required /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Cohortes : saisie des notes et jurys" id="cohortes">
        {data.cohorts.length === 0 ? <p>Aucune cohorte dans ce périmètre.</p> : (
          <Table label="Cohortes" head={['Cohorte', 'Formation', 'Règle en vigueur', 'Périodes']}>
            {data.cohorts.map(item => <tr key={item.id}><td>{item.label}<br /><span className="muted">{item.code} · {item.academic_year}</span></td><td>{item.version_title}</td>
              <td>{item.policy_id ? data.policies.find(policy => policy.id === item.policy_id)?.label ?? 'Règle héritée' : <Badge tone="warn">aucune</Badge>}</td>
              <td><ul>{item.periods.map(period => <li key={period.id}><a href={`${path}/saisie?cohorte=${item.id}&periode=${period.id}`}>{period.label} — notes</a></li>)}</ul>
                {data.rights.jury && item.policy_id && item.periods.length > 0 && (
                  <Editor summary="Constituer un jury">
                    <ActionForm action={api + 'juries'} back={back} hidden={{ cohortId: item.id }} submit="Constituer le jury">
                      <label>Période<select name="periodId">{item.periods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
                      <label>Session<select name="session"><option value="first">Première session</option><option value="resit">Seconde session</option></select></label>
                      <label>Publication des résultats (UTC)<input type="datetime-local" name="publishAt" required /></label>
                      <label>Libellé (facultatif)<input name="label" maxLength={200} /></label>
                    </ActionForm>
                  </Editor>
                )}</td></tr>)}
          </Table>
        )}
      </Panel>

      <Panel title="Jurys" id="jurys">
        {data.juries.length === 0 ? <p>Aucun jury.</p> : (
          <Table label="Jurys" head={['Jury', 'Cohorte', 'Session', 'Publication', 'Décisions', 'État']}>
            {data.juries.map(item => <tr key={item.id}><td><a href={`${path}/jury?id=${item.id}`}>{item.label}</a></td><td>{item.cohort}</td><td>{sessionLabels[item.session]}</td>
              <td>{formatTime(item.publish_at)}</td><td>{item.decisions}</td><td><Badge tone={juryStates[item.state][1]}>{juryStates[item.state][0]}</Badge></td></tr>)}
          </Table>
        )}
      </Panel>

      <Panel title="Contestations" id="contestations">
        {data.appeals.length === 0 ? <p>Aucune contestation.</p> : data.appeals.map(item => (
          <section key={item.id} className="studio-panel">
            <p><strong>{item.name}</strong> — {item.jury_label} · déposée le {formatTime(item.filed_at)} <Badge tone={item.state === 'filed' ? 'warn' : item.state === 'upheld' ? 'ok' : 'muted'}>
              {item.state === 'filed' ? 'À instruire' : item.state === 'upheld' ? 'Fondée' : 'Rejetée'}</Badge></p>
            <p>{item.reason}</p>{item.response && <p className="muted">Réponse : {item.response}</p>}
            {item.state === 'upheld' && <p><a href={`${path}/jury?id=${item.jury_id}#rectifier`}>Rectifier par avenant</a></p>}
            {data.rights.appeal && item.state === 'filed' && (
              <ActionForm action={api + 'decide-appeal'} back={back} hidden={{ appealId: item.id }} submit="Statuer">
                <label>Issue<select name="outcome"><option value="rejected">Rejeter</option><option value="upheld">Fondée (rectification)</option></select></label>
                <label className="studio-wide">Réponse motivée<textarea name="response" required maxLength={4000} /></label>
              </ActionForm>
            )}
          </section>
        ))}
      </Panel>

      <Panel title="Contrôles de cohérence" id="controles" actions={<a className="secondary" href={`${back}&controle=1#controles`}>Lancer les contrôles</a>}>
        {anomalies === null ? <p>Crédits au-delà de la formation, crédits sans unité validée, procès-verbal publié sans signatures, note modifiée après délibération, seconde session sans première, décision différente du recalcul.</p>
          : anomalies.length === 0 ? <p className="studio-notice success" role="status">Aucune anomalie détectée.</p>
          : <ul>{anomalies.map((item, index) => <li key={index}><Badge tone="danger">{item.kind}</Badge> {item.detail}</li>)}</ul>}
      </Panel>
    </main>
  );
}
