import os from 'node:os';
import path from 'node:path';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  materializeMediaOutput,
  persistGeneratedAsset,
  readGeneratedAsset,
} from './index';

describe('generated asset storage', () => {
  let tempDir = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), 'vas-artifact-service-'));
    process.env.VIDEO_AGENT_STUDIO_ASSET_ROOT = path.join(tempDir, '.data');
  });

  afterEach(async () => {
    delete process.env.VIDEO_AGENT_STUDIO_ASSET_ROOT;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('round-trips a persisted generated asset', async () => {
    const stored = await persistGeneratedAsset({
      base64Data: Buffer.from('stored-image').toString('base64'),
      mimeType: 'image/png',
      prefix: 'safe image',
    });

    const loaded = await readGeneratedAsset(stored.storagePath);

    expect(loaded.bytes.toString('utf8')).toBe('stored-image');
    expect(loaded.mimeType).toBe('image/png');
  });

  it.each([
    '../secret.png',
    'generated-assets/../secret.png',
    '/tmp/secret.png',
    'C:\\secret.png',
  ])('rejects an unsafe storage path: %s', async (storagePath) => {
    await expect(readGeneratedAsset(storagePath)).rejects.toThrow(
      /storage path/i,
    );
  });

  it('rejects a symlink that resolves outside generated-assets', async () => {
    const generatedRoot = path.join(tempDir, '.data', 'generated-assets');
    const secretPath = path.join(tempDir, 'secret.png');
    await mkdir(generatedRoot, { recursive: true });
    await writeFile(secretPath, 'secret');
    await symlink(secretPath, path.join(generatedRoot, 'linked.png'));

    await expect(
      readGeneratedAsset('generated-assets/linked.png'),
    ).rejects.toThrow(/outside the generated asset root/i);
  });

  it('rejects a provider-controlled file extension with path separators', async () => {
    await expect(
      persistGeneratedAsset({
        base64Data: Buffer.from('unsafe').toString('base64'),
        mimeType: 'image/png',
        prefix: 'asset',
        fileExtension: '../../outside',
      }),
    ).rejects.toThrow(/file extension/i);
  });

  it('does not write through a generated-assets symlink outside the data root', async () => {
    const dataRoot = path.join(tempDir, '.data');
    const outsideRoot = path.join(tempDir, 'outside');
    await mkdir(dataRoot, { recursive: true });
    await mkdir(outsideRoot, { recursive: true });
    await symlink(outsideRoot, path.join(dataRoot, 'generated-assets'));

    await expect(
      persistGeneratedAsset({
        base64Data: Buffer.from('unsafe').toString('base64'),
        mimeType: 'image/png',
        prefix: 'asset',
      }),
    ).rejects.toThrow(/outside the configured data root/i);
  });

  it('fails when a provider returns no downloadable media instead of fabricating an asset', async () => {
    await expect(
      materializeMediaOutput({
        output: {},
        prefix: 'missing-output',
        fallbackMimeType: 'image/png',
        fallbackExtension: 'png',
      }),
    ).rejects.toThrow(/no downloadable asset/i);
  });
});
