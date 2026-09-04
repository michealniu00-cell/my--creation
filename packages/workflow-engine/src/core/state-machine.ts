import type { WorkflowNode } from '@video-agent-studio/shared';
import { isManualGateNode } from './manual-gate-policy';
import type { WorkflowCursor, WorkflowDefinition } from './types';

const definitions: Record<WorkflowDefinition['type'], WorkflowDefinition> = {
  script: {
    type: 'script',
    startNode: 'agent2',
    nodes: [
      'agent2',
      'agent2_review',
      'agent3',
      'agent3_review',
      'agent4',
      'agent4_review',
      'script_user_confirm',
    ],
    agentNodes: ['agent2', 'agent3', 'agent4'],
    reviewNodes: ['agent2_review', 'agent3_review', 'agent4_review'],
    reviewNodeByAgent: {
      agent2: 'agent2_review',
      agent3: 'agent3_review',
      agent4: 'agent4_review',
    },
    manualGateNodes: ['script_user_confirm'],
    prerequisiteManualGateNodes: ['agent1_confirmed'],
  },
  storyboard: {
    type: 'storyboard',
    startNode: 'agent6',
    nodes: ['agent6', 'agent6_review', 'agent7', 'agent7_review', 'agent8'],
    agentNodes: ['agent6', 'agent7', 'agent8'],
    reviewNodes: ['agent6_review', 'agent7_review'],
    reviewNodeByAgent: {
      agent6: 'agent6_review',
      agent7: 'agent7_review',
    },
    manualGateNodes: [],
    prerequisiteManualGateNodes: ['script_user_confirm'],
  },
  video: {
    type: 'video',
    startNode: 'agent9',
    nodes: ['agent9', 'video_review'],
    agentNodes: ['agent9'],
    reviewNodes: ['video_review'],
    reviewNodeByAgent: {
      agent9: 'video_review',
    },
    manualGateNodes: [],
    prerequisiteManualGateNodes: [],
  },
};

export function getWorkflowDefinition(type: WorkflowDefinition['type']) {
  return definitions[type];
}

export function createCursor(
  definition: WorkflowDefinition,
  startNode?: WorkflowNode,
): WorkflowCursor {
  const node = startNode ?? definition.startNode;
  return {
    currentNode: node,
    completedNodes: [],
    waitingForReview: definition.reviewNodes.includes(node),
    waitingForManualGate: isManualGateNode(definition, node),
    failedNode: null,
  };
}

export function getNextNode(
  definition: WorkflowDefinition,
  currentNode: WorkflowNode,
) {
  const index = definition.nodes.indexOf(currentNode);
  if (index === -1 || index === definition.nodes.length - 1) {
    return null;
  }
  return definition.nodes[index + 1];
}

export function advanceCursor(
  definition: WorkflowDefinition,
  cursor: WorkflowCursor,
  options?: { failed?: boolean; stayOnNode?: boolean },
): WorkflowCursor {
  if (options?.failed) {
    return {
      ...cursor,
      failedNode: cursor.currentNode,
      waitingForReview: false,
      waitingForManualGate: false,
    };
  }

  if (options?.stayOnNode) {
    return {
      ...cursor,
      waitingForReview: definition.reviewNodes.includes(cursor.currentNode),
      waitingForManualGate: isManualGateNode(definition, cursor.currentNode),
    };
  }

  const nextNode = getNextNode(definition, cursor.currentNode);
  if (!nextNode) {
    return {
      ...cursor,
      completedNodes: [...cursor.completedNodes, cursor.currentNode],
      waitingForReview: false,
      waitingForManualGate: false,
    };
  }

  return {
    currentNode: nextNode,
    completedNodes: [...cursor.completedNodes, cursor.currentNode],
    waitingForReview: definition.reviewNodes.includes(nextNode),
    waitingForManualGate: isManualGateNode(definition, nextNode),
    failedNode: null,
  };
}
