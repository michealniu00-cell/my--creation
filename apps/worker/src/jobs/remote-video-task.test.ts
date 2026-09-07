import { describe, expect, it } from 'vitest';
import { remoteVideoTaskControl } from './remote-video-task';
import { remoteVideoTaskScope } from '../workflows/execution-control';

describe('durable remote video task checkpoints', () => {
  it('rehydrates the submitted task after restart and retains failed submission history', async () => {
    let persisted: Record<string, unknown> = { phase: 'running' };
    function restart() {
      const context = {
        checkpoint: structuredClone(persisted),
        throwIfAborted() {},
        async saveCheckpoint(next: Record<string, unknown>) {
          persisted = structuredClone(next);
          context.checkpoint = structuredClone(next);
        },
      };
      return context;
    }
    const scope = remoteVideoTaskScope('shot-1', {
      provider: 'minimax',
      prompt: 'scene',
    });
    await remoteVideoTaskControl(restart(), scope).onRemoteTaskSubmitted?.(
      'remote-1',
    );
    const resumed = remoteVideoTaskControl(restart(), scope);
    expect(resumed.resumeRemoteTaskId).toBe('remote-1');
    await resumed.onRemoteTaskFailed?.('remote-1');
    const retry = remoteVideoTaskControl(restart(), scope);
    expect(retry.resumeRemoteTaskId).toBeUndefined();
    await retry.onRemoteTaskSubmitted?.('remote-2');
    expect(remoteVideoTaskControl(restart(), scope).resumeRemoteTaskId).toBe(
      'remote-2',
    );
    expect(
      (persisted.remoteVideoTasks as Record<string, unknown[]>)[scope],
    ).toHaveLength(2);
    expect(persisted.phase).toBe('running');
  });

  it('isolates shots and request changes without storing prompt or credential material in the key', () => {
    const one = remoteVideoTaskScope('shot-1', {
      prompt: 'private prompt',
      model: 'v1',
    });
    expect(one).not.toContain('private prompt');
    expect(one).not.toBe(
      remoteVideoTaskScope('shot-2', { prompt: 'private prompt', model: 'v1' }),
    );
    expect(one).not.toBe(
      remoteVideoTaskScope('shot-1', { prompt: 'private prompt', model: 'v2' }),
    );
  });

  it('rejects checkpoint updates after cancellation or lease loss', async () => {
    const control = remoteVideoTaskControl(
      {
        checkpoint: {},
        throwIfAborted() {
          throw new Error('lease lost');
        },
        async saveCheckpoint() {
          throw new Error('must not write');
        },
      },
      'shot-1',
    );
    await expect(control.onRemoteTaskSubmitted?.('remote-1')).rejects.toThrow(
      'lease lost',
    );
  });
});
