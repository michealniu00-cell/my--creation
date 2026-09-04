import type { WorkflowNode } from '@video-agent-studio/shared';
import { isManualGateNode } from './manual-gate-policy';
import { getNextNode } from './state-machine';
import type {
  PersistedWorkflowExecutionState,
  WorkflowAgentNode,
  WorkflowDefinition,
  WorkflowExecutionPlan,
  WorkflowExecutionResult,
  WorkflowExecutionState,
  WorkflowRunProjection,
} from './types';

export type WorkflowTransitionErrorCode =
  | 'definition_mismatch'
  | 'invalid_prerequisite_confirmation'
  | 'invalid_execution_state'
  | 'invalid_persisted_state'
  | 'unexpected_execution_result';

export class WorkflowTransitionError extends Error {
  readonly code: WorkflowTransitionErrorCode;

  constructor(code: WorkflowTransitionErrorCode, message: string) {
    super(message);
    this.name = 'WorkflowTransitionError';
    this.code = code;
  }
}

function uniqueNodes(nodes: readonly WorkflowNode[]): WorkflowNode[] {
  return [...new Set(nodes)];
}

function isPrerequisiteManualGate(
  definition: WorkflowDefinition,
  node: WorkflowNode,
) {
  return definition.prerequisiteManualGateNodes.includes(node);
}

function isAnyManualGate(definition: WorkflowDefinition, node: WorkflowNode) {
  return (
    isPrerequisiteManualGate(definition, node) ||
    isManualGateNode(definition, node)
  );
}

function assertMatchingDefinition(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
) {
  if (definition.type !== state.workflowType) {
    throw new WorkflowTransitionError(
      'definition_mismatch',
      `Cannot apply the ${definition.type} definition to ${state.workflowType} state.`,
    );
  }
}

function positionAtNode(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
  node: WorkflowNode | null,
  completedNodes: readonly WorkflowNode[],
  confirmedManualGates: readonly WorkflowNode[],
  requiresManualReview = state.requiresManualReview,
): WorkflowExecutionState {
  const completed = uniqueNodes(completedNodes);
  const confirmed = uniqueNodes(confirmedManualGates);

  if (!node) {
    return {
      ...state,
      currentNode: completed.at(-1) ?? state.currentNode,
      completedNodes: completed,
      confirmedManualGates: confirmed,
      status: 'completed',
      failedNode: null,
      requiresManualReview,
      errorType: null,
      errorMessage: null,
    };
  }

  return {
    ...state,
    currentNode: node,
    completedNodes: completed,
    confirmedManualGates: confirmed,
    status: isAnyManualGate(definition, node)
      ? 'waiting_for_manual_gate'
      : 'running',
    failedNode: null,
    requiresManualReview,
    errorType: null,
    errorMessage: null,
  };
}

export function createWorkflowExecutionState(
  definition: WorkflowDefinition,
  options: { confirmedPrerequisiteGates?: readonly WorkflowNode[] } = {},
): WorkflowExecutionState {
  const confirmed = uniqueNodes(options.confirmedPrerequisiteGates ?? []);
  const invalidConfirmation = confirmed.find(
    (node) => !definition.prerequisiteManualGateNodes.includes(node),
  );
  if (invalidConfirmation) {
    throw new WorkflowTransitionError(
      'invalid_prerequisite_confirmation',
      `${invalidConfirmation} is not a prerequisite manual gate for ${definition.type}.`,
    );
  }

  const missingPrerequisite = definition.prerequisiteManualGateNodes.find(
    (node) => !confirmed.includes(node),
  );
  const currentNode = missingPrerequisite ?? definition.startNode;

  return {
    workflowType: definition.type,
    currentNode,
    completedNodes: [...confirmed],
    confirmedManualGates: confirmed,
    status: missingPrerequisite ? 'waiting_for_manual_gate' : 'running',
    failedNode: null,
    requiresManualReview: false,
    errorType: null,
    errorMessage: null,
  };
}

/**
 * Reconstructs engine state from persisted run facts. This is deliberately
 * strict: intermediate review-node states are rejected, and entering the
 * executable graph always requires external proof for every prerequisite gate.
 */
