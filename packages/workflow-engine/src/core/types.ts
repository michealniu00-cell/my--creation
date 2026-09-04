import type {
  AgentName,
  RunStatus,
  WorkflowNode,
} from '@video-agent-studio/shared';

export type WorkflowAgentNode = Extract<WorkflowNode, AgentName>;

export interface WorkflowDefinition {
  type: 'script' | 'storyboard' | 'video';
  startNode: WorkflowNode;
  nodes: readonly WorkflowNode[];
  agentNodes: readonly WorkflowAgentNode[];
  reviewNodes: readonly WorkflowNode[];
  reviewNodeByAgent: Readonly<Partial<Record<WorkflowAgentNode, WorkflowNode>>>;
  manualGateNodes: readonly WorkflowNode[];
  prerequisiteManualGateNodes: readonly WorkflowNode[];
}

export interface WorkflowCursor {
  currentNode: WorkflowNode;
  completedNodes: WorkflowNode[];
  waitingForReview: boolean;
  waitingForManualGate: boolean;
  failedNode?: WorkflowNode | null;
}

export type WorkflowExecutionStatus =
  | 'running'
  | 'waiting_for_manual_gate'
  | 'completed'
  | 'failed';

export interface WorkflowExecutionState {
  workflowType: WorkflowDefinition['type'];
  currentNode: WorkflowNode | null;
  completedNodes: WorkflowNode[];
  confirmedManualGates: WorkflowNode[];
  status: WorkflowExecutionStatus;
  failedNode: WorkflowNode | null;
  requiresManualReview: boolean;
  errorType: 'system' | 'content' | null;
  errorMessage: string | null;
}

export type WorkflowExecutionPlan =
  | {
      kind: 'execute_reviewed_agent';
      node: WorkflowAgentNode;
      agentName: WorkflowAgentNode;
      reviewNode: WorkflowNode;
    }
  | {
      kind: 'execute_agent';
      node: WorkflowAgentNode;
      agentName: WorkflowAgentNode;
    }
  | {
      kind: 'await_manual_gate';
      node: WorkflowNode;
    }
  | {
      kind: 'complete';
    }
  | {
      kind: 'failed';
      node: WorkflowNode;
      errorType: 'system' | 'content';
      errorMessage: string;
    };

export type WorkflowExecutionResult =
  | {
      type: 'reviewed_agent_passed';
      node: WorkflowAgentNode;
      reviewNode: WorkflowNode;
      requiresManualReview?: boolean;
    }
  | {
      type: 'agent_succeeded';
      node: WorkflowAgentNode;
      requiresManualReview?: boolean;
    }
  | {
      type: 'manual_gate_confirmed';
      node: WorkflowNode;
    }
  | {
      /** Explicit durable-job resume of exactly the persisted failed node. */
      type: 'failed_step_retry_requested';
      node: WorkflowNode;
    }
  | {
      type: 'step_failed';
      node: WorkflowNode;
      errorType: 'system' | 'content';
      errorMessage: string;
      requiresManualReview?: boolean;
    };

export interface WorkflowRunProjection {
  currentNode: WorkflowNode | null;
  status: Extract<RunStatus, 'running' | 'reviewing' | 'completed' | 'failed'>;
  requiresManualReview: boolean;
  errorType: 'system' | 'content' | null;
  errorMessage: string | null;
}

/** Minimal persisted facts needed to reconstruct a linear engine state. */
export interface PersistedWorkflowExecutionState {
  workflowType: WorkflowDefinition['type'];
  currentNode: WorkflowNode | null;
  status: RunStatus;
  requiresManualReview: boolean;
  errorType?: 'system' | 'content' | null;
  errorMessage?: string | null;
}
