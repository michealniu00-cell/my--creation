import { Buffer } from 'node:buffer';
import { persistGeneratedAsset } from '@video-agent-studio/artifact-service';
import { evaluateBindingHealth } from '@video-agent-studio/providers';
import {
  artifactRepository,
  ensureDb,
  jobRepository,
  settingsRepository,
} from '@video-agent-studio/db';
import { shotUploadRegenerationFieldsSchema } from '@video-agent-studio/shared';
import { enqueueShotRegeneration } from '../../../../../../lib/enqueue-shot-regeneration';
import { jsonFail, jsonOk } from '../../../../../../lib/http';
import {
  hasExpectedMediaSignature,
  readSingleFileMultipart,
} from '../../../../../../lib/media-upload';
import { jsonProviderError } from '../../../../../../lib/provider-errors';
import {
  ensureActiveArtifactVersionUnlocked,
  ensureShotUnlocked,
} from '../../../../../../lib/route-guards';
import { resolveWorkflowIdempotencyKey } from '../../../../../../lib/workflow-job-command';

const allowedReferenceTypes = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'video/mp4',
]);
const maxUploadBytes = 25 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ shotId: string }> },
) {
  await ensureDb();
  const { shotId } = await params;
  const shotConflict = await ensureShotUnlocked(
    shotId,
    'Locked shot cannot regenerate video',
  );
  if (shotConflict) {
    return shotConflict;
  }
  const video = await artifactRepository.getShotVideo(shotId);
  if (!video?.group) {
    return jsonFail('NOT_FOUND', 'Video group not found', 404);
  }
  const videoGroup = video.group;
  const artifactConflict = await ensureActiveArtifactVersionUnlocked(
    videoGroup.id,
    'Locked video version cannot be replaced',
  );
  if (artifactConflict) {
    return artifactConflict;
  }

  const multipart = await readSingleFileMultipart(request);
  if (!multipart.success) {
    return multipart.response;
  }
  const { file } = multipart;
  const fields = shotUploadRegenerationFieldsSchema.safeParse(multipart.fields);
  if (!fields.success) {
    return jsonFail('VALIDATION_ERROR', '上传重生成参数不合法', 400, {
      issues: fields.error.issues,
    });
  }
  if (
    !allowedReferenceTypes.has(file.type) ||
    file.size <= 0 ||
    file.size > maxUploadBytes
  ) {
    return jsonFail(
      'VALIDATION_ERROR',
      '仅支持不超过 25MB 的 PNG、JPEG、WebP 或 MP4 素材',
      400,
    );
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedMediaSignature(bytes, file.type)) {
    return jsonFail(
      'INVALID_MEDIA_CONTENT',
      'Uploaded bytes do not match the declared media type',
      400,
    );
  }
  const inferredFileType = file.type.startsWith('video/') ? 'video' : 'image';
  if (fields.data.fileType && fields.data.fileType !== inferredFileType) {
    return jsonFail(
      'VALIDATION_ERROR',
      'fileType 与上传文件 MIME 类型不一致',
      400,
    );
  }

  await settingsRepository.ensureDefaults(videoGroup.projectId);
  const binding = await settingsRepository.getActiveModelBinding(
    videoGroup.projectId,
    'agent9',
  );
  const bindingHealth = evaluateBindingHealth('agent9', binding);
  if (bindingHealth.state !== 'ready' && bindingHealth.state !== 'mock') {
    return jsonFail('PROVIDER_CONFIG_ERROR', bindingHealth.summary, 503);
  }
  let idempotencyKey: string;
  try {
    idempotencyKey = resolveWorkflowIdempotencyKey(request);
  } catch (error) {
    return jsonFail('INVALID_IDEMPOTENCY_KEY', (error as Error).message, 400);
  }
  const existingJob = await jobRepository.findByIdempotencyKey(
    videoGroup.projectId,
    'video',
    idempotencyKey,
  );
  if (existingJob) {
    const versions = await artifactRepository.getVersions(videoGroup.id);
    const existingVersion = versions.versions.find(
      (version) => version.generationInput.jobId === existingJob.id,
    );
    return jsonOk(
      {
        jobId: existingJob.id,
        taskId: existingVersion?.id ?? existingJob.id,
        status: existingJob.status,
        deduplicated: true,
      },
      { idempotencyKey },
      { headers: { 'idempotency-key': idempotencyKey } },
    );
  }

  try {
    const persisted = await persistGeneratedAsset({
      base64Data: Buffer.from(bytes).toString('base64'),
      mimeType: file.type,
      prefix: `video-${shotId}-reference-upload`,
    });
    const referenceAsset = {
      storagePath: persisted.storagePath,
      mimeType: file.type,
      fileName: file.name,
      fileSizeBytes: persisted.fileSizeBytes,
    };
    const promptHint = fields.data.promptHint ?? null;
    const queued = await enqueueShotRegeneration({
      request,
      idempotencyKey,
      projectId: videoGroup.projectId,
      jobType: 'video',
      groupId: videoGroup.id,
      payload: {
        action: 'regenerate_shot_video',
        shotId,
        promptHint,
        referenceAsset,
        referenceAssetType: inferredFileType,
      },
      maxAttempts: 2,
      timeoutMs: 30 * 60_000,
      createPendingVersion: (jobId, expectation) => ({
        groupId: videoGroup.id,
        generatedByAgent: 'agent9',
        sourceTaskId: null,
        mimeType: 'video/mp4',
        storageBucket: null,
        storagePath: null,
        publicUrl: null,
        fileSizeBytes: null,
        width: 1280,
        height: 720,
        durationMs: 4000,
        generationInput: {
          jobId,
          promptHint,
          referenceAssetType: inferredFileType,
          referenceUploadName: file.name,
          ...expectation,
          queuedAt: new Date().toISOString(),
        },
        metadata: {
          provider: binding?.provider ?? 'mock',
          model: binding?.modelName ?? 'mock',
          uploaded: true,
          queueStatus: 'queued',
        },
        status: 'pending',
        versionNote: promptHint || '上传素材后的视频后台重生成排队中',
        isPlaceholder: false,
      }),
    });
    return jsonOk(
      {
        jobId: queued.job.id,
        taskId: queued.version?.id ?? queued.job.id,
        status: queued.job.status,
        deduplicated: !queued.created,
      },
      { idempotencyKey },
      {
        status: queued.created ? 202 : 200,
        headers: { 'idempotency-key': idempotencyKey },
      },
    );
  } catch (error) {
    return jsonProviderError(error);
  }
}