export function rehydrateWorkflowExecutionState(
  definition: WorkflowDefinition,
  persisted: PersistedWorkflowExecutionState,
  options: { confirmedManualGates?: readonly WorkflowNode[] } = {},
): WorkflowExecutionState {
  if (persisted.workflowType !== definition.type) {
    throw new WorkflowTransitionError(
      'definition_mismatch',
      `Cannot rehydrate ${persisted.workflowType} state with the ${definition.type} definition.`,
    );
  }

  const confirmed = uniqueNodes(options.confirmedManualGates ?? []);
  const allowedManualGates = new Set([
    ...definition.prerequisiteManualGateNodes,
    ...definition.manualGateNodes,
  ]);
  const invalidConfirmation = confirmed.find(
    (node) => !allowedManualGates.has(node),
  );
  if (invalidConfirmation) {
    throw new WorkflowTransitionError(
      'invalid_prerequisite_confirmation',
      `${invalidConfirmation} is not a manual gate for ${definition.type}.`,
    );
  }

  const currentNode =
    persisted.currentNode ??
    (persisted.status === 'completed' ? definition.nodes.at(-1) : null);
  if (!currentNode) {
    throw new WorkflowTransitionError(
      'invalid_persisted_state',
      'Persisted active or failed workflow state must include currentNode.',
    );
  }

  const isPrerequisite = isPrerequisiteManualGate(definition, currentNode);
  const nodeIndex = definition.nodes.indexOf(currentNode);
  if (!isPrerequisite && nodeIndex === -1) {
    throw new WorkflowTransitionError(
      'invalid_persisted_state',
      `${currentNode} is not part of the ${definition.type} workflow.`,
    );
  }

  const missingPrerequisite = definition.prerequisiteManualGateNodes.find(
    (node) => !confirmed.includes(node),
  );
  if (isPrerequisite) {
    if (
      missingPrerequisite !== currentNode ||
      confirmed.includes(currentNode)
    ) {
      throw new WorkflowTransitionError(
        'invalid_persisted_state',
        `Persisted prerequisite gate ${currentNode} does not match the supplied confirmations.`,
      );
    }
  } else if (missingPrerequisite) {
    throw new WorkflowTransitionError(
      'invalid_prerequisite_confirmation',
      `Cannot rehydrate ${currentNode} without proof of ${missingPrerequisite}.`,
    );
  }

  const currentIsManualGate = isAnyManualGate(definition, currentNode);
  let status: WorkflowExecutionState['status'];

  if (persisted.status === 'running') {
    if (
      currentIsManualGate ||
      !definition.agentNodes.includes(currentNode as WorkflowAgentNode)
    ) {
      throw new WorkflowTransitionError(
        'invalid_persisted_state',
        `Running state must point at an executable Agent, received ${currentNode}.`,
      );
    }
    status = 'running';
  } else if (persisted.status === 'reviewing') {
    if (!currentIsManualGate || confirmed.includes(currentNode)) {
      throw new WorkflowTransitionError(
        'invalid_persisted_state',
        `Reviewing state must point at an unconfirmed manual gate, received ${currentNode}.`,
      );
    }
    status = 'waiting_for_manual_gate';
  } else if (persisted.status === 'failed') {
    if (
      !definition.agentNodes.includes(currentNode as WorkflowAgentNode) ||
      !persisted.errorType ||
      !persisted.errorMessage
    ) {
      throw new WorkflowTransitionError(
        'invalid_persisted_state',
        'Failed state must point at an executable Agent and include error details.',
      );
    }
    status = 'failed';
  } else if (persisted.status === 'completed') {
    const terminalNode = definition.nodes.at(-1);
    if (currentNode !== terminalNode) {
      throw new WorkflowTransitionError(
        'invalid_persisted_state',
        `Completed state must point at terminal node ${terminalNode ?? 'unknown'}.`,
      );
    }
    if (currentIsManualGate && !confirmed.includes(currentNode)) {
      throw new WorkflowTransitionError(
        'invalid_persisted_state',
        `Completed state is missing confirmation proof for ${currentNode}.`,
      );
    }
    status = 'completed';
  } else {
    throw new WorkflowTransitionError(
      'invalid_persisted_state',
      `Run status ${persisted.status} cannot be rehydrated for execution.`,
    );
  }

  const completedFlowNodes = isPrerequisite
    ? []
    : [...definition.nodes.slice(0, Math.max(0, nodeIndex))];
  if (status === 'completed') {
    completedFlowNodes.push(currentNode);
  }

  return {
    workflowType: definition.type,
    currentNode,
    completedNodes: uniqueNodes([...confirmed, ...completedFlowNodes]),
    confirmedManualGates: confirmed,
    status,
    failedNode: status === 'failed' ? currentNode : null,
    requiresManualReview: persisted.requiresManualReview,
    errorType: status === 'failed' ? (persisted.errorType ?? null) : null,
    errorMessage: status === 'failed' ? (persisted.errorMessage ?? null) : null,
  };
}

export function planWorkflowExecution(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
): WorkflowExecutionPlan {
  assertMatchingDefinition(definition, state);

  if (state.status === 'completed') {
    return { kind: 'complete' };
  }
  if (state.status === 'failed') {
    if (!state.failedNode || !state.errorType || !state.errorMessage) {
      throw new WorkflowTransitionError(
        'invalid_execution_state',
        'Failed workflow state is missing its failed node or error details.',
      );
    }
    return {
      kind: 'failed',
      node: state.failedNode,
      errorType: state.errorType,
      errorMessage: state.errorMessage,
    };
  }
  if (!state.currentNode) {
    throw new WorkflowTransitionError(
      'invalid_execution_state',
      'Active workflow state must have a current node.',
    );
  }

  if (isAnyManualGate(definition, state.currentNode)) {
    return { kind: 'await_manual_gate', node: state.currentNode };
  }

  if (definition.agentNodes.includes(state.currentNode as WorkflowAgentNode)) {
    const agentName = state.currentNode as WorkflowAgentNode;
    const reviewNode = definition.reviewNodeByAgent[agentName];
    return reviewNode
      ? {
          kind: 'execute_reviewed_agent',
          node: agentName,
          agentName,
          reviewNode,
        }
      : {
          kind: 'execute_agent',
          node: agentName,
          agentName,
        };
  }

  throw new WorkflowTransitionError(
    'invalid_execution_state',
    `${state.currentNode} is not an executable Agent or manual gate node.`,
  );
}

