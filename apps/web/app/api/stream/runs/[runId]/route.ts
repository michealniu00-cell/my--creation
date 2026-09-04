import { ensureDb, eventRepository, runRepository, taskRepository } from '@video-agent-studio/db';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ runId: string }> },
) {
  await ensureDb();
  const { runId } = await params;
  const run = await runRepository.get(runId);
  const tasks = run ? await taskRepository.listByRun(runId) : [];
  const events = run
    ? (await eventRepository.list(run.projectId, true)).filter((event) => event.runId === runId)
    : [];

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    start(controller) {
      const chunks = [
        {
          event: 'run.updated',
          data: {
            runId: run?.id,
            status: run?.status,
            currentNode: run?.currentNode,
          },
        },
        ...tasks.slice(-5).map((task) => ({
          event: 'task.updated',
          data: {
            taskId: task.id,
            agentName: task.agentName,
            status: task.status,
          },
        })),
        ...events.slice(0, 5).map((event) => ({
          event: 'user.alert',
          data: {
            type: event.eventType,
            message: event.summary,
          },
        })),
      ];

      chunks.forEach((chunk) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
      });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      Connection: 'keep-alive',
      'Cache-Control': 'no-cache, no-transform',
    },
  });
}
