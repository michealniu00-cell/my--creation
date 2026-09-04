import { agentNames, type AgentName } from '@video-agent-studio/shared';
import { describe, expect, it } from 'vitest';
import {
  AgentOutputWriteDeniedError,
  assertAgentOutputWriteAllowed,
  evaluateAgentOutputWrite,
  textArtifactOwnerByRole,
  type TextArtifactRole,
} from '..';

function expectDenied(
  decision: ReturnType<typeof evaluateAgentOutputWrite>,
  code: string,
) {
  expect(decision).toMatchObject({ allowed: false, code });
}

describe('Agent output write policy', () => {
  it('allows task audit output only when the Agent owns it', () => {
    for (const actorAgent of agentNames) {
      for (const ownerAgent of agentNames) {
        const decision = evaluateAgentOutputWrite({
          actorAgent,
          operation: 'create',
          target: {
            kind: 'task_output',
            ownerAgent,
            source:
              actorAgent === 'agent7' && ownerAgent === 'agent7'
                ? { ownerAgent: 'agent6', outputId: 'agent6-task-1' }
                : null,
          },
        });

        if (actorAgent === ownerAgent && actorAgent !== 'agent5') {
          expect(decision).toEqual({ allowed: true });
        } else {
          expect(decision.allowed).toBe(false);
        }
      }
    }
  });

  it('restricts Agent5 to separate append-only review feedback', () => {
    expect(
      evaluateAgentOutputWrite({
        actorAgent: 'agent5',
        operation: 'create',
        target: {
          kind: 'review_feedback',
          ownerAgent: 'agent5',
          subjectAgent: 'agent4',
        },
      }),
    ).toEqual({ allowed: true });

    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent5',
        operation: 'create',
        target: { kind: 'task_output', ownerAgent: 'agent5' },
      }),
      'agent5_review_feedback_only',
    );
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent5',
        operation: 'create',
        target: {
          kind: 'review_feedback',
          ownerAgent: 'agent5',
          subjectAgent: 'agent5',
        },
      }),
      'agent5_cannot_review_itself',
    );
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent5',
        operation: 'append_version',
        target: {
          kind: 'review_feedback',
          ownerAgent: 'agent5',
          subjectAgent: 'agent4',
        },
      }),
      'review_feedback_must_be_created',
    );
  });

  it('reserves review feedback for Agent5', () => {
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent4',
        operation: 'create',
        target: {
          kind: 'review_feedback',
          ownerAgent: 'agent4',
          subjectAgent: 'agent3',
        },
      }),
      'review_feedback_reserved_for_agent5',
    );
  });

  it('lets Agent7 append an enhancement sourced from Agent6', () => {
    expect(
      evaluateAgentOutputWrite({
        actorAgent: 'agent7',
        operation: 'append_version',
        target: {
          kind: 'text_artifact',
          ownerAgent: 'agent7',
          role: 'shot_enhancement',
          source: { ownerAgent: 'agent6', outputId: 'agent6-task-1' },
        },
      }),
    ).toEqual({ allowed: true });
  });

  it('requires Agent7 task output to keep its Agent6 lineage', () => {
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent7',
        operation: 'create',
        target: { kind: 'task_output', ownerAgent: 'agent7' },
      }),
      'agent7_requires_agent6_source',
    );

    expect(
      evaluateAgentOutputWrite({
        actorAgent: 'agent7',
        operation: 'create',
        target: {
          kind: 'task_output',
          ownerAgent: 'agent7',
          source: { ownerAgent: 'agent6', outputId: 'agent6-task-1' },
        },
      }),
    ).toEqual({ allowed: true });
  });

  it('prevents Agent7 from replacing or detaching the Agent6 source', () => {
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent7',
        operation: 'create',
        target: {
          kind: 'text_artifact',
          ownerAgent: 'agent7',
          role: 'shot_enhancement',
          source: { ownerAgent: 'agent6', outputId: 'agent6-task-1' },
        },
      }),
      'agent7_must_append_enhanced_version',
    );

    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent7',
        operation: 'append_version',
        target: {
          kind: 'text_artifact',
          ownerAgent: 'agent7',
          role: 'shot_enhancement',
        },
      }),
      'agent7_requires_agent6_source',
    );

    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent7',
        operation: 'append_version',
        target: {
          kind: 'text_artifact',
          ownerAgent: 'agent7',
          role: 'shot_enhancement',
          source: { ownerAgent: 'agent4', outputId: 'agent4-task-1' },
        },
      }),
      'agent7_requires_agent6_source',
    );

    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent7',
        operation: 'mutate_existing',
        target: {
          kind: 'text_artifact',
          ownerAgent: 'agent6',
          role: 'shot_structure',
          source: { ownerAgent: 'agent6', outputId: 'agent6-task-1' },
        },
      }),
      'cross_agent_write_denied',
    );
  });

  it.each([
    ['agent1', 'agent1_brief'],
    ['agent2', 'research_report'],
    ['agent3', 'storyline'],
    ['agent4', 'script'],
    ['agent6', 'shot_structure'],
  ] as const)(
    'allows %s to create its own %s text artifact',
    (actorAgent, role) => {
      expect(
        evaluateAgentOutputWrite({
          actorAgent,
          operation: 'create',
          target: { kind: 'text_artifact', ownerAgent: actorAgent, role },
        }),
      ).toEqual({ allowed: true });
    },
  );

  it('rejects a text role that is not assigned to the actor', () => {
    for (const [role, roleOwner] of Object.entries(
      textArtifactOwnerByRole,
    ) as Array<[TextArtifactRole, AgentName]>) {
      const otherAgent = agentNames.find(
        (candidate) =>
          candidate !== roleOwner &&
          candidate !== 'agent5' &&
          candidate !== 'agent8' &&
          candidate !== 'agent9',
      );
      expect(otherAgent).toBeDefined();
      expectDenied(
        evaluateAgentOutputWrite({
          actorAgent: otherAgent!,
          operation: 'create',
          target: { kind: 'text_artifact', ownerAgent: otherAgent!, role },
        }),
        'text_artifact_role_mismatch',
      );
    }
  });

  it('prevents Agent8 and Agent9 from writing back into text artifacts', () => {
    for (const actorAgent of ['agent8', 'agent9'] as const) {
      expectDenied(
        evaluateAgentOutputWrite({
          actorAgent,
          operation: 'append_version',
          target: {
            kind: 'text_artifact',
            ownerAgent: actorAgent,
            role: 'shot_enhancement',
          },
        }),
        'media_agent_cannot_write_text_artifact',
      );
    }
  });

  it('reserves storyboard images for Agent8 and videos for Agent9', () => {
    expect(
      evaluateAgentOutputWrite({
        actorAgent: 'agent8',
        operation: 'append_version',
        target: { kind: 'image_artifact', ownerAgent: 'agent8' },
      }),
    ).toEqual({ allowed: true });
    expect(
      evaluateAgentOutputWrite({
        actorAgent: 'agent9',
        operation: 'append_version',
        target: { kind: 'video_artifact', ownerAgent: 'agent9' },
      }),
    ).toEqual({ allowed: true });

    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent8',
        operation: 'append_version',
        target: { kind: 'video_artifact', ownerAgent: 'agent8' },
      }),
      'video_artifact_reserved_for_agent9',
    );
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent9',
        operation: 'append_version',
        target: { kind: 'image_artifact', ownerAgent: 'agent9' },
      }),
      'image_artifact_reserved_for_agent8',
    );
  });

  it('never permits in-place mutation of an existing Agent output', () => {
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent4',
        operation: 'mutate_existing',
        target: { kind: 'text_artifact', ownerAgent: 'agent4', role: 'script' },
      }),
      'existing_output_is_immutable',
    );
    expectDenied(
      evaluateAgentOutputWrite({
        actorAgent: 'agent8',
        operation: 'mutate_existing',
        target: { kind: 'image_artifact', ownerAgent: 'agent8' },
      }),
      'existing_output_is_immutable',
    );
  });

  it('exposes an assertion helper with a stable denial code', () => {
    expect(() =>
      assertAgentOutputWriteAllowed({
        actorAgent: 'agent8',
        operation: 'create',
        target: {
          kind: 'text_artifact',
          ownerAgent: 'agent8',
          role: 'shot_structure',
        },
      }),
    ).toThrowError(AgentOutputWriteDeniedError);

    try {
      assertAgentOutputWriteAllowed({
        actorAgent: 'agent8',
        operation: 'create',
        target: {
          kind: 'text_artifact',
          ownerAgent: 'agent8',
          role: 'shot_structure',
        },
      });
    } catch (error) {
      expect(error).toBeInstanceOf(AgentOutputWriteDeniedError);
      expect((error as AgentOutputWriteDeniedError).code).toBe(
        'media_agent_cannot_write_text_artifact',
      );
    }
  });
});
