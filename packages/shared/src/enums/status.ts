export const projectStatuses = [
  'draft',
  'running',
  'paused',
  'completed',
  'failed',
  'archived',
] as const;

export const projectStages = ['script', 'storyboard', 'video', 'completed'] as const;

export const workflowTypes = ['script', 'storyboard', 'video', 'full'] as const;

export const runStatuses = [
  'pending',
  'running',
  'reviewing',
  'paused',
  'completed',
  'failed',
  'cancelled',
] as const;

export const taskStatuses = [
  'pending',
  'running',
  'succeeded',
  'failed',
  'review_pending',
  'revise_needed',
  'approved',
  'skipped',
] as const;

export const reviewDecisions = ['pass', 'revise', 'reject'] as const;

export const artifactGroupStatuses = ['active', 'inactive', 'deleted'] as const;

export const artifactVersionStatuses = [
  'pending',
  'generated',
  'approved',
  'rejected',
  'placeholder',
  'failed',
  'deleted',
] as const;

export const lockScopes = ['self', 'cascade'] as const;

export const eventLevels = ['info', 'warn', 'error'] as const;

export const impactLevels = ['low', 'medium', 'high'] as const;

export type ProjectStatus = (typeof projectStatuses)[number];
export type ProjectStage = (typeof projectStages)[number];
export type WorkflowType = (typeof workflowTypes)[number];
export type RunStatus = (typeof runStatuses)[number];
export type TaskStatus = (typeof taskStatuses)[number];
export type ReviewDecision = (typeof reviewDecisions)[number];
export type ArtifactGroupStatus = (typeof artifactGroupStatuses)[number];
export type ArtifactVersionStatus = (typeof artifactVersionStatuses)[number];
/** Placeholders remain explicitly selectable for the local/mock workflow. */
export function isActivatableArtifactStatus(status: string): boolean {
  return status === 'generated' || status === 'approved' || status === 'placeholder';
}
export type LockScope = (typeof lockScopes)[number];
export type EventLevel = (typeof eventLevels)[number];
export type ImpactLevel = (typeof impactLevels)[number];
