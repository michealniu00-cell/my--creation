import { z } from 'zod';

export const createShotSchema = z
  .object({
    insertAfterShotId: z.string().trim().min(1).max(200).optional(),
    title: z.string().trim().min(1).max(200),
    scriptSegment: z.string().trim().max(20_000).optional(),
    sceneDesc: z.string().trim().max(10_000).optional(),
    subjectDesc: z.string().trim().max(10_000).optional(),
    actionDesc: z.string().trim().max(10_000).optional(),
    moodDesc: z.string().trim().max(4_000).optional(),
    continuityNotes: z.string().trim().max(10_000).optional(),
    visualPrompt: z.string().trim().max(20_000).optional(),
    lighting: z.string().trim().max(4_000).optional(),
    cameraMotion: z.string().trim().max(4_000).optional(),
    compositionNotes: z.string().trim().max(10_000).optional(),
    styleNotes: z.string().trim().max(10_000).optional(),
  })
  .strict();

export const updateShotSchema = createShotSchema.omit({ insertAfterShotId: true }).partial();

export const reorderShotsSchema = z
  .object({
    orderedShotIds: z.array(z.string().trim().min(1).max(200)).max(10_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.orderedShotIds).size !== value.orderedShotIds.length) {
      context.addIssue({
        code: 'custom',
        message: 'orderedShotIds must not contain duplicates',
        path: ['orderedShotIds'],
      });
    }
  });
