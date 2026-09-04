import { Buffer } from 'node:buffer';
import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { ArtifactVersionRecord } from '@video-agent-studio/shared';
import type { MediaGenerationOutput } from '@video-agent-studio/providers';

export function nextVersionNumber(existingVersions: ArtifactVersionRecord[]) {
  return (existingVersions[0]?.versionNo ?? 0) + 1;
}

function resolveWorkspaceRoot(start = process.cwd()): string {
  let current = start;
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

function generatedAssetRoot() {
  const override = process.env.VIDEO_AGENT_STUDIO_ASSET_ROOT;
  const dataRoot = override ? override : path.join(resolveWorkspaceRoot(), '.data');
  return path.join(dataRoot, 'generated-assets');
}

function normalizedFileExtension(extension: string) {
  const normalized = extension.toLowerCase().replace(/^\./, '');
  if (!/^[a-z0-9]{1,10}$/.test(normalized)) {
    throw new Error('Asset file extension is invalid');
  }
  return normalized;
}

function isPathInside(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative.length > 0 &&
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function resolveGeneratedAssetStoragePath(storagePath: string) {
  if (
    typeof storagePath !== 'string' ||
    storagePath.length === 0 ||
    storagePath.includes('\0') ||
    path.isAbsolute(storagePath) ||
    path.win32.isAbsolute(storagePath)
  ) {
    throw new Error('Asset storage path is invalid');
  }

  const segments = storagePath.split(/[\\/]+/);
  if (
    segments[0] !== 'generated-assets' ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error('Asset storage path is outside the generated asset root');
  }

  const root = path.resolve(generatedAssetRoot());
  const candidate = path.resolve(path.dirname(root), ...segments);
  if (!isPathInside(root, candidate)) {
    throw new Error('Asset storage path is outside the generated asset root');
  }

  return { root, candidate };
}

export function fileExtensionForMimeType(mimeType: string, fallback = 'bin') {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/svg+xml':
      return 'svg';
    case 'video/mp4':
      return 'mp4';
    default:
      return fallback;
  }
}

export function mimeTypeForStoragePath(storagePath: string) {
  const extension = path.extname(storagePath).toLowerCase();
  switch (extension) {
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    case '.mp4':
      return 'video/mp4';
    default:
      return 'application/octet-stream';
  }
}

export async function persistGeneratedAsset(input: {
  base64Data: string;
  mimeType: string;
  prefix: string;
  fileExtension?: string | null;
}) {
  const extension = normalizedFileExtension(
    input.fileExtension ?? fileExtensionForMimeType(input.mimeType),
  );
  const safePrefix = input.prefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48) || 'asset';
  const fileName = `${safePrefix}-${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`;
  const relativePath = path.join('generated-assets', fileName);
  const bytes = Buffer.from(input.base64Data, 'base64');

  const root = path.resolve(generatedAssetRoot());
  const dataRoot = path.dirname(root);
  await mkdir(root, { recursive: true });
  const [canonicalDataRoot, canonicalRoot] = await Promise.all([
    realpath(dataRoot),
    realpath(root),
  ]);
  if (!isPathInside(canonicalDataRoot, canonicalRoot)) {
    throw new Error('Generated asset root resolves outside the configured data root');
  }
  const absolutePath = path.join(canonicalRoot, fileName);
  await writeFile(absolutePath, bytes, { flag: 'wx' });

  return {
    storageBucket: 'local',
    storagePath: relativePath,
    publicUrl: `/api/media/local/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`,
    fileSizeBytes: bytes.byteLength,
  };
}

export async function materializeMediaOutput(input: {
  output: MediaGenerationOutput;
  prefix: string;
  fallbackMimeType: string;
  fallbackExtension: string;
}) {
  if (input.output.base64Data) {
    return persistGeneratedAsset({
      base64Data: input.output.base64Data,
      mimeType: input.output.mimeType ?? input.fallbackMimeType,
      prefix: input.prefix,
      fileExtension: input.output.fileExtension ?? input.fallbackExtension,
    });
  }

  if (!input.output.url?.trim()) {
    throw new Error('Media provider returned no downloadable asset');
  }

  return {
    storageBucket: 'remote',
    storagePath: `${input.prefix}.${input.output.fileExtension ?? input.fallbackExtension}`,
    publicUrl: input.output.url,
    fileSizeBytes: null,
  };
}

export async function readGeneratedAsset(storagePath: string) {
  const { root, candidate } = resolveGeneratedAssetStoragePath(storagePath);
  const [canonicalRoot, canonicalCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  if (!isPathInside(canonicalRoot, canonicalCandidate)) {
    throw new Error('Asset storage path resolves outside the generated asset root');
  }
  const bytes = await readFile(canonicalCandidate);
  return {
    bytes,
    mimeType: mimeTypeForStoragePath(storagePath),
  };
}

export async function ensureGeneratedAssetRoot() {
  await mkdir(generatedAssetRoot(), { recursive: true });
}

export function makePlaceholderVersion(input: Partial<ArtifactVersionRecord> & { groupId: string }) {
  return {
    groupId: input.groupId,
    versionNo: input.versionNo ?? 1,
    generatedByAgent: input.generatedByAgent ?? 'agent9',
    sourceTaskId: input.sourceTaskId ?? null,
    mimeType: input.mimeType ?? 'video/mp4',
    storageBucket: input.storageBucket ?? 'mock',
    storagePath: input.storagePath ?? 'placeholder.mp4',
    publicUrl:
      input.publicUrl ?? 'https://placehold.co/1280x720/161616/f4f0e8?text=Placeholder+Video',
    fileSizeBytes: input.fileSizeBytes ?? 4096,
    width: input.width ?? 1280,
    height: input.height ?? 720,
    durationMs: input.durationMs ?? 3000,
    generationInput: input.generationInput ?? {},
    metadata: input.metadata ?? {},
    status: input.status ?? 'placeholder',
    versionNote: input.versionNote ?? '自动占位版本',
    isPlaceholder: input.isPlaceholder ?? true,
  };
}
