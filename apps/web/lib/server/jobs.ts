import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { after } from 'next/server';
import { runJobs } from '@unoa/jobs';
import type { IamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';

// The queue is drained by the worker, by the scheduled call of /api/v1/jobs/run,
// and right after each write so that messages leave without waiting.
export function drainSoon(settings: IamSettings) {
  // UNOA_JOBS_DRAIN_AFTER_WRITE=off leaves the queue to the worker alone (deterministic recette).
  if (process.env.UNOA_JOBS_DRAIN_AFTER_WRITE === 'off') return;
  after(() => runJobs(database(settings), { ...process.env, UNOA_WEB_ORIGIN: settings.origin.origin }, 10)
    .catch(error => console.error('unoa-jobs-after', (error as { code?: string }).code ?? 'unknown')));
}

export function jobsAuthorized(header: string | null) {
  const expected = [process.env.UNOA_JOBS_TOKEN, process.env.CRON_SECRET].filter((value): value is string => !!value && value.length >= 32);
  const given = header?.startsWith('Bearer ') ? Buffer.from(header.slice(7)) : null;
  return !!given && expected.some(value => {
    const wanted = Buffer.from(value);
    return wanted.length === given.length && timingSafeEqual(wanted, given);
  });
}
