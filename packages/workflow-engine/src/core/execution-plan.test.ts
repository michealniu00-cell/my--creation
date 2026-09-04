import { describe, expect, it } from 'vitest';
import {
  createWorkflowExecutionState,
  getWorkflowDefinition,
  planWorkflowExecution,
  projectWorkflowRunState,
  rehydrateWorkflowExecutionState,
  transitionWorkflowExecution,
} from '..';

describe('workflow execution planning', () => {
  it('keeps script execution behind the Agent1 confirmation gate', () => {
    const definition = getWorkflowDefinition('script');
    const state = createWorkflowExecutionState(definition);

    expect(state).toMatchObject({
      currentNode: 'agent1_confirmed',
      status: 'waiting_for_manual_gate',
    });
    expect(planWorkflowExecution(definition, state)).toEqual({
      kind: 'await_manual_gate',
      node: 'agent1_confirmed',
    });
    expect(projectWorkflowRunState(state)).toMatchObject({
      currentNode: 'agent1_confirmed',
      status: 'reviewing',
      requiresManualReview: true,
    });
  });

  it('does not accept a terminal gate as a prerequisite confirmation', () => {
    const definition = getWorkflowDefinition('script');

    expect(() =>
      createWorkflowExecutionState(definition, {
        confirmedPrerequisiteGates: ['script_user_confirm'],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_prerequisite_confirmation' }),
    );
  });

  it('starts Agent2 only after an explicit Agent1 gate transition', () => {
    const definition = getWorkflowDefinition('script');
    const blocked = createWorkflowExecutionState(definition);
    const running = transitionWorkflowExecution(definition, blocked, {
      type: 'manual_gate_confirmed',
      node: 'agent1_confirmed',
    });

    expect(running.confirmedManualGates).toContain('agent1_confirmed');
    expect(planWorkflowExecution(definition, running)).toEqual({
      kind: 'execute_reviewed_agent',
      node: 'agent2',
      agentName: 'agent2',
      reviewNode: 'agent2_review',
    });
  });

  it('automatically plans Agent3 and Agent4 after each passing review', () => {
    const definition = getWorkflowDefinition('script');
    let state = createWorkflowExecutionState(definition, {
      confirmedPrerequisiteGates: ['agent1_confirmed'],
    });

    for (const [node, reviewNode, nextNode] of [
      ['agent2', 'agent2_review', 'agent3'],
      ['agent3', 'agent3_review', 'agent4'],
      ['agent4', 'agent4_review', 'script_user_confirm'],
    ] as const) {
      expect(planWorkflowExecution(definition, state)).toMatchObject({
        kind: 'execute_reviewed_agent',
        node,
        reviewNode,
      });
      state = transitionWorkflowExecution(definition, state, {
        type: 'reviewed_agent_passed',
        node,
        reviewNode,
      });
      expect(state.currentNode).toBe(nextNode);
    }

    expect(state.status).toBe('waiting_for_manual_gate');
    expect(planWorkflowExecution(definition, state)).toEqual({
      kind: 'await_manual_gate',
      node: 'script_user_confirm',
    });
  });

  it('cannot auto-advance through script_user_confirm', () => {
    const definition = getWorkflowDefinition('script');
    let state = createWorkflowExecutionState(definition, {
      confirmedPrerequisiteGates: ['agent1_confirmed'],
    });

    for (const [node, reviewNode] of [
      ['agent2', 'agent2_review'],
      ['agent3', 'agent3_review'],
      ['agent4', 'agent4_review'],
    ] as const) {
      state = transitionWorkflowExecution(definition, state, {
        type: 'reviewed_agent_passed',
        node,
        reviewNode,
      });
    }

    expect(() =>
      transitionWorkflowExecution(definition, state, {
        type: 'step_failed',
        node: 'script_user_confirm',
        errorType: 'content',
        errorMessage: 'attempted automatic transition',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'unexpected_execution_result' }),
    );
    expect(state.status).toBe('waiting_for_manual_gate');
  });

  it('completes script only after explicit final script confirmation', () => {
    const definition = getWorkflowDefinition('script');
    let state = createWorkflowExecutionState(definition, {
      confirmedPrerequisiteGates: ['agent1_confirmed'],
    });
    for (const [node, reviewNode] of [
      ['agent2', 'agent2_review'],
      ['agent3', 'agent3_review'],
      ['agent4', 'agent4_review'],
    ] as const) {
      state = transitionWorkflowExecution(definition, state, {
        type: 'reviewed_agent_passed',
        node,
        reviewNode,
      });
    }

    state = transitionWorkflowExecution(definition, state, {
      type: 'manual_gate_confirmed',
      node: 'script_user_confirm',
    });

    expect(state.status).toBe('completed');
    expect(state.currentNode).toBe('script_user_confirm');
    expect(state.confirmedManualGates).toEqual([
      'agent1_confirmed',
      'script_user_confirm',
    ]);
    expect(planWorkflowExecution(definition, state)).toEqual({
      kind: 'complete',
    });
    expect(projectWorkflowRunState(state).status).toBe('completed');
  });

  it('rejects results for nodes other than the engine-planned node', () => {
    const definition = getWorkflowDefinition('script');
    const state = createWorkflowExecutionState(definition, {
      confirmedPrerequisiteGates: ['agent1_confirmed'],
    });

    expect(() =>
      transitionWorkflowExecution(definition, state, {
        type: 'reviewed_agent_passed',
        node: 'agent3',
        reviewNode: 'agent3_review',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'unexpected_execution_result' }),
    );
  });

  it('turns an execution failure into a terminal engine plan', () => {
    const definition = getWorkflowDefinition('script');
    const state = createWorkflowExecutionState(definition, {
      confirmedPrerequisiteGates: ['agent1_confirmed'],
    });
    const failed = transitionWorkflowExecution(definition, state, {
      type: 'step_failed',
      node: 'agent2',
      errorType: 'system',
      errorMessage: 'provider unavailable',
      requiresManualReview: true,
    });

    expect(planWorkflowExecution(definition, failed)).toEqual({
      kind: 'failed',
      node: 'agent2',
      errorType: 'system',
      errorMessage: 'provider unavailable',
    });
    expect(projectWorkflowRunState(failed)).toEqual({
      currentNode: 'agent2',
      status: 'failed',
      requiresManualReview: true,
      errorType: 'system',
      errorMessage: 'provider unavailable',
    });
  });

  it('preserves manual-review escalation while auto-advancing', () => {
    const definition = getWorkflowDefinition('script');
    const state = createWorkflowExecutionState(definition, {
      confirmedPrerequisiteGates: ['agent1_confirmed'],
    });
    const next = transitionWorkflowExecution(definition, state, {
      type: 'reviewed_agent_passed',
      node: 'agent2',
      reviewNode: 'agent2_review',
      requiresManualReview: true,
    });

    expect(next.currentNode).toBe('agent3');
    expect(next.requiresManualReview).toBe(true);
    expect(projectWorkflowRunState(next).requiresManualReview).toBe(true);
  });

  it('requires script confirmation before planning storyboard Agents', () => {
    const definition = getWorkflowDefinition('storyboard');
    const blocked = createWorkflowExecutionState(definition);

    expect(planWorkflowExecution(definition, blocked)).toEqual({
      kind: 'await_manual_gate',
      node: 'script_user_confirm',
    });
  });

  it('auto-advances storyboard reviews and completes after Agent8', () => {
    const definition = getWorkflowDefinition('storyboard');
    let state = createWorkflowExecutionState(definition, {
      confirmedPrerequisiteGates: ['script_user_confirm'],
    });

    state = transitionWorkflowExecution(definition, state, {
      type: 'reviewed_agent_passed',
      node: 'agent6',
      reviewNode: 'agent6_review',
    });
    expect(state.currentNode).toBe('agent7');

    state = transitionWorkflowExecution(definition, state, {
      type: 'reviewed_agent_passed',
      node: 'agent7',
      reviewNode: 'agent7_review',
    });
    expect(planWorkflowExecution(definition, state)).toEqual({
      kind: 'execute_agent',
      node: 'agent8',
      agentName: 'agent8',
    });

    state = transitionWorkflowExecution(definition, state, {
      type: 'agent_succeeded',
      node: 'agent8',
    });
    expect(planWorkflowExecution(definition, state)).toEqual({
      kind: 'complete',
    });
  });

  it('auto-completes video after the Agent9 review passes', () => {
    const definition = getWorkflowDefinition('video');
    const state = createWorkflowExecutionState(definition);
    const completed = transitionWorkflowExecution(definition, state, {
      type: 'reviewed_agent_passed',
      node: 'agent9',
      reviewNode: 'video_review',
    });

    expect(completed.status).toBe('completed');
    expect(planWorkflowExecution(definition, completed)).toEqual({
      kind: 'complete',
    });
  });

  it('rejects a state paired with another workflow definition', () => {
    const scriptState = createWorkflowExecutionState(
      getWorkflowDefinition('script'),
      { confirmedPrerequisiteGates: ['agent1_confirmed'] },
    );

    expect(() =>
      planWorkflowExecution(getWorkflowDefinition('video'), scriptState),
    ).toThrowError(expect.objectContaining({ code: 'definition_mismatch' }));
  });

  it('rehydrates a persisted script gate for one strict confirmation transition', () => {
    const definition = getWorkflowDefinition('script');
    const waiting = rehydrateWorkflowExecutionState(
      definition,
      {
        workflowType: 'script',
        currentNode: 'script_user_confirm',
        status: 'reviewing',
        requiresManualReview: true,
        errorType: null,
        errorMessage: null,
      },
      { confirmedManualGates: ['agent1_confirmed'] },
    );

    expect(planWorkflowExecution(definition, waiting)).toEqual({
      kind: 'await_manual_gate',
      node: 'script_user_confirm',
    });
    expect(waiting.completedNodes).toEqual([
      'agent1_confirmed',
      'agent2',
      'agent2_review',
      'agent3',
      'agent3_review',
      'agent4',
      'agent4_review',
    ]);

    const completed = transitionWorkflowExecution(definition, waiting, {
      type: 'manual_gate_confirmed',
      node: 'script_user_confirm',
    });
    expect(projectWorkflowRunState(completed)).toMatchObject({
      currentNode: 'script_user_confirm',
      status: 'completed',
      errorType: null,
      errorMessage: null,
    });
  });

  it('rejects rehydration beyond Agent1 without persisted gate proof', () => {
    const definition = getWorkflowDefinition('script');

    expect(() =>
      rehydrateWorkflowExecutionState(definition, {
        workflowType: 'script',
        currentNode: 'agent2',
        status: 'running',
        requiresManualReview: false,
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_prerequisite_confirmation' }),
    );
  });

  it('rejects legacy review-node state as executable orchestration state', () => {
    const definition = getWorkflowDefinition('script');

    expect(() =>
      rehydrateWorkflowExecutionState(
        definition,
        {
          workflowType: 'script',
          currentNode: 'agent2_review',
          status: 'reviewing',
          requiresManualReview: false,
        },
        { confirmedManualGates: ['agent1_confirmed'] },
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_persisted_state' }),
    );
  });

  it('rejects a waiting gate that is already claimed as confirmed', () => {
    const definition = getWorkflowDefinition('script');

    expect(() =>
      rehydrateWorkflowExecutionState(
        definition,
        {
          workflowType: 'script',
          currentNode: 'script_user_confirm',
          status: 'reviewing',
          requiresManualReview: true,
        },
        {
          confirmedManualGates: ['agent1_confirmed', 'script_user_confirm'],
        },
      ),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_persisted_state' }),
    );
  });

  it('requires terminal manual-gate proof when rehydrating completed script', () => {
    const definition = getWorkflowDefinition('script');
    const persisted = {
      workflowType: 'script' as const,
      currentNode: 'script_user_confirm' as const,
      status: 'completed' as const,
      requiresManualReview: false,
    };

    expect(() =>
      rehydrateWorkflowExecutionState(definition, persisted, {
        confirmedManualGates: ['agent1_confirmed'],
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'invalid_persisted_state' }),
    );

    const completed = rehydrateWorkflowExecutionState(definition, persisted, {
      confirmedManualGates: ['agent1_confirmed', 'script_user_confirm'],
    });
    expect(planWorkflowExecution(definition, completed)).toEqual({
      kind: 'complete',
    });
  });

  it('resumes only the exact failed node through an engine-owned transition', () => {
    const definition = getWorkflowDefinition('script');
    const failed = rehydrateWorkflowExecutionState(
      definition,
      {
        workflowType: 'script',
        currentNode: 'agent3',
        status: 'failed',
        requiresManualReview: true,
        errorType: 'system',
        errorMessage: 'provider timeout',
      },
      { confirmedManualGates: ['agent1_confirmed'] },
    );

    const resumed = transitionWorkflowExecution(definition, failed, {
      type: 'failed_step_retry_requested',
      node: 'agent3',
    });
    expect(planWorkflowExecution(definition, resumed)).toMatchObject({
      kind: 'execute_reviewed_agent',
      node: 'agent3',
    });
    expect(projectWorkflowRunState(resumed)).toMatchObject({
      currentNode: 'agent3',
      status: 'running',
      errorType: null,
      errorMessage: null,
    });

    expect(() =>
      transitionWorkflowExecution(definition, failed, {
        type: 'failed_step_retry_requested',
        node: 'agent2',
      }),
    ).toThrowError(
      expect.objectContaining({ code: 'unexpected_execution_result' }),
    );
  });
});
