import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

function stripInlineComment(value) {
  let inSingle = false;
  let inDouble = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === '#' && !inSingle && !inDouble) {
      return value.slice(0, index).trimEnd();
    }
  }

  return value.trimEnd();
}

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const source = readFileSync(filePath, 'utf8');
  const env = {};

  for (const rawLine of source.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const delimiterIndex = rawLine.indexOf('=');
    if (delimiterIndex <= 0) {
      continue;
    }

    const key = rawLine.slice(0, delimiterIndex).trim();
    let value = rawLine.slice(delimiterIndex + 1).trim();
    value = stripInlineComment(value);

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env[key] = value;
  }

  return env;
}

function loadRootEnv() {
  const envFiles = ['.env.local', '.env'];

  for (const relativePath of envFiles) {
    const filePath = resolve(repoRoot, relativePath);
    const parsed = parseEnvFile(filePath);

    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] == null || process.env[key] === '') {
        process.env[key] = value;
      }
    }
  }
}

const [, , ...commandArgs] = process.argv;

if (commandArgs.length === 0) {
  console.error('Usage: node scripts/run-with-root-env.mjs <command> [...args]');
  process.exit(1);
}

loadRootEnv();

const child = spawn(commandArgs[0], commandArgs.slice(1), {
  cwd: repoRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

