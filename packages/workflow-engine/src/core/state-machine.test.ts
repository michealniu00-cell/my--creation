import { describe, expect, it } from 'vitest';
import {
  advanceCursor,
  createCursor,
  getNextNode,
  getWorkflowDefinition,
  shouldEscalateToAgent1,
} from '..';

describe('workflow state machine', () => {
  it('advances through the script workflow in the expected order', () => {
    const definition = getWorkflowDefinition('script');
    let cursor = createCursor(definition);

    expect(cursor.currentNode).toBe('agent2');
    expect(getNextNode(definition, cursor.currentNode)).toBe('agent2_review');

    cursor = advanceCursor(definition, cursor);
    expect(cursor.currentNode).toBe('agent2_review');

    cursor = advanceCursor(definition, cursor);
    expect(cursor.currentNode).toBe('agent3');

    cursor = advanceCursor(definition, cursor);
    cursor = advanceCursor(definition, cursor);
    cursor = advanceCursor(definition, cursor);
    cursor = advanceCursor(definition, cursor);

    expect(cursor.currentNode).toBe('script_user_confirm');
    expect(cursor.waitingForManualGate).toBe(true);
  });

  it('flags failure escalation after three retries', () => {
    expect(shouldEscalateToAgent1(2)).toBe(false);
    expect(shouldEscalateToAgent1(3)).toBe(true);
  });
});
