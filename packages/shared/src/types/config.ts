import type { AuditedRecord } from './project';

export interface ProjectConfigVersionRecord extends AuditedRecord {
  projectId: string;
  versionNo: number;
  confirmedByUser: boolean;
  sourceTaskId?: string | null;
  scriptType?: string | null;
  styleDefinition?: string | null;
  researchFocus?: string | null;
  storylineStructure?: string | null;
  scriptOrganization?: string | null;
  globalConstraints: Record<string, unknown>;
  configJson: Record<string, unknown>;
  note?: string | null;
  isActive: boolean;
}

