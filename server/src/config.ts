// Server configuration. This is the ONLY place that reads the AI provider
// keys (GEMINI, DEEPSEEK, KIMI, OPENAI and ANTHROPIC _API_KEY). Keys are held in
// memory, never logged, and never returned by any route.
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { MODEL_PROVIDERS, isModelProvider, type ModelProviderName } from '../../shared/ai';
import { GEMINI_API_BASES, type GeminiBackend } from './ai/geminiClient';

export interface ProviderConfig {
  apiKey: string | undefined;
  model: string;
  /** True when the model was not set explicitly, so the client may switch to the newest model the key offers. */
  modelIsDefault: boolean;
  apiBase: string;
}

export type ThinkingMode = 'enabled' | 'disabled' | undefined;

export interface ServerConfig {
  port: number;
  nodeEnv: string;
  gemini: ProviderConfig & { backend: GeminiBackend; fallbackModels: string[] };
  deepseek: ProviderConfig & { thinking: ThinkingMode };
  kimi: ProviderConfig & { visionModel: string | undefined; alternateBases: string[]; thinking: ThinkingMode };
  openai: ProviderConfig;
  anthropic: ProviderConfig;
  providerOrder: ModelProviderName[];
  allowedOrigins: string[];
  accessToken: string | undefined;
  databasePath: string;
  rateLimitPerMinute: number;
  aiTimeoutMs: number;
  aiMaxRetries: number;
  cacheTtlMinutes: number;
  clientDistDir: string | undefined;
}

export const DEFAULT_GEMINI_MODEL = 'gemini-3.5-flash';
/** Used after DEFAULT_GEMINI_MODEL when GEMINI_MODEL is not set. */
export const DEFAULT_GEMINI_FALLBACKS = ['gemini-3-flash-preview'];
export const DEFAULT_DEEPSEEK_MODEL = 'deepseek-v4-flash';
export const DEFAULT_KIMI_MODEL = 'kimi-k2.6';
export const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5-5';
export const KIMI_API_BASES = ['https://api.moonshot.ai/v1', 'https://api.moonshot.cn/v1'];

function int(value: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

const text = (value: string | undefined) => value?.trim() || undefined;

function thinking(value: string | undefined): ThinkingMode {
  const v = value?.trim().toLowerCase();
  if (v === 'enabled' || v === 'on' || v === 'true') return 'enabled';
  if (v === 'default' || v === 'model') return undefined;
  return 'disabled';
}

function geminiBackend(value: string | undefined): GeminiBackend {
  return /^vertex/i.test(value?.trim() ?? '') ? 'vertex' : 'studio';
}

/** Listed providers first, in the given order; the rest keep the default order. */
function providerOrder(value: string | undefined): ModelProviderName[] {
  const listed = (value ?? '')
    .split(',')
    .map((v) => v.trim().toLowerCase())
    .map((v) => (v === 'moonshot' ? 'kimi' : v))
    .filter(isModelProvider);
  return [...new Set([...listed, ...MODEL_PROVIDERS])];
}

export function loadDotEnv(): void {
  const file = resolve(process.cwd(), '.env');
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch {
      // Malformed .env: ignore, environment variables still apply.
    }
  }
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const dist = resolve(process.cwd(), 'dist/client');
  const backend = geminiBackend(env.GEMINI_BACKEND);
  const kimiBase = text(env.KIMI_API_BASE) ?? text(env.MOONSHOT_API_BASE);
  const kimiModel = text(env.KIMI_MODEL);
  // GEMINI_MODEL may list several models separated by commas: the first is preferred, the rest are fallbacks.
  const geminiModels = [...new Set((env.GEMINI_MODEL ?? '').split(',').map((m) => m.trim()).filter(Boolean))];
  return {
    port: int(env.PORT, 8787, 1, 65535),
    nodeEnv: env.NODE_ENV ?? 'development',
    gemini: {
      apiKey: text(env.GEMINI_API_KEY),
      model: geminiModels[0] ?? DEFAULT_GEMINI_MODEL,
      fallbackModels: geminiModels.length ? geminiModels.slice(1) : DEFAULT_GEMINI_FALLBACKS,
      modelIsDefault: !geminiModels.length,
      backend,
      apiBase: text(env.GEMINI_API_BASE) ?? GEMINI_API_BASES[backend],
    },
    deepseek: {
      apiKey: text(env.DEEPSEEK_API_KEY),
      model: text(env.DEEPSEEK_MODEL) ?? DEFAULT_DEEPSEEK_MODEL,
      modelIsDefault: !text(env.DEEPSEEK_MODEL),
      apiBase: text(env.DEEPSEEK_API_BASE) ?? 'https://api.deepseek.com',
      thinking: thinking(env.DEEPSEEK_THINKING),
    },
    kimi: {
      apiKey: text(env.KIMI_API_KEY) ?? text(env.MOONSHOT_API_KEY),
      model: kimiModel ?? DEFAULT_KIMI_MODEL,
      modelIsDefault: !kimiModel,
      visionModel: text(env.KIMI_VISION_MODEL),
      apiBase: kimiBase ?? KIMI_API_BASES[0]!,
      // Without an explicit base, a key rejected by the international endpoint is retried on the China endpoint.
      alternateBases: kimiBase ? [] : KIMI_API_BASES.slice(1),
      thinking: thinking(env.KIMI_THINKING),
    },
    openai: {
      apiKey: text(env.OPENAI_API_KEY),
      model: text(env.OPENAI_MODEL) ?? DEFAULT_OPENAI_MODEL,
      modelIsDefault: !text(env.OPENAI_MODEL),
      apiBase: text(env.OPENAI_API_BASE) ?? 'https://api.openai.com/v1',
    },
    anthropic: {
      apiKey: text(env.ANTHROPIC_API_KEY),
      model: text(env.ANTHROPIC_MODEL) ?? DEFAULT_ANTHROPIC_MODEL,
      modelIsDefault: !text(env.ANTHROPIC_MODEL),
      apiBase: text(env.ANTHROPIC_API_BASE) ?? 'https://api.anthropic.com/v1',
    },
    providerOrder: providerOrder(env.AI_PROVIDER_ORDER),
    allowedOrigins: (env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:4173,https://localhost,capacitor://localhost')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
    accessToken: text(env.APP_ACCESS_TOKEN),
    databasePath: text(env.DATABASE_PATH) ?? resolve(process.cwd(), 'data/preceptor.sqlite'),
    rateLimitPerMinute: int(env.AI_RATE_LIMIT_PER_MINUTE, 30, 1, 10_000),
    aiTimeoutMs: int(env.AI_TIMEOUT_MS, 90_000, 5_000, 600_000),
    aiMaxRetries: int(env.AI_MAX_RETRIES, 2, 0, 4),
    cacheTtlMinutes: int(env.AI_CACHE_TTL_MINUTES, 60, 0, 7 * 24 * 60),
    clientDistDir: existsSync(dist) ? dist : undefined,
  };
}
