import { NextResponse, type NextRequest } from 'next/server';
import { runJobs } from '@unoa/jobs';
import { iamSettings } from '@/lib/iam/settings';
import { database } from '@/lib/iam/sessions';
import { jobsAuthorized } from '@/lib/server/jobs';
import { problem, unavailable } from '@/lib/server/responses';

const path = '/api/v1/jobs/run';

// Called by the scheduled task (Vercel cron sends "Authorization: Bearer CRON_SECRET").
async function run(request: NextRequest) {
  const settings = iamSettings();
  if (!settings) return unavailable(path);
  if (!jobsAuthorized(request.headers.get('authorization'))) return problem(401, 'Jeton de traitement requis', path);
  try {
    const summary = await runJobs(database(settings), { ...process.env, UNOA_WEB_ORIGIN: settings.origin.origin }, 50);
    return NextResponse.json(summary, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    console.error('unoa-jobs-run', (error as { code?: string }).code ?? 'unknown');
    return problem(503, 'Traitement indisponible', path);
  }
}

export const GET = run;
export const POST = run;
