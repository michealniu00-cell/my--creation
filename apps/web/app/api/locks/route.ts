import { ensureDb, lockRepository } from '@video-agent-studio/db';
import { jsonOk } from '../../../lib/http';

export async function GET(request: Request) {
  await ensureDb();
  const { searchParams } = new URL(request.url);
  const objectType = searchParams.get('objectType') as 'shot' | 'artifact_version';
  const objectId = searchParams.get('objectId') ?? '';
  const status = await lockRepository.getStatus(objectType, objectId);
  return jsonOk(status);
}
