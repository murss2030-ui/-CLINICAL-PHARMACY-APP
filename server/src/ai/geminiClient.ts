// Minimal REST client for the Gemini generateContent API, served either by
// Google AI Studio (generativelanguage.googleapis.com) or Vertex AI express
// mode (aiplatform.googleapis.com). Runs only on the server. The API key is
// sent in the x-goog-api-key header, never in the URL, so it cannot leak
// through access logs.
import type { z } from 'zod';
import type { AICapability } from '../../../shared/ai';
import { AIError, describeNetworkError, mapGeminiHttpError, redact } from './errors';
import { toGeminiSchema } from './jsonSchema';
import { generateValidatedJson, type ModelClient, type ModelJsonRequest, type ModelUsage } from './modelClient';

export type GeminiBackend = 'studio' | 'vertex';

export const GEMINI_API_BASES: Record<GeminiBackend, string> = {
  studio: 'https://generativelanguage.googleapis.com/v1beta',
  vertex: 'https://aiplatform.googleapis.com/v1',
};

export interface GeminiClientOptions {
  apiKey: string | undefined;
  model: string;
  /** Defaults to Google AI Studio. */
  backend?: GeminiBackend;
  apiBase: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

interface Reply {
  ok: boolean;
  status: number;
  retryAfter: string | null;
  raw: string;
}

export class GeminiClient implements ModelClient {
  readonly provider = 'gemini' as const;
  readonly capabilities: readonly AICapability[] = ['text', 'vision', 'audio'];

  constructor(private readonly opts: GeminiClientOptions) {}

  get model(): string {
    return this.opts.model;
  }

  get configured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  get note(): string | undefined {
    return this.backend === 'vertex' ? 'Vertex AI express mode' : undefined;
  }

  modelFor(): string {
    return this.opts.model;
  }

  private get backend(): GeminiBackend {
    return this.opts.backend ?? 'studio';
  }

  private modelUrl(): string {
    const model = encodeURIComponent(this.opts.model);
    return this.backend === 'vertex' ? `${this.opts.apiBase}/publishers/google/models/${model}` : `${this.opts.apiBase}/models/${model}`;
  }

  /**
   * Connectivity/authorisation check. AI Studio: models.get (no tokens).
   * Vertex express mode has no models.get for API keys, so it sends a tiny capped request.
   */
  async probe(): Promise<void> {
    this.requireKey();
    const reply =
      this.backend === 'vertex'
        ? await this.send(
            `${this.modelUrl()}:generateContent`,
            { method: 'POST', body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ping' }] }], generationConfig: { maxOutputTokens: 16 } }) },
            15_000,
          )
        : await this.send(this.modelUrl(), { method: 'GET' }, 15_000);
    if (!reply.ok) throw mapGeminiHttpError(reply.status, reply.raw, reply.retryAfter);
  }

  async generateJson<T extends z.ZodTypeAny>(req: ModelJsonRequest<T>): Promise<{ data: z.infer<T>; usage: ModelUsage }> {
    this.requireKey();
    const responseJsonSchema = toGeminiSchema(req.schema);
    return generateValidatedJson(req, (parts) => this.generate({ ...req, parts }, responseJsonSchema), {
      label: 'Gemini',
      maxRetries: this.opts.maxRetries,
      sleep: this.opts.sleep,
      log: this.opts.log,
    });
  }

  private requireKey(): void {
    if (!this.opts.apiKey) throw new AIError('AI_KEY_NOT_CONFIGURED', { provider: 'gemini' });
  }

  private async generate(req: ModelJsonRequest<z.ZodTypeAny>, responseJsonSchema: Record<string, unknown>): Promise<{ text: string; usage: ModelUsage }> {
    const body = {
      systemInstruction: { parts: [{ text: req.system }] },
      contents: [{ role: 'user', parts: req.parts }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseJsonSchema,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        maxOutputTokens: req.maxOutputTokens ?? 16_384,
      },
    };
    const reply = await this.send(`${this.modelUrl()}:generateContent`, { method: 'POST', body: JSON.stringify(body) }, this.opts.timeoutMs);
    if (!reply.ok) throw mapGeminiHttpError(reply.status, reply.raw, reply.retryAfter);

    let json: GenerateResponse;
    try {
      json = JSON.parse(reply.raw) as GenerateResponse;
    } catch {
      throw new AIError('AI_RESPONSE_INVALID', { internal: 'Gemini envelope was not JSON' });
    }
    if (json.promptFeedback?.blockReason) throw new AIError('AI_BLOCKED', { internal: `blocked: ${json.promptFeedback.blockReason}` });
    const candidate = json.candidates?.[0];
    const finish = candidate?.finishReason;
    if (finish === 'SAFETY' || finish === 'PROHIBITED_CONTENT' || finish === 'BLOCKLIST' || finish === 'SPII')
      throw new AIError('AI_BLOCKED', { internal: `finish: ${finish}` });
    const text = (candidate?.content?.parts ?? [])
      .filter((p) => !p.thought && typeof p.text === 'string')
      .map((p) => p.text)
      .join('');
    if (!text) throw new AIError('AI_RESPONSE_INVALID', { internal: `empty response (finish: ${finish ?? 'none'})` });
    if (finish === 'MAX_TOKENS') throw new AIError('AI_RESPONSE_INVALID', { internal: 'response truncated (MAX_TOKENS)' });
    return {
      text,
      usage: { promptTokens: json.usageMetadata?.promptTokenCount, outputTokens: json.usageMetadata?.candidatesTokenCount },
    };
  }

  /** The timeout also covers reading the body. */
  private async send(url: string, init: { method: string; body?: string }, timeoutMs: number): Promise<Reply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(url, {
        method: init.method,
        body: init.body,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.opts.apiKey ?? '' },
        signal: controller.signal,
      });
      return { ok: res.ok, status: res.status, retryAfter: res.headers.get('retry-after'), raw: await res.text() };
    } catch (err) {
      if (controller.signal.aborted) throw new AIError('AI_TIMEOUT', { provider: 'gemini', internal: `Gemini timeout after ${timeoutMs}ms` });
      throw new AIError('AI_PROVIDER_UNREACHABLE', { provider: 'gemini', internal: redact(`Gemini network error: ${describeNetworkError(err)}`) });
    } finally {
      clearTimeout(timer);
    }
  }
}
