import { z } from 'zod';
import {
  controlPlaneChangeTypes,
  controlPlaneObjectTypes,
  normalizeControlPlaneObjectType,
} from '../lib/control-plane';

export const impactAnalysisSchema = z
  .object({
    objectType: z.enum(controlPlaneObjectTypes).transform(normalizeControlPlaneObjectType),
    objectId: z.string().trim().min(1).max(200),
    changeType: z.enum(controlPlaneChangeTypes).transform((value) => value.trim().toLowerCase()),
  })
  .strict();

export const conflictResolutionSchema = z
  .object({
    resolution: z.string().trim().min(1).max(2_000),
  })
  .strict();
