import { ensureDb, reviewRepository } from '@video-agent-studio/db';
import { jsonOk } from '../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  await ensureDb();
  const { taskId } = await params;
  const items = await reviewRepository.listByTask(taskId);
  return jsonOk({ items });
}

