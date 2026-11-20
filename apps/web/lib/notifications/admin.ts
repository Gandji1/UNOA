import 'server-only';
import { checkTemplate, eventOf, events, TemplateError } from '@unoa/domain/messages';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, ensure, flag, Problem, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction } from '@/lib/server/db';

// Administration of notification templates, delivery log and queues, and the
// account's own contact preferences and consents.

type Right = 'read' | 'manage' | 'publish' | 'jobs';
const channels = ['internal', 'email', 'sms'] as const;

async function rights(settings: IamSettings, actor: string, scopeId: string) {
  const { rows } = await database(settings).query<Record<Right, boolean>>(`
    SELECT unoa.has_scope_permission($1, 'not.read', $2) AS read, unoa.has_scope_permission($1, 'not.manage', $2) AS manage,
           unoa.has_scope_permission($1, 'not.publish', $2) AS publish, unoa.has_scope_permission($1, 'ops.jobs', $2) AS jobs
  `, [actor, scopeId]);
  return rows[0];
}

export async function notificationContexts(settings: IamSettings, actor: string) {
  const { rows } = await database(settings).query<{ id: string; label: string }>(`
    SELECT scope.id, scope.label FROM unoa.scope WHERE unoa.has_scope_permission($1, 'not.read', scope.id)
    ORDER BY scope.parent_id NULLS FIRST, scope.label LIMIT 200
  `, [actor]);
  return rows;
}

export async function notificationOverview(settings: IamSettings, actor: string, scope: string) {
  const scopeId = uuid(scope);
  const granted = await rights(settings, actor, scopeId);
  ensure(granted?.read, 403, 'Portée inaccessible');
  const store = database(settings);
  const [label, templates, attempts, queue, dead, sandbox] = await Promise.all([
    store.query<{ label: string }>('SELECT label FROM unoa.scope WHERE id = $1', [scopeId]),
    store.query<{ id: string; event_code: string; channel: string; language: string; subject: string; body: string; state: string;
      author_id: string; created_at: Date; published_at: Date | null; scope_label: string; own: boolean }>(`
      SELECT template.*, scope.label AS scope_label, template.scope_id = $1 AS own FROM unoa.notification_template AS template
      JOIN unoa.scope ON scope.id = template.scope_id
      WHERE (unoa.scope_within(template.scope_id, $1) OR unoa.scope_within($1, template.scope_id)) AND template.state <> 'retired'
      ORDER BY template.event_code, template.channel, template.language, template.created_at DESC LIMIT 300
    `, [scopeId]),
    store.query<{ id: string; attempted_at: Date; channel: string; adapter: string; recipient_masked: string; status: string; error: string | null; provider_ref: string | null; event: string }>(`
      SELECT attempt.id, attempt.attempted_at, attempt.channel, attempt.adapter, attempt.recipient_masked, attempt.status, attempt.error,
             attempt.provider_ref, job.payload->>'event' AS event
      FROM unoa.delivery_attempt AS attempt JOIN unoa.job ON job.id = attempt.job_id
      WHERE job.scope_id IS NOT NULL AND unoa.scope_within(job.scope_id, $1) ORDER BY attempt.attempted_at DESC LIMIT 100
    `, [scopeId]),
    granted.jobs ? store.query<{ state: string; total: number }>(`
      SELECT state, count(*)::int AS total FROM unoa.job WHERE scope_id IS NOT NULL AND unoa.scope_within(scope_id, $1) GROUP BY state
    `, [scopeId]) : { rows: [] },
    granted.jobs ? store.query<{ id: string; kind: string; attempts: number; last_error: string | null; created_at: Date; event: string }>(`
      SELECT id, kind, attempts, last_error, created_at, payload->>'event' AS event FROM unoa.job
      WHERE state = 'dead' AND scope_id IS NOT NULL AND unoa.scope_within(scope_id, $1) ORDER BY created_at DESC LIMIT 50
    `, [scopeId]) : { rows: [] },
    granted.jobs ? store.query<{ id: string; channel: string; recipient: string; subject: string | null; body: string; created_at: Date }>(`
      SELECT message.id, message.channel, message.recipient, message.subject, message.body, message.created_at
      FROM unoa.sandbox_message AS message JOIN unoa.job ON job.id = message.job_id
      WHERE unoa.scope_within(job.scope_id, $1) ORDER BY message.created_at DESC LIMIT 30
    `, [scopeId]) : { rows: [] },
  ]);
  return {
    scope: { id: scopeId, label: label.rows[0]?.label ?? '' }, rights: granted, events,
    templates: templates.rows, attempts: attempts.rows, queue: Object.fromEntries(queue.rows.map(row => [row.state, row.total])),
    dead: dead.rows, sandbox: sandbox.rows,
  };
}

