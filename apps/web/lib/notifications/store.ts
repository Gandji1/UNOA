import 'server-only';
// In-application notifications (module NOT). External channels (email, SMS,
// push) will plug in here through adapters with consent and delivery proof.
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { uuid } from '@/lib/shared/validation';
import type { Queryable } from '@/lib/server/db';

export async function notify(store: Queryable, offeringId: string, except: string, kind: string, title: string, body: string | null, link: string) {
  await store.query(`
    INSERT INTO unoa.notification(account_id, kind, title, body, link)
    SELECT DISTINCT account_id, $3, $4, $5, $6 FROM unoa.offering_member
    WHERE offering_id = $1 AND removed_at IS NULL AND account_id <> $2
  `, [offeringId, except, kind, title, body, link]);
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

