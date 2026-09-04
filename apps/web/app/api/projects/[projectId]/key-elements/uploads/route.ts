import { Buffer } from 'node:buffer';
import { persistGeneratedAsset } from '@video-agent-studio/artifact-service';
import {
  artifactRepository,
  ensureDb,
  eventRepository,
  projectRepository,
} from '@video-agent-studio/db';
import { keyElementUploadFieldsSchema } from '@video-agent-studio/shared';
import { jsonFail, jsonOk } from '../../../../../../lib/http';
import {
  hasExpectedMediaSignature,
  readSingleFileMultipart,
} from '../../../../../../lib/media-upload';

const allowedImageTypes = new Set(['image/png', 'image/jpeg', 'image/webp']);
const maxUploadBytes = 10 * 1024 * 1024;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  await ensureDb();
  const { projectId } = await params;
  const project = await projectRepository.get(projectId);
  if (!project) {
    return jsonFail('PROJECT_NOT_FOUND', 'Project not found', 404);
  }

  const multipart = await readSingleFileMultipart(request);
  if (!multipart.success) {
    return multipart.response;
  }
  const fieldsResult = keyElementUploadFieldsSchema.safeParse(multipart.fields);
  if (!fieldsResult.success) {
    return jsonFail(
      'VALIDATION_ERROR',
      'Key element upload fields are invalid',
      400,
      { issues: fieldsResult.error.issues },
    );
  }
  const { file } = multipart;
  const fields = fieldsResult.data;

  if (
    !allowedImageTypes.has(file.type) ||
    file.size <= 0 ||
    file.size > maxUploadBytes
  ) {
    return jsonFail(
      'VALIDATION_ERROR',
      'Only PNG, JPEG, or WebP images up to 10MB are supported',
      400,
    );
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedMediaSignature(bytes, file.type)) {
    return jsonFail(
      'INVALID_MEDIA_CONTENT',
      'Uploaded bytes do not match the declared image type',
      400,
    );
  }

  const uploadName = file.name.trim().slice(0, 255) || 'uploaded-image';
  const fallbackName = file.name.trim().slice(0, 200) || 'Uploaded key element';
  const normalizedName = fields.name ?? fallbackName;
  const persisted = await persistGeneratedAsset({
    base64Data: Buffer.from(bytes).toString('base64'),
    mimeType: file.type,
    prefix: `key-element-${projectId}-${fields.role}`,
  });

  const group = await artifactRepository.createGroup({
    projectId,
    scopeType: 'project',
    scopeId: projectId,
    artifactType: 'image',
    role: fields.role,
    name: normalizedName,
    activeVersionId: null,
    status: 'active',
    isUserManaged: true,
    note: fields.note ?? null,
  });

  const version = await artifactRepository.createNextVersion({
    groupId: group.id,
    generatedByAgent: null,
    sourceTaskId: null,
    mimeType: file.type,
    storageBucket: persisted.storageBucket,
    storagePath: persisted.storagePath,
    publicUrl: persisted.publicUrl,
    fileSizeBytes: persisted.fileSizeBytes,
    width: null,
    height: null,
    durationMs: null,
    generationInput: {
      uploadName,
      role: fields.role,
    },
    metadata: {
      uploaded: true,
      originalFileName: uploadName,
    },
    status: 'approved',
    versionNote: fields.note ?? '用户上传素材',
    isPlaceholder: false,
  });
  if (!version) {
    return jsonFail(
      'NOT_FOUND',
      'Key element group disappeared before the upload version could be created',
      404,
    );
  }

  const activation = await artifactRepository.activateVersionIfExpected(
    group.id,
    version.id,
    {
      expectedActiveVersionId: null,
      expectedGroupUpdatedAt: group.updatedAt,
    },
  );
  if (!activation.ok) {
    return jsonFail(
      'ARTIFACT_VERSION_CONFLICT',
      'Uploaded version was retained but could not become active',
      409,
      {
        reason: activation.reason,
        artifactGroupId: group.id,
        candidateVersionId: version.id,
        actualActiveVersionId: activation.actualActiveVersionId,
        actualGroupUpdatedAt: activation.actualGroupUpdatedAt,
        lockId: activation.lockId,
      },
    );
  }

  await eventRepository.create({
    projectId,
    runId: null,
    taskId: null,
    jobId: null,
    eventType: 'key_element_uploaded',
    eventLevel: 'info',
    userVisible: true,
    summary: `已上传关键要素：${normalizedName}`,
    eventPayload: {
      artifactGroupId: group.id,
      artifactVersionId: version.id,
      role: fields.role,
      mimeType: file.type,
      fileSizeBytes: persisted.fileSizeBytes,
    },
  });

  return jsonOk({
    artifactGroupId: group.id,
    versionId: version.id,
  });
}
