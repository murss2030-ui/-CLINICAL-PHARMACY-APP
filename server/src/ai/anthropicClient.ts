// REST client for Claude (Anthropic Messages API). Runs only on the server;
// the key is sent in the x-api-key header. The answer is forced through a
// tool whose input schema is the response schema, so Claude returns
// structured JSON; it is then validated (and repaired once) like every other
// provider.
import type { z } from 'zod';
import type { AICapability } from '../../../shared/ai';
import { AIError, describeNetworkError, mapOpenAICompatError, redact } from './errors';
import { toGeminiSchema } from './jsonSchema';
import { capabilityOf, generateValidatedJson, type ModelClient, type ModelJsonRequest, type ModelPart, type ModelUsage } from './modelClient';

export interface AnthropicOptions {
  apiKey: string | undefined;
  apiBase: string;
  model: string;
  maxOutputTokens: number;
  timeoutMs: number;
  maxRetries: number;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

interface MessagesResponse {
  content?: Array<{ type?: string; input?: unknown; text?: string }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface Reply {
  ok: boolean;
  status: number;
  retryAfter: string | null;
  raw: string;
}

const TOOL = 'submit_answer';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

export class AnthropicClient implements ModelClient {
  readonly provider = 'anthropic' as const;
  readonly capabilities: readonly AICapability[] = ['text', 'vision'];
  private readonly base: string;

  constructor(private readonly opts: AnthropicOptions) {
    this.base = opts.apiBase.replace(/\/$/, '');
  }

  get model(): string {
    return this.opts.model;
  }

  get configured(): boolean {
    return Boolean(this.opts.apiKey);
  }

  get note(): string {
    return `endpoint: ${new URL(this.base).host}`;
  }

  modelFor(): string {
    return this.opts.model;
  }

  /** Lists the models the key can use (no tokens consumed) and checks the configured one is among them. */
  async probe(): Promise<void> {
    this.requireKey();
    const reply = await this.send('/models?limit=100', { method: 'GET' }, 15_000);
    if (!reply.ok) throw this.httpError(reply);
    let ids: string[] = [];
    try {
      ids = ((JSON.parse(reply.raw) as { data?: Array<{ id?: unknown }> }).data ?? []).map((m) => m.id).filter((i): i is string => typeof i === 'string');
    } catch {
      return;
    }
    if (ids.length && !ids.includes(this.opts.model))
      throw new AIError('AI_MODEL_NOT_FOUND', {
        provider: 'anthropic',
        internal: `Claude key does not offer ${this.opts.model}`,
        details: [`This key offers: ${ids.slice(0, 12).join(', ')}. Configured: ${this.opts.model}.`],
      });
  }

  async generateJson<T extends z.ZodTypeAny>(req: ModelJsonRequest<T>): Promise<{ data: z.infer<T>; usage: ModelUsage }> {
    this.requireKey();
    if (capabilityOf(req.parts) === 'audio') throw new AIError('AI_CAPABILITY_UNAVAILABLE', { provider: 'anthropic', internal: 'Claude cannot process audio input' });
    const inputSchema = toGeminiSchema(req.schema);
    return generateValidatedJson(req, (parts) => this.complete(req.system, parts, inputSchema, req.maxOutputTokens), {
      label: 'Claude',
      maxRetries: this.opts.maxRetries,
      sleep: this.opts.sleep,
      log: this.opts.log,
    });
  }

  private requireKey(): void {
    if (!this.opts.apiKey) throw new AIError('AI_KEY_NOT_CONFIGURED', { provider: 'anthropic' });
  }

  private async complete(system: string, parts: ModelPart[], inputSchema: Record<string, unknown>, maxTokens?: number): Promise<{ text: string; usage: ModelUsage }> {
    const content = parts.map((p) => {
      if ('text' in p) return { type: 'text', text: p.text };
      if (!IMAGE_TYPES.has(p.inlineData.mimeType))
        throw new AIError('AI_CAPABILITY_UNAVAILABLE', { provider: 'anthropic', internal: `Claude does not accept ${p.inlineData.mimeType} images` });
      return { type: 'image', source: { type: 'base64', media_type: p.inlineData.mimeType, data: p.inlineData.data } };
    });
    const body = {
      model: this.opts.model,
      max_tokens: maxTokens ?? this.opts.maxOutputTokens,
      system: `${system}\n\nReturn your answer by calling the ${TOOL} tool. Use exactly the property names of its schema and use [] for empty lists.`,
      messages: [{ role: 'user', content }],
      tools: [{ name: TOOL, description: 'Submit the final structured answer.', input_schema: inputSchema }],
      tool_choice: { type: 'tool', name: TOOL },
    };
    const reply = await this.send('/messages', { method: 'POST', body: JSON.stringify(body) }, this.opts.timeoutMs);
    if (!reply.ok) throw this.httpError(reply);
    let json: MessagesResponse;
    try {
      json = JSON.parse(reply.raw) as MessagesResponse;
    } catch {
      throw new AIError('AI_RESPONSE_INVALID', { internal: 'Claude envelope was not JSON' });
    }
    if (json.stop_reason === 'refusal') throw new AIError('AI_BLOCKED', { internal: 'stop_reason: refusal' });
    if (json.stop_reason === 'max_tokens') throw new AIError('AI_RESPONSE_INVALID', { internal: 'response truncated (max_tokens)' });
    const tool = json.content?.find((c) => c.type === 'tool_use');
    const text = tool ? JSON.stringify(tool.input ?? {}) : (json.content ?? []).map((c) => c.text ?? '').join('');
    if (!text.trim()) throw new AIError('AI_RESPONSE_INVALID', { internal: `empty response (stop: ${json.stop_reason ?? 'none'})` });
    return { text, usage: { promptTokens: json.usage?.input_tokens, outputTokens: json.usage?.output_tokens } };
  }

  private httpError(reply: Reply): AIError {
    return mapOpenAICompatError('anthropic', reply.status, reply.raw, reply.retryAfter);
  }

  /** The timeout also covers reading the body. */
  private async send(path: string, init: { method: string; body?: string }, timeoutMs: number): Promise<Reply> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await (this.opts.fetchImpl ?? fetch)(`${this.base}${path}`, {
        method: init.method,
        body: init.body,
        headers: { 'content-type': 'application/json', 'x-api-key': this.opts.apiKey ?? '', 'anthropic-version': '2023-06-01' },
        signal: controller.signal,
      });
      return { ok: res.ok, status: res.status, retryAfter: res.headers.get('retry-after'), raw: await res.text() };
    } catch (err) {
      if (controller.signal.aborted) throw new AIError('AI_TIMEOUT', { provider: 'anthropic', internal: `Claude timeout after ${timeoutMs}ms` });
      throw new AIError('AI_PROVIDER_UNREACHABLE', { provider: 'anthropic', internal: redact(`Claude network error: ${describeNetworkError(err)}`) });
    } finally {
      clearTimeout(timer);
    }
  }
}
