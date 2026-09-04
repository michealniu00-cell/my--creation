import { NextResponse } from 'next/server';
import { fail, ok } from '@video-agent-studio/shared';
import type { ZodType } from 'zod';

export async function readJsonStrict(request: Request) {
  try {
    return {
      success: true as const,
      data: (await request.json()) as unknown,
    };
  } catch {
    return {
      success: false as const,
      response: jsonFail('INVALID_JSON', 'Request body must be valid JSON', 400),
    };
  }
}

export async function readJsonWithSchema<T>(
  request: Request,
  schema: ZodType<T>,
  options: { code?: string; message?: string } = {},
) {
  const body = await readJsonStrict(request);
  if (!body.success) {
    return body;
  }

  const parsed = schema.safeParse(body.data);
  if (!parsed.success) {
    return {
      success: false as const,
      response: jsonFail(
        options.code ?? 'VALIDATION_ERROR',
        options.message ?? 'Request payload is invalid',
        400,
        { issues: parsed.error.issues },
      ),
    };
  }

  return {
    success: true as const,
    data: parsed.data,
  };
}

export function jsonOk<T>(data: T, meta?: Record<string, unknown>, init?: ResponseInit) {
  return NextResponse.json(ok(data, meta), init);
}

export function jsonFail(
  code: string,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
) {
  return NextResponse.json(fail(code, message, details), { status });
}
