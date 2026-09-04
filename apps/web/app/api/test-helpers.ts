import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';
import { ensureDb, lockRepository, projectRepository, shotRepository } from '@video-agent-studio/db';

export async function createTempApiTestEnv(prefix = 'vas-web-route-test-') {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), prefix));
  process.env.VIDEO_AGENT_STUDIO_DB_FILE = path.join(tempDir, 'db.json');
  process.env.VIDEO_AGENT_STUDIO_ASSET_ROOT = path.join(tempDir, '.data');
  await ensureDb();

  return {
    tempDir,
    async cleanup() {
      delete process.env.VIDEO_AGENT_STUDIO_DB_FILE;
      delete process.env.VIDEO_AGENT_STUDIO_ASSET_ROOT;
      delete process.env.OPENAI_API_KEY;
      delete process.env.OPENAI_BASE_URL;
      delete process.env.ANTHROPIC_API_KEY;
      delete process.env.ANTHROPIC_BASE_URL;
      delete process.env.ANTHROPIC_VERSION;
      delete process.env.MINIMAX_API_KEY;
      delete process.env.MINIMAX_BASE_URL;
      delete process.env.VIDEO_AGENT_STUDIO_LLM_API_KEY;
      delete process.env.VIDEO_AGENT_STUDIO_LLM_BASE_URL;
      delete process.env.VIDEO_AGENT_STUDIO_IMAGE_API_KEY;
      delete process.env.VIDEO_AGENT_STUDIO_IMAGE_BASE_URL;
      delete process.env.VIDEO_AGENT_STUDIO_VIDEO_API_KEY;
      delete process.env.VIDEO_AGENT_STUDIO_VIDEO_BASE_URL;
      await rm(tempDir, { recursive: true, force: true });
    },
  };
}

export async function getDemoProject() {
  const project = (await projectRepository.list())[0];
  if (!project) {
    throw new Error('Expected demo project to exist');
  }
  return project;
}

export async function getDemoShot(projectId: string) {
  const shots = await shotRepository.list(projectId, false);
  for (const shot of shots) {
    const locked = await lockRepository.isLocked('shot', shot.id);
    if (!locked) {
      return shot;
    }
  }

  if (shots[0]) {
    return shots[0];
  }

  throw new Error('Expected demo shot to exist');
}
