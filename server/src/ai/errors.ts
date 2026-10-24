import { AI_ERROR_MESSAGES, PROVIDER_INFO, type AIErrorCode, type ModelProviderName } from '../../../shared/ai';

/** Error with a stable, student-safe code. `internal` is for server logs only and never contains secrets. */
export class AIError extends Error {
  readonly code: AIErrorCode;
  readonly status: number;
  readonly retryable: boolean;
  readonly details?: string[];
  readonly retryAfterMs?: number;
  /** Provider that failed. Set by the client that raised the error, or by the router. */
  provider?: ModelProviderName;

  constructor(
    code: AIErrorCode,
    opts: { status?: number; details?: string[]; internal?: string; retryAfterMs?: number; provider?: ModelProviderName } = {},
  ) {
    super(opts.internal ?? code);
    this.name = 'AIError';
    this.code = code;
    this.status = opts.status ?? httpStatusFor(code);
    this.retryable = AI_ERROR_MESSAGES[code].retryable;
    this.details = opts.details;
    this.retryAfterMs = opts.retryAfterMs;
    this.provider = opts.provider;
  }
}

export function toAIError(err: unknown): AIError {
  return err instanceof AIError ? err : new AIError('SERVER_ERROR', { internal: redact(String((err as Error)?.stack ?? err)) });
}

export function httpStatusFor(code: AIErrorCode): number {
  switch (code) {
    case 'REQUEST_INVALID':
      return 400;
    case 'UNAUTHORIZED':
      return 401;
    case 'REQUEST_TOO_LARGE':
      return 413;
    case 'RATE_LIMITED':
    case 'AI_QUOTA_EXCEEDED':
      return 429;
    case 'AI_RESPONSE_INVALID':
    case 'AI_BLOCKED':
      return 502;
    case 'AI_TIMEOUT':
      return 504;
    case 'SERVER_ERROR':
      return 500;
    default:
      return 503;
  }
}

const AQ_KEY_HINT =
  'Google did not accept this key type for the Gemini API (ACCESS_TOKEN_TYPE_UNSUPPORTED). New AI Studio keys start with "AQ."; if Google keeps rejecting it, create a new key in Google AI Studio or a Google Cloud API key restricted to the Generative Language API.';

/**
 * Map a Gemini HTTP failure to an error code. Only the status, the Google
 * error status/reason and a few known phrases are inspected; the raw body is
 * never forwarded to the client.
 */
export function mapGeminiHttpError(status: number, body: string, retryAfterHeader?: string | null): AIError {
  let googleStatus = '';
  let message = '';
  let retryDelay: string | undefined;
  let reason = '';
  let service = '';
  try {
    const parsed = JSON.parse(body) as {
      error?: {
        status?: string;
        message?: string;
        details?: Array<{ '@type'?: string; retryDelay?: string; reason?: string; metadata?: Record<string, string> }>;
      };
    };
    googleStatus = parsed.error?.status ?? '';
    message = parsed.error?.message ?? '';
    const details = parsed.error?.details ?? [];
    retryDelay = details.find((d) => d['@type']?.endsWith('RetryInfo'))?.retryDelay;
    const info = details.find((d) => d['@type']?.endsWith('ErrorInfo'));
    reason = info?.reason ?? '';
    service = info?.metadata?.service ?? '';
  } catch {
    message = body.slice(0, 200);
  }
  const lower = message.toLowerCase();
  const retryAfterMs = parseRetryAfter(retryAfterHeader) ?? parseDuration(retryDelay);
  const internal = `Gemini HTTP ${status} ${googleStatus} ${reason}`.trim();
  const provider = 'gemini' as const;

  if (reason === 'ACCESS_TOKEN_TYPE_UNSUPPORTED') return new AIError('AI_KEY_INVALID', { internal, provider, details: [AQ_KEY_HINT] });
  if (reason === 'SERVICE_DISABLED' || lower.includes('has not been used in project'))
    return new AIError('AI_PERMISSION_DENIED', {
      internal,
      provider,
      details: [
        `The Google Cloud project of this key has ${service || 'the required API'} disabled. Enable it in Google Cloud Console → APIs & Services, or set GEMINI_BACKEND to match the key (studio for Google AI Studio keys).`,
      ],
    });
  if (reason.startsWith('API_KEY_') && reason.endsWith('_BLOCKED'))
    return new AIError('AI_PERMISSION_DENIED', { internal, provider, details: [`The key's restrictions in Google Cloud Console block this request (${reason}).`] });
  if (
    reason === 'API_KEY_INVALID' ||
    (status === 400 && (lower.includes('api key not valid') || lower.includes('api_key_invalid') || lower.includes('api key expired')))
  )
    return new AIError('AI_KEY_INVALID', { internal, provider });
  if (status === 401) return new AIError('AI_KEY_INVALID', { internal, provider });
  // Quota errors also mention "plan and billing details", so classify them first.
  if (status === 429 || googleStatus === 'RESOURCE_EXHAUSTED') return new AIError('AI_QUOTA_EXCEEDED', { internal, retryAfterMs, provider });
  if (status === 402 || ((status === 400 || status === 403) && googleStatus === 'FAILED_PRECONDITION' && lower.includes('billing')))
    return new AIError('AI_BILLING_REQUIRED', { internal, provider });
  if (status === 403) return new AIError('AI_PERMISSION_DENIED', { internal, provider });
  if (status === 404) return new AIError('AI_MODEL_NOT_FOUND', { internal, provider });
  if (status === 413 || lower.includes('request payload size exceeds') || lower.includes('too large'))
    return new AIError('REQUEST_TOO_LARGE', { internal, provider });
  if (status === 400) return new AIError('REQUEST_INVALID', { internal, status: 400, provider });
  if (status === 504) return new AIError('AI_TIMEOUT', { internal, provider });
  if (status >= 500) return new AIError('AI_SERVICE_UNAVAILABLE', { internal, retryAfterMs, provider });
  return new AIError('SERVER_ERROR', { internal, provider });
}

