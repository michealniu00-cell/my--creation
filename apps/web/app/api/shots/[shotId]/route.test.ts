import { describe, expect, it } from 'vitest';
import { DELETE, PATCH } from './route';

describe('/api/shots/[shotId] legacy writes', () => {
  it('requires the canonical project-scoped path for PATCH and DELETE', async () => {
    const patchResponse = await PATCH(new Request('http://localhost'), {
      params: Promise.resolve({ shotId: 'shot-id' }),
    });
    const patchPayload = await patchResponse.json();
    expect(patchResponse.status).toBe(410);
    expect(patchPayload.error.code).toBe('PROJECT_SCOPE_REQUIRED');
    expect(patchPayload.error.details.canonicalPath).toBe(
      '/api/projects/{projectId}/shots/{shotId}',
    );

    const deleteResponse = await DELETE(new Request('http://localhost'), {
      params: Promise.resolve({ shotId: 'shot-id' }),
    });
    expect(deleteResponse.status).toBe(410);
    expect((await deleteResponse.json()).error.code).toBe(
      'PROJECT_SCOPE_REQUIRED',
    );
  });
});
