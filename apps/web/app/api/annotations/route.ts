import { annotationRepository, ensureDb } from '@video-agent-studio/db';
import {
  createAnnotationSchema,
  listAnnotationsSchema,
} from '@video-agent-studio/shared';
import { jsonFail, jsonOk, readJsonWithSchema } from '../../../lib/http';

export async function GET(request: Request) {
  await ensureDb();
  const { searchParams } = new URL(request.url);
  const query = listAnnotationsSchema.safeParse({
    projectId: searchParams.get('projectId'),
    objectType: searchParams.get('objectType') ?? undefined,
    objectId: searchParams.get('objectId') ?? undefined,
  });
  if (!query.success) {
    return jsonFail(
      'VALIDATION_ERROR',
      'projectId and annotation filters are invalid',
      400,
      {
        issues: query.error.issues,
      },
    );
  }
  const items = await annotationRepository.list(
    query.data.projectId,
    query.data.objectType,
    query.data.objectId,
  );
  return jsonOk({ items });
}

export async function POST(request: Request) {
  await ensureDb();
  const body = await readJsonWithSchema(request, createAnnotationSchema, {
    message: 'Invalid annotation payload',
  });
  if (!body.success) {
    return body.response;
  }

  const result = await annotationRepository.createForProject({
    projectId: body.data.projectId,
    objectType: body.data.objectType,
    objectId: body.data.objectId,
    noteType: body.data.noteType,
    content: body.data.content,
    createdByUserId: null,
  });

  if (!result.ok) {
    return jsonFail(
      result.reason === 'project_not_found'
        ? 'PROJECT_NOT_FOUND'
        : 'ANNOTATION_TARGET_NOT_FOUND',
      result.reason === 'project_not_found'
        ? 'Project not found'
        : 'Annotation target not found in this project',
      404,
      { reason: result.reason },
    );
  }

  return jsonOk({
    annotationId: result.annotation.id,
  });
}
