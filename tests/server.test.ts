import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AIProvider } from '../server/src/ai/AIProvider';
import { AIError } from '../server/src/ai/errors';
import { AIRouter } from '../server/src/ai/router';
import { createApp } from '../server/src/app';
import { readConfig } from '../server/src/config';
import { MemoryAuditRepository } from '../server/src/db/memory';
import { describeAIError } from '@shared/ai';

const KEY = 'AIzaSyTESTKEY_must_never_leak_0123456789';
const ctx = { caseCode: 'CASE-0001', department: 'internal_medicine' };
const drpResult = { drps: [], medicationsReviewed: [] };

function fakeProvider(overrides: Partial<AIProvider> = {}): AIProvider {
  const notUsed = vi.fn(async () => {
    throw new Error('not used');
  });
  return {
    name: 'gemini',
    model: 'gemini-test',
    configured: true,
    capabilities: ['text', 'vision', 'audio'],
    probe: vi.fn(async () => undefined),
    analyzeImages: notUsed,
    extractPatientData: notUsed,
    extractMedications: notUsed,
    extractLabs: notUsed,
    transcribeAudio: notUsed,
    buildTimeline: notUsed,
    analyzeCase: notUsed,
    identifyPotentialDRPs: vi.fn(async () => ({ data: drpResult, warnings: [] })),
    generateClinicalDiscussion: notUsed,
    generateMonitoringPlan: notUsed,
    generateFollowUp: notUsed,
    structureRoundNote: notUsed,
    generatePresentation: notUsed,
    generateTeachingQuestions: notUsed,
    evaluateStudentReasoning: notUsed,
    continueDialogue: notUsed,
    generateTrainingCase: notUsed,
    generateLesson: notUsed,
    ...overrides,
  } as AIProvider;
}

const servers: Array<{ close: () => void }> = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function start(provider: AIProvider | AIProvider[], env: Record<string, string> = {}) {
  const config = { ...readConfig({ GEMINI_API_KEY: KEY, ...env }), clientDistDir: undefined };
  const audit = new MemoryAuditRepository();
  const router = new AIRouter(Array.isArray(provider) ? provider : [provider], { order: config.providerOrder });
  const app = createApp({ config, router, audit, log: () => undefined });
  const server = app.listen(0);
  servers.push(server);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, payload: unknown, headers: Record<string, string> = {}) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: typeof payload === 'string' ? payload : JSON.stringify(payload) });
  return { base, post, audit };
}

