import { z } from 'zod';

const jsonObjectSchema = z.record(z.string(), z.unknown());

export const updateAgentProfileSchema = z.object({
  profileId: z.string().min(1),
  roleDefinition: z.string().min(1),
  systemPrompt: z.string().nullable().optional(),
  developerPrompt: z.string().nullable().optional(),
  inputSchema: jsonObjectSchema.default({}),
  outputSchema: jsonObjectSchema.default({}),
  allowedTools: z.array(z.string()).default([]),
  contextScope: jsonObjectSchema.default({}),
  writeScope: jsonObjectSchema.default({}),
  deleteScope: jsonObjectSchema.default({}),
  reviewRules: z.array(z.string()).default([]),
  note: z.string().nullable().optional(),
}).strict();

export const updateModelBindingSchema = z.object({
  bindingId: z.string().min(1),
  provider: z.string().min(1),
  modelName: z.string().min(1),
  providerLabel: z.string().max(120).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  maxTokens: z.number().int().positive().nullable().optional(),
  timeoutSec: z.number().int().positive().nullable().optional(),
  retryLimit: z.number().int().min(0).max(10).nullable().optional(),
  extraConfig: jsonObjectSchema.default({}),
}).strict();
