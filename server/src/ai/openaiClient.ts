// REST client for OpenAI-compatible chat completion APIs: DeepSeek and Kimi
// (Moonshot AI). Runs only on the server; the key is sent as a Bearer token.
// Their JSON mode takes no schema, so the schema is written into the system
// prompt and every answer is validated (and repaired once) like Gemini's.
import type { z } from 'zod';
import { PROVIDER_INFO, type AICapability } from '../../../shared/ai';
import { AIError, describeNetworkError, mapOpenAICompatError, redact } from './errors';
import { toGeminiSchema } from './jsonSchema';
import { capabilityOf, generateValidatedJson, type ModelClient, type ModelJsonRequest, type ModelPart, type ModelUsage } from './modelClient';

export interface OpenAICompatOptions {
  provider: 'deepseek' | 'kimi';
  apiKey: string | undefined;
  apiBase: string;
  /** Tried in order when the current base rejects the key (Kimi keys only work in their own region). */
  alternateBases?: string[];
  model: string;
  /**
   * Set only when `model` is a built-in default: if the key does not offer it,
   * use the newest model matching these patterns (first capture group = version).
   */
  autoModel?: RegExp[];
  vision: boolean;
  /** Model for page images; defaults to `model`. */
  visionModel?: string;
  /** Some models (Kimi K2.x) reject any temperature other than their fixed one. */
  sendTemperature: boolean;
  /** Sent as `thinking: { type }`; omitted when undefined. */
  thinking?: 'enabled' | 'disabled';
  maxOutputTokens: number;
  /** Extra guidance attached to "API key invalid" errors. */
  keyHint?: string;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

interface Reply {
  ok: boolean;
  status: number;
  retryAfter: string | null;
  raw: string;
}

const JSON_INSTRUCTIONS = [
  'OUTPUT FORMAT (mandatory):',
  '- Reply with exactly one JSON object and nothing else: no markdown, no code fences, no commentary.',
  '- It must validate against the JSON Schema below: use exactly these property names, include every required property, use only the listed enum values, and use [] for empty lists.',
  '- Numbers must be JSON numbers, not strings.',
  'JSON Schema:',
].join('\n');

/** System prompt for JSON mode: the task prompt plus the exact schema the answer must match. */
export function jsonModeSystemPrompt(system: string, schemaText: string): string {
  return `${system}\n\n${JSON_INSTRUCTIONS}\n${schemaText}`;
}

export class OpenAICompatClient implements ModelClient {
  readonly provider: 'deepseek' | 'kimi';
  private readonly label: string;
  private base: string;
  private readonly alternates: string[];
  private currentModel: string;
  private modelChecked = false;

  constructor(private readonly opts: OpenAICompatOptions) {
    this.provider = opts.provider;
    this.label = PROVIDER_INFO[opts.provider].label;
    this.base = opts.apiBase.replace(/\/$/, '');
    this.alternates = (opts.alternateBases ?? []).map((b) => b.replace(/\/$/, '')).filter((b) => b !== this.base);
    this.currentModel = opts.model;
  }

  get model(): string {
    return this.currentModel;
  }

  get configured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  get capabilities(): readonly AICapability[] {
    return this.opts.vision ? ['text', 'vision'] : ['text'];
  }

  get note(): string | undefined {
    const vision = this.opts.vision ? this.modelFor('vision') : undefined;
    const notes = [vision && vision !== this.currentModel ? `images: ${vision}` : '', `endpoint: ${new URL(this.base).host}`];
    return notes.filter(Boolean).join(' · ');
  }

  modelFor(capability: AICapability): string {
    return capability === 'vision' ? (this.opts.visionModel ?? this.currentModel) : this.currentModel;
  }

  /** Lists the models the key can use (no tokens consumed) and checks the configured one is among them. */
  async probe(): Promise<void> {
    this.requireKey();
    const ids = await this.listModels();
    this.applyModelList(ids);
    if (!ids.length) return;
    const missing = [this.currentModel, ...(this.opts.vision && this.opts.visionModel ? [this.opts.visionModel] : [])].filter((m) => !ids.includes(m));
    if (missing.length)
      throw new AIError('AI_MODEL_NOT_FOUND', {
        provider: this.provider,
        internal: `${this.label} key does not offer ${missing.join(', ')}`,
        details: [`This key offers: ${ids.slice(0, 12).join(', ')}. Configured: ${missing.join(', ')}.`],
      });
  }

  async generateJson<T extends z.ZodTypeAny>(req: ModelJsonRequest<T>): Promise<{ data: z.infer<T>; usage: ModelUsage }> {
    this.requireKey();
    await this.ensureModel();
    const schemaText = JSON.stringify(toGeminiSchema(req.schema));
    return generateValidatedJson(req, (parts) => this.complete({ ...req, parts }, schemaText), {
      label: this.label,
      maxRetries: this.opts.maxRetries,
      sleep: this.opts.sleep,
      log: this.opts.log,
    });
  }

  private requireKey(): void {
    if (!this.opts.apiKey) throw new AIError('AI_KEY_NOT_CONFIGURED', { provider: this.provider });
  }

