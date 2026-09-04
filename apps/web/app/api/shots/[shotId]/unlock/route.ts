import { ensureDb, lockRepository } from '@video-agent-studio/db';
import { jsonOk } from '../../../../../lib/http';

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  await lockRepository.unlock('shot', shotId);
  return jsonOk({
    shotId,
    unlocked: true,
  });
}

