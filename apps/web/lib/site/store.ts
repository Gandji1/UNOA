import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import type { IamSettings } from '@/lib/iam/settings';
import { iamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, ensure, flag, https, language, optional, text, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction, type Queryable } from '@/lib/server/db';

// Public site of a tenant (module CMS). The host name of the request selects
// the site; its brand, texts and legal pages are published data, never code.

export interface PublicSite {
  site_id: string; scope_id: string; language: string; default_language: string; languages: string[];
  name: string; short_name: string; tagline: string | null; hero_title: string | null; hero_text: string | null;
  hero_image_url: string | null; about: string | null; contact: string | null; legal_notice: string | null;
  privacy_notice: string | null; footer: string | null;
}

const hostFormat = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:[0-9]{1,5})?$/;

function preferredLanguage(acceptLanguage: string | null) {
  const tag = acceptLanguage?.split(',')[0]?.split(';')[0]?.trim() ?? '';
  return /^[a-z]{2,3}(-[A-Z]{2})?$/.test(tag) ? tag : tag.slice(0, 2).toLowerCase();
}

export async function siteForHost(settings: IamSettings, host: string | null, acceptLanguage: string | null) {
  const name = (host ?? '').toLowerCase();
  if (!hostFormat.test(name)) return null;
  const { rows } = await database(settings).query<PublicSite>('SELECT * FROM unoa.public_site($1, $2)', [name, preferredLanguage(acceptLanguage)]);
  return rows[0] ?? null;
}

// One lookup per rendered page, shared by the layout and the page.
export const currentSite = cache(async () => {
  const settings = iamSettings();
  if (!settings) return null;
  const list = await headers();
  return siteForHost(settings, list.get('host'), list.get('accept-language')).catch(() => null);
});

export async function siteForRequest(request: Request) {
  const settings = iamSettings();
  if (!settings) return null;
  return siteForHost(settings, request.headers.get('host'), request.headers.get('accept-language'));
}

// ------------------------------------------------------------------ studio

type Right = 'read' | 'write' | 'publish';

export async function siteContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string; nature: string; site_id: string | null }>(`
    SELECT scope.id, scope.label, kind.nature, site.id AS site_id FROM unoa.scope
    JOIN unoa.scope_type AS kind ON kind.code = scope.type_code
    LEFT JOIN unoa.site ON site.scope_id = scope.id
    WHERE kind.nature IN ('platform', 'territory', 'institution') AND unoa.has_scope_permission($1, 'site.read', scope.id)
    ORDER BY kind.nature, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

async function rights(store: Queryable, actor: string, scopeId: string) {
  const { rows } = await store.query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'site.read', $2) AS read, unoa.has_scope_permission($1, 'site.write', $2) AS write,
           unoa.has_scope_permission($1, 'site.publish', $2) AS publish
  `, [actor, scopeId]);
  return rows[0];
}

async function siteOf(store: Queryable, actor: string, siteId: string, right: Right) {
  const { rows } = await store.query<{ id: string; scope_id: string; default_language: string; online: boolean }>(
    'SELECT id, scope_id, default_language, online FROM unoa.site WHERE id = $1', [siteId],
  );
  ensure(rows[0], 404, 'Site introuvable');
  const granted = await rights(store, actor, rows[0].scope_id);
  ensure(granted?.[right], 403, 'Action non autorisée sur ce site');
  return { site: rows[0], rights: granted };
}

export async function siteDetails(settings: IamSettings, actor: string, scopeId: string) {
  const store = database(settings);
  const granted = await rights(store, actor, uuid(scopeId));
  ensure(granted?.read, 403, 'Périmètre inaccessible');
  const { rows: scope } = await store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]);
  const { rows: site } = await store.query<{ id: string; default_language: string; online: boolean; open_registration: boolean }>(
    'SELECT id, default_language, online, open_registration FROM unoa.site WHERE scope_id = $1', [scopeId],
  );
  if (!site[0]) return { scope: { id: scopeId, label: scope[0]?.label ?? '' }, rights: granted, site: null, hosts: [], texts: [] };
  const [hosts, texts] = await Promise.all([
    store.query<{ host: string; created_at: Date }>('SELECT host, created_at FROM unoa.site_host WHERE site_id = $1 ORDER BY host', [site[0].id]),
    store.query<{
      id: string; language: string; state: string; name: string; short_name: string; tagline: string | null; hero_title: string | null;
      hero_text: string | null; hero_image_url: string | null; about: string | null; contact: string | null; legal_notice: string | null;
      privacy_notice: string | null; footer: string | null; author_id: string; created_at: Date; published_at: Date | null;
    }>('SELECT * FROM unoa.site_text WHERE site_id = $1 ORDER BY language, created_at DESC LIMIT 200', [site[0].id]),
  ]);
  return { scope: { id: scopeId, label: scope[0]?.label ?? '' }, rights: granted, site: site[0], hosts: hosts.rows, texts: texts.rows };
}

