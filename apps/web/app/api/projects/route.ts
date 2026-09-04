import { bootstrapProjectSettings } from '@video-agent-studio/worker';
import { createProjectSchema } from '@video-agent-studio/shared';
import { ensureDb, projectRepository } from '@video-agent-studio/db';
import { jsonOk, readJsonWithSchema } from '../../../lib/http';

export async function GET(request: Request) {
  await ensureDb();
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') ?? undefined;
  const items = await projectRepository.list(status as never);
  return jsonOk({
    items,
    total: items.length,
  });
}

export async function POST(request: Request) {
  await ensureDb();
  const body = await readJsonWithSchema(request, createProjectSchema, {
    message: 'Invalid request body',
  });
  if (!body.success) {
    return body.response;
  }

  const project = await projectRepository.create(body.data);
  await bootstrapProjectSettings(project.id);

  return jsonOk({
    projectId: project.id,
    status: project.status,
  });
}