function templateText(value: unknown, variables: string[], limit: number, label: string, allowEmpty = false) {
  const text = typeof value === 'string' ? value.trim() : '';
  ensure(allowEmpty || text.length > 0, 400, label + ' requis');
  try { return checkTemplate(text, variables, limit); } catch (error) {
    if (error instanceof TemplateError) throw new Problem(400, label + ' : ' + error.message);
    throw error;
  }
}

export async function templateAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.not.template', async store => {
    if (action === 'templates') {
      const scopeId = uuid(input.scopeId);
      ensure((await rights(settings, actor, scopeId))?.manage, 403, 'Rédaction des modèles non autorisée');
      const definition = eventOf(String(input.event ?? ''));
      ensure(definition, 400, 'Événement inconnu');
      const channel = choice(input.channel, channels, 'Canal');
      const lang = choice(input.language, ['fr', 'en'] as const, 'Langue');
      const subject = templateText(input.subject, definition.variables, 200, 'Objet');
      const body = templateText(input.body, definition.variables, channel === 'sms' ? 480 : 2000, 'Texte', true);
      const { rows } = await store.query<{ id: string }>(`
        INSERT INTO unoa.notification_template(scope_id, event_code, channel, language, subject, body, author_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
      `, [scopeId, definition.code, channel, lang, subject, body, actor]);
      await audit(store, actor, scopeId, 'not.template_drafted', correlation, rows[0].id);
      return { id: rows[0].id, scopeId };
    }
    const id = uuid(input.templateId);
    const { rows } = await store.query<{ scope_id: string; event_code: string; channel: string; language: string; state: string; author_id: string }>(
      'SELECT scope_id, event_code, channel, language, state, author_id FROM unoa.notification_template WHERE id = $1 FOR UPDATE', [id]);
    ensure(rows[0], 404, 'Modèle introuvable');
    const found = rows[0];
    ensure((await rights(settings, actor, found.scope_id))?.publish, 403, 'Publication non autorisée');
    if (action === 'publish') {
      ensure(found.state === 'draft', 409, 'Seul un brouillon est publié');
      ensure(found.author_id !== actor, 403, 'La publication revient à une autre personne que l’auteur');
      await store.query(`UPDATE unoa.notification_template SET state = 'retired'
        WHERE scope_id = $1 AND event_code = $2 AND channel = $3 AND language = $4 AND state = 'published'`,
        [found.scope_id, found.event_code, found.channel, found.language]);
      await store.query("UPDATE unoa.notification_template SET state = 'published', published_by = $2, published_at = now() WHERE id = $1", [id, actor]);
    } else if (action === 'retire') {
      ensure(found.state === 'published', 409, 'Seul un modèle publié est retiré');
      await store.query("UPDATE unoa.notification_template SET state = 'retired' WHERE id = $1", [id]);
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, found.scope_id, 'not.template_' + (action === 'publish' ? 'published' : 'retired'), correlation, id);
    return { id, scopeId: found.scope_id };
  });
}

