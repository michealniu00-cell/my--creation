import type {
  AgentModelBindingRecord,
  AgentName,
  AgentProfileRecord,
  StageName,
} from '@video-agent-studio/shared';
import type { TokenUsage } from '@video-agent-studio/providers';

export interface AgentExecutionInput {
  agentName: AgentName;
  stageName: StageName;
  projectTitle: string;
  sourceIdea?: string;
  context?: Record<string, unknown>;
  profile?: AgentProfileRecord | null;
  modelBinding?: AgentModelBindingRecord | null;
  /** Cancels provider work when the durable worker loses its lease or is stopped. */
  signal?: AbortSignal;
  /** Stable identity for this logical Agent execution across durable retries. */
  idempotencyKey?: string;
}

export interface AgentExecutionOutput {
  outputJson: Record<string, unknown>;
  outputMarkdown: string;
  outputSummary: string;
  promptVersion: string;
  usage?: TokenUsage;
  providerName?: string;
  modelName?: string;
  metadata?: Record<string, unknown>;
}
