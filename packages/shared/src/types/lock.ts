import type { LockScope } from '../enums/status';
import type { AuditedRecord } from './project';

export interface ObjectLockRecord extends AuditedRecord {
  projectId: string;
  objectType: 'shot' | 'artifact_version';
  objectId: string;
  lockScope: LockScope;
  cascadeChildren: string[];
  lockedByUserId?: string | null;
  lockReason?: string | null;
  isActive: boolean;
}

export interface LockStatusView {
  locked: boolean;
  lockId?: string | null;
  lockScope?: LockScope | null;
}

