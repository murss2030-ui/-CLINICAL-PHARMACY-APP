#!/usr/bin/env node
// Fails if anything shipped to the browser (client source, public assets or
// the built bundle) contains an API key, a provider key assignment, another
// obvious secret, or a direct call to an AI provider API — and if the value of
// any real server secret (from .env or the environment) appears in ANY file
// that could be published: the git tree (everything not gitignored) and the
// build output.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CLIENT_DIRS = ['client', 'shared', 'dist/client', 'android/app/src/main/assets'];
const TEXT = /\.(ts|tsx|js|mjs|jsx|json|html|css|svg|webmanifest|txt|map)$/i;
const SECRET_ENV = /(_API_KEY|_ACCESS_TOKEN|_SECRET)$/;

export const SECRET_PATTERNS = [
  { name: 'Google API key', re: /AIza[0-9A-Za-z_-]{30,}/ },
  { name: 'Google auth key (AQ.)', re: /\bAQ\.[0-9A-Za-z_-]{30,}/ },
  { name: 'GEMINI_API_KEY assignment', re: /GEMINI_API_KEY\s*[=:]\s*["'`]?[A-Za-z0-9_-]{8,}/ },
  { name: 'DeepSeek/Kimi key assignment', re: /(DEEPSEEK|KIMI|MOONSHOT)_API_KEY\s*[=:]\s*["'`]?[A-Za-z0-9_-]{8,}/ },
  { name: 'AI provider key in VITE variable', re: /VITE_[A-Z_]*(GEMINI|DEEPSEEK|KIMI|MOONSHOT)[A-Z_]*KEY/ },
  { name: 'Direct Gemini API call from client', re: /generativelanguage\.googleapis\.com/ },
  { name: 'Direct AI provider call from client', re: /api\.deepseek\.com|api\.moonshot\.(ai|cn)|aiplatform\.googleapis\.com/ },
  { name: 'Private key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'OpenAI-style key', re: /\bsk-[A-Za-z0-9]{32,}/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36}\b/ },
  { name: 'AWS access key', re: /\bAKIA[0-9A-Z]{16}\b/ },
];

function* walk(dir, textOnly = true) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full, textOnly);
    else if ((!textOnly || TEXT.test(name)) && st.size < 8_000_000) yield full;
  }
}

const realSecret = (v) => typeof v === 'string' && v.length >= 12 && !/^(proxy|placeholder|changeme|your[-_]|<)/i.test(v) && !/x{6,}/i.test(v);

export function scanForSecrets(root = ROOT, extraValues = []) {
  const hits = [];
  const values = extraValues.filter(realSecret);
  for (const d of CLIENT_DIRS) {
    for (const file of walk(join(root, d))) {
      const text = readFileSync(file, 'utf8');
      for (const p of SECRET_PATTERNS) if (p.re.test(text)) hits.push(`${relative(root, file)}: ${p.name}`);
      for (const v of values) if (text.includes(v)) hits.push(`${relative(root, file)}: contains a server secret value`);
    }
  }
  return hits;
}

/** Secret values from a dotenv file (KEY=value lines whose name looks like a secret). */
export function secretValuesFromEnvFile(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([^"'\s#]+)/))
    .filter((m) => m && SECRET_ENV.test(m[1]))
    .map((m) => m[2])
    .filter(realSecret);
}

/** Files that could be published: the git tree minus ignored files (or a full walk without git), plus build output. */
function publishableFiles(root) {
  const git = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root, encoding: 'utf8' });
  const tree =
    git.status === 0
      ? git.stdout.split('\0').filter(Boolean).map((f) => join(root, f))
      : [...walk(root, false)].filter((f) => !/(^|[\\/])\.env$/.test(f));
  return [...new Set([...tree, ...walk(join(root, 'dist'), false)])].filter((f) => existsSync(f) && statSync(f).isFile() && statSync(f).size < 20_000_000);
}

/** Every publishable file that contains one of the given secret values. Never prints the value. */
export function scanTreeForValues(root = ROOT, values = []) {
  const real = values.filter(realSecret);
  if (!real.length) return [];
  const hits = [];
  for (const file of publishableFiles(root)) {
    const content = readFileSync(file);
    if (real.some((v) => content.includes(v))) hits.push(`${relative(root, file)}: contains a server secret value`);
  }
  return hits;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Real secrets present in this environment (or the local .env) must never reach a publishable file.
  const fromEnv = Object.entries(process.env).filter(([k]) => SECRET_ENV.test(k)).map(([, v]) => v);
  const values = [...new Set([...secretValuesFromEnvFile(join(ROOT, '.env')), ...fromEnv].filter(realSecret))];
  const hits = [...new Set([...scanForSecrets(ROOT, values), ...scanTreeForValues(ROOT, values)])];
  if (hits.length) {
    console.error(`✗ Possible secrets or forbidden client-side AI calls (${hits.length}):\n${hits.join('\n')}`);
    process.exit(1);
  }
  console.log(
    `✓ No API keys or secrets in client source, public assets or built bundle${existsSync(join(ROOT, 'dist/client')) ? '' : ' (dist not built yet)'}; ` +
      `${values.length} server secret value(s) checked against every publishable file.`,
  );
}
