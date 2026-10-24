import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AI_ERROR_CODES, MODEL_PROVIDERS, describeAIError } from '@shared/ai';
import type { AIProvider } from '../server/src/ai/AIProvider';
import { AIError, mapOpenAICompatError } from '../server/src/ai/errors';
import { OpenAICompatClient, pickNewestModel, type OpenAICompatOptions } from '../server/src/ai/openaiClient';
import { buildRouter, DEEPSEEK_MODEL_FAMILIES, KIMI_MODEL_FAMILIES } from '../server/src/ai/providers';
import { AIRouter } from '../server/src/ai/router';
import { readConfig } from '../server/src/config';

const schema = z.object({ answer: z.string() });
const req = { system: 'You are a test.', parts: [{ text: 'question' }], schema, temperature: 0.1 };
const chat = (content: string, finish = 'stop') =>
  new Response(JSON.stringify({ choices: [{ message: { content }, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 5 } }), { status: 200 });
const fail = (status: number, error: Record<string, unknown>) => new Response(JSON.stringify({ error }), { status });
const models = (...ids: string[]) => new Response(JSON.stringify({ object: 'list', data: ids.map((id) => ({ id })) }), { status: 200 });
const KEY = 'sk-test0000000000000000000000000000';

function kimi(fetchImpl: typeof fetch, opts: Partial<OpenAICompatOptions> = {}) {
  return new OpenAICompatClient({
    provider: 'kimi',
    apiKey: KEY,
    apiBase: 'https://kimi.invalid/v1',
    model: 'kimi-test',
    vision: true,
    sendTemperature: false,
    thinking: 'disabled',
    maxOutputTokens: 1000,
    timeoutMs: 2000,
    maxRetries: 2,
    fetchImpl,
    sleep: async () => undefined,
    ...opts,
  });
}
const deepseek = (fetchImpl: typeof fetch, opts: Partial<OpenAICompatOptions> = {}) =>
  kimi(fetchImpl, { provider: 'deepseek', apiBase: 'https://deepseek.invalid', model: 'deepseek-test', vision: false, sendTemperature: true, ...opts });

describe('OpenAI-compatible client (DeepSeek, Kimi)', () => {
  it('refuses to call the provider without a server key', async () => {
    const f = vi.fn();
    await expect(kimi(f as never, { apiKey: undefined }).generateJson(req)).rejects.toMatchObject({ code: 'AI_KEY_NOT_CONFIGURED', provider: 'kimi' });
    expect(f).not.toHaveBeenCalled();
  });

  it('sends the key as a Bearer header, asks for JSON and puts the schema in the system prompt', async () => {
    const f = vi.fn().mockImplementation(async () => chat('{"answer":"ok"}'));
    await expect(deepseek(f).generateJson(req)).resolves.toMatchObject({ data: { answer: 'ok' } });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('https://deepseek.invalid/chat/completions');
    expect(String(url)).not.toContain(KEY);
    expect(init.headers.authorization).toBe(`Bearer ${KEY}`);
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'deepseek-test', response_format: { type: 'json_object' }, temperature: 0.1, thinking: { type: 'disabled' }, stream: false, max_tokens: 1000 });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toMatch(/JSON Schema:\n\{.*"answer"/s);
    expect(body.messages[1]).toEqual({ role: 'user', content: 'question' });
  });

  it('never sends a temperature to Kimi (its K2 models only accept their fixed value)', async () => {
    const f = vi.fn().mockImplementation(async () => chat('{"answer":"ok"}'));
    await kimi(f).generateJson(req);
    expect(JSON.parse(f.mock.calls[0]![1].body)).not.toHaveProperty('temperature');
  });

  it('sends page images to Kimi as data URLs, using the vision model', async () => {
    const f = vi.fn().mockImplementation(async () => chat('{"answer":"ok"}'));
    const client = kimi(f, { visionModel: 'kimi-vision-test' });
    await client.generateJson({ ...req, parts: [{ text: '=== PAGE 1 ===' }, { inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }] });
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.model).toBe('kimi-vision-test');
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: '=== PAGE 1 ===' },
      { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,QUJD' } },
    ]);
    expect(client.modelFor('vision')).toBe('kimi-vision-test');
    expect(client.note).toMatch(/images: kimi-vision-test/);
  });

  it('refuses inputs the provider cannot read without calling it', async () => {
    const f = vi.fn();
    const audio = { ...req, parts: [{ inlineData: { mimeType: 'audio/wav', data: 'QUJD' } }] };
    await expect(kimi(f as never).generateJson(audio)).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    const image = { ...req, parts: [{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }] };
    await expect(deepseek(f as never).generateJson(image)).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    expect(f).not.toHaveBeenCalled();
    expect(deepseek(f as never).capabilities).toEqual(['text']);
  });

  it('accepts DeepSeek keep-alive blank lines and fenced JSON', async () => {
    const f = vi.fn().mockImplementation(async () => {
      const r = chat('```json\n{"answer":"ok"}\n```');
      return new Response(`\n\n\n${await r.text()}`, { status: 200 });
    });
    await expect(deepseek(f).generateJson(req)).resolves.toMatchObject({ data: { answer: 'ok' } });
  });

  it('repairs one invalid answer, then rejects truncated or blocked output', async () => {
    const f = vi.fn().mockResolvedValueOnce(chat('{"wrong":1}')).mockResolvedValueOnce(chat('{"answer":"fixed"}'));
    await expect(kimi(f).generateJson(req)).resolves.toMatchObject({ data: { answer: 'fixed' } });
    expect(JSON.parse(f.mock.calls[1]![1].body).messages[1].content).toMatch(/did not match the required JSON schema/);
    const truncated = vi.fn().mockImplementation(async () => chat('{"answer":"x"}', 'length'));
    await expect(kimi(truncated).generateJson(req)).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
    expect(truncated).toHaveBeenCalledTimes(2);
    await expect(kimi(vi.fn().mockImplementation(async () => chat('', 'content_filter'))).generateJson(req)).rejects.toMatchObject({ code: 'AI_BLOCKED' });
  });

  it.each([
    ['deepseek', 401, { message: 'Authentication Fails, Your api key: ****0000 is invalid', type: 'authentication_error' }, 'AI_KEY_INVALID'],
    ['deepseek', 402, { message: 'Insufficient Balance', type: 'unknown_error' }, 'AI_BILLING_REQUIRED'],
    ['deepseek', 400, { message: 'Model Not Exist', type: 'invalid_request_error' }, 'AI_MODEL_NOT_FOUND'],
    ['deepseek', 422, { message: 'Invalid Parameters', type: 'invalid_request_error' }, 'REQUEST_INVALID'],
    ['deepseek', 429, { message: 'Rate Limit Reached', type: 'rate_limit_error' }, 'AI_QUOTA_EXCEEDED'],
    ['deepseek', 500, { message: 'Server Error' }, 'AI_SERVICE_UNAVAILABLE'],
    ['deepseek', 503, { message: 'Server Overloaded' }, 'AI_SERVICE_UNAVAILABLE'],
    ['kimi', 401, { message: 'Invalid Authentication', type: 'invalid_authentication_error' }, 'AI_KEY_INVALID'],
    ['kimi', 429, { message: 'You exceeded your current token quota, please check your account balance', type: 'exceeded_current_quota_error' }, 'AI_BILLING_REQUIRED'],
    ['kimi', 429, { message: 'The engine is currently overloaded, please try again later', type: 'engine_overloaded_error' }, 'AI_SERVICE_UNAVAILABLE'],
    ['kimi', 429, { message: 'Your account request reached organization max RPM: 3', type: 'rate_limit_reached_error' }, 'AI_QUOTA_EXCEEDED'],
    ['kimi', 400, { message: 'The request was rejected because it was considered high risk', type: 'content_filter' }, 'AI_BLOCKED'],
    ['kimi', 400, { message: 'Your request exceeded model token limit: 262144', type: 'invalid_request_error' }, 'REQUEST_TOO_LARGE'],
    ['kimi', 404, { message: 'Not found the model kimi-x or Permission denied', type: 'resource_not_found_error' }, 'AI_MODEL_NOT_FOUND'],
    ['kimi', 403, { message: 'The API you are accessing is not open', type: 'permission_denied_error' }, 'AI_PERMISSION_DENIED'],
  ] as const)('%s HTTP %i → %s', (provider, status, error, code) => {
    const e = mapOpenAICompatError(provider, status, JSON.stringify({ error }));
    expect(e.code).toBe(code);
    expect(e.provider).toBe(provider);
    expect(e.message).not.toMatch(/Authentication Fails|balance/);
  });

  it('retries overload with backoff, but not bad keys', async () => {
    const f = vi.fn().mockResolvedValueOnce(fail(503, { message: 'Server Overloaded' })).mockResolvedValueOnce(chat('{"answer":"ok"}'));
    await expect(deepseek(f).generateJson(req)).resolves.toMatchObject({ data: { answer: 'ok' } });
    const g = vi.fn().mockImplementation(async () => fail(401, { message: 'Authentication Fails', type: 'authentication_error' }));
    await expect(deepseek(g).generateJson(req)).rejects.toMatchObject({ code: 'AI_KEY_INVALID' });
    expect(g).toHaveBeenCalledTimes(1);
  });

  it('retries a Kimi key on the other region endpoint, then sticks to it', async () => {
    const f = vi.fn().mockImplementation(async (url: string) =>
      url.startsWith('https://api.moonshot.ai') ? fail(401, { message: 'Invalid Authentication', type: 'invalid_authentication_error' }) : chat('{"answer":"ok"}'),
    );
    const client = kimi(f, { apiBase: 'https://api.moonshot.ai/v1', alternateBases: ['https://api.moonshot.cn/v1'] });
    await expect(client.generateJson(req)).resolves.toMatchObject({ data: { answer: 'ok' } });
    await client.generateJson(req);
    expect(f.mock.calls.map((c) => new URL(c[0]).host)).toEqual(['api.moonshot.ai', 'api.moonshot.cn', 'api.moonshot.cn']);
    expect(client.note).toMatch(/api\.moonshot\.cn/);
  });

  it('explains region-bound Kimi keys when every endpoint rejects them', async () => {
    const f = vi.fn().mockImplementation(async () => fail(401, { message: 'Invalid Authentication', type: 'invalid_authentication_error' }));
    const client = kimi(f, { apiBase: 'https://api.moonshot.ai/v1', alternateBases: ['https://api.moonshot.cn/v1'], keyHint: 'Kimi keys only work in their own region.' });
    await expect(client.generateJson(req)).rejects.toMatchObject({ code: 'AI_KEY_INVALID', details: ['Kimi keys only work in their own region.'] });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it('switches a default model the key does not offer to the newest one of its family', async () => {
    const f = vi.fn().mockImplementation(async (url: string) => (url.endsWith('/models') ? models('kimi-k2.5', 'kimi-k3', 'moonshot-v1-8k') : chat('{"answer":"ok"}')));
    const client = kimi(f, { model: 'kimi-k2.6', autoModel: KIMI_MODEL_FAMILIES });
    await client.generateJson(req);
    expect(client.model).toBe('kimi-k3');
    expect(JSON.parse(f.mock.calls[1]![1].body).model).toBe('kimi-k3');
    await client.generateJson(req);
    expect(f.mock.calls.filter((c) => String(c[0]).endsWith('/models'))).toHaveLength(1);
  });

  it('never swaps a model the administrator chose; the probe reports it instead', async () => {
    const f = vi.fn().mockImplementation(async () => models('deepseek-v4-flash', 'deepseek-v4-pro'));
    const client = deepseek(f, { model: 'deepseek-chat' });
    const err = (await client.probe().catch((e) => e)) as AIError;
    expect(err.code).toBe('AI_MODEL_NOT_FOUND');
    expect(err.details?.[0]).toMatch(/offers: deepseek-v4-flash, deepseek-v4-pro/);
    expect(client.model).toBe('deepseek-chat');
    await expect(deepseek(vi.fn().mockImplementation(async () => models('deepseek-test'))).probe()).resolves.toBeUndefined();
  });

  it('maps unreachable hosts and timeouts (including a stalled body) without leaking the key', async () => {
    const down = vi.fn().mockRejectedValue(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND', message: `getaddrinfo ENOTFOUND ${KEY}` } }));
    const err = (await deepseek(down, { maxRetries: 0 }).generateJson(req).catch((e) => e)) as AIError;
    expect(err).toMatchObject({ code: 'AI_PROVIDER_UNREACHABLE', provider: 'deepseek' });
    expect(err.message).toMatch(/ENOTFOUND/);
    expect(err.message).not.toContain(KEY);
    const stalled = vi.fn(async (_u: string, init: { signal: AbortSignal }) =>
      new Response(new ReadableStream({ start: (c) => init.signal.addEventListener('abort', () => c.error(new Error('aborted'))) }), { status: 200 }),
    );
    await expect(deepseek(stalled as never, { timeoutMs: 30, maxRetries: 0 }).generateJson(req)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });

  it('picks the newest version within a model family', () => {
    expect(pickNewestModel(['deepseek-chat', 'deepseek-v4-flash', 'deepseek-v4.1-flash', 'deepseek-v4-pro'], DEEPSEEK_MODEL_FAMILIES)).toBe('deepseek-v4.1-flash');
    expect(pickNewestModel(['deepseek-chat', 'deepseek-reasoner'], DEEPSEEK_MODEL_FAMILIES)).toBe('deepseek-chat');
    expect(pickNewestModel(['kimi-k2.5', 'kimi-k2.6', 'kimi-k2-thinking'], KIMI_MODEL_FAMILIES)).toBe('kimi-k2.6');
    expect(pickNewestModel(['moonshot-v1-8k'], KIMI_MODEL_FAMILIES)).toBeUndefined();
  });
});

function provider(name: string, patch: Partial<AIProvider> = {}): AIProvider {
  const ok = vi.fn(async () => ({ data: { drps: [], medicationsReviewed: [] }, warnings: [] }));
  return {
    name,
    model: `${name}-model`,
    configured: true,
    capabilities: ['text', 'vision', 'audio'],
    probe: vi.fn(async () => undefined),
    identifyPotentialDRPs: ok,
    transcribeAudio: vi.fn(async () => ({ data: { transcript: 'x' }, warnings: [] })),
    analyzeImages: vi.fn(async () => ({ data: { pages: [] }, warnings: [] })),
    ...patch,
  } as unknown as AIProvider;
}
const caseReq = { context: { caseCode: 'CASE-0001', department: 'internal_medicine' } } as never;
const rejecting = (code: (typeof AI_ERROR_CODES)[number], details?: string[]) => vi.fn(async () => Promise.reject(new AIError(code, { details })));

describe('AI router (failover and capability routing)', () => {
  it('uses the configured order and skips providers without a key', async () => {
    const r = new AIRouter([provider('gemini', { configured: false }), provider('deepseek'), provider('kimi')], { order: ['kimi', 'deepseek', 'gemini'] });
    expect(r.order).toEqual(['kimi', 'deepseek', 'gemini']);
    expect(await r.identifyPotentialDRPs(caseReq)).toMatchObject({ provider: 'kimi', model: 'kimi-model' });
    expect(await r.prefer('deepseek').identifyPotentialDRPs(caseReq)).toMatchObject({ provider: 'deepseek' });
    expect(r.prefer('deepseek').order).toEqual(['deepseek', 'kimi', 'gemini']);
    expect(await r.prefer('gemini').identifyPotentialDRPs(caseReq)).toMatchObject({ provider: 'kimi' });
  });

  it('falls over to the next provider and says why', async () => {
    const r = new AIRouter([provider('gemini', { identifyPotentialDRPs: rejecting('AI_QUOTA_EXCEEDED') }), provider('deepseek')]);
    const result = await r.identifyPotentialDRPs(caseReq);
    expect(result).toMatchObject({ provider: 'deepseek', fallbackFrom: ['gemini'] });
    expect(result.warnings[0]).toBe('Answered by DeepSeek because Gemini failed (GEMINI QUOTA EXCEEDED).');
  });

  it('routes voice notes and page images only to providers that can read them', async () => {
    const ds = provider('deepseek', { capabilities: ['text'] });
    const km = provider('kimi', { capabilities: ['text', 'vision'], modelFor: (c) => (c === 'vision' ? 'kimi-vision' : 'kimi-model') });
    const r = new AIRouter([ds, km, provider('gemini')], { order: ['deepseek', 'kimi', 'gemini'] });
    expect(await r.transcribeAudio({} as never)).toMatchObject({ provider: 'gemini' });
    expect(await r.analyzeImages({} as never)).toMatchObject({ provider: 'kimi', model: 'kimi-vision' });
    expect(ds.analyzeImages).not.toHaveBeenCalled();
    expect(ds.transcribeAudio).not.toHaveBeenCalled();
  });

  it('explains when no configured provider can read the input', async () => {
    const r = new AIRouter([provider('gemini', { configured: false }), provider('deepseek', { capabilities: ['text'] })]);
    await expect(r.transcribeAudio({} as never)).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE', details: ['Voice input needs a server key for Gemini.'] });
  });

  it('combines failures from every provider into one student-safe error', async () => {
    const r = new AIRouter([
      provider('gemini', { identifyPotentialDRPs: rejecting('AI_KEY_INVALID', ['Google did not accept this key type.']) }),
      provider('deepseek', { identifyPotentialDRPs: rejecting('AI_PROVIDER_UNREACHABLE') }),
      provider('kimi', { identifyPotentialDRPs: vi.fn(async () => Promise.reject(new Error('boom sk-secretsecretsecretsecret'))) }),
    ]);
    const err = (await r.identifyPotentialDRPs(caseReq).catch((e) => e)) as AIError;
    expect(err).toMatchObject({ code: 'AI_KEY_INVALID', provider: 'gemini' });
    expect(err.details).toEqual(['Gemini: GEMINI API KEY INVALID — Google did not accept this key type.', 'DeepSeek: CANNOT REACH DEEPSEEK', 'Kimi: AI SERVICE UNAVAILABLE']);
    expect(err.message).not.toContain('secretsecret');
  });

  it('stops failing over once the time budget is spent', async () => {
    let t = 0;
    const slow = provider('gemini', { identifyPotentialDRPs: vi.fn(async () => ((t += 80_000), Promise.reject(new AIError('AI_TIMEOUT')))) });
    const next = provider('deepseek');
    const r = new AIRouter([slow, next], { now: () => t });
    await expect(r.identifyPotentialDRPs(caseReq)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
    expect(next.identifyPotentialDRPs).not.toHaveBeenCalled();
  });

  it('reports per-provider status and probe failures', async () => {
    const r = new AIRouter([provider('gemini', { probe: rejecting('AI_PERMISSION_DENIED', ['enable the API']) }), provider('kimi', { configured: false, note: 'endpoint: api.moonshot.ai' })]);
    expect(await r.statuses(true)).toEqual([
      { name: 'gemini', label: 'Gemini', configured: true, model: 'gemini-model', capabilities: ['text', 'vision', 'audio'], reachable: false, probeError: 'AI_PERMISSION_DENIED', probeDetails: ['enable the API'] },
      { name: 'kimi', label: 'Kimi', configured: false, model: 'kimi-model', capabilities: ['text', 'vision', 'audio'], note: 'endpoint: api.moonshot.ai' },
    ]);
  });
});

describe('provider configuration', () => {
  it('reads keys, defaults and the failover order from the environment', () => {
    const c = readConfig({ GEMINI_API_KEY: ' g ', DEEPSEEK_API_KEY: 'd', MOONSHOT_API_KEY: 'k', AI_PROVIDER_ORDER: 'moonshot, deepseek, nonsense' });
    expect(c.providerOrder).toEqual(['kimi', 'deepseek', 'gemini', 'openai', 'anthropic']);
    expect(c.gemini).toMatchObject({ apiKey: 'g', backend: 'studio', apiBase: 'https://generativelanguage.googleapis.com/v1beta' });
    expect(c.deepseek).toMatchObject({ apiKey: 'd', model: 'deepseek-v4-flash', modelIsDefault: true, apiBase: 'https://api.deepseek.com', thinking: 'disabled' });
    expect(c.kimi).toMatchObject({ apiKey: 'k', model: 'kimi-k2.6', apiBase: 'https://api.moonshot.ai/v1', alternateBases: ['https://api.moonshot.cn/v1'] });
  });

  it('honours explicit models, endpoints and backends', () => {
    const c = readConfig({ GEMINI_BACKEND: 'vertex', KIMI_API_BASE: 'https://api.moonshot.cn/v1', KIMI_MODEL: 'kimi-k2.5', DEEPSEEK_THINKING: 'enabled', KIMI_THINKING: 'default' });
    expect(c.gemini.apiBase).toBe('https://aiplatform.googleapis.com/v1');
    expect(c.kimi).toMatchObject({ apiBase: 'https://api.moonshot.cn/v1', alternateBases: [], model: 'kimi-k2.5', modelIsDefault: false, thinking: undefined });
    expect(c.deepseek.thinking).toBe('enabled');
  });

  it('builds all three providers; only those with keys are configured', () => {
    const r = buildRouter(readConfig({ DEEPSEEK_API_KEY: 'sk-x', AI_PROVIDER_ORDER: 'deepseek' }));
    expect(r.order).toEqual(['deepseek', 'gemini', 'kimi', 'openai', 'anthropic']);
    expect(r.configured).toBe(true);
    expect(r.name).toBe('deepseek');
  });
});

describe('error wording', () => {
  it('names the provider in every title and leaves no placeholder behind', () => {
    for (const code of AI_ERROR_CODES) {
      for (const p of [...MODEL_PROVIDERS, undefined]) {
        const { title, message } = describeAIError(code, p);
        expect(`${title} ${message}`).not.toMatch(/[{}]/);
      }
    }
    expect(describeAIError('AI_KEY_INVALID', 'gemini').title).toBe('GEMINI API KEY INVALID');
    expect(describeAIError('AI_QUOTA_EXCEEDED', 'deepseek').title).toBe('DEEPSEEK QUOTA EXCEEDED');
    expect(describeAIError('AI_KEY_NOT_CONFIGURED', 'kimi').message).toMatch(/KIMI_API_KEY/);
    expect(describeAIError('AI_KEY_NOT_CONFIGURED').message).toMatch(/GEMINI_API_KEY, DEEPSEEK_API_KEY, KIMI_API_KEY, OPENAI_API_KEY or ANTHROPIC_API_KEY/);
  });
});

import { AnthropicClient } from '../server/src/ai/anthropicClient';

const claude = (fetchImpl: typeof fetch) =>
  new AnthropicClient({ apiKey: 'sk-ant-test0000000000000000', apiBase: 'https://claude.invalid/v1', model: 'claude-test', maxOutputTokens: 1000, timeoutMs: 2000, maxRetries: 1, fetchImpl, sleep: async () => undefined });
const toolReply = (input: unknown, stop = 'tool_use') => new Response(JSON.stringify({ content: [{ type: 'tool_use', input }], stop_reason: stop, usage: { input_tokens: 5, output_tokens: 3 } }), { status: 200 });

describe('Claude client (Anthropic Messages API)', () => {
  it('sends x-api-key, forces the schema tool and reads the structured answer', async () => {
    const f = vi.fn().mockImplementation(async () => toolReply({ answer: 'ok' }));
    await expect(claude(f).generateJson({ ...req, parts: [{ text: 'q' }, { inlineData: { mimeType: 'image/png', data: 'QUJD' } }] })).resolves.toMatchObject({ data: { answer: 'ok' } });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('https://claude.invalid/v1/messages');
    expect(init.headers['x-api-key']).toBe('sk-ant-test0000000000000000');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(init.body);
    expect(body.tool_choice).toEqual({ type: 'tool', name: 'submit_answer' });
    expect(body.tools[0].input_schema.properties).toHaveProperty('answer');
    expect(body).not.toHaveProperty('temperature');
    expect(body.messages[0].content[1]).toEqual({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
  });
  it('refuses audio and unsupported image types without calling Claude', async () => {
    const f = vi.fn();
    await expect(claude(f as never).generateJson({ ...req, parts: [{ inlineData: { mimeType: 'audio/wav', data: 'QUJD' } }] })).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    await expect(claude(f as never).generateJson({ ...req, parts: [{ inlineData: { mimeType: 'image/heic', data: 'QUJD' } }] })).rejects.toMatchObject({ code: 'AI_CAPABILITY_UNAVAILABLE' });
    expect(f).not.toHaveBeenCalled();
  });
  it.each([
    [401, 'authentication_error', 'invalid x-api-key', 'AI_KEY_INVALID'],
    [400, 'invalid_request_error', 'Your credit balance is too low to access the Anthropic API', 'AI_BILLING_REQUIRED'],
    [429, 'rate_limit_error', 'rate limited', 'AI_QUOTA_EXCEEDED'],
    [529, 'overloaded_error', 'Overloaded', 'AI_SERVICE_UNAVAILABLE'],
    [404, 'not_found_error', 'model: claude-x', 'AI_MODEL_NOT_FOUND'],
  ] as const)('HTTP %i %s → %s', async (status, type, message, code) => {
    const f = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ type: 'error', error: { type, message } }), { status }));
    await expect(claude(f).generateJson(req)).rejects.toMatchObject({ code, provider: 'anthropic' });
  });
  it('repairs a wrong answer once and reports a refusal as blocked', async () => {
    const f = vi.fn().mockResolvedValueOnce(toolReply({ wrong: 1 })).mockResolvedValueOnce(toolReply({ answer: 'fixed' }));
    await expect(claude(f).generateJson(req)).resolves.toMatchObject({ data: { answer: 'fixed' } });
    await expect(claude(vi.fn().mockImplementation(async () => toolReply({}, 'refusal'))).generateJson(req)).rejects.toMatchObject({ code: 'AI_BLOCKED' });
  });
  it('OpenAI models get max_completion_tokens and no temperature', async () => {
    const f = vi.fn().mockImplementation(async () => chat('{"answer":"ok"}'));
    await kimi(f, { provider: 'openai', tokenParam: 'max_completion_tokens', thinking: undefined }).generateJson(req);
    const body = JSON.parse(f.mock.calls[0]![1].body);
    expect(body.max_completion_tokens).toBe(1000);
    expect(body).not.toHaveProperty('max_tokens');
    expect(body).not.toHaveProperty('thinking');
  });
});
