import {
  artifactRepository,
  ensureDb,
  runRepository,
  shotRepository,
} from '@video-agent-studio/db';
import type { ShotWithAssets } from '@video-agent-studio/shared';
import { jsonOk } from '../../../../../../../lib/http';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const run = await runRepository.getLatestByProject(projectId, 'video');
  const shots = (await shotRepository.list(
    projectId,
    true,
  )) as ShotWithAssets[];

  let generated = 0;
  let failed = 0;
  let placeholderCount = 0;
  for (const shot of shots) {
    const video = await artifactRepository.getShotVideo(shot.id);
    const activeVersion = video?.versions.find(
      (version) => version.id === video.group?.activeVersionId,
    );
    if (activeVersion?.isPlaceholder) {
      placeholderCount += 1;
      failed += 1;
    } else if (activeVersion) {
      generated += 1;
    }
  }

  return jsonOk({
    run,
    summary: {
      totalShots: shots.length,
      generated,
      failed,
      placeholderCount,
    },
  });
}
