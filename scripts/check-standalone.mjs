#!/usr/bin/env node
// Fails if any source, configuration or dependency references Base44.
// Documentation may state that the project is independent of it; code may not.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'coverage', 'test-results', 'build', '.gradle', 'data']);
const SCAN_EXT = /\.(ts|tsx|js|mjs|cjs|jsx|json|html|css|xml|gradle|kts|properties|java|kt|yml|yaml|env|example)$/i;
const PATTERNS = [/base44/i, /base44\.app/i, /@base44\//i, /base44[-_ ]?sdk/i, /base44[-_ ]?(api|runtime|client)/i];
// Files allowed to contain the word because they implement or test this check.
const ALLOW = new Set([SELF, join(ROOT, 'tests', 'security.test.ts')]);

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (SCAN_EXT.test(name) || name === '.env.example' || name === 'Dockerfile') yield full;
  }
}

export function scanForBase44(root = ROOT) {
  const hits = [];
  for (const file of walk(root)) {
    if (ALLOW.has(file) || file.endsWith(`${sep}README.md`)) continue;
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      if (PATTERNS.some((p) => p.test(line))) hits.push(`${relative(root, file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  // Dependencies: nothing installed or declared may come from Base44.
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  for (const dep of Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })) if (/base44/i.test(dep)) hits.push(`package.json dependency: ${dep}`);
  try {
    for (const name of readdirSync(join(root, 'node_modules'))) if (/base44/i.test(name)) hits.push(`node_modules/${name}`);
  } catch {
    // node_modules not installed
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const hits = scanForBase44();
  if (hits.length) {
    console.error(`✗ Base44 references found (${hits.length}):\n${hits.join('\n')}`);
    process.exit(1);
  }
  console.log('✓ No Base44 references in source, configuration or dependencies.');
}
