import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { readJsonWithSchema } from './http';

const schema = z.object({ name: z.string().min(1) }).strict();

function request(body: string) {
  return new Request('http://localhost', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
  });
}

describe('readJsonWithSchema', () => {
  it('distinguishes malformed JSON from schema validation failures', async () => {
    const malformed = await readJsonWithSchema(request('{'), schema);
    const invalid = await readJsonWithSchema(request('{}'), schema);

    expect(malformed.success).toBe(false);
    expect(invalid.success).toBe(false);
    if (!malformed.success && !invalid.success) {
      expect((await malformed.response.json()).error.code).toBe('INVALID_JSON');
      expect((await invalid.response.json()).error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('rejects undeclared input and returns typed data for valid JSON', async () => {
    const extra = await readJsonWithSchema(request('{"name":"Ada","admin":true}'), schema);
    const valid = await readJsonWithSchema(request('{"name":"Ada"}'), schema);

    expect(extra.success).toBe(false);
    expect(valid).toEqual({ success: true, data: { name: 'Ada' } });
  });
});
