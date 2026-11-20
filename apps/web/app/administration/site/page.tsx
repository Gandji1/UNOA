import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { cookieName, iamSettings, scopeIdFormat } from '@/lib/iam/settings';
import { sessionAccount } from '@/lib/iam/sessions';
import { Problem } from '@/lib/shared/validation';
import { siteContexts, siteDetails } from '@/lib/site/store';
import { ActionForm, Badge, Editor, formatTime, Notice, Panel, Table } from '../forms';

export const metadata: Metadata = { title: 'Site public' };
export const dynamic = 'force-dynamic';

type Search = Record<string, string | string[] | undefined>;
const field = (value: Search[string]) => typeof value === 'string' ? value : '';
const path = '/administration/site';
const api = '/api/v1/site/';
const states: Record<string, [string, 'ok' | 'warn' | 'muted']> = { draft: ['Brouillon', 'warn'], published: ['En ligne', 'ok'], archived: ['Archivée', 'muted'] };

export default async function SiteStudio({ searchParams }: { searchParams: Promise<Search> }) {
  const settings = iamSettings();
  if (!settings) redirect('/connexion');
  const actor = await sessionAccount(settings, (await cookies()).get(cookieName(settings, 'session'))?.value).catch(() => null);
  if (!actor) redirect('/connexion');
  const search = await searchParams;
  const contexts = await siteContexts(settings, actor);
  const requested = field(search.scope);
  const selected = scopeIdFormat.test(requested) ? requested : contexts[0]?.id;
  const notice = <Notice error={field(search.error)} message={field(search.message)} />;
  if (!selected) {
    return <main id="contenu" className="studio"><section className="studio-heading"><h1>Site public</h1>
      <p>Aucune portée ne vous est attribuée pour la gestion d’un site public.</p></section></main>;
  }
  const data = await siteDetails(settings, actor, selected).catch(error => { if (error instanceof Problem) return null; throw error; });
  if (!data) return <main id="contenu" className="studio"><section className="studio-panel"><h1>Site public</h1>{notice}<p>Portée inaccessible.</p></section></main>;
  const { scope, rights, site, hosts, texts } = data;
  const back = `${path}?scope=${scope.id}`;
  const latest = texts.find(item => item.language === site?.default_language);
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/espace">Mon espace</a> › <span aria-current="page">Site public</span></nav>
      <section className="studio-heading"><p className="eyebrow">Site public · {scope.label}</p><h1>{latest?.name ?? 'Site public'}</h1>
        <p>Nom, accroche, textes d’accueil, présentation, contacts, mentions légales et confidentialité sont publiés ici, par langue.
          Le site n’affiche que les formations et les structures de sa portée.</p></section>
      {notice}
      <section className="studio-panel" aria-label="Choix de la portée">
        <form method="get" className="studio-form studio-filters">
          <label>Portée<select name="scope" defaultValue={scope.id}>
            {contexts.map(item => <option key={item.id} value={item.id}>{item.label}{item.site_id ? ' · site' : ''}</option>)}
          </select></label>
          <button className="action" type="submit">Consulter</button>
        </form>
      </section>
      {!site ? (
        <Panel title="Créer le site" id="creer">
          <p>Aucun site n’est encore déclaré pour cette portée.</p>
          {rights.write && (
            <ActionForm action={`${api}sites`} back={back} hidden={{ scopeId: scope.id }} submit="Créer le site">
              <label>Langue par défaut<input name="defaultLanguage" required maxLength={6} defaultValue="fr" /></label>
            </ActionForm>
          )}
        </Panel>
      ) : (
        <>
          <Panel title="Mise en ligne" id="statut">
            <p>{site.online ? <Badge tone="ok">En ligne</Badge> : <Badge tone="muted">Hors ligne</Badge>} · langue par défaut : {site.default_language}</p>
            {rights.publish && (
              <ActionForm inline action={`${api}sites/${site.id}/online`} back={back} hidden={{ online: site.online ? 'false' : 'true' }}
                submit={site.online ? 'Mettre hors ligne' : 'Mettre en ligne'} />
            )}
            <p className="studio-help">La mise en ligne exige des textes publiés dans la langue par défaut.</p>
          </Panel>
          <Panel title="Noms d’hôte" id="hotes">
            {hosts.length === 0 ? <p>Aucun nom d’hôte : le site n’est joignable à aucune adresse.</p> : (
              <ul>{hosts.map(item => (
                <li key={item.host}><code>{item.host}</code>
                  {rights.write && <ActionForm inline action={`${api}sites/${site.id}/hosts`} back={back} hidden={{ host: item.host, remove: 'true' }} submit="Retirer" />}</li>
              ))}</ul>
            )}
            {rights.write && (
              <ActionForm action={`${api}sites/${site.id}/hosts`} back={back} submit="Ajouter">
                <label>Nom d’hôte (avec le port si besoin)<input name="host" required maxLength={260} placeholder="campus.exemple.org" /></label>
              </ActionForm>
            )}
          </Panel>
          <Panel title="Textes publiés et versions" id="textes">
            {texts.length === 0 ? <p>Aucun texte.</p> : (
              <Table label="Versions des textes" head={['Langue', 'Nom', 'État', 'Créée', 'Publiée', 'Action']}>
                {texts.map(item => (
                  <tr key={item.id}>
                    <td>{item.language}</td><td>{item.name}</td>
                    <td><Badge tone={states[item.state][1]}>{states[item.state][0]}</Badge></td>
                    <td>{formatTime(item.created_at)}</td><td>{item.published_at ? formatTime(item.published_at) : '—'}</td>
                    <td>{item.state === 'draft' && rights.publish && item.author_id !== actor
                      ? <ActionForm inline action={`${api}sites/${site.id}/publish`} back={back} hidden={{ textId: item.id }} submit="Publier" />
                      : item.state === 'draft' ? <span className="muted">À publier par une autre personne</span> : '—'}</td>
                  </tr>
                ))}
              </Table>
            )}
            {rights.write && (
              <Editor summary="Rédiger une nouvelle version des textes">
                <ActionForm action={`${api}sites/${site.id}/texts`} back={back} submit="Enregistrer le brouillon"
                  confirm="Mise en forme : # titre, - liste, **gras**, [lien](https://…). Le HTML n’est jamais interprété.">
                  <label>Langue<input name="language" required maxLength={6} defaultValue={latest?.language ?? site.default_language} /></label>
                  <label>Nom<input name="name" required maxLength={160} defaultValue={latest?.name} /></label>
                  <label>Nom court (marque)<input name="shortName" required maxLength={24} defaultValue={latest?.short_name} /></label>
                  <label>Accroche<input name="tagline" maxLength={200} defaultValue={latest?.tagline ?? ''} /></label>
                  <label>Titre d’accueil<input name="heroTitle" maxLength={160} defaultValue={latest?.hero_title ?? ''} /></label>
                  <label>Illustration (HTTPS)<input type="url" name="heroImageUrl" maxLength={2000} defaultValue={latest?.hero_image_url ?? ''} /></label>
                  <label className="studio-wide">Texte d’accueil<textarea name="heroText" maxLength={1000} defaultValue={latest?.hero_text ?? ''} /></label>
                  <label className="studio-wide">Présentation<textarea name="about" maxLength={20000} rows={6} defaultValue={latest?.about ?? ''} /></label>
                  <label className="studio-wide">Contacts<textarea name="contact" maxLength={2000} defaultValue={latest?.contact ?? ''} /></label>
                  <label className="studio-wide">Mentions légales<textarea name="legalNotice" maxLength={40000} rows={6} defaultValue={latest?.legal_notice ?? ''} /></label>
                  <label className="studio-wide">Confidentialité<textarea name="privacyNotice" maxLength={40000} rows={6} defaultValue={latest?.privacy_notice ?? ''} /></label>
                  <label className="studio-wide">Pied de page<input name="footer" maxLength={500} defaultValue={latest?.footer ?? ''} /></label>
                </ActionForm>
              </Editor>
            )}
          </Panel>
        </>
      )}
    </main>
  );
}
