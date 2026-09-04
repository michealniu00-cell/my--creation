import { configVersionDraftSchema } from '@video-agent-studio/shared';
import { configRepository, ensureDb } from '@video-agent-studio/db';
import { jsonOk, readJsonWithSchema } from '../../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const items = await configRepository.list(projectId);
  return jsonOk({ items });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const body = await readJsonWithSchema(request, configVersionDraftSchema, {
    message: 'Invalid config payload',
  });
  if (!body.success) {
    return body.response;
  }

  const configVersion = await configRepository.createDraft(projectId, body.data as never);
  return jsonOk({
    configVersionId: configVersion.id,
    versionNo: configVersion.versionNo,
    confirmedByUser: configVersion.confirmedByUser,
  });
}