/**
 * Map a failure from an OpenAI-compatible API (DeepSeek, Kimi). Both use
 * `{ error: { type, message, code } }`; Kimi signals most conditions through
 * `type`, DeepSeek through the HTTP status. The raw body is never forwarded.
 */
export function mapOpenAICompatError(provider: ModelProviderName, status: number, body: string, retryAfterHeader?: string | null): AIError {
  let type = '';
  let message = '';
  try {
    const parsed = JSON.parse(body) as { error?: { type?: unknown; message?: unknown; code?: unknown } | string; message?: unknown };
    if (typeof parsed.error === 'string') message = parsed.error;
    else {
      type = [parsed.error?.type, parsed.error?.code].filter((v) => typeof v === 'string' && v).join(' ');
      message = String(parsed.error?.message ?? parsed.message ?? '');
    }
  } catch {
    message = body.slice(0, 200);
  }
  const text = `${type} ${message}`.toLowerCase();
  const retryAfterMs = parseRetryAfter(retryAfterHeader);
  const internal = `${PROVIDER_INFO[provider].label} HTTP ${status} ${type}`.trim();
  const fail = (code: AIErrorCode, extra: { status?: number; retryAfterMs?: number } = {}) => new AIError(code, { internal, provider, ...extra });

  if (text.includes('content_filter') || text.includes('high risk')) return fail('AI_BLOCKED');
  if (status === 401 || text.includes('invalid_authentication') || text.includes('authentication fails') || text.includes('incorrect api key'))
    return fail('AI_KEY_INVALID');
  if (
    status === 402 ||
    text.includes('insufficient balance') ||
    text.includes('insufficient_quota') ||
    text.includes('exceeded_current_quota') ||
    text.includes('account balance') ||
    text.includes('suspended')
  )
    return fail('AI_BILLING_REQUIRED');
  if (text.includes('overloaded')) return fail('AI_SERVICE_UNAVAILABLE', { retryAfterMs });
  if (status === 429) return fail('AI_QUOTA_EXCEEDED', { retryAfterMs });
  if (status === 404 || text.includes('model not exist') || text.includes('not found the model') || text.includes('model_not_found') || text.includes('resource_not_found'))
    return fail('AI_MODEL_NOT_FOUND');
  if (status === 403 || text.includes('permission_denied')) return fail('AI_PERMISSION_DENIED');
  if (status === 413 || text.includes('too long') || text.includes('token limit') || text.includes('context length') || text.includes('too large'))
    return fail('REQUEST_TOO_LARGE');
  if (status === 400 || status === 422) return fail('REQUEST_INVALID', { status: 400 });
  if (status === 504) return fail('AI_TIMEOUT');
  if (status >= 500) return fail('AI_SERVICE_UNAVAILABLE', { retryAfterMs });
  return fail('SERVER_ERROR');
}

/** Google RPC durations look like "35.08s". */
function parseDuration(value?: string): number | undefined {
  const m = value?.match(/^([\d.]+)s$/);
  return m ? Math.ceil(Number(m[1]) * 1000) : undefined;
}

function parseRetryAfter(value?: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : undefined;
}

/** Network errors from fetch hide the useful part (ENOTFOUND, proxy refusal…) in `cause`. */
export function describeNetworkError(err: unknown): string {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  return [e?.message, e?.cause?.code, e?.cause?.message].filter(Boolean).join(' — ');
}

/** Remove anything that looks like a credential from text before logging. */
export function redact(text: string): string {
  return text
    .replace(/AIza[0-9A-Za-z_\-]{20,}/g, '[redacted-key]')
    .replace(/\bAQ\.[0-9A-Za-z_\-]{20,}/g, '[redacted-key]')
    .replace(/\bsk-[0-9A-Za-z_\-]{16,}/g, '[redacted-key]')
    .replace(/(key=)[^&\s]+/gi, '$1[redacted]')
    .replace(/(x-goog-api-key["']?\s*[:=]\s*["']?)[^"'\s,]+/gi, '$1[redacted]')
    .replace(/(Bearer\s+)[A-Za-z0-9._\-]+/g, '$1[redacted]');
}
