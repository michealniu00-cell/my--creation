import { readGeneratedAsset } from '@video-agent-studio/artifact-service';
import { ensureDb } from '@video-agent-studio/db';
import { NextResponse } from 'next/server';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  await ensureDb();
  const { path } = await params;
  const storagePath = path.join('/');

  try {
    const asset = await readGeneratedAsset(storagePath);
    return new NextResponse(asset.bytes, {
      headers: {
        'Content-Type': asset.mimeType,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Media asset not found',
        },
      },
      { status: 404 },
    );
  }
}
