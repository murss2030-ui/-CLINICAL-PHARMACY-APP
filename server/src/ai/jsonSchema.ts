import { z } from 'zod';

const DROP_KEYS = new Set(['$schema', 'additionalProperties', 'default', 'pattern', '$id', 'maxLength', 'minLength', 'exclusiveMinimum', 'exclusiveMaximum', 'maxItems', 'minItems']);

/**
 * Convert a zod schema into the JSON-Schema subset accepted by Gemini's
 * `responseJsonSchema`. Validation constraints we cannot express are still
 * enforced afterwards by zod on the server.
 */
export function toGeminiSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  return clean(raw) as Record<string, unknown>;
}

function clean(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(clean);
  if (!node || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
    if (DROP_KEYS.has(key)) continue;
    out[key] = clean(value);
  }
  return out;
}
