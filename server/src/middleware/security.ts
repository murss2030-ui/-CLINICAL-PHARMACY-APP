import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { describeAIError, type AIErrorCode, type ModelProviderName } from '../../../shared/ai';

export function sendError(res: Response, status: number, code: AIErrorCode, details?: string[], provider?: ModelProviderName): void {
  const info = describeAIError(code, provider);
  res.status(status).json({
    ok: false,
    error: { code, message: info.message, retryable: info.retryable, ...(provider ? { provider } : {}), ...(details?.length ? { details } : {}) },
  });
}

/** Optional shared access code protecting the AI provider quotas on public deployments. */
export function requireAccessToken(token: string | undefined) {
  const expected = token ? Buffer.from(token) : undefined;
  return (req: Request, res: Response, next: NextFunction) => {
    if (!expected) return next();
    const header = req.get('authorization') ?? '';
    const provided = Buffer.from(header.startsWith('Bearer ') ? header.slice(7).trim() : '');
    if (provided.length === expected.length && timingSafeEqual(provided, expected)) return next();
    sendError(res, 401, 'UNAUTHORIZED');
  };
}

/** Fixed-window per-client rate limit for AI requests. */
export function rateLimit(perMinute: number) {
  const hits = new Map<string, { count: number; windowStart: number }>();
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const entry = hits.get(key);
    if (!entry || now - entry.windowStart >= 60_000) {
      hits.set(key, { count: 1, windowStart: now });
      if (hits.size > 10_000) hits.clear();
      return next();
    }
    entry.count++;
    if (entry.count > perMinute) {
      res.setHeader('retry-after', String(Math.ceil((entry.windowStart + 60_000 - now) / 1000)));
      return sendError(res, 429, 'RATE_LIMITED');
    }
    next();
  };
}
