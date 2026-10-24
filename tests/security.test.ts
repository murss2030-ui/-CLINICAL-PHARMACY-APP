import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanForSecrets, scanTreeForValues, secretValuesFromEnvFile } from '../scripts/check-secrets.mjs';
import { scanForBase44 } from '../scripts/check-standalone.mjs';

const ROOT = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe('platform independence', () => {
  it('has zero Base44 references in code, config or dependencies', () => {
    expect(scanForBase44(ROOT)).toEqual([]);
  });
  it('detects a planted Base44 dependency', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { '@base44/sdk': '1.0.0' } }));
    writeFileSync(join(dir, 'app.ts'), "import { createClient } from '@base44/sdk';");
    expect(scanForBase44(dir).length).toBeGreaterThanOrEqual(2);
  });
});

describe('API key protection', () => {
  it('finds no secrets in client source, public assets or built bundle', () => {
    expect(scanForSecrets(ROOT)).toEqual([]);
  });
  it('detects a planted key, key assignment and direct Gemini call in client code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-'));
    mkdirSync(join(dir, 'client'));
    writeFileSync(join(dir, 'client', 'a.ts'), `const k = "AIza${'x'.repeat(35)}";`);
    writeFileSync(join(dir, 'client', 'b.ts'), 'GEMINI_API_KEY=abcdefghijklmnop');
    writeFileSync(join(dir, 'client', 'c.ts'), "fetch('https://generativelanguage.googleapis.com/v1beta/models')");
    expect(scanForSecrets(dir)).toHaveLength(3);
  });
  it('detects DeepSeek/Kimi keys, new-format Google keys and direct provider calls in client code', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-'));
    mkdirSync(join(dir, 'client'));
    writeFileSync(join(dir, 'client', 'a.ts'), 'DEEPSEEK_API_KEY=abcdefghijklmnop');
    writeFileSync(join(dir, 'client', 'b.ts'), `const k = "AQ.${'A'.repeat(40)}";`);
    writeFileSync(join(dir, 'client', 'c.ts'), "fetch('https://api.moonshot.ai/v1/chat/completions')");
    writeFileSync(join(dir, 'client', 'd.ts'), 'import.meta.env.VITE_KIMI_API_KEY');
    expect(scanForSecrets(dir).map((h) => h.split(': ')[1])).toEqual([
      'DeepSeek/Kimi key assignment',
      'Google auth key (AQ.)',
      'Direct AI provider call from client',
      'AI provider key in VITE variable',
    ]);
  });
  it('detects the real key value if it ever reaches the bundle', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-'));
    mkdirSync(join(dir, 'dist', 'client'), { recursive: true });
    writeFileSync(join(dir, 'dist', 'client', 'app.js'), 'var k="my-real-server-key-value";');
    expect(scanForSecrets(dir, ['my-real-server-key-value'])).toHaveLength(1);
  });
  it('finds a real secret from .env in any publishable file, while .env itself stays ignored', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pc-'));
    const secret = 'sk-planted0000000000000000000000000000';
    writeFileSync(join(dir, '.env'), `# local\nDEEPSEEK_API_KEY=${secret}\nPORT=8787\nGEMINI_API_KEY=your-key-here\n`);
    writeFileSync(join(dir, '.gitignore'), '.env\n');
    writeFileSync(join(dir, 'README.md'), `example: ${secret}`);
    writeFileSync(join(dir, 'safe.md'), 'no secrets here');
    spawnSync('git', ['init', '-q'], { cwd: dir });
    expect(secretValuesFromEnvFile(join(dir, '.env'))).toEqual([secret]);
    expect(scanTreeForValues(dir, [secret])).toEqual(['README.md: contains a server secret value']);
  });
  it('no real server secret from the local .env appears in any publishable file', () => {
    expect(scanTreeForValues(ROOT, secretValuesFromEnvFile(join(ROOT, '.env')))).toEqual([]);
  });
  it.each(['GEMINI_API_KEY', 'DEEPSEEK_API_KEY', 'KIMI_API_KEY', 'MOONSHOT_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY'])('reads %s only in the server configuration module', (name) => {
    const reads = new RegExp(`\\benv\\.${name}|env\\[['"]${name}`);
    const readers = files(join(ROOT, 'server', 'src')).filter((f) => reads.test(readFileSync(f, 'utf8')));
    expect(readers.map((f) => f.replace(ROOT, ''))).toEqual([join('/server', 'src', 'config.ts')]);
    const clientRefs = files(join(ROOT, 'client', 'src')).filter((f) => /process\.env\.|import\.meta\.env\.[A-Z_]*(GEMINI|DEEPSEEK|KIMI|MOONSHOT|OPENAI|ANTHROPIC)/.test(readFileSync(f, 'utf8')));
    expect(clientRefs).toEqual([]);
  });
  it('the browser only ever calls the PRECEPTOR backend', () => {
    const api = readFileSync(join(ROOT, 'client', 'src', 'lib', 'api.ts'), 'utf8');
    expect(api).toMatch(/\/api\/ai\//);
    expect(api).not.toMatch(/googleapis|gemini\.google|deepseek\.com|moonshot\.(ai|cn)/);
  });
});
