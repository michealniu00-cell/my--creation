import { ensureDb, settingsRepository } from '@video-agent-studio/db';
import { updateAgentProfileSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  await settingsRepository.ensureDefaults(projectId);
  const items = await settingsRepository.listProfiles(projectId);
  return jsonOk({ items });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  await settingsRepository.ensureDefaults(projectId);
  const body = await readJsonWithSchema(request, updateAgentProfileSchema, {
    message: 'Invalid agent profile payload',
  });
  if (!body.success) {
    return body.response;
  }

  const { profileId, ...patch } = body.data;
  const item = await settingsRepository.updateProfile(projectId, profileId, patch);
  if (!item) {
    return jsonFail('NOT_FOUND', 'Agent profile not found', 404);
  }

  return jsonOk({ item });
}