function assertExpectedPlan(
  plan: WorkflowExecutionPlan,
  expectedKind: WorkflowExecutionPlan['kind'],
) {
  if (plan.kind !== expectedKind) {
    throw new WorkflowTransitionError(
      'unexpected_execution_result',
      `Received a result for ${expectedKind} while the engine planned ${plan.kind}.`,
    );
  }
}

export function transitionWorkflowExecution(
  definition: WorkflowDefinition,
  state: WorkflowExecutionState,
  result: WorkflowExecutionResult,
): WorkflowExecutionState {
  const plan = planWorkflowExecution(definition, state);

  if (result.type === 'failed_step_retry_requested') {
    assertExpectedPlan(plan, 'failed');
    if (plan.kind !== 'failed' || plan.node !== result.node) {
      throw new WorkflowTransitionError(
        'unexpected_execution_result',
        `Cannot retry ${result.node}; the persisted failure is at ${plan.kind === 'failed' ? plan.node : 'another step'}.`,
      );
    }
    return {
      ...state,
      currentNode: plan.node,
      status: 'running',
      failedNode: null,
      errorType: null,
      errorMessage: null,
    };
  }

  if (result.type === 'manual_gate_confirmed') {
    assertExpectedPlan(plan, 'await_manual_gate');
    if (plan.kind !== 'await_manual_gate' || plan.node !== result.node) {
      throw new WorkflowTransitionError(
        'unexpected_execution_result',
        `Cannot confirm ${result.node}; the engine is waiting for ${plan.kind === 'await_manual_gate' ? plan.node : 'another step'}.`,
      );
    }

    const confirmed = uniqueNodes([...state.confirmedManualGates, result.node]);
    const completed = uniqueNodes([...state.completedNodes, result.node]);

    if (isPrerequisiteManualGate(definition, result.node)) {
      const nextMissingPrerequisite =
        definition.prerequisiteManualGateNodes.find(
          (node) => !confirmed.includes(node),
        );
      return positionAtNode(
        definition,
        state,
        nextMissingPrerequisite ?? definition.startNode,
        completed,
        confirmed,
      );
    }

    return positionAtNode(
      definition,
      state,
      getNextNode(definition, result.node),
      completed,
      confirmed,
    );
  }

  if (result.type === 'reviewed_agent_passed') {
    assertExpectedPlan(plan, 'execute_reviewed_agent');
    if (
      plan.kind !== 'execute_reviewed_agent' ||
      plan.node !== result.node ||
      plan.reviewNode !== result.reviewNode
    ) {
      throw new WorkflowTransitionError(
        'unexpected_execution_result',
        `Reviewed result ${result.node}/${result.reviewNode} does not match the current engine plan.`,
      );
    }

    return positionAtNode(
      definition,
      state,
      getNextNode(definition, result.reviewNode),
      [...state.completedNodes, result.node, result.reviewNode],
      state.confirmedManualGates,
      state.requiresManualReview || Boolean(result.requiresManualReview),
    );
  }

  if (result.type === 'agent_succeeded') {
    assertExpectedPlan(plan, 'execute_agent');
    if (plan.kind !== 'execute_agent' || plan.node !== result.node) {
      throw new WorkflowTransitionError(
        'unexpected_execution_result',
        `Agent result ${result.node} does not match the current engine plan.`,
      );
    }

    return positionAtNode(
      definition,
      state,
      getNextNode(definition, result.node),
      [...state.completedNodes, result.node],
      state.confirmedManualGates,
      state.requiresManualReview || Boolean(result.requiresManualReview),
    );
  }

  if (
    (plan.kind !== 'execute_agent' && plan.kind !== 'execute_reviewed_agent') ||
    plan.node !== result.node
  ) {
    throw new WorkflowTransitionError(
      'unexpected_execution_result',
      `Failure at ${result.node} does not match the current engine plan.`,
    );
  }

  return {
    ...state,
    currentNode: result.node,
    status: 'failed',
    failedNode: result.node,
    requiresManualReview:
      state.requiresManualReview || Boolean(result.requiresManualReview),
    errorType: result.errorType,
    errorMessage: result.errorMessage,
  };
}

export function projectWorkflowRunState(
  state: WorkflowExecutionState,
): WorkflowRunProjection {
  const status: WorkflowRunProjection['status'] =
    state.status === 'waiting_for_manual_gate' ? 'reviewing' : state.status;

  return {
    currentNode: state.currentNode,
    status,
    requiresManualReview:
      state.requiresManualReview || state.status === 'waiting_for_manual_gate',
    errorType: state.errorType,
    errorMessage: state.errorMessage,
  };
}
