import { configRepository, ensureDb } from '@video-agent-studio/db';
import { jsonFail, jsonOk } from '../../../../../../../../lib/http';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ projectId: string; configVersionId: string }> },
) {
  await ensureDb();
  const { projectId, configVersionId } = await params;
  const version = await configRepository.confirm(projectId, configVersionId);
  if (!version) {
    return jsonFail('NOT_FOUND', 'Config version not found', 404);
  }
  return jsonOk({
    configVersionId,
    confirmedByUser: true,
    isActive: true,
  });
}

