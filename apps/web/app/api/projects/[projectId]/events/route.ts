import { ensureDb, eventRepository } from '@video-agent-studio/db';
import { jsonOk } from '../../../../../lib/http';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const { searchParams } = new URL(request.url);
  const userVisible = searchParams.get('userVisible');
  const items = await eventRepository.list(
    projectId,
    userVisible === null ? undefined : userVisible === 'true',
  );
  return jsonOk({ items });
}

