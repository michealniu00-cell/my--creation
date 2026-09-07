import { describe, expect, it } from 'vitest';
import type { ShotWithAssets } from '@video-agent-studio/shared';
import { matchesShotFilter, shotNeedsAttention } from './shot-filter';

const shot: ShotWithAssets = {
  id: 'shot-1',
  projectId: 'project-1',
  shotIndexGlobal: 1,
  status: 'active',
  locked: false,
  isUserAdded: false,
  sortVersion: 1,
  createdAt: '',
  updatedAt: '',
  deletedAt: null,
};
describe('Shot workspace filters', () => {
  it('keeps empty video slots and placeholders in the unfinished list', () => {
    expect(matchesShotFilter(shot, 'missing_video')).toBe(true);
    expect(
      matchesShotFilter(
        {
          ...shot,
          assets: {
            videoMain: {
              artifactGroupId: 'video',
              url: '/placeholder.mp4',
              isPlaceholder: true,
            },
          },
        },
        'missing_video',
      ),
    ).toBe(true);
    expect(
      matchesShotFilter(
        {
          ...shot,
          assets: { videoMain: { artifactGroupId: 'video', url: '/real.mp4' } },
        },
        'missing_video',
      ),
    ).toBe(false);
  });
  it('surfaces failed replacements even when the active version is usable', () => {
    const failed = {
      ...shot,
      assets: {
        storyboardMain: {
          artifactGroupId: 'image',
          url: '/active.png',
          processingVersion: {
            versionId: 'v2',
            versionNo: 2,
            status: 'failed',
          },
        },
      },
    };
    expect(shotNeedsAttention(failed)).toBe(true);
    expect(matchesShotFilter(failed, 'attention')).toBe(true);
    expect(failed.assets.storyboardMain.url).toBe('/active.png');
  });
  it('does not confuse running jobs with failures or change locks', () => {
    expect(
      shotNeedsAttention({
        ...shot,
        assets: {
          videoMain: {
            artifactGroupId: 'video',
            processingVersion: {
              versionId: 'v1',
              versionNo: 1,
              status: 'pending',
            },
          },
        },
      }),
    ).toBe(false);
    expect(matchesShotFilter({ ...shot, locked: true }, 'locked')).toBe(true);
    expect(matchesShotFilter(shot, 'locked')).toBe(false);
    expect(matchesShotFilter(shot, 'all')).toBe(true);
  });
});
