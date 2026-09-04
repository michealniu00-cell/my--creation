import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import path from 'node:path';

function resolveWorkspaceRoot(start = process.cwd()): string {
  let current = start;
  while (true) {
    if (existsSync(path.join(current, 'pnpm-workspace.yaml'))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return start;
    }
    current = parent;
  }
}

function dataRoot() {
  if (process.env.VIDEO_AGENT_STUDIO_DB_FILE) {
    return path.dirname(process.env.VIDEO_AGENT_STUDIO_DB_FILE);
  }
  return path.join(resolveWorkspaceRoot(), '.data');
}

function keyFilePath() {
  return path.join(dataRoot(), '.provider-secret.key');
}

async function loadKeyMaterial() {
  const envKey = process.env.VIDEO_AGENT_STUDIO_SECRET_KEY;
  if (envKey) {
    return createHash('sha256').update(envKey).digest();
  }

  const file = keyFilePath();
  if (existsSync(file)) {
    const content = await readFile(file, 'utf8');
    return Buffer.from(content.trim(), 'base64');
  }

  const generated = randomBytes(32);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, generated.toString('base64'), 'utf8');
  return generated;
}

export async function encryptSecret(value: string) {
  const key = await loadKeyMaterial();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

export async function decryptSecret(ciphertext?: string | null) {
  if (!ciphertext) {
    return null;
  }

  const buffer = Buffer.from(ciphertext, 'base64');
  const iv = buffer.subarray(0, 12);
  const tag = buffer.subarray(12, 28);
  const encrypted = buffer.subarray(28);
  const key = await loadKeyMaterial();
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
}

export function maskSecret(value?: string | null) {
  if (!value) {
    return null;
  }
  const suffix = value.slice(-4);
  return `••••${suffix}`;
}
