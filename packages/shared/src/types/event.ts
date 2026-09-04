import type { EventLevel, ImpactLevel } from '../enums/status';
import type { AuditedRecord } from './project';

export interface TaskEventRecord extends AuditedRecord {
  projectId: string;
  runId?: string | null;
  taskId?: string | null;
  /** Durable background job that caused this event, when applicable. */
  jobId?: string | null;
  eventType: string;
  eventLevel: EventLevel;
  userVisible: boolean;
  summary?: string | null;
  eventPayload: Record<string, unknown>;
}

export interface OutboxEventRecord extends AuditedRecord {
  aggregateType: 'workflow_job' | 'workflow_run' | 'project_config' | 'task_event';
  aggregateId: string;
  eventType: string;
  eventPayload: Record<string, unknown>;
  publishedAt?: string | null;
  publishAttempts: number;
  lastError?: string | null;
}

export interface UserAnnotationRecord extends AuditedRecord {
  projectId: string;
  objectType:
    | 'task'
    | 'scene'
    | 'shot'
    | 'artifact_version'
    | 'config'
    | 'storyboard'
    | 'video'
    | 'key_element'
    | 'conflict';
  objectId: string;
  noteType: 'comment' | 'supplement' | 'conflict_resolution';
  content: string;
  createdByUserId?: string | null;
}

export interface ProjectStageSnapshotRecord extends AuditedRecord {
  projectId: string;
  stageName: string;
  sourceTaskId?: string | null;
  sourceArtifactVersionId?: string | null;
  snapshotJson: Record<string, unknown>;
  snapshotMarkdown?: string | null;
  isActive: boolean;
}

export interface ImpactAnalysisResult {
  impactLevel: ImpactLevel;
  affectedObjects: Array<{ type: string; id: string }>;
  requiresUserConfirmation: boolean;
  warnings: string[];
}
