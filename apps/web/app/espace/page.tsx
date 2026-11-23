import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings } from '@/lib/iam/settings';
import { readableScopes } from '@/lib/config/store';
import { readableTerritories } from '@/lib/territory/store';
import { orgContexts } from '@/lib/org/store';
import { catalogContexts } from '@/lib/catalog/access';
import { myOfferings } from '@/lib/lms/offerings';
import { siteContexts } from '@/lib/site/store';
import { lmsContexts } from '@/lib/lms/studio';
import { sessionAccount } from '@/lib/iam/sessions';
import { accountDetails } from '@/lib/iam/admin';
import { contactSettings } from '@/lib/notifications/admin';
import { credentialState } from '@/lib/iam/local';
import { navigation } from '@/lib/iam/navigation';
import { ActionForm, Badge, formatTime, Notice } from '../administration/forms';

export const metadata: Metadata = { title: 'Mon espace' };
export const dynamic = 'force-dynamic';

export default async function Espace({ searchParams }: { searchParams: Promise<{ statut?: string; error?: string; message?: string; changer?: string }> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const token = (await cookies()).get(cookieName(settings, 'session'))?.value;
  let account: string | null;
  try {
    account = await sessionAccount(settings, token);
  } catch {
    redirect('/connexion?statut=indisponible');
  }
  if (!account) redirect('/connexion');

  const { statut, error, message, changer } = await searchParams;
  const [me, menu, contact] = await Promise.all([accountDetails(settings, account, account), navigation(), contactSettings(settings, account)]);
  const credential = await credentialState(settings, account);
  const administration = menu.groups.some(group => group.label === 'Administration');
  const own = me.grants.filter(item => !item.revoked_at && !item.delegated_from && (!item.effective_until || new Date(item.effective_until) > new Date()));
  const [configuration, territories, structures, catalogue] = await Promise.all([
    readableScopes(settings, account).catch(() => []),
    readableTerritories(settings, account).catch(() => []),
    orgContexts(settings, account).catch(() => []),
    catalogContexts(settings, account).catch(() => []),
  ]);
  const [learning, studio, sites] = await Promise.all([
    myOfferings(settings, account).catch(() => []),
    lmsContexts(settings, account).catch(() => []),
    siteContexts(settings, account).catch(() => []),
  ]);
  return (
    <main id="contenu" className="page">
      <section className="account-panel">
        <h1>Mon espace</h1>
        {statut === 'indisponible'
          ? <p role="status">La déconnexion a échoué. Réessayez.</p>
          : <p>Votre session institutionnelle est active.</p>}
        <Notice error={error} message={message} />
        {administration && <p><a className="action" href="/administration">Console d’administration</a></p>}
        <p><a href="/apprendre">Mes cours{learning.length > 0 ? ` (${learning.length})` : ''}</a> · <a href="/candidature">Mes candidatures</a></p>
        {[configuration, territories, structures, catalogue, studio, sites].every(list => list.length === 0) && !administration &&
          <p className="muted">Aucun rôle d’administration ne vous est attribué.</p>}
      </section>
      <section className="account-panel" aria-labelledby="profil">
        <h2 id="profil">Profil</h2>
        <ActionForm action="/api/v1/iam/profile" back="/espace" submit="Enregistrer le profil">
          <label>Nom complet<input name="displayName" required maxLength={200} defaultValue={me.account.display_name ?? ''} /></label>
          <label>Courriel de contact<input name="email" type="email" maxLength={254} defaultValue={me.account.email ?? ''} /></label>
        </ActionForm>
      </section>
      {me.grants.length > 0 && (
        <section className="account-panel" aria-labelledby="roles">
          <h2 id="roles">Mes rôles</h2>
          <ul>{me.grants.map(item => (
            <li key={item.grant_id}>{item.role_label ?? item.role_code} — {item.scope_label}
              {item.effective_until && ' (jusqu’au ' + formatTime(item.effective_until) + ')'}{' '}
              {item.revoked_at ? <Badge tone="muted">retiré</Badge> : item.delegated_from ? <Badge tone="info">délégation reçue</Badge> : null}</li>
          ))}</ul>
          {own.length > 0 && (
            <details><summary>Déléguer temporairement un rôle</summary>
              <ActionForm action="/api/v1/iam/delegate" back="/espace" submit="Déléguer" confirm="La délégation est limitée à 90 jours, justifiée, auditée, et prend fin avec votre propre rôle.">
                <label>Rôle<select name="grantId">{own.map(item => <option key={item.grant_id} value={item.grant_id}>{item.role_label ?? item.role_code} — {item.scope_label}</option>)}</select></label>
                <label>Identifiant du compte bénéficiaire<input name="accountId" required pattern="[0-9a-fA-F-]{36}" /></label>
                <label>Fin (UTC)<input type="datetime-local" name="effectiveUntil" required /></label>
                <label>Justification<input name="reason" required maxLength={500} /></label>
              </ActionForm>
            </details>
          )}
        </section>
      )}
      <section className="account-panel" aria-labelledby="contact">
        <h2 id="contact">Langue, coordonnées et notifications</h2>
        <ActionForm action="/api/v1/notifications/contact" back="/espace" submit="Enregistrer">
          <label>Langue des messages<select name="language" defaultValue={contact.language ?? ''}><option value="">Langue du site</option>
            <option value="fr">Français</option><option value="en">English</option></select></label>
          <label>Téléphone (format international)<input name="phone" type="tel" defaultValue={contact.phone ?? ''} placeholder="+229…" maxLength={20} /></label>
        </ActionForm>
        {(['email', 'sms'] as const).map(channel => (
          <p key={channel}>{channel === 'email' ? 'Courriel' : 'SMS'} : {contact.current[channel] ? <Badge tone="ok">accepté</Badge> : <Badge tone="muted">refusé</Badge>}{' '}
            <ActionForm inline action="/api/v1/notifications/consent" back="/espace" hidden={{ channel, granted: contact.current[channel] ? 'false' : 'true' }}
              submit={contact.current[channel] ? 'Retirer mon consentement' : 'Accepter de recevoir des messages'} /></p>
        ))}
        {(contact.current.email || contact.current.sms) && (
          <details><summary>Choisir les messages reçus hors de la plateforme</summary>
            <ul>{contact.events.flatMap(item => (['email', 'sms'] as const).filter(channel => contact.current[channel]).map(channel => {
              const enabled = contact.preferences.find(pref => pref.event_code === item.code && pref.channel === channel)?.enabled ?? true;
              return <li key={item.code + channel}><code>{item.code}</code> · {channel === 'email' ? 'courriel' : 'SMS'} : {enabled ? 'activé' : 'désactivé'}{' '}
                <ActionForm inline action="/api/v1/notifications/preference" back="/espace" hidden={{ event: item.code, channel, enabled: enabled ? 'false' : 'true' }}
                  submit={enabled ? 'Désactiver' : 'Activer'} /></li>;
            }))}</ul>
          </details>
        )}
        <p><a href="/api/v1/notifications/contact/export">Exporter mes consentements et préférences (JSON)</a></p>
      </section>
      {credential && (
        <section className="account-panel" aria-labelledby="mot-de-passe-titre" id="mot-de-passe">
          <h2 id="mot-de-passe-titre">Identifiant et mot de passe</h2>
          {(credential.must_change || changer) && <p className="studio-notice" role="alert">Choisissez un mot de passe personnel : celui qui vous a été remis est provisoire.</p>}
          <p>Identifiant : <code>{credential.login}</code>{credential.totp ? ' · code de vérification exigé à chaque connexion' : ''}</p>
          <ActionForm action="/api/v1/auth/password" back="/espace" submit="Changer le mot de passe">
            <label>Mot de passe actuel<input name="current" type="password" required autoComplete="current-password" /></label>
            <label>Nouveau mot de passe (12 caractères au moins, majuscules, minuscules et chiffres)
              <input name="password" type="password" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          </ActionForm>
        </section>
      )}
      <section className="account-panel" aria-labelledby="sessions">
        <h2 id="sessions">Sessions</h2>
        <p>Identifiant de compte : <code>{account}</code></p>
        <p>{me.sessions.filter(item => !item.revoked_at && new Date(item.expires_at) > new Date()).length} session(s) active(s).</p>
        <ActionForm inline action="/api/v1/iam/sessions" back="/connexion" hidden={{ accountId: account }} submit="Fermer toutes mes sessions" />
        <form action="/api/v1/auth/logout" method="post">
          <button className="action" type="submit">Se déconnecter</button>
        </form>
      </section>
    </main>
  );
}
