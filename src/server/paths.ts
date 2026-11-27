import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export function repoRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(dir, 'package.json'))) {
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) {
      throw new Error('could not locate package.json (repository root)');
    }
    dir = parent;
  }
}

export function flowsRoot(): string {
  return join(repoRoot(), 'flows');
}

export function runStoreRoot(): string {
  return join(repoRoot(), '.runs');
}

export function statsRoot(): string {
  return join(repoRoot(), '.runs');
}
