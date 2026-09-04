import type { ArtifactGroupStatus, ArtifactVersionStatus } from '../enums/status';
import type { AuditedRecord } from './project';

export type ArtifactScopeType = 'project' | 'scene' | 'shot';
export type ArtifactType = 'image' | 'video' | 'document' | 'markdown' | 'json' | 'upload';
export type ArtifactRole =
  | 'key_element_image'
  | 'storyboard_image'
  | 'video_clip'
  | 'research_report'
  | 'script_doc'
  | 'external_material'
  | 'character_ref'
  | 'scene_ref'
  | 'prop_ref'
  | 'style_ref'
  | 'effect_ref';

export interface ArtifactGroupRecord extends AuditedRecord {
  projectId: string;
  scopeType: ArtifactScopeType;
  scopeId: string;
  artifactType: ArtifactType;
  role: ArtifactRole;
  name?: string | null;
  activeVersionId?: string | null;
  status: ArtifactGroupStatus;
  isUserManaged: boolean;
  note?: string | null;
}

export interface ArtifactVersionRecord extends AuditedRecord {
  groupId: string;
  versionNo: number;
  generatedByAgent?: string | null;
  sourceTaskId?: string | null;
  mimeType?: string | null;
  storageBucket?: string | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  fileSizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  generationInput: Record<string, unknown>;
  metadata: Record<string, unknown>;
  status: ArtifactVersionStatus;
  versionNote?: string | null;
  isPlaceholder: boolean;
}

export interface ShotAssetBindingRecord extends AuditedRecord {
  projectId: string;
  shotId: string;
  artifactGroupId: string;
  bindingRole:
    | 'character_ref'
    | 'scene_ref'
    | 'prop_ref'
    | 'style_ref'
    | 'effect_ref'
    | 'storyboard_main'
    | 'video_main';
  isPrimary: boolean;
  influenceScope?: 'current_shot' | 'referenced_shots' | 'global' | null;
  note?: string | null;
}

