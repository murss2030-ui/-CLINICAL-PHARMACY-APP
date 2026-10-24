import { PROVIDER_INFO } from '../../shared/ai';
import { buildRouter } from './ai/providers';
import { createApp } from './app';
import { loadDotEnv, readConfig } from './config';
import { openAuditRepository } from './db/sqlite';

loadDotEnv();
const config = readConfig();
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const router = buildRouter(config, log);
const audit = openAuditRepository(config.databasePath, log);
const app = createApp({ config, router, audit, log, version: process.env.npm_package_version ?? '1.0.0' });

const server = app.listen(config.port, () => {
  log(`PRECEPTOR API listening on http://localhost:${config.port}`);
  for (const s of providerSummary()) log(s);
  if (!router.configured) log('No AI provider configured — set GEMINI_API_KEY, DEEPSEEK_API_KEY and/or KIMI_API_KEY in the server environment');
  log(`Audit log: ${audit.kind}${config.clientDistDir ? ' · serving built PWA' : ''}`);
});

/** One line per provider, in failover order. Never prints keys. */
function providerSummary(): string[] {
  return router.order.map((name, i) => {
    const p = config[name];
    const label = PROVIDER_INFO[name].label;
    return p.apiKey ? `AI provider ${i + 1}: ${label} configured (model ${p.model})` : `AI provider ${i + 1}: ${label} not configured (${PROVIDER_INFO[name].keyEnv})`;
  });
}

function shutdown() {
  server.close(() => {
    audit.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
