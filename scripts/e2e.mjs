#!/usr/bin/env node
// End-to-end test of the required MVP workflow against the production build.
//   npm run build && npm run test:e2e
// Optional live Gemini pass (uses the server's GEMINI_API_KEY):
//   E2E_REAL_GEMINI=1 GEMINI_API_KEY=... npm run test:e2e
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SHOTS = join(ROOT, 'test-results', 'e2e');
const REAL = process.env.E2E_REAL_GEMINI === '1';
mkdirSync(SHOTS, { recursive: true });
if (!existsSync(join(ROOT, 'dist/server/index.js'))) {
  console.error('Build first: npm run build');
  process.exit(1);
}

const results = [];
const servers = [];
let failed = false;
let currentPage;
const pageErrors = [];

async function step(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    results.push({ name, ok: true, ms: Date.now() - t, note });
    console.log(`  ✓ ${name}${note ? ` — ${note}` : ''} (${Date.now() - t} ms)`);
  } catch (err) {
    failed = true;
    results.push({ name, ok: false, ms: Date.now() - t, note: err.message });
    await currentPage?.screenshot({ path: join(SHOTS, 'failure.png'), fullPage: true }).catch(() => undefined);
    if (pageErrors.length) console.log(`      page errors: ${pageErrors.join(' | ').slice(0, 2000)}`);
    console.log(`  ✗ ${name}\n      ${String(err.message).split('\n').slice(0, 6).join('\n      ')}`);
    throw err;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function startServer(port, env) {
  const dir = mkdtempSync(join(tmpdir(), 'preceptor-e2e-'));
  const child = spawn(process.execPath, ['dist/server/index.js'], {
    cwd: ROOT,
    env: { ...process.env, NODE_ENV: 'production', PORT: String(port), DATABASE_PATH: join(dir, 'audit.sqlite'), AI_RATE_LIMIT_PER_MINUTE: '600', ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  servers.push(child);
  let log = '';
  child.stdout.on('data', (d) => (log += d));
  child.stderr.on('data', (d) => (log += d));
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`http://localhost:${port}/api/health`)).ok) return { base: `http://localhost:${port}`, log: () => log };
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Server on ${port} did not start:\n${log}`);
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });

/** Waits until `fn` returns truthy (polling), for conditions Playwright locators cannot express directly. */
async function until(fn, timeout = 20_000, what = 'condition') {
  const end = Date.now() + timeout;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function think(page, answer) {
  const box = page.getByPlaceholder(/Write your reasoning/);
  await box.fill(answer);
  await page.getByRole('button', { name: 'Commit my answer' }).click();
  await page.getByText('Your answer', { exact: true }).first().waitFor();
}

async function next(page, label) {
  await page.getByRole('button', { name: `Next: ${label}` }).click();
  await page.getByRole('heading', { level: 2 }).first().waitFor();
}

async function run() {
  console.log('\nPRECEPTOR end-to-end workflow\n');
  // No provider keys at all, even if a local .env has some (empty values are not overridden by .env).
  const A = await startServer(8791, { GEMINI_API_KEY: '', DEEPSEEK_API_KEY: '', KIMI_API_KEY: '', MOONSHOT_API_KEY: '', OPENAI_API_KEY: '', ANTHROPIC_API_KEY: '' });
  // Fake microphone so the voice-note path (MediaRecorder → WAV → transcription) runs headless.
  const launchArgs = ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  const browser = await chromium.launch({ args: launchArgs, ...(process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, permissions: ['microphone'] });
  const requests = [];
  context.on('request', (r) => requests.push(r.url()));
  // Network failures are expected in the failure/offline tests; anything else logged as an error is a bug.
  context.on('console', (m) => m.type() === 'error' && !m.text().startsWith('Failed to load resource') && pageErrors.push(`console: ${m.text()}`));
  let page = await context.newPage();
  currentPage = page;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  let caseUrl = '';
  let completenessBefore = '';

  await step('1–3 · Create synthetic patient & case with synthetic chart images', async () => {
    await page.goto(A.base);
    await page.getByRole('button', { name: 'I understand' }).click();
    await page.getByText('LOAD DEMO CASE →').first().click();
    await page.waitForURL(/\/cases\//, { timeout: 30_000 });
    caseUrl = page.url().split('?')[0];
    await until(async () => (await page.getByTestId('source-card').count()) === 3, 20_000, '3 sources');
    await shot(page, '01-collect');
    return `${await page.locator('h1').first().textContent()} with 3 synthetic documents (4 page images)`;
  });

  await step('4 · Run extraction (quality → vision → structured extraction)', async () => {
    for (let i = 0; i < 3; i++) {
      const card = page.getByTestId('source-card').nth(i);
      await card.getByRole('button', { name: 'Analyse with AI' }).click();
      await card.getByText('Extracted', { exact: true }).waitFor({ timeout: 60_000 });
    }
    const n = await page.getByTestId('verify-item').count();
    assert(n > 20, `expected many extracted items, got ${n}`);
    return `${n} items in the verification queue`;
  });

  await step('5 · Display confidence, handwriting, duplicates and conflicts', async () => {
    // innerText reflects CSS text-transform (badges are uppercase), so match case-insensitively.
    const text = await page.locator('section[aria-labelledby="verify-title"]').innerText();
    assert(/\d+% · LIKELY/i.test(text), 'missing LIKELY confidence badges');
    assert(/\d+% · POSSIBLE/i.test(text), 'missing POSSIBLE confidence badges');
    assert(/handwriting/i.test(text), 'handwriting flag not shown');
    assert(/Conflict detected/i.test(text) && /Warfarin/.test(text), 'warfarin conflict not shown');
    assert(/Possible reading:/i.test(text), 'possible reading not shown');
    await shot(page, '02-verification');
    return 'LIKELY / POSSIBLE bands, handwriting, duplicate and CONFLICT DETECTED displayed';
  });

  await step('6 · Verify extracted data (bulk high-confidence, conflicts, review items)', async () => {
    await page.getByRole('button', { name: /Verify all high-confidence/ }).click();
    await until(async () => (await page.getByRole('button', { name: /Verify all high-confidence/ }).count()) === 0, 30_000, 'bulk verification');
    const dup = page.getByRole('button', { name: /Discard duplicates/ });
    if (await dup.count()) await dup.click();
    for (let i = 0; i < 120; i++) {
      const items = page.getByTestId('verify-item');
      if ((await items.count()) === 0) break;
      const first = items.first();
      const save = first.getByRole('button', { name: 'Save & verify' });
      const discard = first.getByRole('button', { name: 'Discard duplicate' });
      if (await save.count()) await save.click();
      else if (await discard.count()) await discard.click();
      else await first.getByRole('button', { name: /^Verify/ }).first().click();
      await page.waitForTimeout(120);
    }
    await page.getByText('All extracted data has been reviewed').waitFor();
    const check = await page.getByText('Data check before assessment').locator('..').innerText();
    assert(/known/.test(check), 'data check not updated');
    return 'queue empty; data check updated';
  });

  await step('Voice note · record → WAV → transcription → "What I heard"', async () => {
    await page.getByRole('button', { name: 'Voice', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Start recording' }).click();
    await page.waitForTimeout(1500);
    await dialog.getByRole('button', { name: /Stop/ }).click();
    await dialog.locator('audio').waitFor({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Transcribe with AI' }).click();
    const heard = dialog.getByLabel(/WHAT I HEARD/);
    await heard.waitFor({ timeout: 30_000 });
    assert((await heard.inputValue()).length > 20, 'empty transcript');
    await dialog.getByRole('button', { name: 'Save transcript only' }).click();
    await until(async () => (await page.getByTestId('source-card').count()) === 4, 10_000, 'voice source saved');
    return 'recorded with the fake microphone, converted to WAV, transcript shown before saving';
  });

  await step('7 · Generate timeline (Understand)', async () => {
    await next(page, 'Understand');
    await page.getByText('Clinical snapshot').waitFor();
    await page.getByRole('button', { name: 'Build with AI' }).click();
    await page.getByText('Admitted to Internal Medicine').waitFor({ timeout: 30_000 });
    await think(page, 'Pneumonia with confusion, AKI on CKD, and a supratherapeutic INR on warfarin. AKI and bleeding risk first.');
    await page.getByRole('button', { name: 'Get preceptor feedback' }).click();
    await page.getByText('Preceptor feedback').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.getByText('Suggested problems').waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Accept', exact: true }).first().click();
    await shot(page, '03-understand');
    return 'timeline, think-first feedback, accepted AI problem';
  });

  await step('8 · Open pharmacotherapy workup (Assess)', async () => {
    await next(page, 'Assess');
    await page.getByText('Safety screen').waitFor();
    const safety = await page.getByText('Safety screen').locator('../../..').innerText();
    assert(/anticoagulant|INR|Renal dose review/i.test(safety), 'expected safety alerts');
    await page.getByRole('tab', { name: 'Pharmacotherapy workup' }).click();
    await page.getByText('1. Patient information').waitFor();
    await page.getByText('12. Drug-related problems').waitFor();
    await shot(page, '04-workup');
    return 'safety alerts + 19-section workup';
  });

  await step('9 · Generate potential DRPs (never auto-confirmed)', async () => {
    await page.getByRole('tab', { name: /Drug-related problems/ }).click();
    await think(page, 'Duplicate anticoagulation (warfarin + enoxaparin) with INR 4.2, and metformin in AKI.');
    await page.getByRole('button', { name: 'Run DRP analysis' }).click();
    await until(async () => (await page.getByTestId('ai-drp').count()) >= 4, 30_000, 'AI DRPs');
    const statuses = await page.getByTestId('ai-drp').allInnerTexts();
    assert(!statuses.some((s) => /\bConfirmed\b/.test(s)), 'AI DRP shown as confirmed');
    await page.getByRole('button', { name: 'Accept for assessment' }).first().click();
    await page.getByRole('button', { name: 'Accept for assessment' }).first().click();
    await until(async () => (await page.getByTestId('drp-card').count()) === 2, 10_000, '2 DRP cards');
    return `${statuses.length} potential DRPs, 2 accepted for assessment`;
  });

  await step('10 · Review clinical discussion, confirm DRP, argue with me', async () => {
    const card = page.getByTestId('drp-card').first();
    await card.getByRole('button', { name: 'Clinical discussion' }).click();
    await card.getByText('6 · Recommendation draft').waitFor({ timeout: 30_000 });
    await card.getByLabel('DRP status').selectOption('confirmed');
    await card.getByLabel(/I checked this against/).check();
    await card.getByRole('button', { name: 'Confirm DRP' }).click();
    await card.getByText('Confirmed', { exact: true }).first().waitFor();
    await card.getByRole('button', { name: 'Argue with me' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Your answer').fill('I recommend stopping enoxaparin.');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await dialog.getByText(/patient-specific evidence|clinical problem/i).first().waitFor({ timeout: 30_000 });
    await shot(page, '05-argue');
    await page.keyboard.press('Escape');
    await shot(page, '05-discussion');
    return 'discussion with 9 sections; DRP confirmed by trainee; Socratic challenge received';
  });

  await step('Act · Plan intervention and generate communication', async () => {
    await page.getByTestId('drp-card').first().getByRole('button', { name: 'Plan intervention' }).click();
    await page.getByRole('button', { name: 'Use & edit' }).click();
    await page.getByRole('button', { name: 'Save intervention' }).click();
    await page.getByLabel('Intervention status').first().selectOption('accepted');
    await page.getByRole('button', { name: 'Communicate' }).first().click();
    await page.getByRole('dialog').getByText(/Recommendation:/).waitFor();
    await page.keyboard.press('Escape');
    return 'intervention linked to DRP, status accepted, physician note generated';
  });

  await step('11 · Generate monitoring', async () => {
    await next(page, 'Monitor');
    await page.getByText(/1\.8 → /).first().waitFor();
    await think(page, 'INR daily, creatinine and potassium daily, glucose QID, bleeding signs.');
    await page.getByRole('button', { name: 'Draft monitoring plan' }).click();
    await page.getByRole('button', { name: 'Accept', exact: true }).first().click({ timeout: 30_000 });
    // Edit a suggestion before accepting it (Accept / Edit / Dismiss).
    await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
    await page.getByLabel('Parameter').fill('Serum creatinine (edited by trainee)');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('cell', { name: /Serum creatinine \(edited by trainee\)/ }).first().waitFor();
    await page.getByRole('button', { name: 'Dismiss' }).first().click();
    await until(async () => (await page.locator('table tbody tr').count()) >= 2, 10_000, 'monitoring rows');
    await shot(page, '06-monitor');
    return 'lab trend chart; suggestions accepted, edited-then-accepted and dismissed';
  });

  await step('12 · Create follow-up (with linked task)', async () => {
    await next(page, 'Follow up');
    await think(page, 'Tomorrow morning: INR, creatinine, potassium. Failure if INR still > 3 or creatinine rising.');
    await page.getByRole('button', { name: 'Draft follow-up plan' }).click();
    await page.getByRole('button', { name: 'Accept & schedule' }).first().click({ timeout: 30_000 });
    await page.getByTestId('followup').first().waitFor();
    await page.getByTestId('followup').first().getByLabel('Follow-up status').selectOption('improved');
    await page.getByTestId('followup').first().getByLabel('Follow-up outcome').fill('Enoxaparin stopped; INR 3.1 next day');
    await page.getByTestId('followup').first().getByLabel('Follow-up outcome').blur();
    return 'follow-up scheduled, task created, outcome recorded';
  });

  await step('13 · Add reflection', async () => {
    await next(page, 'Reflect');
    await page.getByRole('textbox', { name: 'What did I learn?' }).fill('Always check every anticoagulant order against the INR.');
    await page.getByRole('textbox', { name: 'What should I study next?' }).fill('Renal dosing of LMWH');
    await page.getByRole('button', { name: 'Save reflection' }).click();
    await page.getByText('Reflection saved to your portfolio.').waitFor();
    completenessBefore = (await page.getByText(/^CASE COMPLETENESS: \d+%$/).textContent()) ?? '';
    return completenessBefore;
  });

  await step('14 · Generate presentation (+ head-of-department defence)', async () => {
    await page.getByRole('button', { name: 'Generate with AI' }).click();
    await page.getByText('Slide 1', { exact: true }).waitFor({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Build from case data (offline)' }).click();
    await page.getByText('Built from case data').waitFor();
    await page.getByRole('button', { name: 'Defend it' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Your answer').fill('78-year-old with CAP and AKI; duplicate anticoagulation with INR 4.2; I recommended stopping enoxaparin.');
    await dialog.getByRole('button', { name: 'Send' }).click();
    await dialog.getByText(/Why is this a drug-related problem/).waitFor({ timeout: 30_000 });
    await page.keyboard.press('Escape');
    await shot(page, '07-reflect');
    return 'AI + offline presentations; defence question received';
  });

  await step('15–16 · Close and reopen case; data persists', async () => {
    await page.close();
    page = await context.newPage();
    currentPage = page;
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.goto(`${A.base}/cases`);
    await page.getByText('CASE-0001').first().click();
    await page.waitForURL(/\/cases\//);
    await page.goto(`${caseUrl}?stage=assess`);
    await until(async () => (await page.getByTestId('drp-card').count()) === 2, 15_000, 'persisted DRPs');
    await page.goto(`${caseUrl}?stage=reflect`);
    const after = (await page.getByText(/^CASE COMPLETENESS: \d+%$/).textContent()) ?? '';
    assert(after === completenessBefore, `completeness changed: ${completenessBefore} → ${after}`);
    await page.getByText(/Reflection ·/).first().waitFor();
    await page.goto(`${A.base}/tasks`);
    // The follow-up was completed in step 12, which also completes its linked task.
    await page.getByRole('tab', { name: 'Done' }).click();
    await page.getByText(/Follow up:/).first().waitFor();
    return `${after}; DRPs, reflection and follow-up task present after reopening`;
  });

  await step('17–18 · AI failure (no provider key) → case safe → continue manually', async () => {
    await page.goto(`${A.base}/cases/new`);
    await page.getByLabel('Age (years)').fill('60');
    await page.getByRole('button', { name: 'Create case' }).click();
    await page.waitForURL(/stage=collect/);
    await page.getByRole('button', { name: 'Text', exact: true }).click();
    await page.getByRole('dialog').getByLabel('Text').fill('Fictional note: amlodipine 5 mg daily, creatinine 1.0 mg/dL.');
    await page.getByRole('button', { name: 'Save & extract with AI' }).click();
    await page.getByText('GEMINI API KEY NOT CONFIGURED').waitFor({ timeout: 30_000 });
    await page.getByText('Your case data is safe.').waitFor();
    await shot(page, '08-gemini-failure');
    await page.getByRole('button', { name: 'Continue manually' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Drug name').fill('Amlodipine');
    await dialog.getByLabel('Dose').fill('5');
    await dialog.getByLabel('Unit').fill('mg');
    await dialog.getByRole('button', { name: 'Add to case' }).click();
    await dialog.getByText('Saved to case (medication).').waitFor();
    await dialog.getByRole('button', { name: 'Done' }).click();
    assert((await page.getByTestId('source-card').count()) === 1, 'source lost after AI failure');
    return 'clear error, case and source intact, manual entry saved';
  });

  await step('19 · Offline editing (and offline reload from the service worker)', async () => {
    const offlineCase = page.url().split('?')[0];
    await context.setOffline(true);
    await page.getByRole('button', { name: 'Manual', exact: true }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('tab', { name: 'Lab' }).click();
    await dialog.getByLabel('Test').fill('Potassium');
    await dialog.getByLabel('Result').fill('4.1');
    await dialog.getByRole('button', { name: 'Add to case' }).click();
    await dialog.getByText('Saved to case (lab).').waitFor();
    await dialog.getByRole('button', { name: 'Done' }).click();
    await page.goto(`${offlineCase}?stage=understand`);
    await page.getByText('Clinical snapshot').waitFor({ timeout: 15_000 });
    const snap = await page.getByText('Clinical snapshot').locator('../../..').innerText();
    assert(/Amlodipine/.test(snap), 'offline: medication missing after reload');
    await page.getByRole('button', { name: 'Build with AI' }).click();
    await page.getByText('AI SERVICE UNAVAILABLE').first().waitFor();
    await shot(page, '09-offline');
    await context.setOffline(false);
    return 'edited and reloaded offline; AI shows AI SERVICE UNAVAILABLE';
  });

  await step('20 · Standalone — platform-dependency scan', async () => {
    const r = spawnSync(process.execPath, ['scripts/check-standalone.mjs'], { cwd: ROOT, encoding: 'utf8' });
    assert(r.status === 0, r.stderr || r.stdout);
    return r.stdout.trim();
  });

  await step('21 · No client-side API key; browser only talks to /api', async () => {
    const r = spawnSync(process.execPath, ['scripts/check-secrets.mjs'], { cwd: ROOT, encoding: 'utf8' });
    assert(r.status === 0, r.stderr || r.stdout);
    const direct = requests.filter((u) => /googleapis\.com|gemini|deepseek|moonshot|kimi|openai|anthropic/i.test(new URL(u).host));
    assert(direct.length === 0, `browser contacted an AI provider directly: ${direct[0]}`);
    const scripts = [...new Set(requests.filter((u) => u.endsWith('.js')))];
    for (const s of scripts) {
      const body = await (await fetch(s)).text();
      assert(!/AIza[0-9A-Za-z_-]{30,}|\bAQ\.[0-9A-Za-z_-]{30,}|\bsk-[A-Za-z0-9]{32,}|\bsk-(proj|ant)-[A-Za-z0-9_-]{20,}/.test(body), `key pattern in ${s}`);
      assert(!/generativelanguage\.googleapis\.com|aiplatform\.googleapis\.com|api\.deepseek\.com|api\.moonshot\.|api\.openai\.com|api\.anthropic\.com/.test(body), `provider host in ${s}`);
    }
    const ai = requests.filter((u) => u.includes('/api/ai/'));
    assert(ai.length > 10, 'expected AI calls through the backend');
    return `${ai.length} AI calls, all via /api/ai; ${scripts.length} bundles clean`;
  });

  if (REAL) {
    const B = await startServer(8792, {});
    await step('Live Gemini · photo of a synthetic lab report → extraction with confidence', async () => {
      const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const p = await ctx2.newPage();
      const render = await ctx2.newPage();
      await render.setViewportSize({ width: 900, height: 1100 });
      await render.setContent(`<html><body style="font:22px serif;padding:40px;background:#fff">
        <p style="color:#b91c1c;font:bold 16px sans-serif">SYNTHETIC TEST DOCUMENT — FICTIONAL PATIENT</p>
        <h2>LABORATORY REPORT</h2><p>Collected: 2026-03-10 08:40</p>
        <table border="1" cellpadding="8" style="border-collapse:collapse;font-size:22px">
        <tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th></tr>
        <tr><td>Creatinine</td><td>1.8</td><td>mg/dL</td><td>0.5-1.1</td></tr>
        <tr><td>Potassium</td><td>5.4</td><td>mmol/L</td><td>3.5-5.1</td></tr>
        <tr><td>Sodium</td><td>133</td><td>mmol/L</td><td>135-145</td></tr>
        <tr><td>INR</td><td>4.2</td><td></td><td>0.8-1.2</td></tr>
        <tr><td>Hemoglobin</td><td>11.2</td><td>g/dL</td><td>12.0-15.5</td></tr></table></body></html>`);
      const file = join(SHOTS, 'synthetic-lab-report.png');
      writeFileSync(file, await render.screenshot({ fullPage: true }));
      await render.close();
      await p.goto(`${B.base}/cases/new`);
      await p.getByRole('button', { name: 'Create case' }).click();
      await p.waitForURL(/stage=collect/);
      await p.getByLabel('Document type').first().selectOption('lab_report');
      await p.getByTestId('gallery-input').setInputFiles(file);
      await p.getByText('Ready for analysis').waitFor({ timeout: 20_000 });
      await p.getByRole('button', { name: 'Save & analyse with AI' }).click();
      const done = p.getByText('Extracted', { exact: true });
      const err = p.getByRole('alert');
      await Promise.race([done.waitFor({ timeout: 240_000 }), err.waitFor({ timeout: 240_000 })]);
      if (await err.count()) {
        const msg = await err.first().innerText();
        await shot(p, '10-live-gemini');
        await ctx2.close();
        if (/QUOTA|UNAVAILABLE/.test(msg)) return `Gemini returned a handled error (${msg.split('\n')[0]}) — error path verified`;
        throw new Error(msg);
      }
      const q = await p.locator('section[aria-labelledby="verify-title"]').innerText();
      assert(/Creatinine/i.test(q) && /\d+% · (LIKELY|POSSIBLE|UNCERTAIN)/i.test(q), 'live extraction missing creatinine with confidence');
      await shot(p, '10-live-gemini');
      await ctx2.close();
      return `${(q.match(/% ·/g) ?? []).length} values extracted by ${process.env.GEMINI_MODEL ?? 'configured model'} with confidence`;
    });
  }

  assert(pageErrors.length === 0, `uncaught page errors: ${pageErrors.join(' | ')}`);
  await browser.close();
}

try {
  await run();
} catch {
  // reported by step()
} finally {
  servers.forEach((s) => s.kill());
  const ok = results.filter((r) => r.ok).length;
  console.log(`\n${ok}/${results.length} steps passed${failed ? ' — FAILED' : ''}. Screenshots: ${SHOTS}\n`);
  writeFileSync(join(SHOTS, 'results.json'), JSON.stringify(results, null, 2));
  process.exit(failed ? 1 : 0);
}
