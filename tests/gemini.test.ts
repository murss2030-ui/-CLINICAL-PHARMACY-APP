import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { mapGeminiHttpError, redact, type AIError } from '../server/src/ai/errors';
import { GeminiClient } from '../server/src/ai/geminiClient';
import { toGeminiSchema } from '../server/src/ai/jsonSchema';
import { drpAnalysisSchema } from '@shared/ai';

const body = (status: string, message: string, details: unknown[] = []) => JSON.stringify({ error: { status, message, details } });

describe('Gemini error mapping (no raw errors reach the student)', () => {
  it.each([
    [400, body('INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.'), 'AI_KEY_INVALID'],
    [401, body('UNAUTHENTICATED', 'x'), 'AI_KEY_INVALID'],
    [402, body('', 'payment'), 'AI_BILLING_REQUIRED'],
    [403, body('PERMISSION_DENIED', 'denied'), 'AI_PERMISSION_DENIED'],
    [404, body('NOT_FOUND', 'model retired'), 'AI_MODEL_NOT_FOUND'],
    [413, body('', 'too big'), 'REQUEST_TOO_LARGE'],
    [429, body('RESOURCE_EXHAUSTED', 'You exceeded your current quota, please check your plan and billing details.'), 'AI_QUOTA_EXCEEDED'],
    [500, body('INTERNAL', 'x'), 'AI_SERVICE_UNAVAILABLE'],
    [502, 'Bad gateway', 'AI_SERVICE_UNAVAILABLE'],
    [503, body('UNAVAILABLE', 'high demand'), 'AI_SERVICE_UNAVAILABLE'],
    [504, body('DEADLINE_EXCEEDED', 'x'), 'AI_TIMEOUT'],
  ])('HTTP %i → %s', (status, raw, code) => {
    const e = mapGeminiHttpError(status, raw);
    expect(e.code).toBe(code);
    expect(e.provider).toBe('gemini');
  });

  const errorInfo = (reason: string, service = 'generativelanguage.googleapis.com') => ({ '@type': 'type.googleapis.com/google.rpc.ErrorInfo', reason, metadata: { service } });
  it('explains new-format AI Studio keys Google refuses (ACCESS_TOKEN_TYPE_UNSUPPORTED)', () => {
    const e = mapGeminiHttpError(401, body('UNAUTHENTICATED', 'Request had invalid authentication credentials.', [errorInfo('ACCESS_TOKEN_TYPE_UNSUPPORTED')]));
    expect(e.code).toBe('AI_KEY_INVALID');
    expect(e.details?.[0]).toMatch(/AQ\./);
  });
  it('explains a disabled Google Cloud API (e.g. Vertex AI not enabled for the key project)', () => {
    const e = mapGeminiHttpError(403, body('PERMISSION_DENIED', 'Agent Platform API has not been used in project 123 before or it is disabled.', [errorInfo('SERVICE_DISABLED', 'aiplatform.googleapis.com')]));
    expect(e.code).toBe('AI_PERMISSION_DENIED');
    expect(e.details?.[0]).toMatch(/aiplatform\.googleapis\.com disabled/);
    expect(mapGeminiHttpError(403, body('PERMISSION_DENIED', 'x', [errorInfo('API_KEY_SERVICE_BLOCKED')])).details?.[0]).toMatch(/restrictions/);
  });

  it('reads the RetryInfo delay from quota errors', () => {
    const e = mapGeminiHttpError(429, body('RESOURCE_EXHAUSTED', 'quota', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '35.08s' }]));
    expect(e.retryAfterMs).toBe(35_080);
  });
  it('redacts credentials from log text', () => {
    const out = redact('GET /v1/models?key=AIzaSyA1234567890abcdefghijklmnopqrstu x-goog-api-key: secretvalue Bearer abc.def');
    expect(out).not.toMatch(/AIzaSy|secretvalue|abc\.def/);
    const more = redact('key AQ.Ab8RN6Kzpa_example_not_real_1234567890 and sk-0123456789abcdef0123456789abcdef in a message');
    expect(more).not.toMatch(/AQ\.Ab8|sk-0123/);
  });
});

