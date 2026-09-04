import type { ReviewDecision } from '../enums/status';
import type { AuditedRecord } from './project';

export interface ReviewRecord extends AuditedRecord {
  projectId: string;
  runId: string;
  sourceTaskId: string;
  reviewerType: 'agent' | 'human' | 'system';
  reviewerName: string;
  decision: ReviewDecision;
  reviewStyle?: string | null;
  score?: number | null;
  failedRules: string[];
  feedbackMarkdown?: string | null;
  revisionBrief?: string | null;
  reviewRound: number;
  isFinal: boolean;
}

export interface FailureSummaryDoc extends AuditedRecord {
  projectId: string;
  runId?: string | null;
  sourceTaskId?: string | null;
  versionNo: number;
  summaryMarkdown: string;
  summaryJson: Record<string, unknown>;
  basedOnTaskIds: string[];
  basedOnReviewIds: string[];
  isActive: boolean;
  note?: string | null;
}