export async function createSite(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const scopeId = uuid(input.scopeId);
  const tag = language(input.defaultLanguage);
  return transaction(settings, 'unoa.site.scope.' + scopeId, async store => {
    const granted = await rights(store, actor, scopeId);
    ensure(granted?.write, 403, 'Création de site non autorisée');
    const { rows } = await store.query<{ id: string }>(
      'INSERT INTO unoa.site(scope_id, default_language, created_by) VALUES ($1, $2, $3) RETURNING id', [scopeId, tag, actor],
    );
    await audit(store, actor, scopeId, 'site.created', correlation, rows[0].id);
    return { scopeId, id: rows[0].id };
  });
}

export async function siteAction(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const siteId = uuid(id);
  return transaction(settings, 'unoa.site.' + siteId, async store => {
    if (action === 'hosts') {
      const { site } = await siteOf(store, actor, siteId, 'write');
      const host = String(input.host ?? '').trim().toLowerCase();
      ensure(hostFormat.test(host), 400, 'Nom d’hôte invalide');
      if (flag(input.remove)) {
        const removed = await store.query('DELETE FROM unoa.site_host WHERE host = $1 AND site_id = $2', [host, siteId]);
        ensure(removed.rowCount === 1, 404, 'Nom d’hôte introuvable');
      } else {
        await store.query('INSERT INTO unoa.site_host(host, site_id, created_by) VALUES ($1, $2, $3)', [host, siteId, actor]);
      }
      await audit(store, actor, site.scope_id, flag(input.remove) ? 'site.host_removed' : 'site.host_added', correlation, siteId);
      return { scopeId: site.scope_id, id: siteId };
    }
    if (action === 'texts') {
      const { site } = await siteOf(store, actor, siteId, 'write');
      const long = (limit: number, label: string) => (value: unknown) => {
        ensure(typeof value === 'string' && value.trim().length > 0 && value.length <= limit && !value.includes('\u0000'), 400, label + ' invalide');
        return value.trim();
      };
      const { rows } = await store.query<{ id: string }>(`
        INSERT INTO unoa.site_text(site_id, language, name, short_name, tagline, hero_title, hero_text, hero_image_url,
          about, contact, legal_notice, privacy_notice, footer, author_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id
      `, [siteId, language(input.language), boundedText(input.name, 160, 'Nom'), boundedText(input.shortName, 24, 'Nom court'),
        optional(input.tagline, text(200, 'Accroche')), optional(input.heroTitle, text(160, 'Titre d’accueil')),
        optional(input.heroText, text(1000, 'Texte d’accueil')), optional(input.heroImageUrl, value => https(value, 'Illustration')),
        optional(input.about, long(20000, 'Présentation')), optional(input.contact, long(2000, 'Contacts')),
        optional(input.legalNotice, long(40000, 'Mentions légales')), optional(input.privacyNotice, long(40000, 'Confidentialité')),
        optional(input.footer, text(500, 'Pied de page')), actor]);
      await audit(store, actor, site.scope_id, 'site.text_saved', correlation, rows[0].id);
      return { scopeId: site.scope_id, id: rows[0].id };
    }
    if (action === 'publish') {
      const { site } = await siteOf(store, actor, siteId, 'publish');
      const textId = uuid(input.textId);
      const { rows } = await store.query<{ language: string; author_id: string; state: string }>(
        'SELECT language, author_id, state FROM unoa.site_text WHERE id = $1 AND site_id = $2 FOR UPDATE', [textId, siteId],
      );
      ensure(rows[0], 404, 'Version introuvable');
      ensure(rows[0].state === 'draft', 409, 'Seule une version en brouillon est publiée');
      ensure(rows[0].author_id !== actor, 403, 'La publication revient à une autre personne que l’auteur');
      await store.query("UPDATE unoa.site_text SET state = 'archived' WHERE site_id = $1 AND language = $2 AND state = 'published'", [siteId, rows[0].language]);
      await store.query("UPDATE unoa.site_text SET state = 'published', published_by = $2, published_at = now() WHERE id = $1", [textId, actor]);
      await audit(store, actor, site.scope_id, 'site.text_published', correlation, textId);
      return { scopeId: site.scope_id, id: siteId };
    }
    if (action === 'online') {
      const { site } = await siteOf(store, actor, siteId, 'publish');
      const online = flag(input.online);
      await store.query('UPDATE unoa.site SET online = $2, changed_by = $3, changed_at = now() WHERE id = $1', [siteId, online, actor]);
      await audit(store, actor, site.scope_id, online ? 'site.online' : 'site.offline', correlation, siteId);
      return { scopeId: site.scope_id, id: siteId };
    }
    if (action === 'registration') {
      const { site } = await siteOf(store, actor, siteId, 'publish');
      const open = flag(input.open);
      await store.query('UPDATE unoa.site SET open_registration = $2, changed_by = $3, changed_at = now() WHERE id = $1', [siteId, open, actor]);
      await audit(store, actor, site.scope_id, open ? 'site.registration_opened' : 'site.registration_closed', correlation, siteId);
      return { scopeId: site.scope_id, id: siteId };
    }
    ensure(false, 404, 'Opération inconnue');
  });
}