describe('Gemini JSON schema conversion', () => {
  it('drops keywords Gemini rejects while keeping structure', () => {
    const s = JSON.stringify(toGeminiSchema(drpAnalysisSchema));
    expect(s).not.toMatch(/maxItems|maxLength|additionalProperties|\$schema|"default"/);
    expect(s).toMatch(/"enum":\["possible","not_supported","needs_data"\]/);
  });
});

const schema = z.object({ answer: z.string() });
const okResponse = (text: string, finishReason = 'STOP') => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason }] }), { status: 200 });
const errResponse = (status: number, raw = body('UNAVAILABLE', 'x')) => new Response(raw, { status });

function client(fetchImpl: typeof fetch, opts: Partial<ConstructorParameters<typeof GeminiClient>[0]> = {}) {
  return new GeminiClient({ apiKey: 'test-key-123456', model: 'gemini-test', apiBase: 'https://gemini.invalid/v1beta', timeoutMs: 2000, maxRetries: 2, fetchImpl, sleep: async () => undefined, ...opts });
}
const req = { system: 's', parts: [{ text: 'p' }], schema };

describe('GeminiClient', () => {
  it('refuses to call Gemini without a server key', async () => {
    const f = vi.fn();
    await expect(client(f as never, { apiKey: undefined }).generateJson(req)).rejects.toMatchObject({ code: 'AI_KEY_NOT_CONFIGURED' });
    expect(f).not.toHaveBeenCalled();
  });
  it('sends the key only in a header, never in the URL', async () => {
    const f = vi.fn().mockResolvedValue(okResponse('{"answer":"ok"}'));
    await client(f).generateJson(req);
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).not.toContain('test-key-123456');
    expect(init.headers['x-goog-api-key']).toBe('test-key-123456');
    expect(JSON.parse(init.body).generationConfig.responseMimeType).toBe('application/json');
  });
  it('retries transient failures a bounded number of times', async () => {
    const f = vi.fn().mockResolvedValueOnce(errResponse(503)).mockResolvedValueOnce(errResponse(502, 'bad')).mockResolvedValueOnce(okResponse('{"answer":"ok"}'));
    await expect(client(f).generateJson(req)).resolves.toMatchObject({ data: { answer: 'ok' } });
    expect(f).toHaveBeenCalledTimes(3);
    const g = vi.fn().mockImplementation(async () => errResponse(503));
    await expect(client(g).generateJson(req)).rejects.toMatchObject({ code: 'AI_SERVICE_UNAVAILABLE' });
    expect(g).toHaveBeenCalledTimes(3);
  });
  it('does not retry non-transient errors or long quota windows', async () => {
    const f = vi.fn().mockImplementation(async () => errResponse(400, body('INVALID_ARGUMENT', 'bad')));
    await expect(client(f).generateJson(req)).rejects.toMatchObject({ code: 'REQUEST_INVALID' });
    expect(f).toHaveBeenCalledTimes(1);
    const q = vi.fn().mockImplementation(async () => errResponse(429, body('RESOURCE_EXHAUSTED', 'quota', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '40s' }])));
    await expect(client(q).generateJson(req)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    expect(q).toHaveBeenCalledTimes(1);
  });
  it('repairs one invalid response, then rejects safely', async () => {
    const f = vi.fn().mockResolvedValueOnce(okResponse('not json')).mockResolvedValueOnce(okResponse('{"answer":"fixed"}'));
    await expect(client(f).generateJson(req)).resolves.toMatchObject({ data: { answer: 'fixed' } });
    const g = vi.fn().mockResolvedValueOnce(okResponse('{"wrong":1}')).mockResolvedValueOnce(okResponse('{"still":"wrong"}'));
    await expect(client(g).generateJson(req)).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
    expect(g).toHaveBeenCalledTimes(2);
  });
  it('treats truncated and blocked answers as invalid / blocked', async () => {
    const truncated = vi.fn().mockImplementation(async () => okResponse('{"answer":"x"}', 'MAX_TOKENS'));
    await expect(client(truncated).generateJson(req)).rejects.toMatchObject({ code: 'AI_RESPONSE_INVALID' });
    expect(truncated).toHaveBeenCalledTimes(2);
    await expect(client(vi.fn().mockImplementation(async () => okResponse('', 'SAFETY'))).generateJson(req)).rejects.toMatchObject({ code: 'AI_BLOCKED' });
  });
  it('times out hung requests', async () => {
    const hang = vi.fn((_u: string, init: { signal: AbortSignal }) => new Promise<Response>((_r, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')))));
    await expect(client(hang as never, { timeoutMs: 30, maxRetries: 0 }).generateJson(req)).rejects.toMatchObject({ code: 'AI_TIMEOUT' });
  });
  it('maps network failures without leaking details', async () => {
    const f = vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED key=AIzaSecretKey1234567890123456789012345'));
    const err = (await client(f, { maxRetries: 0 }).generateJson(req).catch((e) => e)) as AIError;
    expect(err.code).toBe('AI_PROVIDER_UNREACHABLE');
    expect(err.provider).toBe('gemini');
    expect(err.message).not.toContain('AIzaSecret');
  });
});

describe('GeminiClient on Vertex AI express mode', () => {
  it('calls the publisher model endpoint with the key in a header', async () => {
    const f = vi.fn().mockImplementation(async () => okResponse('{"answer":"ok"}'));
    const vertex = client(f, { backend: 'vertex', apiBase: 'https://aiplatform.googleapis.com/v1' });
    await expect(vertex.generateJson(req)).resolves.toMatchObject({ data: { answer: 'ok' } });
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toBe('https://aiplatform.googleapis.com/v1/publishers/google/models/gemini-test:generateContent');
    expect(init.headers['x-goog-api-key']).toBe('test-key-123456');
    expect(vertex.note).toMatch(/Vertex/);
  });
  it('probes Vertex with a tiny capped request (no models.get for API keys)', async () => {
    const f = vi.fn().mockImplementation(async () => okResponse('pong'));
    await client(f, { backend: 'vertex', apiBase: 'https://aiplatform.googleapis.com/v1' }).probe();
    const [url, init] = f.mock.calls[0]!;
    expect(String(url)).toMatch(/:generateContent$/);
    expect(JSON.parse(init.body).generationConfig.maxOutputTokens).toBeLessThanOrEqual(16);
  });
});

describe('GeminiClient model fallback', () => {
  const quota = () => errResponse(429, body('RESOURCE_EXHAUSTED', 'quota', [{ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '40s' }]));
  it('moves to the next model when the first is out of quota, without waiting', async () => {
    const f = vi.fn().mockResolvedValueOnce(quota()).mockResolvedValueOnce(okResponse('{"answer":"from b"}'));
    const r = await client(f, { model: 'model-a', fallbackModels: ['model-b'] }).generateJson(req);
    expect(r.data).toEqual({ answer: 'from b' });
    expect(r.usage.note).toBe('Answered by Gemini model model-b because model-a failed (AI_QUOTA_EXCEEDED).');
    expect(f.mock.calls.map((c) => String(c[0]).match(/models\/([^:]+):/)![1])).toEqual(['model-a', 'model-b']);
  });
  it('tries every model, then reports the last failure', async () => {
    const f = vi.fn().mockImplementation(async () => quota());
    await expect(client(f, { model: 'a', fallbackModels: ['b', 'c'] }).generateJson(req)).rejects.toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    expect(f).toHaveBeenCalledTimes(3);
  });
  it('does not switch models for a bad key (all models share it)', async () => {
    const f = vi.fn().mockImplementation(async () => errResponse(401, body('UNAUTHENTICATED', 'x')));
    await expect(client(f, { model: 'a', fallbackModels: ['b'] }).generateJson(req)).rejects.toMatchObject({ code: 'AI_KEY_INVALID' });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('skips a retired model (404) and uses the next', async () => {
    const f = vi.fn().mockResolvedValueOnce(errResponse(404, body('NOT_FOUND', 'gone'))).mockResolvedValueOnce(okResponse('{"answer":"ok"}'));
    await expect(client(f, { model: 'old', fallbackModels: ['new'] }).generateJson(req)).resolves.toMatchObject({ data: { answer: 'ok' } });
  });
});
