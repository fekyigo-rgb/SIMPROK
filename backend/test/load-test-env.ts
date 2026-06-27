import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const ENV_TEST_PATH = resolve(__dirname, '..', '.env.test');

function parseEnvLine(line: string): [string, string] | undefined {
  const trimmed = line.trim();

  if (!trimmed || trimmed.startsWith('#')) {
    return undefined;
  }

  const separatorIndex = trimmed.indexOf('=');

  if (separatorIndex === -1) {
    return undefined;
  }

  const key = trimmed.slice(0, separatorIndex).trim();
  let value = trimmed.slice(separatorIndex + 1).trim();

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return [key, value];
}

export function loadTestEnv(): void {
  const contents = readFileSync(ENV_TEST_PATH, 'utf8');

  for (const line of contents.split(/\r?\n/)) {
    const entry = parseEnvLine(line);

    if (!entry) {
      continue;
    }

    const [key, value] = entry;
    process.env[key] = value;
  }
}

loadTestEnv();
