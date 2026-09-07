import type { ShotWithAssets } from '@video-agent-studio/shared';

export type ShotFilter = 'all' | 'attention' | 'missing_video' | 'locked';
export function shotNeedsAttention(shot: ShotWithAssets) {
  return (
    shot.assets?.storyboardMain?.processingVersion?.status === 'failed' ||
    shot.assets?.videoMain?.processingVersion?.status === 'failed'
  );
}
export function matchesShotFilter(shot: ShotWithAssets, filter: ShotFilter) {
  if (filter === 'attention') return shotNeedsAttention(shot);
  if (filter === 'locked') return shot.locked;
  if (filter === 'missing_video')
    return (
      !shot.assets?.videoMain?.url ||
      Boolean(shot.assets.videoMain.isPlaceholder)
    );
  return true;
}