describe('API server', () => {
  it('reports health', async () => {
    const { base } = await start(fakeProvider());
    expect(await (await fetch(`${base}/api/health`)).json()).toMatchObject({ ok: true, database: 'memory' });
  });

  it('reports provider status without ever exposing the key', async () => {
    const { base } = await start(fakeProvider());
    const res = await fetch(`${base}/api/ai/status?probe=1`);
    const text = await res.text();
    expect(text).not.toContain(KEY);
    expect(JSON.parse(text)).toMatchObject({ configured: true, order: ['gemini'], providers: [{ name: 'gemini', label: 'Gemini', configured: true, model: 'gemini-test', reachable: true }] });
  });

  it('validates requests and returns student-safe errors', async () => {
    const { post } = await start(fakeProvider());
    const bad = await post('/api/ai/drp-analysis', { context: {} });
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ ok: false, error: { code: 'REQUEST_INVALID' } });
    const notJson = await post('/api/ai/drp-analysis', '{broken');
    expect(notJson.status).toBe(400);
    expect((await post('/api/ai/unknown', {})).status).toBe(404);
  });

  it('returns validated results in an envelope and caches identical requests', async () => {
    const provider = fakeProvider();
    const { post, audit } = await start(provider);
    const first = await (await post('/api/ai/drp-analysis', { context: ctx })).json();
    expect(first).toMatchObject({ ok: true, data: drpResult, meta: { provider: 'gemini', model: 'gemini-test', cached: false } });
    const second = await (await post('/api/ai/drp-analysis', { context: ctx })).json();
    expect(second.meta.cached).toBe(true);
    expect(provider.identifyPotentialDRPs).toHaveBeenCalledTimes(1);
    expect(audit.recent(5)[0]).toMatchObject({ action: 'drp-analysis', caseCode: 'CASE-0001', status: 'ok' });
    expect(JSON.stringify(audit.recent(5))).not.toContain('medication');
  });

  it.each([
    ['AI_QUOTA_EXCEEDED', 429, 'GEMINI QUOTA EXCEEDED'],
    ['AI_KEY_NOT_CONFIGURED', 503, 'GEMINI API KEY NOT CONFIGURED'],
    ['AI_KEY_INVALID', 503, 'GEMINI API KEY INVALID'],
    ['AI_SERVICE_UNAVAILABLE', 503, 'GEMINI SERVICE UNAVAILABLE'],
    ['AI_PROVIDER_UNREACHABLE', 503, 'CANNOT REACH GEMINI'],
    ['AI_TIMEOUT', 504, 'AI REQUEST TIMED OUT'],
  ] as const)('maps provider error %s to HTTP %i', async (code, status, title) => {
    const { post } = await start(fakeProvider({ identifyPotentialDRPs: vi.fn(async () => Promise.reject(new AIError(code, { internal: `secret internal ${KEY}` }))) }));
    const res = await post('/api/ai/drp-analysis', { context: ctx });
    expect(res.status).toBe(status);
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.error.code).toBe(code);
    expect(body.error.provider).toBe('gemini');
    expect(describeAIError(body.error.code, body.error.provider).title).toBe(title);
    expect(text).not.toContain('secret internal');
    expect(text).not.toContain(KEY);
  });

  it('never forwards unvalidated AI output', async () => {
    const { post } = await start(fakeProvider({ identifyPotentialDRPs: vi.fn(async () => ({ data: { drps: [{ category: 'invented' }] } as never, warnings: [] })) }));
    const res = await post('/api/ai/drp-analysis', { context: ctx });
    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('AI_RESPONSE_INVALID');
  });

  it('hides unexpected exceptions', async () => {
    const { post } = await start(fakeProvider({ identifyPotentialDRPs: vi.fn(async () => Promise.reject(new Error(`boom ${KEY}`))) }));
    const res = await post('/api/ai/drp-analysis', { context: ctx });
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(text).not.toContain('boom');
    expect(text).not.toContain(KEY);
  });

  it('routes synthetic demo cases to the scripted demo provider only', async () => {
    const provider = fakeProvider();
    const { post } = await start(provider);
    const res = await (await post('/api/ai/drp-analysis', { context: ctx }, { 'x-preceptor-demo-case': 'im-cap-aki' })).json();
    expect(res.meta.provider).toBe('demo');
    expect(res.data.drps.length).toBeGreaterThan(3);
    expect(res.data.drps.every((d: { status: string }) => d.status !== 'confirmed')).toBe(true);
    expect(provider.identifyPotentialDRPs).not.toHaveBeenCalled();
    const unknown = await (await post('/api/ai/drp-analysis', { context: ctx }, { 'x-preceptor-demo-case': 'not-a-demo' })).json();
    expect(unknown.meta.provider).toBe('gemini');
  });

  it('enforces the optional access code', async () => {
    const { post, base } = await start(fakeProvider(), { APP_ACCESS_TOKEN: 'ward-code-42' });
    expect((await post('/api/ai/drp-analysis', { context: ctx })).status).toBe(401);
    expect((await post('/api/ai/drp-analysis', { context: ctx }, { authorization: 'Bearer wrong' })).status).toBe(401);
    expect((await post('/api/ai/drp-analysis', { context: ctx }, { authorization: 'Bearer ward-code-42' })).status).toBe(200);
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('rate-limits AI requests', async () => {
    const { post } = await start(fakeProvider(), { AI_RATE_LIMIT_PER_MINUTE: '2', AI_CACHE_TTL_MINUTES: '0' });
    expect((await post('/api/ai/drp-analysis', { context: ctx })).status).toBe(200);
    expect((await post('/api/ai/drp-analysis', { context: ctx })).status).toBe(200);
    const third = await post('/api/ai/drp-analysis', { context: ctx });
    expect(third.status).toBe(429);
    expect((await third.json()).error.code).toBe('RATE_LIMITED');
  });

  it('allows only configured browser origins', async () => {
    const { base } = await start(fakeProvider());
    const good = await fetch(`${base}/api/health`, { headers: { origin: 'https://localhost' } });
    expect(good.headers.get('access-control-allow-origin')).toBe('https://localhost');
    const evil = await fetch(`${base}/api/health`, { headers: { origin: 'https://evil.example' } });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('fails over to the next provider and reports who answered', async () => {
    const gemini = fakeProvider({ identifyPotentialDRPs: vi.fn(async () => Promise.reject(new AIError('AI_QUOTA_EXCEEDED'))) });
    const deepseek = fakeProvider({ name: 'deepseek', model: 'deepseek-test', capabilities: ['text'] });
    const { post, audit } = await start([gemini, deepseek]);
    const res = await (await post('/api/ai/drp-analysis', { context: ctx })).json();
    expect(res).toMatchObject({ ok: true, meta: { provider: 'deepseek', model: 'deepseek-test', fallbackFrom: ['gemini'] } });
    expect(res.meta.warnings[0]).toBe('Answered by DeepSeek because Gemini failed (GEMINI QUOTA EXCEEDED).');
    expect(audit.recent(1)[0]).toMatchObject({ provider: 'deepseek', model: 'deepseek-test', status: 'ok' });
  });

  it('honours the preferred provider header and keeps its cache separate', async () => {
    const gemini = fakeProvider();
    const kimi = fakeProvider({ name: 'kimi', model: 'kimi-test', capabilities: ['text', 'vision'] });
    const { post } = await start([gemini, kimi]);
    const viaKimi = await (await post('/api/ai/drp-analysis', { context: ctx }, { 'x-preceptor-provider': 'kimi' })).json();
    expect(viaKimi.meta.provider).toBe('kimi');
    const auto = await (await post('/api/ai/drp-analysis', { context: ctx })).json();
    expect(auto.meta).toMatchObject({ provider: 'gemini', cached: false });
    const bogus = await (await post('/api/ai/drp-analysis', { context: ctx }, { 'x-preceptor-provider': 'evil' })).json();
    expect(bogus.meta).toMatchObject({ provider: 'gemini', cached: true });
  });

  it('lists every provider failure when all of them fail', async () => {
    const gemini = fakeProvider({ identifyPotentialDRPs: vi.fn(async () => Promise.reject(new AIError('AI_KEY_INVALID'))) });
    const kimi = fakeProvider({ name: 'kimi', identifyPotentialDRPs: vi.fn(async () => Promise.reject(new AIError('AI_PROVIDER_UNREACHABLE'))) });
    const { post } = await start([gemini, kimi]);
    const res = await post('/api/ai/drp-analysis', { context: ctx });
    const body = await res.json();
    expect(body.error).toMatchObject({ code: 'AI_KEY_INVALID', provider: 'gemini' });
    expect(body.error.details).toEqual(['Gemini: GEMINI API KEY INVALID', 'Kimi: CANNOT REACH KIMI']);
  });

  it('names Gemini when no provider key is configured at all', async () => {
    const { post } = await start([fakeProvider({ configured: false }), fakeProvider({ name: 'deepseek', configured: false, capabilities: ['text'] })]);
    const res = await post('/api/ai/drp-analysis', { context: ctx });
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(describeAIError(body.error.code, body.error.provider).title).toBe('GEMINI API KEY NOT CONFIGURED');
  });

  it('rejects oversized image batches before calling Gemini', async () => {
    const provider = fakeProvider();
    const { post } = await start(provider);
    const img = { mimeType: 'image/jpeg', data: 'A'.repeat(100), page: 1 };
    const res = await post('/api/ai/analyze-images', { sourceType: 'lab_report', images: Array.from({ length: 13 }, (_, i) => ({ ...img, page: i + 1 })) });
    expect(res.status).toBe(400);
    expect(provider.analyzeImages).not.toHaveBeenCalled();
  });
});
