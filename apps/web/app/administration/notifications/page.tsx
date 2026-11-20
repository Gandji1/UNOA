import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { notificationContexts, notificationOverview } from '@/lib/notifications/admin';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';

export const metadata: Metadata = { title: 'Notifications' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/notifications';
const api = '/api/v1/notifications/';
const channelLabels: Record<string, string> = { internal: 'Espace personnel', email: 'Courriel', sms: 'SMS' };
const queueLabels: Record<string, string> = { queued: 'En attente', running: 'En cours', failed: 'Nouvel essai prévu', done: 'Envoyées', skipped: 'Non envoyées', dead: 'Échec définitif' };
const statusTone = { sent: 'ok', failed: 'danger', skipped: 'muted' } as const;

function refused(error: unknown) {
  if (error instanceof Problem) return null;
  throw error;
}

export default async function Notifications({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  const scopeId = field(search.scope);
  const crumbs = (label?: string) => <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/administration">Administration</a> ›{' '}
    {label ? <><a href={path}>Notifications</a> › <span aria-current="page">{label}</span></> : <span aria-current="page">Notifications</span>}</nav>;

  if (scopeIdFormat.test(scopeId)) {
    const data = await notificationOverview(settings, actor, scopeId).catch(refused);
    if (!data) return <main id="contenu" className="studio"><section className="studio-panel"><h1>Notifications</h1>{notice}<p>Portée inaccessible.</p></section></main>;
    const back = `${path}?scope=${scopeId}`;
    return (
      <main id="contenu" className="studio">
        {crumbs(data.scope.label)}
        <section className="studio-heading"><p className="eyebrow">Messagerie et notifications</p><h1>{data.scope.label}</h1>
          <p>Modèles par événement, canal et langue ; à défaut, le texte du logiciel s’applique. Un modèle publié s’impose aux sous-structures
            qui n’en publient pas. Les événements sensibles ne sortent de la plateforme qu’avec un avis générique.</p></section>
        {notice}
        <Panel title="Modèles" id="modeles">
          {data.templates.length === 0 ? <p>Aucun modèle : les textes par défaut s’appliquent.</p> : (
            <Table label="Modèles" head={['Événement', 'Canal', 'Langue', 'Objet et texte', 'Portée', 'État', '']}>
              {data.templates.map(item => (
                <tr key={item.id}><td><code>{item.event_code}</code></td><td>{channelLabels[item.channel]}</td><td>{item.language}</td>
                  <td><strong>{item.subject}</strong><p className="muted">{item.body}</p></td><td>{item.scope_label}{!item.own && ' (héritée)'}</td>
                  <td>{item.state === 'published' ? <Badge tone="ok">Publié</Badge> : <Badge tone="warn">Brouillon</Badge>}</td>
                  <td>{item.own && data.rights.publish && (item.state === 'draft'
                    ? <ActionForm inline action={api + 'publish'} back={back} hidden={{ templateId: item.id }} submit="Publier" />
                    : <ActionForm inline action={api + 'retire'} back={back} hidden={{ templateId: item.id }} submit="Retirer" />)}</td></tr>
              ))}
            </Table>
          )}
        </Panel>
        {data.rights.manage && (
          <Editor summary="Rédiger un modèle">
            <ActionForm action={api + 'templates'} back={back} hidden={{ scopeId }} submit="Enregistrer le brouillon"
              confirm="Variables utilisables : celles de l’événement, écrites {{nom}}. Texte brut uniquement ; la publication revient à une autre personne.">
              <label>Événement<select name="event">{data.events.map(item => <option key={item.code} value={item.code}>{item.code} — {item.variables.map(name => `{{${name}}}`).join(' ')}{item.sensitive ? ' (sensible)' : ''}</option>)}</select></label>
              <label>Canal<select name="channel">{Object.entries(channelLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label>Langue<select name="language"><option value="fr">Français</option><option value="en">English</option></select></label>
              <label className="studio-wide">Objet<input name="subject" required maxLength={200} /></label>
              <label className="studio-wide">Texte (480 caractères au plus pour un SMS)<textarea name="body" maxLength={2000} rows={4} /></label>
            </ActionForm>
          </Editor>
        )}
        <Panel title="Journal des envois" id="envois">
          {data.attempts.length === 0 ? <p>Aucun envoi externe.</p> : (
            <Table label="Envois" head={['Date', 'Événement', 'Canal', 'Destinataire', 'Adaptateur', 'Statut', 'Référence ou motif']}>
              {data.attempts.map(item => (
                <tr key={item.id}><td>{formatTime(item.attempted_at)}</td><td><code>{item.event}</code></td><td>{channelLabels[item.channel]}</td>
                  <td>{item.recipient_masked}</td><td>{item.adapter}</td>
                  <td><Badge tone={statusTone[item.status as keyof typeof statusTone]}>{item.status === 'sent' ? 'envoyé' : item.status === 'failed' ? 'échec' : 'non envoyé'}</Badge></td>
                  <td>{item.provider_ref ?? item.error ?? '—'}</td></tr>
              ))}
            </Table>
          )}
        </Panel>
        {data.rights.jobs && (
          <Panel title="Files de traitement" id="files">
            <p>{Object.entries(queueLabels).map(([state, label]) => `${label} : ${data.queue[state] ?? 0}`).join(' · ')}</p>
            {data.dead.length > 0 && (
              <Table label="Échecs définitifs" head={['Créée', 'Événement', 'Essais', 'Dernière erreur', '']}>
                {data.dead.map(item => (
                  <tr key={item.id}><td>{formatTime(item.created_at)}</td><td><code>{item.event ?? item.kind}</code></td><td>{item.attempts}</td>
                    <td>{item.last_error}</td><td><ActionForm inline action={api + 'replay'} back={back} hidden={{ jobId: item.id }} submit="Rejouer" /></td></tr>
                ))}
              </Table>
            )}
            {data.sandbox.length > 0 && <>
              <h3>Boîte de recette (adaptateur sandbox : rien n’est réellement envoyé)</h3>
              <ul>{data.sandbox.map(item => <li key={item.id}>{formatTime(item.created_at)} · {channelLabels[item.channel]} → {item.recipient}
                {item.subject && <> · <strong>{item.subject}</strong></>}<pre className="muted">{item.body}</pre></li>)}</ul>
            </>}
          </Panel>
        )}
      </main>
    );
  }

  const scopes = await notificationContexts(settings, actor);
  return (
    <main id="contenu" className="studio">
      {crumbs()}
      <section className="studio-heading"><p className="eyebrow">Administration</p><h1>Notifications</h1><p>Choisissez une portée.</p></section>
      {notice}
      {scopes.length === 0 ? <p className="card-note">Aucune portée accessible.</p> : (
        <ul className="program-grid">{scopes.map(item => <li key={item.id} className="program-card"><h2><a href={`${path}?scope=${item.id}`}>{item.label}</a></h2></li>)}</ul>
      )}
    </main>
  );
}
