import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AIResult } from './ai/AIProvider';
import { ResponseCache } from './ai/cache';
import type { AIRouter } from './ai/router';
import type { ServerConfig } from './config';
import type { AuditRepository } from './db/repository';
import { rateLimit, requireAccessToken, sendError } from './middleware/security';
import { aiRouter } from './routes/ai';

export interface AppDeps {
  config: ServerConfig;
  router: AIRouter;
  audit: AuditRepository;
  log?: (msg: string) => void;
  version?: string;
}

export function createApp({ config, router, audit, log = console.log, version = '1.0.0' }: AppDeps) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'media-src': ["'self'", 'blob:'],
          'style-src': ["'self'", "'unsafe-inline'"],
          'script-src': ["'self'"],
          'connect-src': ["'self'"],
          'worker-src': ["'self'", 'blob:'],
          'manifest-src': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
    }),
  );

  const allowed = new Set(config.allowedOrigins);
  app.use(
    '/api',
    cors({
      origin: (origin, cb) => cb(null, !origin || allowed.has(origin)),
      allowedHeaders: ['content-type', 'authorization', 'x-preceptor-demo-case', 'x-preceptor-demo-doc', 'x-preceptor-provider'],
      methods: ['GET', 'POST'],
      maxAge: 600,
    }),
  );

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, service: 'preceptor-api', version, uptimeSeconds: Math.round(process.uptime()), database: audit.kind, time: new Date().toISOString() });
  });

  app.use('/api/ai', express.json({ limit: '25mb' }));
  app.use('/api/ai', requireAccessToken(config.accessToken));
  const limiter = rateLimit(config.rateLimitPerMinute);
  app.use('/api/ai', (req, res, next) => (req.method === 'POST' ? limiter(req, res, next) : next()));
  app.use(
    '/api/ai',
    aiRouter({
      router,
      audit,
      cache: new ResponseCache<AIResult<unknown>>(config.cacheTtlMinutes * 60_000),
      rateLimitPerMinute: config.rateLimitPerMinute,
      accessCodeRequired: Boolean(config.accessToken),
      log,
    }),
  );
  app.use('/api', (_req, res) => sendError(res, 404, 'REQUEST_INVALID', ['Unknown API endpoint.']));

  // Serve the built PWA when present (single deployable unit).
  if (config.clientDistDir && existsSync(join(config.clientDistDir, 'index.html'))) {
    const dist = config.clientDistDir;
    app.use(
      express.static(dist, {
        index: false,
        setHeaders: (res, path) => {
          if (path.endsWith('sw.js') || path.endsWith('index.html') || path.endsWith('manifest.webmanifest')) res.setHeader('cache-control', 'no-cache');
          else if (path.includes(`${join(dist, 'assets')}`)) res.setHeader('cache-control', 'public, max-age=31536000, immutable');
        },
      }),
    );
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.setHeader('cache-control', 'no-cache');
      res.sendFile(join(dist, 'index.html'));
    });
  }

  // Body-parser and unexpected errors: never leak stack traces or payloads.
  app.use((err: Error & { type?: string; status?: number }, _req: Request, res: Response, _next: NextFunction) => {
    if (err.type === 'entity.too.large') return sendError(res, 413, 'REQUEST_TOO_LARGE');
    if (err.type === 'entity.parse.failed') return sendError(res, 400, 'REQUEST_INVALID', ['Body is not valid JSON.']);
    log(`[server] unexpected error: ${err.name}`);
    sendError(res, 500, 'SERVER_ERROR');
  });

  return app;
}