export async function replayJob(settings: IamSettings, actor: string, input: Input, correlation: string) {
  const id = uuid(input.jobId);
  return transaction(settings, 'unoa.job.' + id, async store => {
    const { rows } = await store.query<{ scope_id: string | null; state: string }>('SELECT scope_id, state FROM unoa.job WHERE id = $1 FOR UPDATE', [id]);
    ensure(rows[0]?.scope_id, 404, 'Tâche introuvable');
    ensure((await rights(settings, actor, rows[0].scope_id!))?.jobs, 403, 'Supervision des files non autorisée');
    ensure(rows[0].state === 'dead', 409, 'Seule une tâche en échec définitif est rejouée');
    await store.query(`UPDATE unoa.job SET state = 'queued', attempts = 0, run_after = now(), finished_at = NULL,
      replayed_by = $2, replayed_at = now() WHERE id = $1`, [id, actor]);
    await audit(store, actor, rows[0].scope_id!, 'ops.job_replayed', correlation, id);
    return { id, scopeId: rows[0].scope_id };
  });
}

// ---------------------------------------------------------------- account

export async function contactSettings(settings: IamSettings, actor: string) {
  const store = database(settings);
  const [account, consents, preferences] = await Promise.all([
    store.query<{ language: string | null; phone: string | null; email: string | null }>('SELECT language, phone, email FROM unoa.account WHERE id = $1', [actor]),
    store.query<{ channel: string; granted: boolean; source: string; recorded_at: Date }>(
      'SELECT channel, granted, source, recorded_at FROM unoa.contact_consent WHERE account_id = $1 ORDER BY recorded_at DESC LIMIT 100', [actor]),
    store.query<{ event_code: string; channel: string; enabled: boolean }>(
      'SELECT event_code, channel, enabled FROM unoa.notification_preference WHERE account_id = $1', [actor]),
  ]);
  const current = (channel: string) => consents.rows.find(item => item.channel === channel)?.granted ?? false;
  return { ...account.rows[0], consents: consents.rows, current: { email: current('email'), sms: current('sms') }, preferences: preferences.rows, events };
}

export async function contactAction(settings: IamSettings, actor: string, action: string, input: Input, correlation: string) {
  return transaction(settings, 'unoa.contact.' + actor, async store => {
    if (action === 'contact') {
      const phone = typeof input.phone === 'string' && input.phone.trim() ? input.phone.replace(/[\s.-]/g, '') : null;
      ensure(!phone || /^\+[1-9][0-9]{6,14}$/.test(phone), 400, 'Téléphone au format international (+229…)');
      const lang = typeof input.language === 'string' && input.language ? choice(input.language, ['fr', 'en'] as const, 'Langue') : null;
      await store.query('UPDATE unoa.account SET phone = $2, language = $3 WHERE id = $1', [actor, phone, lang]);
    } else if (action === 'consent') {
      const channel = choice(input.channel, ['email', 'sms'] as const, 'Canal');
      await store.query(`INSERT INTO unoa.contact_consent(account_id, channel, granted, source) VALUES ($1, $2, $3, 'account')`,
        [actor, channel, flag(input.granted)]);
      // A withdrawn consent stops the messages still waiting in the queue.
      if (!flag(input.granted)) {
        await store.query(`UPDATE unoa.job SET state = 'skipped', finished_at = now(), last_error = 'Consentement retiré'
          WHERE kind = 'deliver' AND state IN ('queued', 'failed') AND payload->>'accountId' = $1 AND payload->>'channel' = $2`, [actor, channel]);
      }
    } else if (action === 'preference') {
      const definition = eventOf(String(input.event ?? ''));
      ensure(definition, 400, 'Événement inconnu');
      await store.query(`INSERT INTO unoa.notification_preference(account_id, event_code, channel, enabled) VALUES ($1, $2, $3, $4)
        ON CONFLICT (account_id, event_code, channel) DO UPDATE SET enabled = EXCLUDED.enabled, updated_at = now()`,
        [actor, definition.code, choice(input.channel, ['email', 'sms'] as const, 'Canal'), flag(input.enabled)]);
    } else {
      throw new Problem(404, 'Opération inconnue');
    }
    await audit(store, actor, null, 'not.contact_' + action, correlation, actor);
    return { accountId: actor };
  });
}

// IAM-013: the account's consents and contact preferences, as a portable file.
export async function contactExport(settings: IamSettings, actor: string) {
  const data = await contactSettings(settings, actor);
  return {
    exportedAt: new Date().toISOString(), account: actor, language: data.language, email: data.email, phone: data.phone,
    consents: data.consents, preferences: data.preferences,
  };
}
