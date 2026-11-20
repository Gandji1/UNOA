import type { ReactNode } from 'react';
import { issueMessages, simulatePlan, type Issue } from '@unoa/domain/curriculum';
import type { versionDetails } from '@/lib/catalog/store';
import { ActionForm, Badge, Editor, Panel, Table } from '../forms';
import { regulatoryBadge, requirementLabels, stateBadge } from './labels';

type Data = Awaited<ReturnType<typeof versionDetails>>;
const path = '/administration/catalogue';
const api = '/api/v1/catalog/program-versions/';

export function IssueList({ issues }: { issues: Issue[] }) {
  return (
    <ul className="issues">
      {issues.map((issue, index) => (
        <li key={index}>{issueMessages[issue.code]}{issue.subject ? ' : ' + issue.subject : ''}{issue.detail ? ' (' + issue.detail + ')' : ''}</li>
      ))}
    </ul>
  );
}

export function VersionView({ data, actor, notice, choices, simulate }: {
  data: Data; actor: string; notice: ReactNode; choices: string[]; simulate: boolean;
}) {
  const { version, program, scope, issues, periods, groups, units, requirements, competencies, territories,
    equivalences, courses, availableCompetencies, equivalenceSources, zones, model } = data;
  const back = `${path}?version=${version.id}`;
  const action = (part: string) => `${api}${version.id}/${part}`;
  const editable = version.state === 'draft' && scope?.write;
  const unitCode = new Map(units.map(unit => [unit.id, unit.code]));
  const plan = simulate ? simulatePlan(model, choices) : null;
  const electives = units.filter(unit => unit.option_group_id);
  const remove = (kind: string, itemId: string, extra: Record<string, string> = {}) => editable ? (
    <ActionForm inline action={action('remove')} back={back} hidden={{ kind, itemId, ...extra }} submit="Retirer" />
  ) : null;

  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs">
        <a href="/espace">Mon espace</a> › <a href={path}>Catalogue</a> ›{' '}
        <a href={`${path}?scope=${program.owner_scope_id}`}>{program.owner_label}</a> ›{' '}
        <a href={`${path}?program=${program.id}`}>{program.code}</a> › <span aria-current="page">v{version.number}</span>
      </nav>
      <section className="studio-heading">
        <p className="eyebrow">{program.kind_label} · version {version.number}</p>
        <h1>{version.title}</h1>
        <p>{stateBadge(version.state)} {regulatoryBadge(program.regulatory_status)}
          {version.admission_open && <Badge tone="ok">candidatures ouvertes</Badge>}</p>
      </section>
      {notice}

      <Panel title="Cycle de validation" id="cycle">
        <ol className="steps">
          {['draft', 'review', 'approved', 'published'].map(step => (
            <li key={step} className={version.state === step ? 'current' : undefined}>{stateBadge(step)}</li>
          ))}
        </ol>
        {version.review_note && <p className="studio-notice">Observation de revue : {version.review_note}</p>}
        {issues.length > 0 ? (
          <div><p><strong>Incohérences à corriger avant soumission :</strong></p><IssueList issues={issues} /></div>
        ) : <p><Badge tone="ok">Maquette cohérente</Badge></p>}
        <div className="studio-actions">
          {editable && issues.length === 0 && <ActionForm inline action={action('submit')} back={back} submit="Soumettre à la revue" />}
          {version.state === 'review' && scope?.review && version.author_id !== actor && (
            <>
              <ActionForm inline action={action('review')} back={back} hidden={{ decision: 'approve' }} submit="Approuver" />
              <ActionForm inline action={action('review')} back={back} hidden={{ decision: 'reject' }} submit="Renvoyer en brouillon">
                <label className="sr" htmlFor="note-reject">Motif</label>
                <input id="note-reject" name="note" required maxLength={1000} placeholder="Motif du renvoi" />
              </ActionForm>
            </>
          )}
          {version.state === 'review' && version.author_id === actor && <p className="studio-help">La revue revient à une autre personne que l’auteur.</p>}
          {version.state === 'approved' && scope?.publish && (
            <ActionForm inline action={action('publish')} back={back} submit="Publier la version (immuable)" />
          )}
          {version.state === 'published' && scope?.publish && (
            <ActionForm inline action={action('admission')} back={back} hidden={{ open: version.admission_open ? 'false' : 'true' }}
              submit={version.admission_open ? 'Fermer les candidatures' : 'Ouvrir les candidatures'} />
          )}
          {(version.state === 'published' || version.state === 'retired') && scope?.write && (
            <ActionForm inline action={action('derive')} back={`${path}?program=${program.id}`} submit="Préparer une nouvelle version" />
          )}
        </div>
        {version.state === 'published' && !program.admission_allowed &&
          <p className="studio-help">L’ouverture des candidatures exige une autorisation vérifiée en cours de validité.</p>}
      </Panel>

      <Panel title="Caractéristiques" id="caracteristiques">
        <dl className="studio-resolution">
          <div><dt>Organisation</dt><dd>{version.organisation}</dd></div>
          <div><dt>Durée</dt><dd>{version.duration}</dd></div>
          <div><dt>Modalité</dt><dd>{version.delivery_mode}</dd></div>
          <div><dt>Crédits attendus</dt><dd>{version.expected_credits ? `${Number(version.expected_credits)} ${version.credit_unit}` : 'Non fixé'}</dd></div>
          <div><dt>Langues</dt><dd>{version.languages.join(', ') || '—'}</dd></div>
          <div><dt>Capacité</dt><dd>{version.capacity ?? 'Non fixée'}</dd></div>
        </dl>
        {version.objectives && <p className="lead">{version.objectives}</p>}
        {version.admission && <p><strong>Admission :</strong> {version.admission}</p>}
        {editable && (
          <Editor summary="Modifier les caractéristiques">
            <ActionForm action={action('update')} back={back} submit="Enregistrer">
              <label className="studio-wide">Intitulé<input name="title" required maxLength={200} defaultValue={version.title} /></label>
              <label>Organisation<input name="organisation" required maxLength={120} defaultValue={version.organisation} /></label>
              <label>Durée<input name="duration" required maxLength={120} defaultValue={version.duration} /></label>
              <label>Modalité<input name="deliveryMode" required maxLength={120} defaultValue={version.delivery_mode} /></label>
              <label>Unité de crédit<input name="creditUnit" required maxLength={60} defaultValue={version.credit_unit} /></label>
              <label>Total attendu<input type="number" name="expectedCredits" min={0} step="0.01" defaultValue={version.expected_credits ?? ''} /></label>
              <label>Langues<input name="languages" maxLength={120} defaultValue={version.languages.join(' ')} /></label>
              <label>Capacité<input type="number" name="capacity" min={1} defaultValue={version.capacity ?? ''} /></label>
              <label className="studio-wide">Objectifs<textarea name="objectives" maxLength={4000} defaultValue={version.objectives ?? ''} /></label>
              <label className="studio-wide">Conditions d’admission<textarea name="admission" maxLength={4000} defaultValue={version.admission ?? ''} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Maquette" id="maquette">
        {periods.length === 0 && <p>Aucune période. Ajoutez des semestres, trimestres, modules ou sessions selon l’organisation choisie.</p>}
        {periods.map(period => {
          const periodUnits = units.filter(unit => unit.period_id === period.id);
          const periodGroups = groups.filter(group => group.period_id === period.id);
          const credits = periodUnits.filter(unit => !unit.option_group_id).reduce((sum, unit) => sum + Number(unit.credits), 0);
          return (
            <section key={period.id} className="period" aria-labelledby={'period-' + period.id}>
              <div className="panel-head">
                <h3 id={'period-' + period.id}>{period.ordinal}. {period.label}</h3>
                <span className="muted">{credits} {version.credit_unit} obligatoires</span>
                {periodUnits.length === 0 && periodGroups.length === 0 && remove('period', period.id)}
              </div>
              {periodGroups.map(group => (
                <p key={group.id} className="muted">Options « {group.label} » : choisir {group.min_choices} à {group.max_choices}
                  {' '}{units.every(unit => unit.option_group_id !== group.id) && remove('group', group.id)}</p>
              ))}
              {periodUnits.length === 0 ? <p className="muted">Aucune UE.</p> : (
                <Table label={'UE ' + period.label} head={['Code', 'UE', 'Crédits', 'Coef.', 'Statut', 'Volumes', 'Cours', 'Prérequis', 'Compétences', '']}>
                  {periodUnits.map(unit => (
                    <tr key={unit.id}>
                      <td>{unit.code}</td><td>{unit.title}</td><td>{Number(unit.credits)}</td><td>{Number(unit.coefficient)}</td>
                      <td>{unit.option_group_id ? <Badge tone="info">option</Badge> : <Badge tone="muted">obligatoire</Badge>}</td>
                      <td>{unit.volumes.map(volume => `${volume.activity} ${Number(volume.hours)} h`).join(', ') || '—'}</td>
                      <td>{unit.courses.map(course => course.code).join(', ') || '—'}</td>
                      <td>{unit.requires.map(required => (
                        <span key={required} className="chip">{unitCode.get(required)}
                          {remove('prerequisite', unit.id, { requiredUnitId: required })}</span>
                      ))}{unit.requires.length === 0 && '—'}</td>
                      <td>{unit.competencies.map(item => `${item.code} (${item.level})`).join(', ') || '—'}</td>
                      <td>{remove('unit', unit.id)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </section>
          );
        })}
        {editable && (
          <div className="editor-grid">
            <Editor summary="Ajouter une période">
              <ActionForm action={action('periods')} back={back} submit="Ajouter">
                <label>Rang<input type="number" name="ordinal" required min={1} max={100} defaultValue={periods.length + 1} /></label>
                <label>Libellé<input name="label" required maxLength={120} /></label>
              </ActionForm>
            </Editor>
            {periods.length > 0 && (
              <Editor summary="Ajouter un groupe d’options">
                <ActionForm action={action('groups')} back={back} submit="Ajouter">
                  <label>Période<select name="periodId">{periods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
                  <label>Libellé<input name="label" required maxLength={160} /></label>
                  <label>Minimum<input type="number" name="minChoices" required min={0} defaultValue={1} /></label>
                  <label>Maximum<input type="number" name="maxChoices" required min={1} defaultValue={1} /></label>
                </ActionForm>
              </Editor>
            )}
            {periods.length > 0 && (
              <Editor summary="Ajouter une UE">
                <ActionForm action={action('units')} back={back} submit="Ajouter">
                  <label>Période<select name="periodId">{periods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
                  <label>Code<input name="code" required maxLength={32} /></label>
                  <label className="studio-wide">Intitulé<input name="title" required maxLength={200} /></label>
                  <label>Crédits<input type="number" name="credits" required min={0} step="0.01" /></label>
                  <label>Coefficient<input type="number" name="coefficient" min={0.01} step="0.01" defaultValue={1} /></label>
                  <label className="studio-wide">Groupe d’options (vide = obligatoire)<select name="optionGroupId" defaultValue="">
                    <option value="">Obligatoire</option>
                    {groups.map(group => <option key={group.id} value={group.id}>{group.label}</option>)}
                  </select></label>
                </ActionForm>
              </Editor>
            )}
            {units.length > 0 && (
              <Editor summary="Volume horaire d’une UE">
                <ActionForm action={action('volumes')} back={back} submit="Enregistrer">
                  <label>UE<select name="unitId">{units.map(unit => <option key={unit.id} value={unit.id}>{unit.code}</option>)}</select></label>
                  <label>Activité<input name="activity" required maxLength={60} placeholder="cours, TD, TP, projet…" /></label>
                  <label>Heures<input type="number" name="hours" required min={0.01} step="0.01" /></label>
                </ActionForm>
              </Editor>
            )}
            {units.length > 0 && courses.length > 0 && (
              <Editor summary="Rattacher un cours (élément constitutif)">
                <ActionForm action={action('courses')} back={back} submit="Rattacher">
                  <label>UE<select name="unitId">{units.map(unit => <option key={unit.id} value={unit.id}>{unit.code}</option>)}</select></label>
                  <label>Cours<select name="courseId">{courses.map(course => <option key={course.id} value={course.id}>{course.code} · {course.title}</option>)}</select></label>
                  <label>Coefficient<input type="number" name="coefficient" min={0.01} step="0.01" defaultValue={1} /></label>
                  <label>Crédits (facultatif)<input type="number" name="credits" min={0} step="0.01" /></label>
                </ActionForm>
              </Editor>
            )}
            {units.length > 1 && (
              <Editor summary="Ajouter un prérequis">
                <ActionForm action={action('prerequisites')} back={back} submit="Ajouter"
                  confirm="Un prérequis appartient à une période antérieure ; un cycle est refusé.">
                  <label>UE<select name="unitId">{units.map(unit => <option key={unit.id} value={unit.id}>{unit.code}</option>)}</select></label>
                  <label>Exige<select name="requiredUnitId">{units.map(unit => <option key={unit.id} value={unit.id}>{unit.code}</option>)}</select></label>
                </ActionForm>
              </Editor>
            )}
          </div>
        )}
      </Panel>

      <Panel title="Compétences visées" id="competences-version">
        {competencies.length === 0 ? <p>Aucune compétence rattachée.</p> : <ul>{competencies.map(item => <li key={item.id}>{item.code} · {item.label}</li>)}</ul>}
        {editable && availableCompetencies.length > 0 && (
          <Editor summary="Rattacher une compétence">
            <ActionForm action={action('competencies')} back={back} submit="Rattacher">
              <label>Compétence<select name="competencyId">{availableCompetencies.map(item => <option key={item.id} value={item.id}>{item.code} · {item.label}</option>)}</select></label>
              <label>UE (facultatif)<select name="unitId" defaultValue=""><option value="">Programme seulement</option>
                {units.map(unit => <option key={unit.id} value={unit.id}>{unit.code}</option>)}</select></label>
              <label>Niveau visé<input name="level" maxLength={60} placeholder="initiation, maîtrise…" /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Stages, mémoires et soutenances" id="exigences">
        {requirements.length === 0 ? <p>Aucune exigence complémentaire.</p> : (
          <Table label="Exigences" head={['Nature', 'Libellé', 'Crédits', 'Obligatoire', 'Conditions', '']}>
            {requirements.map(item => (
              <tr key={item.id}><td>{requirementLabels[item.kind]}</td><td>{item.label}</td><td>{item.credits ? Number(item.credits) : '—'}</td>
                <td>{item.mandatory ? 'Oui' : 'Non'}</td><td>{item.conditions ?? '—'}</td><td>{remove('requirement', item.id)}</td></tr>
            ))}
          </Table>
        )}
        {editable && (
          <Editor summary="Ajouter un stage, un mémoire ou une soutenance">
            <ActionForm action={action('requirements')} back={back} submit="Ajouter">
              <label>Nature<select name="kind">{Object.entries(requirementLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
              <label>Libellé<input name="label" required maxLength={200} /></label>
              <label>Période<select name="periodId" defaultValue=""><option value="">Toute la formation</option>
                {periods.map(period => <option key={period.id} value={period.id}>{period.label}</option>)}</select></label>
              <label>Crédits<input type="number" name="credits" min={0} step="0.01" /></label>
              <input type="hidden" name="mandatory" value="false" />
              <label className="studio-checkbox"><input type="checkbox" name="mandatory" defaultChecked /> Obligatoire</label>
              <label className="studio-wide">Conditions<textarea name="conditions" maxLength={2000} /></label>
            </ActionForm>
          </Editor>
        )}
      </Panel>

      <Panel title="Zones éligibles" id="zones">
        {territories.length === 0 ? <p>Aucune zone restreinte n’est déclarée.</p> : (
          <ul>{territories.map(item => <li key={item.id}>{item.label} {remove('territory', item.id)}</li>)}</ul>
        )}
        {editable && zones.length > 0 && (
          <ActionForm action={action('territories')} back={back} submit="Ajouter la zone">
            <label>Territoire<select name="territoryId">{zones.map(zone => <option key={zone.id} value={zone.id}>{zone.label}</option>)}</select></label>
          </ActionForm>
        )}
      </Panel>

      <Panel title="Équivalences" id="equivalences">
        {equivalences.length === 0 ? <p>Aucune équivalence déclarée.</p> : (
          <Table label="Équivalences" head={['UE de cette version', 'Équivaut à', 'Note', '']}>
            {equivalences.map(item => (
              <tr key={item.id}><td>{item.target_code}</td><td>{item.source_program} v{item.source_number} · {item.source_code}</td>
                <td>{item.note ?? '—'}</td><td>{remove('equivalence', item.id)}</td></tr>
            ))}
          </Table>
        )}
        {editable && units.length > 0 && equivalenceSources.length > 0 && (
          <ActionForm action={action('equivalences')} back={back} submit="Déclarer l’équivalence">
            <label>UE de cette version<select name="targetUnitId">{units.map(unit => <option key={unit.id} value={unit.id}>{unit.code}</option>)}</select></label>
            <label>UE d’une version publiée<select name="source">{equivalenceSources.map(item => (
              <option key={item.unit_id} value={`${item.version_id}:${item.unit_id}`}>{item.label}</option>))}</select></label>
            <label className="studio-wide">Note<input name="note" maxLength={1000} /></label>
          </ActionForm>
        )}
      </Panel>

      <Panel title="Simuler un plan d’études" id="simulation">
        <form method="get" className="studio-form">
          <input type="hidden" name="version" value={version.id} />
          <input type="hidden" name="simuler" value="1" />
          {electives.length === 0 ? <p className="studio-wide">Aucune option : le plan comprend toutes les UE obligatoires.</p> : (
            <fieldset className="studio-wide"><legend>Options choisies</legend>
              {electives.map(unit => (
                <label key={unit.id} className="studio-checkbox">
                  <input type="checkbox" name="choice" value={unit.id} defaultChecked={choices.includes(unit.id)} /> {unit.code} · {unit.title}
                </label>
              ))}
            </fieldset>
          )}
          <div className="studio-wide"><button className="action" type="submit">Simuler</button></div>
        </form>
        {plan && (
          <div role="status">
            <Table label="Plan simulé" head={['Période', 'UE retenues', 'Crédits']}>
              {plan.periods.map(period => <tr key={period.ordinal}><td>{period.label}</td><td>{period.units.join(', ') || '—'}</td><td>{period.credits}</td></tr>)}
            </Table>
            <p><strong>Total : {plan.total} {version.credit_unit}</strong></p>
            {plan.issues.length === 0 ? <Badge tone="ok">Plan conforme à la maquette</Badge> : <IssueList issues={plan.issues} />}
          </div>
        )}
      </Panel>
    </main>
  );
}
