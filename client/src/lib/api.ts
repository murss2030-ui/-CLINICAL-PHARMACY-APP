// The browser talks ONLY to the PRECEPTOR backend (/api/...). The backend
// holds the AI provider keys; no AI provider is ever called from the client.
import type { z } from 'zod';
import { AI_ERROR_CODES, describeAIError, isModelProvider, type AIErrorCode, type AIMeta, type AIStatus, type ModelProviderName } from '@shared/ai';
import { getSettings } from './db';
import { isNativeApp } from './platform';

export class AiError extends Error {
  readonly code: AIErrorCode;
  readonly title: string;
  readonly retryable: boolean;
  readonly details?: string[];
  /** Provider that failed, when the server knows it. */
  readonly provider?: ModelProviderName;

  constructor(code: AIErrorCode, details?: string[], provider?: ModelProviderName) {
    const info = describeAIError(code, provider);
    super(info.message);
    this.name = 'AiError';
    this.code = code;
    this.title = info.title;
    this.retryable = info.retryable;
    this.details = details;
    this.provider = provider;
  }
}

export function toAiError(err: unknown): AiError {
  if (err instanceof AiError) return err;
  return new AiError('SERVER_ERROR');
}

async function base(): Promise<{ url: string; headers: Record<string, string> }> {
  const s = await getSettings();
  const url = (s.apiBase || import.meta.env.VITE_API_BASE_URL || '').replace(/\/$/, '');
  // Inside the Android app the page is served locally, so a relative /api would never reach the server.
  if (!url && isNativeApp()) throw new AiError('AI_NETWORK_ERROR', ['Set the PRECEPTOR server URL in Settings → Server (required in the Android app).']);
  const headers: Record<string, string> = {};
  if (s.accessCode) headers.authorization = `Bearer ${s.accessCode}`;
  // Only a provider *name* is sent; the keys never leave the server.
  if (isModelProvider(s.aiProvider)) headers['x-preceptor-provider'] = s.aiProvider;
  return { url, headers };
}

function codeForStatus(status: number): AIErrorCode {
  if (status === 401) return 'UNAUTHORIZED';
  if (status === 413) return 'REQUEST_TOO_LARGE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400) return 'REQUEST_INVALID';
  if (status === 504) return 'AI_TIMEOUT';
  return 'SERVER_ERROR';
}

export interface DemoTarget {
  caseKey: string;
  docKey?: string;
}

export async function aiRequest<S extends z.ZodTypeAny>(
  path: string,
  body: unknown,
  schema: S,
  opts: { demo?: DemoTarget; timeoutMs?: number } = {},
): Promise<{ data: z.infer<S>; meta: AIMeta }> {
  const { url, headers } = await base();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new AiError('AI_NETWORK_ERROR');
  if (opts.demo) {
    headers['x-preceptor-demo-case'] = opts.demo.caseKey;
    if (opts.demo.docKey) headers['x-preceptor-demo-doc'] = opts.demo.docKey;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 180_000);
  let res: Response;
  try {
    res = await fetch(`${url}/api/ai/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch {
    throw new AiError(controller.signal.aborted ? 'AI_TIMEOUT' : 'AI_NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
  }
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    throw new AiError(res.ok ? 'AI_RESPONSE_INVALID' : codeForStatus(res.status));
  }
  const envelope = json as { ok?: boolean; data?: unknown; meta?: AIMeta; error?: { code?: string; details?: string[]; provider?: string } };
  if (!res.ok || !envelope.ok) {
    const code = (AI_ERROR_CODES as readonly string[]).includes(envelope.error?.code ?? '') ? (envelope.error!.code as AIErrorCode) : codeForStatus(res.status);
    const provider = isModelProvider(envelope.error?.provider) ? envelope.error.provider : undefined;
    throw new AiError(code, envelope.error?.details, provider);
  }
  // Validate again on the client: nothing unvalidated is rendered as clinical content.
  const parsed = schema.safeParse(envelope.data);
  if (!parsed.success || !envelope.meta) throw new AiError('AI_RESPONSE_INVALID');
  return { data: parsed.data, meta: envelope.meta };
}

export async function fetchAiStatus(probe = false): Promise<AIStatus> {
  const { url, headers } = await base();
  const res = await fetch(`${url}/api/ai/status${probe ? '?probe=1' : ''}`, { headers });
  if (!res.ok) throw new AiError(codeForStatus(res.status));
  return (await res.json()) as AIStatus;
}

export async function fetchHealth(): Promise<{ ok: boolean; version: string; database: string }> {
  const { url } = await base();
  const res = await fetch(`${url}/api/health`);
  if (!res.ok) throw new AiError('SERVER_ERROR');
  return res.json();
}
