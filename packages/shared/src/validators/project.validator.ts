import { z } from 'zod';
import { projectStages, projectStatuses } from '../enums/status';

export const createProjectSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    sourceIdea: z.string().trim().min(1).max(30_000),
    targetPlatform: z.string().trim().max(50).optional(),
    language: z.string().trim().min(2).max(20).default('zh-CN'),
  })
  .strict();

export const updateProjectSchema = createProjectSchema.partial();

export const projectResponseSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceIdea: z.string(),
  targetPlatform: z.string().nullable().optional(),
  language: z.string(),
  status: z.enum(projectStatuses),
  currentStage: z.enum(projectStages),
  latestRunId: z.string().nullable().optional(),
  currentConfigVersionId: z.string().nullable().optional(),
}).strict();
