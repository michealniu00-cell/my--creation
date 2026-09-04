import { z } from 'zod';

export const configVersionDraftSchema = z
  .object({
    scriptType: z.string().trim().max(100).optional(),
    styleDefinition: z.string().trim().max(10_000).optional(),
    researchFocus: z.string().trim().max(10_000).optional(),
    storylineStructure: z.string().trim().max(100).optional(),
    scriptOrganization: z.string().trim().max(100).optional(),
    globalConstraints: z.record(z.string(), z.unknown()).default({}),
    configJson: z.record(z.string(), z.unknown()).optional(),
    note: z.string().trim().max(2_000).optional(),
  })
  .strict();
