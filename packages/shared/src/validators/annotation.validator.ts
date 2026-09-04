import { z } from 'zod';

export const annotationObjectTypes = [
  'task',
  'scene',
  'shot',
  'artifact_version',
  'config',
  'storyboard',
  'video',
  'key_element',
  'conflict',
] as const;

export const annotationNoteTypes = [
  'comment',
  'supplement',
  'conflict_resolution',
] as const;

export const createAnnotationSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200),
    objectType: z.enum(annotationObjectTypes),
    objectId: z.string().trim().min(1).max(200),
    noteType: z.enum(annotationNoteTypes),
    content: z.string().trim().min(1).max(10_000),
  })
  .strict();

export const listAnnotationsSchema = z
  .object({
    projectId: z.string().trim().min(1).max(200),
    objectType: z.enum(annotationObjectTypes).optional(),
    objectId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
