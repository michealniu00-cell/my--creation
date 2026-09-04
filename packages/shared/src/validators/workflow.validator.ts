import { z } from 'zod';

export const scriptWorkflowRunSchema = z
  .object({
    configVersionId: z.string().min(1).optional(),
    startFromNode: z.literal('agent2').optional(),
    confirmStageRegeneration: z.literal(true).optional(),
  })
  .strict();

export const storyboardWorkflowRunSchema = z
  .object({
    scriptSourceTaskId: z.string().min(1).optional(),
    startFromNode: z.literal('agent6').optional(),
    confirmStageRegeneration: z.literal(true).optional(),
  })
  .strict();

const missingVideoWorkflowRunSchema = z
  .object({
    mode: z.literal('missing_only').default('missing_only'),
    selectedShotIds: z.never().optional(),
    confirmFullProjectRegeneration: z.never().optional(),
  })
  .strict();

const allVideoWorkflowRunSchema = z
  .object({
    mode: z.literal('all'),
    confirmFullProjectRegeneration: z.literal(true),
    selectedShotIds: z.never().optional(),
  })
  .strict();

const selectedShotsVideoWorkflowRunSchema = z
  .object({
    mode: z.literal('selected_shots'),
    selectedShotIds: z.array(z.string().min(1)).min(1),
    confirmFullProjectRegeneration: z.never().optional(),
  })
  .strict();

export const videoWorkflowRunSchema = z.union([
  selectedShotsVideoWorkflowRunSchema,
  missingVideoWorkflowRunSchema,
  allVideoWorkflowRunSchema,
]);

export const scriptConfirmSchema = z
  .object({
    taskId: z.string().min(1),
  })
  .strict();

export const workflowJobCancelSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const workflowJobResumeSchema = z
  .object({
    additionalAttempts: z.number().int().min(1).max(10).default(1),
    runAfter: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const taskRetrySchema = z
  .object({
    reason: z.string().trim().min(1).max(1_000).optional(),
  })
  .strict();

export const shotRegenerationRequestSchema = z
  .object({
    promptHint: z.string().trim().max(4_000).optional(),
  })
  .strict();

export const shotUploadRegenerationFieldsSchema = z
  .object({
    promptHint: z.string().trim().max(4_000).optional(),
    fileType: z.enum(['image', 'video']).optional(),
  })
  .strict();

const persistedReferenceAssetSchema = z
  .object({
    storagePath: z.string().min(1),
    mimeType: z.string().min(1).max(100),
    fileName: z.string().min(1).max(255),
    fileSizeBytes: z.number().int().nonnegative(),
  })
  .strict();

export const shotStoryboardRegenerationJobSchema = z
  .object({
    action: z.literal('regenerate_shot_storyboard'),
    shotId: z.string().min(1),
    promptHint: z.string().max(4_000).nullable(),
    referenceAsset: persistedReferenceAssetSchema.nullable().optional(),
  })
  .strict();

export const shotVideoRegenerationJobSchema = z
  .object({
    action: z.literal('regenerate_shot_video'),
    shotId: z.string().min(1),
    promptHint: z.string().max(4_000).nullable(),
    referenceAsset: persistedReferenceAssetSchema.nullable().optional(),
    referenceAssetType: z.enum(['image', 'video']).nullable().optional(),
  })
  .strict();

export type VideoWorkflowRunInput = z.infer<typeof videoWorkflowRunSchema>;
