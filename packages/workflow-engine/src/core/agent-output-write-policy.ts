import type { AgentName } from '@video-agent-studio/shared';

/**
 * Content writes are intentionally narrower than repository operations.
 * Status/lease metadata updates do not pass through this policy, while every
 * write that can change user-visible Agent output must be classified here.
 */
export const agentOutputWriteOperations = [
  'create',
  'append_version',
  'mutate_existing',
] as const;

export type AgentOutputWriteOperation =
  (typeof agentOutputWriteOperations)[number];

export const textArtifactRoles = [
  'agent1_brief',
  'research_report',
  'storyline',
  'script',
  'shot_structure',
  'shot_enhancement',
] as const;

export type TextArtifactRole = (typeof textArtifactRoles)[number];

/**
 * An explicit role owner prevents an Agent from claiming another stage's
 * output merely by setting itself as the record owner.
 */
export const textArtifactOwnerByRole = {
  agent1_brief: 'agent1',
  research_report: 'agent2',
  storyline: 'agent3',
  script: 'agent4',
  shot_structure: 'agent6',
  shot_enhancement: 'agent7',
} as const satisfies Record<TextArtifactRole, AgentName>;

export interface AgentOutputReference {
  ownerAgent: AgentName;
  outputId: string;
}

interface OwnedOutputTarget {
  /** Must come from the persisted target record, never from model output. */
  ownerAgent: AgentName;
}

export type AgentOutputWriteTarget =
  | (OwnedOutputTarget & {
      /** Immutable audit envelope for one Agent execution. */
      kind: 'task_output';
      /** Required for Agent7 so its enhancement remains traceable to Agent6. */
      source?: AgentOutputReference | null;
    })
  | (OwnedOutputTarget & {
      /** A separate review record; it never aliases the reviewed content. */
      kind: 'review_feedback';
      subjectAgent: AgentName;
    })
  | (OwnedOutputTarget & {
      /** User-visible text/structured content used by downstream stages. */
      kind: 'text_artifact';
      role: TextArtifactRole;
      source?: AgentOutputReference | null;
    })
  | (OwnedOutputTarget & {
      kind: 'image_artifact';
    })
  | (OwnedOutputTarget & {
      kind: 'video_artifact';
    });

export interface AgentOutputWriteIntent {
  actorAgent: AgentName;
  operation: AgentOutputWriteOperation;
  target: AgentOutputWriteTarget;
}

export type AgentOutputWriteDenialCode =
  | 'cross_agent_write_denied'
  | 'existing_output_is_immutable'
  | 'agent5_review_feedback_only'
  | 'review_feedback_reserved_for_agent5'
  | 'agent5_cannot_review_itself'
  | 'task_output_must_be_created'
  | 'review_feedback_must_be_created'
  | 'text_artifact_role_mismatch'
  | 'media_agent_cannot_write_text_artifact'
  | 'agent7_must_append_enhanced_version'
  | 'agent7_requires_agent6_source'
  | 'image_artifact_reserved_for_agent8'
  | 'video_artifact_reserved_for_agent9';

export type AgentOutputWriteDecision =
  | { allowed: true }
  | {
      allowed: false;
      code: AgentOutputWriteDenialCode;
      message: string;
    };

function allow(): AgentOutputWriteDecision {
  return { allowed: true };
}

function deny(
  code: AgentOutputWriteDenialCode,
  message: string,
): AgentOutputWriteDecision {
  return { allowed: false, code, message };
}

/**
 * Pure workflow-domain authorization. Callers must resolve owner/source data
 * from persisted records before evaluating the intent, then re-check inside
 * the same write transaction when a durable transactional store is used.
 */
