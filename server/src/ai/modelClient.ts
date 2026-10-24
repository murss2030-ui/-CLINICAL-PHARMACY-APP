// Provider-neutral model transport. Each client (Gemini, OpenAI-compatible)
// turns these parts into its own wire format; the JSON validation, repair and
// retry loop is shared so every provider is held to the same contract.
import type { z } from 'zod';
import type { AICapability, ModelProviderName } from '../../../shared/ai';
import { AIError, toAIError } from './errors';

export type ModelPart = { text: string } | { inlineData: { mimeType: string; data: string } };

export interface ModelJsonRequest<T extends z.ZodTypeAny> {
  system: string;
  parts: ModelPart[];
  schema: T;
  temperature?: number;
  maxOutputTokens?: number;
}

export interface ModelUsage {
  promptTokens?: number;
  outputTokens?: number;
}

export interface ModelClient {
  readonly provider: ModelProviderName;
  readonly model: string;
  readonly configured: boolean;
  readonly capabilities: readonly AICapability[];
  /** Short routing detail for the status page (vision model, backend). Never a secret. */
  readonly note?: string;
  modelFor(capability: AICapability): string;
  /** Cheap reachability/authorisation check. */
  probe(): Promise<void>;
  generateJson<T extends z.ZodTypeAny>(req: ModelJsonRequest<T>): Promise<{ data: z.infer<T>; usage: ModelUsage }>;
}

/** The most demanding input in a request: audio beats images beats text. */
export function capabilityOf(parts: ModelPart[]): AICapability {
  let capability: AICapability = 'text';
  for (const p of parts) {
    if (!('inlineData' in p)) continue;
    if (p.inlineData.mimeType.startsWith('audio/')) return 'audio';
    capability = 'vision';
  }
  return capability;
}

const MAX_WAIT_MS = 20_000;
// Timeouts and unreachable hosts are not retried here: the router fails over to the next provider instead.
const RETRYABLE = new Set<string>(['AI_SERVICE_UNAVAILABLE', 'AI_QUOTA_EXCEEDED']);

export interface JsonLoopOptions {
  label: string;
  maxRetries: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
}

/**
 * Ask for JSON matching `schema`, validate it, and retry a bounded number of
 * times on transient failures. One extra "repair" attempt is made if the
 * model returns JSON that fails validation. There are no unbounded loops.
 */
export async function generateValidatedJson<T extends z.ZodTypeAny>(
  req: ModelJsonRequest<T>,
  call: (parts: ModelPart[]) => Promise<{ text: string; usage: ModelUsage }>,
  opts: JsonLoopOptions,
): Promise<{ data: z.infer<T>; usage: ModelUsage }> {
  let parts = req.parts;
  let repaired = false;

  for (let attempt = 0; ; attempt++) {
    try {
      const { text, usage } = await call(parts);
      const result = req.schema.safeParse(parseModelJson(text));
      if (result.success) return { data: result.data, usage };
      if (repaired) {
        throw new AIError('AI_RESPONSE_INVALID', {
          internal: 'Schema validation failed after repair',
          details: result.error.issues.slice(0, 5).map((i) => `${i.path.join('.')}: ${i.message}`),
        });
      }
      repaired = true;
      const issues = result.error.issues.slice(0, 8).map((i) => `- ${i.path.join('.')}: ${i.message}`).join('\n');
      parts = [...req.parts, { text: `Your previous answer did not match the required JSON schema:\n${issues}\nReturn corrected JSON only.` }];
    } catch (err) {
      const error = toAIError(err);
      if (error.code === 'AI_RESPONSE_INVALID' && !repaired) {
        repaired = true;
        parts = [...req.parts, { text: 'Your previous answer was not valid JSON. Return valid JSON only.' }];
        continue;
      }
      if (!RETRYABLE.has(error.code) || attempt >= opts.maxRetries) throw error;
      // A quota window longer than the cap is reported immediately instead of holding the request open.
      if (error.retryAfterMs !== undefined && error.retryAfterMs > MAX_WAIT_MS) throw error;
      const backoff = Math.min(error.retryAfterMs ?? 1000 * 2 ** attempt, MAX_WAIT_MS);
      opts.log?.(`${opts.label} ${error.code}; retry ${attempt + 1}/${opts.maxRetries} in ${backoff}ms`);
      await (opts.sleep ?? defaultSleep)(backoff);
    }
  }
}

export function parseModelJson(text: string): unknown {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new AIError('AI_RESPONSE_INVALID', { internal: 'Model output was not valid JSON' });
  }
}

export const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
