import { ensureDb, sceneRepository } from '@video-agent-studio/db';
import { jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const items = await sceneRepository.list(projectId);
  return jsonOk({ items });
}

