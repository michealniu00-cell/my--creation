import { ensureDb } from '@video-agent-studio/db';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { DurableJobRunner } from './jobs/job-runner';
import { createWorkflowJobHandlers } from './jobs/workflow-job-handlers';

async function main() {
  await ensureDb();
  const workerId = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const shutdown = new AbortController();
  const requestShutdown = () => shutdown.abort();
  process.once('SIGINT', requestShutdown);
  process.once('SIGTERM', requestShutdown);

  const runner = new DurableJobRunner({
    workerId,
    handlers: createWorkflowJobHandlers(),
  });
  console.log(`[worker] Video Agent Studio worker polling as ${workerId}`);
  await runner.start(shutdown.signal);
  console.log(`[worker] ${workerId} stopped`);
}

main().catch((error) => {
  console.error('[worker] boot failed', error);
  process.exit(1);
});
