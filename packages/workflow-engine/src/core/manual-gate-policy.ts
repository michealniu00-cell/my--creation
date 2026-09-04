import type { WorkflowDefinition } from './types';

export function isManualGateNode(definition: WorkflowDefinition, node: string) {
  return definition.manualGateNodes.includes(node as never);
}

