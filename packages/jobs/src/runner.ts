import type { Pool, PoolClient } from 'pg';
import { backoffMinutes, maskRecipient } from '@unoa/domain/messages';
import { deliver, SkipDelivery, TemporaryFailure, type AdapterEnvironment } from './adapters.ts';

// Worker of the durable queue (CORE-006, CORE-010): claims ready jobs with
// SKIP LOCKED, reclaims expired locks, retries with exponential backoff up to
// max_attempts, then marks the job dead for an operator to replay.

interface Job { id: string; kind: string; payload: Record<string, unknown>; attempts: number; max_attempts: number; idempotency_key: string }
export interface RunSummary { claimed: number; done: number; skipped: number; failed: number; dead: number }

const clean = (error: unknown) => (error instanceof Error ? error.message : 'Erreur inconnue').replace(/[^\p{L}\p{N} .,:;'()/_-]/gu, '').slice(0, 300);

async function deliverJob(client: PoolClient, env: AdapterEnvironment, job: Job) {
  const { accountId, channel, notificationId, subject, body, link } = job.payload as Record<string, string | null>;
  const { rows } = await client.query<{ email: string | null; phone: string | null; disabled_at: Date | null; consent: boolean | null }>(`
    SELECT account.email, account.phone, account.disabled_at,
      (SELECT granted FROM unoa.contact_consent WHERE account_id = account.id AND channel = $2 ORDER BY recorded_at DESC LIMIT 1) AS consent
    FROM unoa.account WHERE account.id = $1
  `, [accountId, channel]);
  const account = rows[0];
  const recipient = channel === 'email' ? account?.email : account?.phone;
  const record = (status: string, adapter: string, ref: string | null, error: string | null) => client.query(`
    INSERT INTO unoa.delivery_attempt(job_id, notification_id, channel, adapter, recipient_masked, status, provider_ref, error)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`, [job.id, notificationId, channel, adapter, recipient ? maskRecipient(recipient) : '—', status, ref, error]);
  // Consent and contact are checked again at delivery: a withdrawal stops pending messages.
  if (!account || account.disabled_at || !recipient || account.consent !== true) {
    await record('skipped', 'none', null, 'Consentement ou coordonnée absents');
    throw new SkipDelivery('Consentement ou coordonnée absents');
  }
  const absolute = link && env.UNOA_WEB_ORIGIN ? new URL(link, env.UNOA_WEB_ORIGIN).href : null;
  try {
    const sent = await deliver(env, client, job.id, {
      channel: channel as 'email' | 'sms', recipient, subject: String(subject ?? ''),
      body: [body, absolute].filter(Boolean).join('\n\n'), link: absolute, idempotencyKey: job.idempotency_key,
    });
    await record('sent', sent.adapter, sent.providerRef, null);
  } catch (error) {
    await record(error instanceof SkipDelivery ? 'skipped' : 'failed', String(env[channel === 'email' ? 'UNOA_EMAIL_ADAPTER' : 'UNOA_SMS_ADAPTER'] || 'none').slice(0, 30).replace(/[^a-z0-9_]/g, '') || 'none', null, clean(error));
    throw error;
  }
}

const handlers: Record<string, (client: PoolClient, env: AdapterEnvironment, job: Job) => Promise<void>> = { deliver: deliverJob };

export async function runJobs(pool: Pool, env: AdapterEnvironment, limit = 20): Promise<RunSummary> {
  const summary: RunSummary = { claimed: 0, done: 0, skipped: 0, failed: 0, dead: 0 };
  const { rows: jobs } = await pool.query<Job>(`
    UPDATE unoa.job SET state = 'running', attempts = attempts + 1, locked_until = now() + interval '2 minutes'
    WHERE id IN (
      SELECT id FROM unoa.job
      WHERE (state IN ('queued', 'failed') AND run_after <= now()) OR (state = 'running' AND locked_until < now())
      ORDER BY run_after LIMIT $1 FOR UPDATE SKIP LOCKED)
    RETURNING id, kind, payload, attempts, max_attempts, idempotency_key
  `, [limit]);
  summary.claimed = jobs.length;
  for (const job of jobs) {
    const client = await pool.connect();
    try {
      const handler = handlers[job.kind];
      if (!handler) throw new Error('Type de tâche inconnu');
      await handler(client, env, job);
      await client.query("UPDATE unoa.job SET state = 'done', finished_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1", [job.id]);
      summary.done++;
    } catch (error) {
      if (error instanceof SkipDelivery) {
        await client.query("UPDATE unoa.job SET state = 'skipped', finished_at = now(), locked_until = NULL, last_error = $2 WHERE id = $1", [job.id, clean(error)]);
        summary.skipped++;
      } else if (job.attempts >= job.max_attempts || !(error instanceof TemporaryFailure)) {
        await client.query("UPDATE unoa.job SET state = 'dead', finished_at = now(), locked_until = NULL, last_error = $2 WHERE id = $1", [job.id, clean(error)]);
        summary.dead++;
      } else {
        await client.query(`UPDATE unoa.job SET state = 'failed', locked_until = NULL, last_error = $2,
          run_after = now() + make_interval(mins => $3) WHERE id = $1`, [job.id, clean(error), backoffMinutes(job.attempts)]);
        summary.failed++;
      }
    } finally {
      client.release();
    }
  }
  return summary;
}
