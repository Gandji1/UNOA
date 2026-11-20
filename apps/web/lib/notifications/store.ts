import 'server-only';
import { eventOf, language, render, sensitiveNotice } from '@unoa/domain/messages';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { uuid } from '@/lib/shared/validation';
import type { Queryable } from '@/lib/server/db';

// Notifications (module NOT). In the business transaction: the internal
// message is rendered with the template published nearest to the scope (or
// the software default) in the recipient's language; every external channel
// the recipient consented to and kept enabled becomes a "deliver" job in the
// same transaction (outbox), drained by the worker.

export interface Dispatch {
  event: string;
  scopeId: string;
  recipients: string[];
  values: Record<string, string | null | undefined>;
  link: string | null;
  correlation: string;
}

interface Template { id: string | null; subject: string; body: string }

async function template(store: Queryable, scopeId: string, event: string, channel: string, lang: 'fr' | 'en'): Promise<Template> {
  const { rows } = await store.query<{ id: string; subject: string; body: string }>(`
    WITH RECURSIVE ancestry AS (
      SELECT id, parent_id, 0 AS depth FROM unoa.scope WHERE id = $1
      UNION ALL SELECT scope.id, scope.parent_id, ancestry.depth + 1 FROM unoa.scope JOIN ancestry ON scope.id = ancestry.parent_id
    )
    SELECT template.id, template.subject, template.body FROM unoa.notification_template AS template
    JOIN ancestry ON ancestry.id = template.scope_id
    WHERE template.event_code = $2 AND template.channel = $3 AND template.language = $4 AND template.state = 'published'
    ORDER BY ancestry.depth LIMIT 1
  `, [scopeId, event, channel, lang]);
  if (rows[0]) return rows[0];
  const fallback = eventOf(event)?.defaults[lang];
  if (!fallback) throw new Error('Unknown notification event');
  return { id: null, ...fallback };
}

export async function dispatch(store: Queryable, message: Dispatch) {
  const definition = eventOf(message.event);
  if (!definition) throw new Error('Unknown notification event');
  const recipients = [...new Set(message.recipients)];
  if (!recipients.length) return;
  const { rows: accounts } = await store.query<{ id: string; language: string | null; email_on: boolean; sms_on: boolean }>(`
    SELECT account.id, account.language,
      coalesce((SELECT granted FROM unoa.contact_consent WHERE account_id = account.id AND channel = 'email' ORDER BY recorded_at DESC LIMIT 1), false)
        AND account.email IS NOT NULL
        AND coalesce((SELECT enabled FROM unoa.notification_preference WHERE account_id = account.id AND event_code = $2 AND channel = 'email'), true) AS email_on,
      coalesce((SELECT granted FROM unoa.contact_consent WHERE account_id = account.id AND channel = 'sms' ORDER BY recorded_at DESC LIMIT 1), false)
        AND account.phone IS NOT NULL
        AND coalesce((SELECT enabled FROM unoa.notification_preference WHERE account_id = account.id AND event_code = $2 AND channel = 'sms'), true) AS sms_on
    FROM unoa.account WHERE account.id = ANY($1::uuid[]) AND account.disabled_at IS NULL
  `, [recipients, message.event]);
  for (const account of accounts) {
    const lang = language(account.language);
    const internal = await template(store, message.scopeId, message.event, 'internal', lang);
    const { rows } = await store.query<{ id: string }>(`
      INSERT INTO unoa.notification(account_id, kind, title, body, link, scope_id, template_id, language)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [account.id, message.event, render(internal.subject, message.values).slice(0, 200) || message.event,
      render(internal.body, message.values).slice(0, 2000) || null, message.link, message.scopeId, internal.id, lang]);
    for (const channel of ['email', 'sms'] as const) {
      if (!(channel === 'email' ? account.email_on : account.sms_on)) continue;
      // A sensitive event never leaves the platform with its content.
      const external = definition.sensitive ? { id: null, ...sensitiveNotice[lang] } : await template(store, message.scopeId, message.event, channel, lang);
      await store.query(`
        INSERT INTO unoa.job(kind, payload, scope_id, idempotency_key, correlation_id)
        VALUES ('deliver', $1, $2, $3, $4) ON CONFLICT (idempotency_key) DO NOTHING
      `, [JSON.stringify({
        accountId: account.id, channel, notificationId: rows[0].id, event: message.event, templateId: external.id,
        subject: render(external.subject, message.values).slice(0, 200),
        body: render(external.body, message.values).slice(0, channel === 'sms' ? 480 : 2000), link: message.link,
      }), message.scopeId, 'deliver:' + rows[0].id + ':' + channel, message.correlation]);
    }
  }
}

// Members of an offering, except the author of the change.
export async function offeringRecipients(store: Queryable, offeringId: string, except: string) {
  const { rows } = await store.query<{ account_id: string }>(
    'SELECT DISTINCT account_id FROM unoa.offering_member WHERE offering_id = $1 AND removed_at IS NULL AND account_id <> $2', [offeringId, except]);
  return rows.map(row => row.account_id);
}

export async function notifications(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; kind: string; title: string; body: string | null; link: string | null; created_at: Date; read_at: Date | null }>(
    'SELECT id, kind, title, body, link, created_at, read_at FROM unoa.notification WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50', [actor],
  );
  return rows;
}

export async function markRead(settings: IamSettings, actor: string, id: string) {
  await database(settings).query('UPDATE unoa.notification SET read_at = now() WHERE id = $1 AND account_id = $2 AND read_at IS NULL', [uuid(id), actor]);
  return { id };
}
