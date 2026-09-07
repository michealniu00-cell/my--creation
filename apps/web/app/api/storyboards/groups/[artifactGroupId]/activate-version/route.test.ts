import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { artifactRepository, lockRepository } from '@video-agent-studio/db';
import { POST } from './route';
import {
  createTempApiTestEnv,
  getDemoProject,
  getDemoShot,
} from '../../../../test-helpers';

function request(body: unknown) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/storyboards/groups/[artifactGroupId]/activate-version', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-storyboard-activate-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    await cleanup();
  });

  async function getStoryboardGroup() {
    const project = await getDemoProject();
    const shot = await getDemoShot(project.id);
    const storyboard = await artifactRepository.getShotStoryboard(shot.id);
    expect(storyboard?.group).toBeTruthy();
    return { project, shot, group: storyboard!.group! };
  }

  async function createCandidate(groupId: string, note: string, status: 'generated' | 'pending' | 'failed' | 'rejected' = 'generated') {
    const version = await artifactRepository.createNextVersion({
      groupId,
      generatedByAgent: 'agent8',
      sourceTaskId: null,
      mimeType: 'image/png',
      storageBucket: 'test',
      storagePath: `${note}.png`,
      publicUrl: `/test/${note}.png`,
      fileSizeBytes: 1,
      width: 1280,
      height: 720,
      durationMs: null,
      generationInput: {},
      metadata: {},
      status,
      versionNote: note,
      isPlaceholder: false,
    });
    expect(version).toBeTruthy();
    return version!;
  }

  it('requires the client-observed active version', async () => {
    const { group } = await getStoryboardGroup();
    const candidate = await createCandidate(group.id, 'missing-expectation');

    const response = await POST(request({ versionId: candidate.id }), {
      params: Promise.resolve({ artifactGroupId: group.id }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
  });

  it.each(['pending', 'failed', 'rejected'] as const)('rejects %s versions even when directly requested', async (status) => {
    const { group } = await getStoryboardGroup();
    const candidate = await createCandidate(group.id, 'not-ready', status);
    const response = await POST(request({ versionId: candidate.id, expectedActiveVersionId: group.activeVersionId ?? null }), { params: Promise.resolve({ artifactGroupId: group.id }) });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('VERSION_NOT_READY');
    expect((await artifactRepository.getGroup(group.id))?.activeVersionId).toBe(group.activeVersionId);
  });

  it('returns 409 for a stale activation and leaves the newer version active', async () => {
    const { group } = await getStoryboardGroup();
    const observedActiveVersionId = group.activeVersionId ?? null;
    const olderCompletion = await createCandidate(group.id, 'older-completion');
    const newerCompletion = await createCandidate(group.id, 'newer-completion');

    const newerResponse = await POST(
      request({
        versionId: newerCompletion.id,
        expectedActiveVersionId: observedActiveVersionId,
      }),
      { params: Promise.resolve({ artifactGroupId: group.id }) },
    );
    expect(newerResponse.status).toBe(200);

    const staleResponse = await POST(
      request({
        versionId: olderCompletion.id,
        expectedActiveVersionId: observedActiveVersionId,
      }),
      { params: Promise.resolve({ artifactGroupId: group.id }) },
    );
    const payload = await staleResponse.json();

    expect(staleResponse.status).toBe(409);
    expect(payload.error.code).toBe('ARTIFACT_VERSION_CONFLICT');
    expect(payload.error.details.reason).toBe('active_version_conflict');
    expect((await artifactRepository.getGroup(group.id))?.activeVersionId).toBe(
      newerCompletion.id,
    );
  });

  it('returns a lock conflict when the active version is locked', async () => {
    const { project, group } = await getStoryboardGroup();
    expect(group.activeVersionId).toBeTruthy();
    const candidate = await createCandidate(group.id, 'locked-candidate');
    await lockRepository.lock({
      projectId: project.id,
      objectType: 'artifact_version',
      objectId: group.activeVersionId!,
      lockScope: 'self',
      cascadeChildren: [],
      lockedByUserId: null,
      lockReason: 'test lock',
      isActive: true,
    });

    const response = await POST(
      request({
        versionId: candidate.id,
        expectedActiveVersionId: group.activeVersionId,
      }),
      { params: Promise.resolve({ artifactGroupId: group.id }) },
    );
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('LOCK_CONFLICT');
    expect(payload.error.details.reason).toBe('active_version_locked');
    expect((await artifactRepository.getGroup(group.id))?.activeVersionId).toBe(
      group.activeVersionId,
    );
  });
});
