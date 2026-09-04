import type { AuditedRecord } from './project';

export interface ShotRecord extends AuditedRecord {
  projectId: string;
  sceneId?: string | null;
  sourceTaskId?: string | null;
  shotIndexGlobal: number;
  shotIndexInScene?: number | null;
  title?: string | null;
  scriptSegment?: string | null;
  sceneDesc?: string | null;
  subjectDesc?: string | null;
  actionDesc?: string | null;
  moodDesc?: string | null;
  continuityNotes?: string | null;
  visualPrompt?: string | null;
  lighting?: string | null;
  cameraMotion?: string | null;
  compositionNotes?: string | null;
  styleNotes?: string | null;
  status: 'draft' | 'active' | 'locked' | 'deleted';
  isUserAdded: boolean;
  sortVersion: number;
  note?: string | null;
}

export interface ShotWithAssets extends ShotRecord {
  locked: boolean;
  assets?: {
    storyboardMain?: BoundAssetView | null;
    videoMain?: BoundAssetView | null;
  };
}

export interface BoundAssetView {
  artifactGroupId: string;
  activeVersionId?: string | null;
  url?: string | null;
  versionNote?: string | null;
  isPlaceholder?: boolean;
  processingVersion?: {
    versionId: string;
    jobId?: string | null;
    /** Presentation guard for legacy/orphaned pending versions. */
    jobUnavailable?: boolean;
    versionNo: number;
    status: string;
    versionNote?: string | null;
    createdAt?: string | null;
    updatedAt?: string | null;
    error?: string | null;
  } | null;
}
