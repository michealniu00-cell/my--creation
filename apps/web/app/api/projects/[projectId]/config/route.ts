import { configRepository, ensureDb } from '@video-agent-studio/db';
import { jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const activeVersion = await configRepository.getActive(projectId);
  return jsonOk({ activeVersion });
}