  private async complete(req: ModelJsonRequest<z.ZodTypeAny>, schemaText: string): Promise<{ text: string; usage: ModelUsage }> {
    const capability = capabilityOf(req.parts);
    if (capability === 'audio' || (capability === 'vision' && !this.opts.vision))
      throw new AIError('AI_CAPABILITY_UNAVAILABLE', { provider: this.provider, internal: `${this.label} cannot process ${capability} input` });
    const body: Record<string, unknown> = {
      model: this.modelFor(capability),
      messages: [
        { role: 'system', content: jsonModeSystemPrompt(req.system, schemaText) },
        { role: 'user', content: userContent(req.parts) },
      ],
      response_format: { type: 'json_object' },
      max_tokens: req.maxOutputTokens ?? this.opts.maxOutputTokens,
      stream: false,
    };
    if (this.opts.sendTemperature && req.temperature !== undefined) body.temperature = req.temperature;
    if (this.opts.thinking) body.thinking = { type: this.opts.thinking };

    const reply = await this.request('/chat/completions', { method: 'POST', body: JSON.stringify(body) }, this.opts.timeoutMs);
    if (!reply.ok) throw this.httpError(reply);
    let json: ChatResponse;
    try {
      // DeepSeek may stream blank keep-alive lines before the JSON body; JSON.parse ignores them.
      json = JSON.parse(reply.raw) as ChatResponse;
    } catch {
      throw new AIError('AI_RESPONSE_INVALID', { internal: `${this.label} envelope was not JSON` });
    }
    const choice = json.choices?.[0];
    const finish = choice?.finish_reason;
    if (finish === 'content_filter' || finish === 'sensitive') throw new AIError('AI_BLOCKED', { internal: `finish: ${finish}` });
    const text = typeof choice?.message?.content === 'string' ? choice.message.content : '';
    if (!text.trim()) throw new AIError('AI_RESPONSE_INVALID', { internal: `empty response (finish: ${finish ?? 'none'})` });
    if (finish === 'length') throw new AIError('AI_RESPONSE_INVALID', { internal: 'response truncated (length)' });
    return { text, usage: { promptTokens: json.usage?.prompt_tokens, outputTokens: json.usage?.completion_tokens } };
  }

  private async listModels(): Promise<string[]> {
    const reply = await this.request('/models', { method: 'GET' }, 15_000);
    if (!reply.ok) throw this.httpError(reply);
    try {
      const json = JSON.parse(reply.raw) as { data?: Array<{ id?: unknown }> };
      return (json.data ?? []).map((m) => m.id).filter((id): id is string => typeof id === 'string');
    } catch {
      return [];
    }
  }

  /** Resolve a default model once per process; failures are ignored so the real call reports them. */
  private async ensureModel(): Promise<void> {
    if (!this.opts.autoModel || this.modelChecked) return;
    try {
      this.applyModelList(await this.listModels());
    } catch {
      // Keep the default model; the completion request will surface the actual error.
    }
  }

  private applyModelList(ids: string[]): void {
    if (!ids.length) return;
    this.modelChecked = true;
    if (!this.opts.autoModel || ids.includes(this.currentModel)) return;
    const pick = pickNewestModel(ids, this.opts.autoModel);
    if (pick) {
      this.opts.log?.(`${this.label}: ${this.currentModel} is not offered to this key; using ${pick}`);
      this.currentModel = pick;
    }
  }

  private httpError(reply: Reply): AIError {
    const error = mapOpenAICompatError(this.provider, reply.status, reply.raw, reply.retryAfter);
    if (error.code === 'AI_KEY_INVALID' && this.opts.keyHint)
      return new AIError('AI_KEY_INVALID', { provider: this.provider, internal: error.message, details: [this.opts.keyHint] });
    return error;
  }

  private async request(path: string, init: { method: string; body?: string }, timeoutMs: number): Promise<Reply> {
    for (;;) {
      const reply = await this.send(`${this.base}${path}`, init, timeoutMs);
      if (reply.status !== 401 || !this.alternates.length) return reply;
      const next = this.alternates.shift()!;
      this.opts.log?.(`${this.label}: key rejected by ${new URL(this.base).host}; trying ${new URL(next).host}`);
      this.base = next;
    }
  }

  /** The timeout also covers reading the body (DeepSeek keeps slow requests open with keep-alive lines). */
  private async send(url: string, init: { method: string; body?: string }, timeoutMs: number): Promise<Reply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(url, {
        method: init.method,
        body: init.body,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.opts.apiKey ?? ''}` },
        signal: controller.signal,
      });
      return { ok: res.ok, status: res.status, retryAfter: res.headers.get('retry-after'), raw: await res.text() };
    } catch (err) {
      if (controller.signal.aborted) throw new AIError('AI_TIMEOUT', { provider: this.provider, internal: `${this.label} timeout after ${timeoutMs}ms` });
      throw new AIError('AI_PROVIDER_UNREACHABLE', { provider: this.provider, internal: redact(`${this.label} network error: ${describeNetworkError(err)}`) });
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Plain text when there are no images; otherwise OpenAI-style content parts with data URLs. */
function userContent(parts: ModelPart[]): string | Array<Record<string, unknown>> {
  if (!parts.some((p) => 'inlineData' in p)) return parts.map((p) => ('text' in p ? p.text : '')).join('\n\n');
  return parts.map((p) =>
    'text' in p ? { type: 'text', text: p.text } : { type: 'image_url', image_url: { url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}` } },
  );
}

/** Newest id matching the first family that matches anything, e.g. kimi-k2.6 over kimi-k2.5. */
export function pickNewestModel(ids: string[], families: RegExp[]): string | undefined {
  const version = (m: RegExpMatchArray) => (m[1] ?? '0').split('.').map(Number);
  for (const family of families) {
    const matches = ids.flatMap((id) => {
      const m = id.match(family);
      return m ? [{ id, v: version(m) }] : [];
    });
    if (!matches.length) continue;
    matches.sort((a, b) => {
      for (let i = 0; i < Math.max(a.v.length, b.v.length); i++) {
        const d = (b.v[i] ?? 0) - (a.v[i] ?? 0);
        if (d) return d;
      }
      return 0;
    });
    return matches[0]!.id;
  }
  return undefined;
}
