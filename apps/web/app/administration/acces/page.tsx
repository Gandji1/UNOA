import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { accessOverview, accountDetails, adminContexts, auditTrail, roleCatalogue } from '@/lib/iam/admin';
import { ActionForm, Badge, Editor, formatTime, Hidden, Notice, Panel, Table } from '../forms';

export const metadata: Metadata = { title: 'Utilisateurs et rôles' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/acces';
const api = '/api/v1/iam/';
const levelLabels: Record<string, string> = { platform: 'Plateforme', territory: 'Pays', institution: 'Établissement', unit: 'Faculté / département' };
const origins: Record<string, string> = { bootstrap: 'Amorçage', invitation: 'Invitation', registration: 'Inscription libre', provisioned: 'Provisionné' };
const invitationState = (item: { accepted_at: Date | null; revoked_at: Date | null; expires_at: Date }) =>
  item.accepted_at ? <Badge tone="ok">Acceptée</Badge> : item.revoked_at ? <Badge tone="muted">Retirée</Badge>
    : new Date(item.expires_at) < new Date() ? <Badge tone="muted">Expirée</Badge> : <Badge tone="info">En attente</Badge>;

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Access({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const denied = <main id="contenu" className="studio"><section className="studio-panel"><h1>Utilisateurs et rôles</h1>{notice}
    <p>Élément inaccessible avec vos habilitations.</p><p><a href={path}>Revenir</a></p></section></main>;
  const crumbs = (...parts: [string, string?][]) => (
    <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> › <a href={path}>Utilisateurs et rôles</a>
      {parts.map(([label, href], index) => <span key={index}> › {href ? <a href={href}>{label}</a> : <span aria-current="page">{label}</span>}</span>)}</nav>
  );
  const contexts = await adminContexts(settings, actor);

  // ---------------------------------------------------------------- roles
  if (field(search.vue) === 'roles') {
    const data = await roleCatalogue(settings, actor).catch(refused);
    if (!data) return denied;
    const modules = Array.from(new Set<string>(data.permissions.map(item => item.module ?? 'Autres')));
    const editing = data.roles.find(item => item.code === field(search.role) && !item.system);
    const permissionsPicker = (selected: string[]) => modules.map(module => (
      <fieldset key={module} className="studio-wide"><legend>{module}</legend>
        {data.permissions.filter(item => (item.module ?? 'Autres') === module).map(item => (
          <label key={item.code} className="check"><input type="checkbox" name="permissions" value={item.code} defaultChecked={selected.includes(item.code)} />
            {item.label ?? item.code} <code>{item.code}</code>{item.sensitive && <Badge tone="warn">sensible</Badge>}</label>
        ))}
      </fieldset>
    ));
    return (
      <main id="contenu" className="studio">
        {crumbs(['Rôles'])}
        <section className="studio-heading"><p className="eyebrow">Identité et permissions</p><h1>Rôles et permissions</h1>
          <p>Les permissions sont définies par le logiciel ; l’administration compose librement les rôles. Personne ne compose un rôle au-delà de ses propres permissions.</p></section>
        {notice}
        <Panel title="Rôles" id="roles">
          <Table label="Rôles" head={['Rôle', 'Code', 'Permissions', 'État', '']}>
            {data.roles.map(item => (
              <tr key={item.code}><td>{item.label ?? item.code}{item.description && <p className="muted">{item.description}</p>}</td><td><code>{item.code}</code></td>
                <td>{item.system ? 'Toutes' : item.permissions.join(', ')}</td>
                <td><Badge tone="info">{levelLabels[item.level] ?? item.level}</Badge>{' '}
                  {item.system ? <Badge tone="info">Amorçage</Badge> : item.archived_at ? <Badge tone="muted">Archivé</Badge> : <Badge tone="ok">Actif</Badge>}</td>
                <td>{data.manage && !item.system && !item.archived_at && <>
                  <a href={`${path}?vue=roles&role=${item.code}#composer`}>Modifier</a>{' '}
                  <ActionForm inline action={api + 'archive-role'} back={`${path}?vue=roles`} hidden={{ code: item.code }} submit="Archiver" />
                </>}</td></tr>
            ))}
          </Table>
        </Panel>
        {data.manage && (
          <section className="studio-panel" id="composer" aria-labelledby="composer-titre">
            <h2 id="composer-titre">{editing ? 'Modifier le rôle ' + (editing.label ?? editing.code) : 'Composer un rôle'}</h2>
            <ActionForm action={api + 'roles'} back={`${path}?vue=roles`} submit={editing ? 'Enregistrer' : 'Créer le rôle'}>
              <label>Code technique<input name="code" required pattern="[a-z][a-z0-9_]{0,62}" defaultValue={editing?.code} readOnly={!!editing} /></label>
              <label>Libellé<input name="label" required maxLength={120} defaultValue={editing?.label ?? ''} /></label>
              <label>Niveau<select name="level" defaultValue={editing?.level ?? 'institution'}>
                <option value="platform">Plateforme</option><option value="territory">Pays ou territoire</option>
                <option value="institution">Établissement ou campus</option><option value="unit">Faculté ou département</option></select></label>
              <label className="studio-wide">Description<textarea name="description" maxLength={1000} defaultValue={editing?.description ?? ''} /></label>
              {permissionsPicker(editing?.permissions ?? [])}
            </ActionForm>
          </section>
        )}
      </main>
    );
  }

  // -------------------------------------------------------------- account
  const accountId = field(search.compte);
  if (scopeIdFormat.test(accountId)) {
    const data = await accountDetails(settings, actor, accountId).catch(refused);
    if (!data) return denied;
    const { account } = data;
    const back = `${path}?compte=${account.id}`;
    const assignScopes = contexts;
    const roles = (await accessOverview(settings, actor, field(search.portee) || assignScopes[0]?.id || '').catch(() => null))?.roles ?? [];
    const target = field(search.portee) || assignScopes[0]?.id || '';
    return (
      <main id="contenu" className="studio">
        {crumbs([account.display_name ?? 'Compte'])}
        <section className="studio-heading"><p className="eyebrow">Compte · {origins[account.origin]}</p><h1>{account.display_name ?? 'Compte sans nom'}</h1>
          <p>{account.email ?? 'Courriel non renseigné'} · créé le {formatTime(account.created_at)}{' '}
            {account.disabled_at ? <Badge tone="danger">Désactivé : {account.disabled_reason}</Badge> : <Badge tone="ok">Actif</Badge>}</p></section>
        {notice}
        <Panel title="Rôles attribués" id="attributions">
          {data.grants.length === 0 ? <p>Aucun rôle : le compte n’accède qu’à ses propres espaces.</p> : (
            <Table label="Attributions" head={['Rôle', 'Périmètre', 'Période', 'Justification', 'État', '']}>
              {data.grants.map(item => (
                <tr key={item.grant_id}>
                  <td>{item.role_label ?? item.role_code}{item.delegated_from && <Badge tone="info">délégation</Badge>}</td>
                  <td>{item.scope_label}{item.include_descendants ? ' et sous-structures' : ''}</td>
                  <td>{formatTime(item.effective_from)} → {item.effective_until ? formatTime(item.effective_until) : 'sans terme'}</td>
                  <td>{item.reason ?? '—'}{item.granted_by_name && <p className="muted">par {item.granted_by_name}</p>}</td>
                  <td>{item.revoked_at ? <Badge tone="muted">Retiré : {item.revoke_reason}</Badge> : <Badge tone="ok">En vigueur</Badge>}</td>
                  <td>{!item.revoked_at && !data.self && (
                    <ActionForm inline action={api + 'revoke'} back={back} hidden={{ grantId: item.grant_id, accountId: account.id }} submit="Retirer">
                      <input name="reason" required maxLength={500} aria-label="Justification du retrait" placeholder="Justification" />
                    </ActionForm>
                  )}</td>
                </tr>
              ))}
            </Table>
          )}
        </Panel>
        {!data.self && assignScopes.length > 0 && (
          <Editor summary="Attribuer un rôle">
            <form method="get" action={path} className="studio-inline"><input type="hidden" name="compte" value={account.id} />
              <select name="portee" defaultValue={target} aria-label="Périmètre">{assignScopes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
              <button className="secondary" type="submit">Choisir le périmètre</button></form>
            <ActionForm action={api + 'grants'} back={back} hidden={{ accountId: account.id, scopeId: target }} submit="Attribuer"
              confirm="Seuls les rôles dont vous détenez toutes les permissions dans ce périmètre sont proposés.">
              <label className="studio-wide">Rôle<select name="role" required>{roles.filter(item => item.assignable).map(item => <option key={item.code} value={item.code}>{item.label ?? item.code}{item.description ? ' — ' + item.description : ''}</option>)}</select></label>
              <label className="check"><input type="checkbox" name="includeDescendants" defaultChecked /> Inclure les sous-structures</label>
              <label>Fin (UTC, facultative)<input type="datetime-local" name="effectiveUntil" /></label>
              <label className="studio-wide">Justification<input name="reason" required maxLength={500} /></label>
            </ActionForm>
          </Editor>
        )}
        <Panel title="Sessions" id="sessions">
          {data.sessions.length === 0 ? <p>Aucune session.</p> : (
            <Table label="Sessions" head={['Ouverture', 'Expiration', 'État']}>
              {data.sessions.map((item, index) => <tr key={index}><td>{formatTime(item.started_at)}</td><td>{formatTime(item.expires_at)}</td>
                <td>{item.revoked_at ? 'Révoquée' : new Date(item.expires_at) < new Date() ? 'Expirée' : 'Active'}</td></tr>)}
            </Table>
          )}
          {data.manageable && !data.self && (
            <ActionForm inline action={api + 'reset-password'} back={back} hidden={{ accountId: account.id }} submit="Réinitialiser le mot de passe">
              <input name="password" type="text" required maxLength={200} placeholder="Nouveau mot de passe" aria-label="Nouveau mot de passe" autoComplete="off" />
            </ActionForm>
          )}
          {data.manageable && !data.self && <div className="studio-actions">
            <ActionForm inline action={api + 'sessions'} back={back} hidden={{ accountId: account.id }} submit="Révoquer toutes les sessions" />
            {account.disabled_at
              ? <ActionForm inline action={api + 'enable'} back={back} hidden={{ accountId: account.id }} submit="Réactiver le compte" />
              : <ActionForm inline action={api + 'disable'} back={back} hidden={{ accountId: account.id }} submit="Désactiver le compte">
                  <input name="reason" required maxLength={500} aria-label="Justification de la désactivation" placeholder="Justification" />
                </ActionForm>}
          </div>}
        </Panel>
      </main>
    );
  }

  // ---------------------------------------------------------------- audit
  const scopeId = field(search.scope);
  if (field(search.vue) === 'journal' && scopeIdFormat.test(scopeId)) {
    const data = await auditTrail(settings, actor, scopeId, field(search.prefixe) || undefined, field(search.avant) || undefined).catch(refused);
    if (!data) return denied;
    const last = data.events.at(-1);
    return (
      <main id="contenu" className="studio">
        {crumbs(['Journal d’audit'])}
        <section className="studio-heading"><p className="eyebrow">Traçabilité</p><h1>Journal d’audit</h1>
          <p>Actions autorisées et refusées dans le périmètre, horodatées, non modifiables.</p></section>
        <form method="get" action={path} className="studio-inline"><Hidden values={{ vue: 'journal', scope: scopeId }} />
          <input name="prefixe" defaultValue={field(search.prefixe)} placeholder="Préfixe (ex. iam., adm.)" aria-label="Filtrer par action" pattern="[a-z][a-z0-9_.]{0,40}" />
          <button className="secondary" type="submit">Filtrer</button></form>
        <Table label="Événements" head={['Date', 'Action', 'Résultat', 'Auteur', 'Périmètre', 'Corrélation']}>
          {data.events.map(item => (
            <tr key={item.id}><td>{formatTime(item.occurred_at)}</td><td><code>{item.action}</code></td>
              <td>{item.outcome === 'allowed' ? <Badge tone="ok">autorisé</Badge> : <Badge tone="danger">{item.outcome === 'denied' ? 'refusé' : 'échec'}</Badge>}</td>
              <td>{item.actor_id ? <a href={`${path}?compte=${item.actor_id}`}>{item.actor_name ?? item.actor_id.slice(0, 8)}</a> : '—'}</td>
              <td>{item.scope_label ?? 'Plateforme'}</td><td><code>{item.correlation_id.slice(0, 8)}</code></td></tr>
          ))}
        </Table>
        {last && data.events.length === 100 && <p><a href={`${path}?vue=journal&scope=${scopeId}&prefixe=${field(search.prefixe)}&avant=${new Date(last.occurred_at).toISOString()}`}>Événements plus anciens</a></p>}
      </main>
    );
  }

  // ---------------------------------------------------------------- scope
  if (scopeIdFormat.test(scopeId)) {
    const data = await accessOverview(settings, actor, scopeId, field(search.q)).catch(refused);
    if (!data) return denied;
    const back = `${path}?scope=${scopeId}`;
    const link = field(search.lien);
    return (
      <main id="contenu" className="studio">
        {crumbs([data.scope.label])}
        <section className="studio-heading"><p className="eyebrow">Utilisateurs et rôles</p><h1>{data.scope.label}</h1>
          <p className="studio-actions"><a href={`${path}?vue=roles`}>Rôles et permissions</a> <a href="/administration/guide">Qui fait quoi</a>
            {data.rights.audit && <a href={`${path}?vue=journal&scope=${scopeId}`}>Journal d’audit</a>}</p></section>
        {notice}
        {link.startsWith(settings.origin.origin + '/invitation/') && (
          <section className="studio-notice success" role="status"><p>Invitation créée. Transmettez ce lien personnel à la personne invitée ; il ne sera plus affiché.</p>
            <p><input readOnly value={link} aria-label="Lien d’invitation" className="studio-wide" /></p></section>
        )}
        {data.rights.read && (
          <Panel title="Comptes" id="comptes" actions={
            <form method="get" action={path} className="studio-inline"><input type="hidden" name="scope" value={scopeId} />
              <input name="q" defaultValue={field(search.q)} placeholder="Nom ou courriel" aria-label="Rechercher un compte" maxLength={100} />
              <button className="secondary" type="submit">Rechercher</button></form>}>
            {data.accounts.length === 0 ? <p>Aucun compte rattaché à ce périmètre.</p> : (
              <Table label="Comptes" head={['Nom', 'Courriel', 'Origine', 'Rôles', 'Sessions', 'État']}>
                {data.accounts.map(item => (
                  <tr key={item.id}><td><a href={`${path}?compte=${item.id}`}>{item.display_name ?? 'Compte ' + item.id.slice(0, 8)}</a></td>
                    <td>{item.email ?? '—'}</td><td>{origins[item.origin]}</td><td>{item.grants}</td><td>{item.sessions}</td>
                    <td>{item.disabled_at ? <Badge tone="danger">Désactivé</Badge> : <Badge tone="ok">Actif</Badge>}</td></tr>
                ))}
              </Table>
            )}
          </Panel>
        )}
        {data.rights.manage && (
          <Editor summary="Inviter une personne">
            <form method="post" action={api + 'invitations'} className="studio-form">
              <Hidden values={{ scopeId }} />
              <label>Nom complet<input name="displayName" required maxLength={200} /></label>
              <label>Courriel (facultatif)<input name="email" type="email" maxLength={254} /></label>
              <label className="studio-wide">Rôle<select name="role" required>{data.roles.filter(item => item.assignable).map(item => <option key={item.code} value={item.code}>{item.label ?? item.code}{item.description ? ' — ' + item.description : ''}</option>)}</select></label>
              <label>Validité (jours)<input name="validDays" type="number" min={1} max={30} defaultValue={7} required /></label>
              <label>Fin du rôle (UTC, facultative)<input type="datetime-local" name="effectiveUntil" /></label>
              <label className="check"><input type="checkbox" name="includeDescendants" value="true" defaultChecked /> Inclure les sous-structures</label>
              <label className="studio-wide">Justification<input name="reason" required maxLength={500} /></label>
              <p className="studio-wide studio-help">La personne ouvre le lien, choisit son identifiant et son mot de passe ; le rôle lui est alors attribué sur ce périmètre. Sans service de courriel configuré, le lien est à transmettre par vos soins.</p>
              <div className="studio-wide"><button className="action" type="submit">Créer l’invitation</button></div>
            </form>
          </Editor>
        )}
        {data.invitations.length > 0 && (
          <Panel title="Invitations" id="invitations">
            <Table label="Invitations" head={['Personne', 'Rôle', 'Périmètre', 'Expiration', 'État', '']}>
              {data.invitations.map(item => (
                <tr key={item.id}><td>{item.display_name}{item.email && <p className="muted">{item.email}</p>}</td><td>{item.role_code}</td>
                  <td>{item.scope_label}</td><td>{formatTime(item.expires_at)}</td><td>{invitationState(item)}</td>
                  <td>{data.rights.manage && !item.accepted_at && !item.revoked_at &&
                    <ActionForm inline action={api + 'revoke-invitation'} back={back} hidden={{ invitationId: item.id, scopeId }} submit="Retirer" />}</td></tr>
              ))}
            </Table>
          </Panel>
        )}
      </main>
    );
  }

  return (
    <main id="contenu" className="studio">
      {crumbs()}
      <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Utilisateurs et rôles</h1>
        <p>Comptes, invitations, rôles composés, attributions justifiées, délégations, sessions et journal d’audit.</p>
        <p><a href={`${path}?vue=roles`}>Rôles et permissions</a></p></section>
      {notice}
      {contexts.length === 0 ? <p className="card-note">Aucun périmètre administrable.</p> : (
        <ul className="program-grid">{contexts.map(item => <li key={item.id} className="program-card"><p className="eyebrow">{item.nature}</p>
          <h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>
      )}
    </main>
  );
}
