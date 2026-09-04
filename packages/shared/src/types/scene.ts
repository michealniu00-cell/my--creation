import type { AuditedRecord } from './project';

export interface SceneRecord extends AuditedRecord {
  projectId: string;
  sourceTaskId?: string | null;
  sceneIndex: number;
  title?: string | null;
  scriptSegment?: string | null;
  sceneDesc?: string | null;
  status: 'draft' | 'active' | 'deleted';
  note?: string | null;
}

