import pg from 'pg';
import { runJobs } from '@unoa/jobs';

// Long-running worker for self-hosted deployments. On Vercel the same queue is
// drained by /api/v1/jobs/run (scheduled task) and right after each write.
// UNOA_WORKER_DATABASE_URL uses the restricted web role, never the owner.
const connectionString = process.env.UNOA_WORKER_DATABASE_URL;
if (!connectionString) {
  console.error('Définir UNOA_WORKER_DATABASE_URL');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString, max: 4, statement_timeout: 15_000 });
const interval = Math.max(Number(process.env.UNOA_WORKER_INTERVAL_MS ?? 5000), 1000);
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { stopping = true; });

while (!stopping) {
  try {
    const summary = await runJobs(pool, process.env, 50);
    if (summary.claimed) console.log(JSON.stringify({ event: 'unoa-worker-run', ...summary }));
  } catch (error) {
    console.error(JSON.stringify({ event: 'unoa-worker-error', code: (error as { code?: string }).code ?? 'unknown' }));
  }
  await new Promise(resolve => setTimeout(resolve, interval));
}
await pool.end();
