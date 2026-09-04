import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { persistGeneratedAsset } from '@video-agent-studio/artifact-service';
import { GET } from './route';
import { createTempApiTestEnv } from '../../../test-helpers';

describe('GET /api/media/local/[...path]', () => {
  let cleanup = async () => {};
  let tempDir = '';

  beforeEach(async () => {
    const env = await createTempApiTestEnv('vas-media-route-');
    cleanup = env.cleanup;
    tempDir = env.tempDir;
  });

  afterEach(async () => {
    await cleanup();
  });

  it('serves locally materialized media with cache headers', async () => {
    const stored = await persistGeneratedAsset({
      base64Data: Buffer.from('hello-image').toString('base64'),
      mimeType: 'image/png',
      prefix: 'route-test',
      fileExtension: 'png',
    });

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ path: stored.storagePath.split('/') }),
    });
    const bytes = Buffer.from(await response.arrayBuffer()).toString('utf8');

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(bytes).toBe('hello-image');
  });

  it('returns 404 JSON when the asset does not exist', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ path: ['generated-assets', 'missing-file.png'] }),
    });
    const payload = (await response.json()) as {
      success: boolean;
      error: { code: string };
    };

    expect(response.status).toBe(404);
    expect(payload.success).toBe(false);
    expect(payload.error.code).toBe('NOT_FOUND');
  });

  it('does not read a traversal path outside generated-assets', async () => {
    await writeFile(path.join(tempDir, 'secret.txt'), 'must-not-be-served');

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ path: ['..', 'secret.txt'] }),
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain('must-not-be-served');
  });

  it('does not follow a generated-assets symlink outside the asset root', async () => {
    const secretPath = path.join(tempDir, 'secret.png');
    const generatedRoot = path.join(tempDir, '.data', 'generated-assets');
    await writeFile(secretPath, 'must-not-be-served');
    await mkdir(generatedRoot, { recursive: true });
    await symlink(secretPath, path.join(generatedRoot, 'linked.png'));

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ path: ['generated-assets', 'linked.png'] }),
    });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).not.toContain('must-not-be-served');
  });
});
