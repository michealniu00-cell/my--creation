import type { ProjectStage, ProjectStatus } from '../enums/status';

export interface AuditedRecord {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ProjectRecord extends AuditedRecord {
  title: string;
  userId?: string | null;
  sourceIdea: string;
  targetPlatform?: string | null;
  language: string;
  status: ProjectStatus;
  currentStage: ProjectStage;
  currentConfigVersionId?: string | null;
  latestRunId?: string | null;
  currentFailureSummaryId?: string | null;
  remark?: string | null;
}

export interface ProjectOverviewStats {
  sceneCount: number;
  shotCount: number;
  keyElementImageCount: number;
  storyboardImageCount: number;
  videoClipCount: number;
}

