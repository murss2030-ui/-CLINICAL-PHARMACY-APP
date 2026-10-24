// Builds the provider chain from the server configuration. Each provider is
// independent: a missing key simply leaves that provider "not configured".
import type { ServerConfig } from '../config';
import { AnthropicClient } from './anthropicClient';
import { GeminiClient } from './geminiClient';
import { ModelService } from './ModelService';
import { OpenAICompatClient } from './openaiClient';
import { AIRouter } from './router';

/** Used only when the default model is not offered to the key (e.g. after a model retirement). */
export const DEEPSEEK_MODEL_FAMILIES = [/^deepseek-v(\d+(?:\.\d+)*)-flash$/, /^deepseek-flash$/, /^deepseek-chat$/];
export const OPENAI_MODEL_FAMILIES = [/^gpt-(\d+(?:\.\d+)*)-mini$/];
export const KIMI_MODEL_FAMILIES = [/^kimi-k(\d+(?:\.\d+)*)$/, /^kimi-latest$/];

const KIMI_KEY_HINT =
  'Kimi keys only work in the region where they were created: keys from platform.moonshot.ai / platform.kimi.ai use https://api.moonshot.ai/v1, keys from platform.moonshot.cn use https://api.moonshot.cn/v1 (KIMI_API_BASE).';

export function buildRouter(config: ServerConfig, log?: (msg: string) => void): AIRouter {
  const common = { timeoutMs: config.aiTimeoutMs, maxRetries: config.aiMaxRetries, log };
  const { gemini, deepseek, kimi, openai, anthropic } = config;
  const clients = [
    new GeminiClient({ apiKey: gemini.apiKey, model: gemini.model, fallbackModels: gemini.fallbackModels, backend: gemini.backend, apiBase: gemini.apiBase, ...common }),
    new OpenAICompatClient({
      provider: 'deepseek',
      apiKey: deepseek.apiKey,
      apiBase: deepseek.apiBase,
      model: deepseek.model,
      autoModel: deepseek.modelIsDefault ? DEEPSEEK_MODEL_FAMILIES : undefined,
      vision: false,
      sendTemperature: true,
      thinking: deepseek.thinking,
      maxOutputTokens: 8_192,
      ...common,
    }),
    new OpenAICompatClient({
      provider: 'kimi',
      apiKey: kimi.apiKey,
      apiBase: kimi.apiBase,
      alternateBases: kimi.alternateBases,
      model: kimi.model,
      autoModel: kimi.modelIsDefault ? KIMI_MODEL_FAMILIES : undefined,
      vision: true,
      visionModel: kimi.visionModel,
      sendTemperature: false,
      thinking: kimi.thinking,
      maxOutputTokens: 16_384,
      keyHint: KIMI_KEY_HINT,
      ...common,
    }),
    new OpenAICompatClient({
      provider: 'openai',
      apiKey: openai.apiKey,
      apiBase: openai.apiBase,
      model: openai.model,
      autoModel: openai.modelIsDefault ? OPENAI_MODEL_FAMILIES : undefined,
      vision: true,
      sendTemperature: false,
      tokenParam: 'max_completion_tokens',
      maxOutputTokens: 16_384,
      ...common,
    }),
    new AnthropicClient({ apiKey: anthropic.apiKey, apiBase: anthropic.apiBase, model: anthropic.model, maxOutputTokens: 16_384, ...common }),
  ];
  return new AIRouter(
    clients.map((c) => new ModelService(c)),
    { order: config.providerOrder, log },
  );
}
