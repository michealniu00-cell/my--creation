import { z } from 'zod';

export const keyElementRoles = [
  'character_ref',
  'scene_ref',
  'prop_ref',
  'style_ref',
  'effect_ref',
] as const;

export const impactScopes = [
  'current_shot',
  'referenced_shots',
  'global',
] as const;

const optionalUploadText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((value) => (value.length > 0 ? value : undefined))
    .optional();

/**
 * Multipart files are validated separately by the command handler. Keeping the
 * remaining fields in a strict schema prevents silently accepting misspelled or
 * future fields with unintended semantics.
 */
export const keyElementUploadFieldsSchema = z
  .object({
    role: z.enum(keyElementRoles),
    name: optionalUploadText(200),
    note: optionalUploadText(1_000),
  })
  .strict();

export const keyElementRegenerateSchema = z
  .object({
    promptHint: z.string().trim().min(1).max(4_000).optional(),
    basedOnVersionId: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const keyElementRegenerationJobSchema =
  keyElementRegenerateSchema.extend({
    action: z.literal('regenerate_key_element'),
    artifactGroupId: z.string().trim().min(1).max(200),
  });

export const activateArtifactVersionSchema = z
  .object({
    versionId: z.string().trim().min(1).max(200),
    expectedActiveVersionId: z.string().trim().min(1).max(200).nullable(),
    expectedGroupUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const keyElementReplaceSchema = z
  .object({
    newVersionId: z.string().trim().min(1).max(200),
    impactScope: z.enum(impactScopes),
    expectedActiveVersionId: z.string().trim().min(1).max(200).nullable(),
    expectedGroupUpdatedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

export const versionLockSchema = z
  .object({
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const shotLockSchema = z
  .object({
    cascade: z.boolean().default(true),
    reason: z.string().trim().min(1).max(500).optional(),
  })
  .strict();

export const shotRegenerateSchema = z
  .object({
    promptHint: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();
