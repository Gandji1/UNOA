import type { NextRequest } from 'next/server';
import { Problem } from '@/lib/shared/validation';
import { studioGet, studioPost } from '@/lib/server/route';
import { forumAction, forumThread } from '@/lib/lms/forum';
import { closeOffering, completeLesson, createOffering, lessonView, manageMember, myOfferings, offeringView, saveNote, setDue } from '@/lib/lms/offerings';
import { courseDetails, courseVersionDetails, createCourseVersion, editCourseVersion, exportCourseVersion, importCourseVersion, lmsContexts, lmsOverview, removeFromCourseVersion, transitionCourseVersion } from '@/lib/lms/studio';
import { markRead, notifications } from '@/lib/notifications/store';

type RouteContext = { params: Promise<{ operation: string[] }> };
const options = {
  path: '/api/v1/lms', studio: '/administration/cours', denial: 'lms.access', label: 'lms', returns: ['/apprendre', '/espace'],
};

export async function GET(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioGet(request, operation, options, async ({ settings, actor }, query) => {
    const [resource, id, action, extra] = operation;
    if (resource === 'scopes' && operation.length === 1) {
      const scopeId = query.get('scopeId');
      return scopeId ? lmsOverview(settings, actor, scopeId) : { scopes: await lmsContexts(settings, actor) };
    }
    if (resource === 'courses' && operation.length === 2) return courseDetails(settings, actor, id);
    if (resource === 'course-versions' && operation.length === 2) return courseVersionDetails(settings, actor, id);
    if (resource === 'course-versions' && action === 'export') return exportCourseVersion(settings, actor, id);
    if (resource === 'offerings' && operation.length === 1) return { offerings: await myOfferings(settings, actor) };
    if (resource === 'offerings' && operation.length === 2) return offeringView(settings, actor, id);
    if (resource === 'offerings' && action === 'lessons' && extra) return lessonView(settings, actor, id, extra);
    if (resource === 'offerings' && action === 'threads' && extra) return forumThread(settings, actor, id, extra);
    if (resource === 'notifications') return { notifications: await notifications(settings, actor) };
    return null;
  });
}

export async function POST(request: NextRequest, { params }: RouteContext) {
  const { operation } = await params;
  return studioPost(request, operation, { ...options, repeated: [] }, async ({ settings, actor, correlation }, input) => {
    const [resource, id, action] = operation;
    if (resource === 'courses' && action === 'versions') return createCourseVersion(settings, actor, id, input, correlation);
    if (resource === 'courses' && action === 'import') return importCourseVersion(settings, actor, id, input, correlation);
    if (resource === 'course-versions' && ['update', 'modules', 'lessons'].includes(action)) {
      return editCourseVersion(settings, actor, id, action, input, correlation);
    }
    if (resource === 'course-versions' && action === 'remove') return removeFromCourseVersion(settings, actor, id, input, correlation);
    if (resource === 'course-versions' && ['submit', 'review', 'derive'].includes(action)) {
      return transitionCourseVersion(settings, actor, id, action, input, correlation);
    }
    if (resource === 'course-versions' && action === 'offerings') return createOffering(settings, actor, id, input, correlation);
    if (resource === 'offerings' && action === 'members') return manageMember(settings, actor, id, input, correlation);
    if (resource === 'offerings' && action === 'close') return closeOffering(settings, actor, id, correlation);
    if (resource === 'offerings' && action === 'progress') return completeLesson(settings, actor, id, input, correlation);
    if (resource === 'offerings' && action === 'notes') return saveNote(settings, actor, id, input, correlation);
    if (resource === 'offerings' && action === 'dues') return setDue(settings, actor, id, input, correlation);
    if (resource === 'offerings' && ['threads', 'posts', 'hide', 'lock'].includes(action)) {
      return forumAction(settings, actor, id, action, input, correlation);
    }
    if (resource === 'notifications' && action === 'read') return markRead(settings, actor, id);
    throw new Problem(404, 'Opération inconnue');
  });
}
