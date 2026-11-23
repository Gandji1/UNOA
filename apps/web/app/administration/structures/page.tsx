import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { orgContexts, orgDetails } from '@/lib/org/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, shortId, Table } from '../forms';

export const metadata: Metadata = { title: 'Facultés et départements' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/structures';
const api = '/api/v1/org/';

const statusLabels: Record<string, [string, 'ok' | 'warn' | 'muted' | 'danger']> = {
  proposed: ['Proposée', 'warn'], active: ['Active', 'ok'], rejected: ['Refusée', 'danger'], closed: ['Close', 'muted'],
};
const capacityLabels: Record<string, string> = { titular: 'Titulaire', deputy: 'Suppléant', interim: 'Intérim' };
const changeLabels: Record<string, string> = { closure: 'Fermeture', merger: 'Fusion', transfer: 'Transfert' };
const stateLabels: Record<string, string> = { requested: 'En attente', approved: 'Approuvée', rejected: 'Refusée' };

function Status({ status }: { status: string | null }) {
  if (!status) return <Badge tone="info">Établissement</Badge>;
  const [label, tone] = statusLabels[status];
  return <Badge tone={tone}>{label}</Badge>;
}

export default async function Structures({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const token = (await cookies()).get(cookieName(settings, 'session'))?.value;
  const actor = await sessionAccount(settings, token).catch(() => null);
  if (!actor) redirect('/connexion');

  const search = await searchParams;
  const contexts = await orgContexts(settings, actor);
  const requested = field(search.scope);
  const selected = scopeIdFormat.test(requested) ? requested : contexts[0]?.id;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  if (!selected) {
    return (
      <main id="contenu" className="studio">
        <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › Structures</nav>
        <section className="studio-heading"><h1>Facultés et départements</h1>
          <p>Aucun établissement ni aucune composante ne vous est attribué.</p></section>
      </main>
    );
  }
  const data = await orgDetails(settings, actor, selected).catch(error => {
    if (error instanceof Problem) return null;
    throw error;
  });
  if (!data) {
    return (
      <main id="contenu" className="studio">
        <section className="studio-panel"><h1>Facultés et départements</h1>{notice}
          <p>Cette structure est inaccessible.</p><p><a href={path}>Choisir une structure autorisée</a></p></section>
      </main>
    );
  }
  const { scope, children, unitTypes, positions, capacity, changes, lineage, vacancies } = data;
  const back = `${path}?scope=${scope.id}`;
  const unit = scope.nature === 'academic_unit';
  const living = !unit || scope.status === 'active';
  const others = contexts.filter(item => item.id !== scope.id);

  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs">
        <a href="/espace">Mon espace</a> › <a href={path}>Structures</a>
        {scope.parent_label && <> › {scope.parent_label}</>} › <span aria-current="page">{scope.label}</span>
      </nav>
      <section className="studio-heading">
        <p className="eyebrow">Organisation institutionnelle</p>
        <h1>{scope.label}</h1>
        <p>Composantes, responsables, capacités et réorganisations. Chaque décision est datée, motivée et validée par une autre personne.</p>
      </section>
      {notice}

      <section className="studio-panel" aria-label="Choix de la structure">
        <form method="get" className="studio-form studio-filters">
          <label>Structure<select name="scope" defaultValue={scope.id}>
            {(contexts.some(item => item.id === scope.id) ? contexts : [scope, ...contexts]).map(item => (
              <option key={item.id} value={item.id}>{item.nature === 'institution' ? '◆ ' : ''}{item.label}</option>
            ))}
          </select></label>
          <button type="submit" className="action">Consulter</button>
        </form>
      </section>

      <Panel title="Identité" id="identite">
        <dl className="studio-resolution">
          <div><dt>Type</dt><dd>{scope.type_label}</dd></div>
          <div><dt>Statut</dt><dd><Status status={scope.status} /></dd></div>
          {unit && <div><dt>Code</dt><dd>{scope.code}</dd></div>}
          <div><dt>Rattachement</dt><dd>{scope.parent_label ?? 'Racine'}</dd></div>
          {unit && <div><dt>Établissement</dt><dd>{scope.institution_label}</dd></div>}
          <div><dt>Présence</dt><dd>{formatTime(scope.present_from)} → {formatTime(scope.present_until)}</dd></div>
          {unit && <div><dt>Organigramme public</dt><dd>{scope.public ? 'Publié' : 'Non publié'}</dd></div>}
        </dl>
        {scope.mission && <p className="lead">{scope.mission}</p>}
        {unit && scope.status === 'proposed' && scope.approve && scope.proposed_by !== actor && (
          <div className="studio-actions">
            <ActionForm inline action={`${api}units/${scope.id}/decide`} back={back} hidden={{ decision: 'approve' }} submit="Approuver l’unité" />
            <ActionForm inline action={`${api}units/${scope.id}/decide`} back={back} hidden={{ decision: 'reject' }} submit="Refuser" />
          </div>
        )}
        {unit && scope.status === 'proposed' && scope.proposed_by === actor &&
          <p className="studio-help">Vous avez proposé cette unité : sa validation revient à une autre personne habilitée.</p>}
      </Panel>

      <Panel title="Organigramme" id="organigramme">
        {children.length === 0 ? <p>Aucune composante rattachée.</p> : (
          <ul className="org-tree">
            {children.map(child => (
              <li key={child.id}>
                <a href={`${path}?scope=${child.id}`}>{child.label}</a>
                <span className="muted"> · {child.type_label} · {child.code}</span> <Status status={child.status} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {scope.write && living && (unitTypes.length === 0 ? (
        <section className="studio-panel"><h2>Créer une composante</h2>
          <p>Aucun type d’unité académique n’est déclaré sous « {scope.type_label} ». Déclarez-le dans
            le studio des territoires avec la nature « Unité académique ».</p></section>
      ) : (
        <Editor summary="Proposer une composante (faculté, école, département, laboratoire…)">
          <ActionForm action={`${api}units`} back={back} hidden={{ parentId: scope.id }} submit="Proposer"
            confirm="La composante restera « proposée » jusqu’à sa validation par une autre personne habilitée.">
            <label>Type<select name="typeCode" required>
              {unitTypes.map(type => <option key={type.code} value={type.code}>{type.label}</option>)}
            </select></label>
            <label>Code<input name="code" required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9._\-]{0,31}" /></label>
            <label className="studio-wide">Intitulé<input name="label" required maxLength={160} /></label>
            <label>Début (UTC)<input type="datetime-local" name="presentFrom" required /></label>
            <label className="studio-checkbox"><input type="checkbox" name="public" /> Publier dans l’organigramme public</label>
            <label className="studio-wide">Mission<textarea name="mission" maxLength={2000} /></label>
          </ActionForm>
        </Editor>
      ))}

      {unit && scope.write && (scope.status === 'proposed' || scope.status === 'active') && (
        <Editor summary="Modifier l’intitulé, la mission ou la publication">
          <ActionForm action={`${api}units/${scope.id}/update`} back={back} submit="Enregistrer">
            <label className="studio-wide">Intitulé<input name="label" required maxLength={160} defaultValue={scope.label} /></label>
            <label className="studio-wide">Mission<textarea name="mission" maxLength={2000} defaultValue={scope.mission ?? ''} /></label>
            <label className="studio-checkbox"><input type="checkbox" name="public" defaultChecked={scope.public ?? false} /> Publier</label>
          </ActionForm>
        </Editor>
      )}

      {unit && (
        <Panel title="Responsables et postes" id="postes">
          {vacancies.length > 0 && <p className="studio-notice" role="status">Poste(s) vacant(s) : {vacancies.join(', ')}.</p>}
          {positions.length === 0 ? <p>Aucun poste défini.</p> : positions.map(position => (
            <article key={position.id} className="position">
              <h3>{position.title} {position.is_head && <Badge tone="info">Responsable de l’unité</Badge>}
                {' '}<span className="muted">{position.seats} siège(s){position.public ? ' · public' : ''}</span></h3>
              {position.appointments.length === 0 ? <p className="muted">Aucune nomination.</p> : (
                <Table label={'Nominations ' + position.title} head={['Personne', 'Qualité', 'Période', 'Motif', 'Action']}>
                  {position.appointments.map(item => (
                    <tr key={item.id}>
                      <td>{item.public_name ?? 'Compte ' + shortId(item.account_id)}</td>
                      <td>{capacityLabels[item.capacity]} {item.current && <Badge tone="ok">en fonction</Badge>}</td>
                      <td>{formatTime(item.effective_from)} → {formatTime(item.effective_until)}</td>
                      <td>{item.reason}</td>
                      <td>{scope.write && (item.effective_until === null || new Date(item.effective_until) > new Date()) ? (
                        <ActionForm inline action={`${api}appointments/${item.id}/end`} back={back} submit="Mettre fin">
                          <label className="sr" htmlFor={'end-' + item.id}>Date de fin</label>
                          <input id={'end-' + item.id} type="datetime-local" name="effectiveUntil" required />
                        </ActionForm>
                      ) : '—'}</td>
                    </tr>
                  ))}
                </Table>
              )}
              {scope.write && scope.status === 'active' && (
                <Editor summary="Nommer sur ce poste">
                  <ActionForm action={`${api}positions/${position.id}/appointments`} back={back} submit="Nommer">
                    <label>Identifiant du compte<input name="accountId" required pattern="[0-9a-fA-F\-]{36}" /></label>
                    <label>Qualité<select name="capacity">
                      {Object.entries(capacityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select></label>
                    <label>Nom publié (facultatif)<input name="publicName" maxLength={160} /></label>
                    <label>Motif ou acte<input name="reason" required maxLength={500} /></label>
                    <label>Début (UTC)<input type="datetime-local" name="effectiveFrom" required /></label>
                    <label>Fin (UTC, facultative)<input type="datetime-local" name="effectiveUntil" /></label>
                  </ActionForm>
                </Editor>
              )}
            </article>
          ))}
          {scope.write && scope.status === 'active' && (
            <Editor summary="Créer un poste">
              <ActionForm action={`${api}units/${scope.id}/positions`} back={back} submit="Créer le poste">
                <label>Intitulé<input name="title" required maxLength={160} /></label>
                <label>Sièges<input type="number" name="seats" min={1} max={500} defaultValue={1} /></label>
                <label className="studio-checkbox"><input type="checkbox" name="isHead" /> Responsable de l’unité</label>
                <label className="studio-checkbox"><input type="checkbox" name="public" /> Poste visible publiquement</label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
      )}

      {unit && (
        <Panel title="Capacités et ressources" id="capacites">
          {capacity.length === 0 ? <p>Aucune capacité enregistrée.</p> : (
            <Table label="Capacités en vigueur" head={['Ressource', 'Quantité', 'Depuis', 'Motif']}>
              {capacity.map(item => (
                <tr key={item.resource}>
                  <td>{item.resource}</td><td>{Number(item.quantity).toLocaleString('fr-FR')} {item.measure}</td>
                  <td>{formatTime(item.effective_from)}</td><td>{item.reason}</td>
                </tr>
              ))}
            </Table>
          )}
          {scope.write && scope.status === 'active' && (
            <Editor summary="Enregistrer une capacité datée">
              <ActionForm action={`${api}units/${scope.id}/capacities`} back={back} submit="Enregistrer">
                <label>Ressource<input name="resource" required maxLength={120} /></label>
                <label>Quantité<input type="number" name="quantity" required min={0} step="0.01" /></label>
                <label>Unité de mesure<input name="measure" required maxLength={60} /></label>
                <label>À compter du (UTC)<input type="datetime-local" name="effectiveFrom" required /></label>
                <label className="studio-wide">Motif<input name="reason" required maxLength={500} /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
      )}

      {unit && (
        <Panel title="Réorganisations et historique" id="reorganisations">
          {lineage.length > 0 && (
            <ul>{lineage.map(item => (
              <li key={item.direction + item.other_id}>
                {item.direction === 'successor' ? 'Reprise par ' : 'Reprend '}
                <a href={`${path}?scope=${item.other_id}`}>{item.other_label}</a> ({changeLabels[item.kind]})
              </li>
            ))}</ul>
          )}
          {changes.length === 0 ? <p>Aucune réorganisation demandée.</p> : (
            <Table label="Demandes de réorganisation" head={['Nature', 'Cible', 'Effet', 'État', 'Motif', 'Décision']}>
              {changes.map(change => (
                <tr key={change.id}>
                  <td>{changeLabels[change.kind]}</td><td>{change.target_label ?? '—'}</td>
                  <td>{formatTime(change.effective_at)}</td><td>{stateLabels[change.state]}</td><td>{change.reason}</td>
                  <td>{change.state === 'requested' && scope.approve && change.requested_by !== actor ? (
                    <div className="studio-actions">
                      <ActionForm inline action={`${api}changes/${change.id}/decide`} back={back} hidden={{ decision: 'approve' }} submit="Approuver" />
                      <ActionForm inline action={`${api}changes/${change.id}/decide`} back={back} hidden={{ decision: 'reject' }} submit="Refuser" />
                    </div>
                  ) : change.decision_note ?? '—'}</td>
                </tr>
              ))}
            </Table>
          )}
          {scope.write && scope.status === 'active' && (
            <Editor summary="Demander une fermeture, une fusion ou un transfert">
              <ActionForm action={`${api}units/${scope.id}/reorganize`} back={back} submit="Soumettre la demande"
                confirm="Les fonctions en cours prennent fin à la date d’effet. Les composantes filles doivent être closes auparavant.">
                <label>Nature<select name="kind">
                  {Object.entries(changeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select></label>
                <label>Cible (fusion : unité absorbante ; transfert : nouvelle structure mère)<select name="targetId" defaultValue="">
                  <option value="">— aucune (fermeture) —</option>
                  {others.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
                </select></label>
                <label>Date d’effet (UTC)<input type="datetime-local" name="effectiveAt" required /></label>
                <label className="studio-wide">Motif<textarea name="reason" required maxLength={1000} /></label>
              </ActionForm>
            </Editor>
          )}
        </Panel>
      )}
    </main>
  );
}
