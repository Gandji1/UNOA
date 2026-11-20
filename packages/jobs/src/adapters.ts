// Delivery adapters. "sandbox" keeps the message in the database (laboratory
// and recette only); "http" posts to a relay configured by environment
// variables (production provider, secrets outside the code). No adapter
// configured means the channel is disabled: the attempt is recorded as skipped.

export interface Outgoing { channel: 'email' | 'sms'; recipient: string; subject: string; body: string; link: string | null; idempotencyKey: string }
export interface Delivered { adapter: string; providerRef: string | null }

export class SkipDelivery extends Error {}
export class TemporaryFailure extends Error {}

export interface AdapterEnvironment { [name: string]: string | undefined }

type Store = { query: (sql: string, values?: unknown[]) => Promise<unknown> };

export function adapterName(env: AdapterEnvironment, channel: 'email' | 'sms') {
  return (env[channel === 'email' ? 'UNOA_EMAIL_ADAPTER' : 'UNOA_SMS_ADAPTER'] ?? '').trim().toLowerCase();
}

export async function deliver(env: AdapterEnvironment, store: Store, jobId: string, message: Outgoing): Promise<Delivered> {
  const name = adapterName(env, message.channel);
  if (!name) throw new SkipDelivery('Canal non activé');
  if (name === 'sandbox') {
    if (env.UNOA_ENVIRONMENT === 'production') throw new SkipDelivery('Adaptateur sandbox interdit en production');
    await store.query('INSERT INTO unoa.sandbox_message(job_id, channel, recipient, subject, body) VALUES ($1, $2, $3, $4, $5)',
      [jobId, message.channel, message.recipient, message.channel === 'email' ? message.subject : null, message.body]);
    return { adapter: 'sandbox', providerRef: 'sandbox:' + jobId };
  }
  if (name === 'http') {
    const prefix = message.channel === 'email' ? 'UNOA_EMAIL_HTTP_' : 'UNOA_SMS_HTTP_';
    const url = env[prefix + 'URL'];
    const token = env[prefix + 'TOKEN'];
    if (!url || !token) throw new SkipDelivery('Relais non configuré');
    const target = new URL(url);
    const local = ['127.0.0.1', 'localhost'].includes(target.hostname) && env.NODE_ENV !== 'production';
    if (target.protocol !== 'https:' && !local) throw new SkipDelivery('Relais HTTPS requis');
    let response: Response;
    try {
      response = await fetch(target, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', 'Idempotency-Key': message.idempotencyKey },
        body: JSON.stringify({
          channel: message.channel, to: message.recipient, from: env[prefix + 'FROM'] || undefined,
          subject: message.channel === 'email' ? message.subject : undefined, text: message.body,
        }),
      });
    } catch {
      throw new TemporaryFailure('Relais injoignable');
    }
    if (response.status === 429 || response.status >= 500) throw new TemporaryFailure('Relais indisponible (' + response.status + ')');
    if (!response.ok) throw new Error('Envoi refusé par le relais (' + response.status + ')');
    const answer = await response.json().catch(() => ({})) as { id?: unknown };
    return { adapter: 'http', providerRef: typeof answer.id === 'string' ? answer.id.slice(0, 200) : null };
  }
  throw new SkipDelivery('Adaptateur inconnu');
}
