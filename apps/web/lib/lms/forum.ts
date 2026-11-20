import 'server-only';
// Moderated course forum: members post, the teaching team hides or locks.
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { boundedText, choice, day, ensure, flag, https, integer, language, numeric, optional, optionalText, Problem, text, timeZone, uuid, type Input } from '@/lib/shared/validation';
import { audit, transaction } from '@/lib/server/db';
import { canModerate, offering } from './offerings';

export async function forumThread(settings: IamSettings, actor: string, id: string, threadId: string) {
  const store = database(settings);
  const item = await offering(store, actor, uuid(id));
  const { rows: thread } = await store.query<{ id: string; title: string; locked_at: Date | null }>(
    'SELECT id, title, locked_at FROM unoa.forum_thread WHERE id = $1 AND offering_id = $2', [uuid(threadId), item.id],
  );
  ensure(thread[0], 404, 'Discussion introuvable');
  const moderator = canModerate(item);
  const { rows: posts } = await store.query<{ id: string; author: string | null; body: string | null; created_at: Date; hidden: boolean; hidden_reason: string | null; mine: boolean }>(`
    SELECT post.id, member.display_name AS author, CASE WHEN post.hidden_at IS NULL OR $3 THEN post.body END AS body,
           post.created_at, post.hidden_at IS NOT NULL AS hidden, post.hidden_reason, post.author_id = $4 AS mine
    FROM unoa.forum_post AS post
    LEFT JOIN LATERAL (SELECT display_name FROM unoa.offering_member WHERE offering_id = $2 AND account_id = post.author_id
      AND display_name IS NOT NULL LIMIT 1) AS member ON true
    WHERE post.thread_id = $1 ORDER BY post.created_at LIMIT 500
  `, [thread[0].id, item.id, moderator, actor]);
  return { offering: item, thread: thread[0], posts, moderator };
}

export async function forumAction(settings: IamSettings, actor: string, id: string, action: string, input: Input, correlation: string) {
  const offeringId = uuid(id);
  return transaction(settings, 'unoa.lms.forum.' + offeringId, async store => {
    const item = await offering(store, actor, offeringId);
    ensure(item.role || item.manage, 403, 'Forum réservé aux membres');
    if (action === 'threads') {
      ensure(item.state === 'open', 409, 'Offre close');
      const title = boundedText(input.title, 200, 'Sujet');
      const body = boundedText(input.body, 10000, 'Message');
      const { rows } = await store.query<{ id: string }>('INSERT INTO unoa.forum_thread(offering_id, title, created_by) VALUES ($1, $2, $3) RETURNING id',
        [offeringId, title, actor]);
      await store.query('INSERT INTO unoa.forum_post(thread_id, author_id, body) VALUES ($1, $2, $3)', [rows[0].id, actor, body]);
      return { id: rows[0].id };
    }
    const threadId = uuid(input.threadId);
    const { rows } = await store.query('SELECT 1 FROM unoa.forum_thread WHERE id = $1 AND offering_id = $2', [threadId, offeringId]);
    ensure(rows[0], 404, 'Discussion introuvable');
    if (action === 'posts') {
      const { rows: post } = await store.query<{ id: string }>('INSERT INTO unoa.forum_post(thread_id, author_id, body) VALUES ($1, $2, $3) RETURNING id',
        [threadId, actor, boundedText(input.body, 10000, 'Message')]);
      return { id: post[0].id };
    }
    ensure(canModerate(item), 403, 'Modération réservée à l’équipe pédagogique');
    if (action === 'hide') {
      const hidden = await store.query(`
        UPDATE unoa.forum_post SET hidden_at = now(), hidden_by = $3, hidden_reason = $4 WHERE id = $1 AND thread_id = $2 AND hidden_at IS NULL
      `, [uuid(input.postId), threadId, actor, boundedText(input.reason, 500, 'Motif')]);
      ensure(hidden.rowCount === 1, 404, 'Message introuvable ou déjà masqué');
      await audit(store, actor, item.owner_scope_id, 'lms.post_hidden', correlation, String(input.postId));
      return { id: threadId };
    }
    if (action === 'lock') {
      await store.query('UPDATE unoa.forum_thread SET locked_at = now() WHERE id = $1 AND locked_at IS NULL', [threadId]);
      await audit(store, actor, item.owner_scope_id, 'lms.thread_locked', correlation, threadId);
      return { id: threadId };
    }
    throw new Problem(404, 'Opération inconnue');
  });
}

