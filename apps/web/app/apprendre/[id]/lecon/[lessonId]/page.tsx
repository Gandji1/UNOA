import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { formatOffset } from '@unoa/domain/learning';
import { formatInZone } from '@unoa/domain/time';
import { Problem } from '@/lib/shared/validation';
import { scopeIdFormat } from '@/lib/iam/settings';
import { lessonView } from '@/lib/lms/offerings';
import { Markup } from '@/lib/lms/markup';
import { ActionForm, Badge, Notice } from '../../../../administration/forms';
import { learner } from '../../../session';
import { Player } from './player';

export const metadata: Metadata = { title: 'Leçon' };
export const dynamic = 'force-dynamic';
type Props = { params: Promise<{ id: string; lessonId: string }>; searchParams: Promise<{ error?: string; message?: string }> };

export default async function Lesson({ params, searchParams }: Props) {
  const { id, lessonId } = await params;
  if (!scopeIdFormat.test(id) || !scopeIdFormat.test(lessonId)) notFound();
  const { settings, actor } = await learner();
  const search = await searchParams;
  let view;
  try {
    view = await lessonView(settings, actor, id, lessonId);
  } catch (error) {
    if (!(error instanceof Problem)) throw error;
    return <main id="contenu" className="studio"><section className="studio-panel"><h1>Leçon</h1>
      <p>{error.status === 423 ? 'Cette leçon est verrouillée : terminez d’abord les leçons requises.' : 'Leçon inaccessible.'}</p>
      <p><a href={`/apprendre/${id}`}>Revenir au cours</a></p></section></main>;
  }
  const { offering, lesson, lessons, completed, note, dues } = view;
  const back = `/apprendre/${offering.id}/lecon/${lesson.id}`;
  const index = lessons.findIndex(item => item.id === lesson.id);
  const next = lessons[index + 1];
  const due = dues.find(item => item.lesson_id === lesson.id);
  const done = completed.includes(lesson.id);
  return (
    <main id="contenu" className="studio lesson">
      <nav aria-label="Fil d’Ariane" className="crumbs"><a href="/apprendre">Mes cours</a> › <a href={`/apprendre/${offering.id}`}>{offering.title}</a> ›{' '}
        <span aria-current="page">{lesson.title}</span></nav>
      <Notice error={search.error} message={search.message} />
      <article className="studio-panel">
        <h1>{lesson.title}</h1>
        <p className="badges">{lesson.expected_minutes && <Badge tone="muted">{lesson.expected_minutes} min</Badge>}
          {due && <Badge tone="warn">Échéance : {formatInZone(due.due_at, offering.time_zone)}</Badge>}
          {done && <Badge tone="ok">Terminée</Badge>}</p>
        {(lesson.kind === 'video' || lesson.kind === 'audio') && lesson.media_url && (
          <Player kind={lesson.kind} src={lesson.media_url} captions={lesson.captions_url} captionsLanguage={lesson.captions_language ?? offering.language}
            chapters={lesson.chapters} title={lesson.title} />
        )}
        {lesson.chapters.length > 0 && lesson.kind !== 'video' && lesson.kind !== 'audio' &&
          <ul>{lesson.chapters.map(item => <li key={item.at}>{formatOffset(item.at)} {item.title}</li>)}</ul>}
        {(lesson.kind === 'document' || lesson.kind === 'link') && lesson.media_url && (
          <p><a className="secondary" href={lesson.media_url} rel="noopener noreferrer" target="_blank"
            {...(lesson.downloadable ? { download: '' } : {})}>{lesson.kind === 'document' ? 'Ouvrir le document' : 'Ouvrir la ressource'}</a></p>
        )}
        {lesson.body && <Markup source={lesson.body} />}
        {lesson.transcript && <details><summary>Transcription</summary><p className="transcript">{lesson.transcript}</p></details>}
        <p className="muted">Droits : {lesson.rights}</p>
        <div className="studio-actions">
          {offering.role === 'learner' && !done && (
            <ActionForm inline action={`/api/v1/lms/offerings/${offering.id}/progress`} back={next ? `/apprendre/${offering.id}/lecon/${next.id}` : `/apprendre/${offering.id}`}
              hidden={{ lessonId: lesson.id }} submit="Marquer comme terminée" />
          )}
          {next && <a className="secondary" href={`/apprendre/${offering.id}/lecon/${next.id}`}>Leçon suivante</a>}
        </div>
      </article>
      {offering.role && (
        <section className="studio-panel" aria-labelledby="notes">
          <h2 id="notes">Mes notes</h2>
          <p className="studio-help">Visibles par vous seul.</p>
          <ActionForm action={`/api/v1/lms/offerings/${offering.id}/notes`} back={back} hidden={{ lessonId: lesson.id }} submit="Enregistrer">
            <label className="studio-wide">Notes<textarea name="body" maxLength={20000} rows={5} defaultValue={note?.body ?? ''} /></label>
            <label className="studio-checkbox"><input type="checkbox" name="bookmarked" defaultChecked={note?.bookmarked ?? false} /> Signet</label>
          </ActionForm>
        </section>
      )}
    </main>
  );
}
