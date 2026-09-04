import type { AgentName, StageName, WorkflowNode } from '../enums/agent';
import type { RunStatus, TaskStatus, WorkflowType } from '../enums/status';
import type { AuditedRecord } from './project';

export interface WorkflowRunRecord extends AuditedRecord {
  projectId: string;
  /** Durable command that owns this run. Present for worker-enqueued workflows. */
  originJobId?: string | null;
  workflowType: WorkflowType;
  triggerMode: 'manual' | 'auto' | 'retry' | 'resume' | 'system';
  startFromNode?: WorkflowNode | null;
  endAtNode?: WorkflowNode | null;
  currentNode?: WorkflowNode | null;
  status: RunStatus;
  runReason?: string | null;
  retryCount: number;
  requiresManualReview: boolean;
  errorType?: 'system' | 'content' | null;
  errorMessage?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface AgentTaskRecord extends AuditedRecord {
  runId: string;
  projectId: string;
  /** Stable logical execution identity used to recover after worker crashes. */
  executionKey?: string | null;
  agentName: AgentName;
  stageName: StageName;
  roundNo: number;
  parentTaskId?: string | null;
  inputPayload: Record<string, unknown>;
  outputJson: Record<string, unknown>;
  outputMarkdown?: string | null;
  outputSummary?: string | null;
  profileVersionId?: string | null;
  modelBindingId?: string | null;
  providerName?: string | null;
  modelName?: string | null;
  credentialSource?: 'page' | 'env' | 'none' | null;
  promptVersion?: string | null;
  status: TaskStatus;
  errorType?: 'system' | 'content' | null;
  errorMessage?: string | null;
  latencyMs?: number | null;
  promptTokens?: number | null;
  completionTokens?: number | null;
  totalTokens?: number | null;
  startedAt?: string | null;
  finishedAt?: string | null;
}

export interface WorkflowStateView {
  run: Pick<
    WorkflowRunRecord,
    'id' | 'status' | 'currentNode' | 'requiresManualReview' | 'workflowType'
  >;
  checkpoints: Record<string, boolean>;
  tasks: Array<
    Pick<
      AgentTaskRecord,
      'id' | 'agentName' | 'status' | 'roundNo' | 'outputSummary'
    >
  >;
}
