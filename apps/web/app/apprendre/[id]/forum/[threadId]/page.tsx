import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { scopeIdFormat } from '@/lib/iam/settings';
import { forumThread } from '@/lib/lms/forum';
import { ActionForm, Badge, formatTime, Notice } from '../../../../administration/forms';
import { learner, refusedAs } from '../../../session';

export const metadata: Metadata = { title: 'Forum' };
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; threadId: string }>; searchParams: Promise<{ error?: string; message?: string }> };

export default async function Thread({ params, searchParams }: Props) {
  const { id, threadId } = await params;
  if (!scopeIdFormat.test(id) || !scopeIdFormat.test(threadId)) notFound();
  const { settings, actor } = await learner();
  const search = await searchParams;
  const data = await forumThread(settings, actor, id, threadId).catch(refusedAs(null));
  if (!data) return <main id="contenu" className="studio"><section className="studio-panel"><h1>Forum</h1><p>Discussion inaccessible.</p></section></main>;
  const { offering, thread, posts, moderator } = data;
  const back = `/apprendre/${offering.id}/forum/${thread.id}`;
  const api = `/api/v1/lms/offerings/${offering.id}/`;
  return (
    <main id="contenu" className="studio">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/apprendre">Mes cours</a> › <a href={`/apprendre/${offering.id}#forum`}>{offering.title}</a> › Forum</nav>
      <section className="studio-panel"><h1>{thread.title}</h1>{thread.locked_at && <Badge tone="muted">Discussion verrouillée</Badge>}</section>
      <Notice error={search.error} message={search.message} />
      <ol className="posts">
        {posts.map(post => (
          <li key={post.id} className="studio-panel">
            <p className="muted">{post.author ?? (post.mine ? 'Vous' : 'Participant')} · {formatTime(post.created_at)}</p>
            {post.hidden && <p><Badge tone="warn">Message masqué par la modération{post.hidden_reason && moderator ? ' : ' + post.hidden_reason : ''}</Badge></p>}
            {post.body && <p className="post-body">{post.body}</p>}
            {moderator && !post.hidden && (
              <ActionForm inline action={api + 'hide'} back={back} hidden={{ threadId: thread.id, postId: post.id }} submit="Masquer">
                <label className="sr" htmlFor={'reason-' + post.id}>Motif</label>
                <input id={'reason-' + post.id} name="reason" required maxLength={500} placeholder="Motif de modération" />
              </ActionForm>
            )}
          </li>
        ))}
      </ol>
      {!thread.locked_at && offering.state === 'open' && (
        <ActionForm action={api + 'posts'} back={back} hidden={{ threadId: thread.id }} submit="Répondre">
          <label className="studio-wide">Réponse<textarea name="body" required maxLength={10000} /></label>
        </ActionForm>
      )}
      {moderator && !thread.locked_at && <ActionForm action={api + 'lock'} back={back} hidden={{ threadId: thread.id }} submit="Verrouiller la discussion" />}
    </main>
  );
}