export function evaluateAgentOutputWrite(
  intent: AgentOutputWriteIntent,
): AgentOutputWriteDecision {
  const { actorAgent, operation, target } = intent;

  if (target.ownerAgent !== actorAgent) {
    return deny(
      'cross_agent_write_denied',
      `${actorAgent} cannot write output owned by ${target.ownerAgent}.`,
    );
  }

  if (operation === 'mutate_existing') {
    return deny(
      'existing_output_is_immutable',
      'Agent output bodies are immutable; create a new record or append a version instead.',
    );
  }

  if (actorAgent === 'agent5' && target.kind !== 'review_feedback') {
    return deny(
      'agent5_review_feedback_only',
      'Agent5 may create review feedback but cannot write production content.',
    );
  }

  if (target.kind === 'review_feedback') {
    if (actorAgent !== 'agent5') {
      return deny(
        'review_feedback_reserved_for_agent5',
        'Only Agent5 may create Agent review feedback.',
      );
    }
    if (target.subjectAgent === 'agent5') {
      return deny(
        'agent5_cannot_review_itself',
        'Agent5 cannot review its own feedback.',
      );
    }
    if (operation !== 'create') {
      return deny(
        'review_feedback_must_be_created',
        'Review feedback is append-only and must be created as a new record.',
      );
    }
    return allow();
  }

  if (target.kind === 'task_output') {
    if (operation !== 'create') {
      return deny(
        'task_output_must_be_created',
        'A task output is an immutable audit record and must be created once.',
      );
    }
    if (
      actorAgent === 'agent7' &&
      (target.source?.ownerAgent !== 'agent6' ||
        typeof target.source.outputId !== 'string' ||
        target.source.outputId.trim().length === 0)
    ) {
      return deny(
        'agent7_requires_agent6_source',
        'Agent7 task output must reference a persisted Agent6 source output.',
      );
    }
    return allow();
  }

  if (target.kind === 'text_artifact') {
    if (actorAgent === 'agent8' || actorAgent === 'agent9') {
      return deny(
        'media_agent_cannot_write_text_artifact',
        `${actorAgent} may write media output but cannot write back into text artifacts.`,
      );
    }

    if (textArtifactOwnerByRole[target.role] !== actorAgent) {
      return deny(
        'text_artifact_role_mismatch',
        `${actorAgent} does not own the ${target.role} text artifact role.`,
      );
    }

    if (actorAgent === 'agent7') {
      if (operation !== 'append_version') {
        return deny(
          'agent7_must_append_enhanced_version',
          'Agent7 must append an enhanced version and cannot replace Agent6 content.',
        );
      }

      if (
        target.source?.ownerAgent !== 'agent6' ||
        typeof target.source.outputId !== 'string' ||
        target.source.outputId.trim().length === 0
      ) {
        return deny(
          'agent7_requires_agent6_source',
          'Agent7 enhancements must reference a persisted Agent6 source output.',
        );
      }
    }

    return allow();
  }

  if (target.kind === 'image_artifact') {
    if (actorAgent !== 'agent8') {
      return deny(
        'image_artifact_reserved_for_agent8',
        'Only Agent8 may write generated storyboard image artifacts.',
      );
    }
    return allow();
  }

  if (target.kind === 'video_artifact') {
    if (actorAgent !== 'agent9') {
      return deny(
        'video_artifact_reserved_for_agent9',
        'Only Agent9 may write generated video artifacts.',
      );
    }
    return allow();
  }

  const unreachableTarget: never = target;
  return unreachableTarget;
}

export class AgentOutputWriteDeniedError extends Error {
  readonly code: AgentOutputWriteDenialCode;

  constructor(decision: Extract<AgentOutputWriteDecision, { allowed: false }>) {
    super(decision.message);
    this.name = 'AgentOutputWriteDeniedError';
    this.code = decision.code;
  }
}

export function assertAgentOutputWriteAllowed(
  intent: AgentOutputWriteIntent,
): void {
  const decision = evaluateAgentOutputWrite(intent);
  if (!decision.allowed) {
    throw new AgentOutputWriteDeniedError(decision);
  }
}
