import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readGeneratedAsset } from '@video-agent-studio/artifact-service';
import {
  artifactRepository,
  readDb,
} from '@video-agent-studio/db';
import { POST } from './route';
import {
  createTempApiTestEnv,
  getDemoProject,
} from '../../../../test-helpers';

type ImageFixture = {
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  fileName: string;
  bytes: Uint8Array<ArrayBuffer>;
};

const imageFixtures: ImageFixture[] = [
  {
    mimeType: 'image/png',
    fileName: 'reference.png',
    bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
  },
  {
    mimeType: 'image/jpeg',
    fileName: 'reference.jpg',
    bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
  },
  {
    mimeType: 'image/webp',
    fileName: 'reference.webp',
    bytes: new Uint8Array([
      82, 73, 70, 70, 0, 0, 0, 0, 87, 69, 66, 80,
    ]),
  },
];

function uploadRequest(
  projectId: string,
  fixture: ImageFixture = imageFixtures[0]!,
  mutate?: (formData: FormData) => void,
) {
  const formData = new FormData();
  formData.set('role', 'character_ref');
  formData.set('name', '主角设定');
  formData.set('note', '用于保持角色一致性');
  formData.set(
    'file',
    new File([fixture.bytes], fixture.fileName, { type: fixture.mimeType }),
  );
  mutate?.(formData);
  return new Request(
    `http://localhost/api/projects/${projectId}/key-elements/uploads`,
    { method: 'POST', body: formData },
  );
}

describe('POST /api/projects/[projectId]/key-elements/uploads', () => {
  let cleanup = async () => {};

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-key-element-upload-route-');
    cleanup = env.cleanup;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await cleanup();
  });

  it.each(imageFixtures)(
    'persists and activates a real $mimeType upload',
    async (fixture) => {
      const project = await getDemoProject();
      const response = await POST(uploadRequest(project.id, fixture), {
        params: Promise.resolve({ projectId: project.id }),
      });
      const payload = (await response.json()) as {
        success: boolean;
        data: { artifactGroupId: string; versionId: string };
      };

      expect(response.status).toBe(200);
      expect(payload.success).toBe(true);
      const state = await artifactRepository.getVersions(
        payload.data.artifactGroupId,
      );
      expect(state.group).toMatchObject({
        projectId: project.id,
        scopeId: project.id,
        activeVersionId: payload.data.versionId,
        role: 'character_ref',
      });
      expect(state.versions).toHaveLength(1);
      expect(state.versions[0]).toMatchObject({
        id: payload.data.versionId,
        versionNo: 1,
        mimeType: fixture.mimeType,
        storageBucket: 'local',
        status: 'approved',
        isPlaceholder: false,
      });
      expect(state.versions[0]?.publicUrl).toMatch(
        /^\/api\/media\/local\/generated-assets\//,
      );
      expect(state.versions[0]?.publicUrl).not.toContain('data:image');

      const stored = await readGeneratedAsset(
        state.versions[0]!.storagePath!,
      );
      expect(stored.bytes).toEqual(Buffer.from(fixture.bytes));
      expect(stored.mimeType).toBe(fixture.mimeType);

      const db = await readDb();
      expect(
        db.taskEvents.some(
          (event) =>
            event.projectId === project.id &&
            event.eventType === 'key_element_uploaded' &&
            event.eventPayload.artifactVersionId === payload.data.versionId,
        ),
      ).toBe(true);
    },
  );

  it('rejects unknown multipart fields through the strict schema', async () => {
    const project = await getDemoProject();
    const before = (await artifactRepository.listKeyElements(project.id)).length;
    const response = await POST(
      uploadRequest(project.id, imageFixtures[0], (formData) => {
        formData.set('unexpectedScope', 'global');
      }),
      { params: Promise.resolve({ projectId: project.id }) },
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('VALIDATION_ERROR');
    expect(await artifactRepository.listKeyElements(project.id)).toHaveLength(
      before,
    );
  });

  it('rejects a spoofed image before creating an artifact', async () => {
    const project = await getDemoProject();
    const before = (await artifactRepository.listKeyElements(project.id)).length;
    const spoofed = {
      mimeType: 'image/png',
      fileName: 'not-an-image.png',
      bytes: new Uint8Array([60, 115, 118, 103, 62]),
    } as const;

    const response = await POST(uploadRequest(project.id, spoofed), {
      params: Promise.resolve({ projectId: project.id }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe('INVALID_MEDIA_CONTENT');
    expect(await artifactRepository.listKeyElements(project.id)).toHaveLength(
      before,
    );
  });

  it('rejects uploads for a project that does not exist', async () => {
    const response = await POST(uploadRequest('missing-project'), {
      params: Promise.resolve({ projectId: 'missing-project' }),
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe('PROJECT_NOT_FOUND');
  });

  it('retains the appended candidate when compare-and-swap activation conflicts', async () => {
    const project = await getDemoProject();
    const activation = vi
      .spyOn(artifactRepository, 'activateVersionIfExpected')
      .mockResolvedValue({
        ok: false,
        reason: 'active_version_conflict',
        group: null,
        version: null,
        actualActiveVersionId: 'newer-version',
        actualGroupUpdatedAt: new Date().toISOString(),
        lockId: null,
      });

    const response = await POST(uploadRequest(project.id), {
      params: Promise.resolve({ projectId: project.id }),
    });
    const payload = (await response.json()) as {
      error: {
        code: string;
        details: { artifactGroupId: string; candidateVersionId: string };
      };
    };

    expect(response.status).toBe(409);
    expect(payload.error.code).toBe('ARTIFACT_VERSION_CONFLICT');
    expect(activation).toHaveBeenCalledWith(
      payload.error.details.artifactGroupId,
      payload.error.details.candidateVersionId,
      expect.objectContaining({ expectedActiveVersionId: null }),
    );
    const retained = await artifactRepository.getVersions(
      payload.error.details.artifactGroupId,
    );
    expect(retained.group?.activeVersionId).toBeNull();
    expect(retained.versions.map((version) => version.id)).toContain(
      payload.error.details.candidateVersionId,
    );
  });
});
