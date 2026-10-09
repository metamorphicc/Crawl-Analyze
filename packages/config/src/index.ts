import { config as dotenv } from 'dotenv';
import { z } from 'zod';

const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
const optionalUrl = z.preprocess((v) => (v === '' ? undefined : v), z.url().optional());
const int = (fallback: number, min: number, max: number) =>
  z.coerce.number().int().min(min).max(max).default(fallback);
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.url().refine((v) => /^postgres(ql)?:/.test(v)),
  REDIS_URL: z.url().refine((v) => /^rediss?:/.test(v)),
  HELIUS_API_KEY: optional,
  SOLANA_RPC_URL: optionalUrl,
  SOLANA_FALLBACK_RPC_URL: optionalUrl,
  TELEGRAM_BOT_TOKEN: optional,
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: int(3001, 1, 65535),
  WEB_ORIGIN: z.url().default('http://localhost:5173'),
  PUBLIC_WEB_URL: z.url().default('http://localhost:5173'),
  SCAN_CONCURRENCY: int(4, 1, 32),
  SCAN_QUEUE_LIMIT: int(200, 1, 10000),
  SCAN_IP_MINUTE_LIMIT: int(6, 1, 1000),
  SCAN_IP_DAILY_LIMIT: int(100, 1, 100000),
  SCAN_CACHE_MS: int(60000, 1000, 600000),
  SSE_CONNECTION_LIMIT: int(100, 1, 10000),
  SCAN_PREVIEW_DEADLINE_MS: int(15000, 1000, 120000),
  SCAN_DEEP_DEADLINE_MS: int(120000, 1000, 600000),
  PROVIDER_REQUEST_TIMEOUT_MS: int(5000, 100, 30000),
  PROVIDER_MAX_RPS: int(5, 1, 100),
  PROVIDER_DAILY_REQUEST_LIMIT: int(50000, 1, 10000000),
  MAX_HOLDER_PAGES: int(200, 1, 10000),
  MAX_HISTORY_OWNERS: int(100, 1, 1000),
  ALERT_RECHECK_INTERVAL_MS: int(900000, 60000, 86400000),
  WATCHLIST_LIMIT: int(20, 1, 1000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});
export type Config = z.infer<typeof schema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    // Zod issues can contain user input. Only key names leave this boundary.
    throw new Error(
      `Invalid configuration keys: ${[...new Set(result.error.issues.map((i) => i.path.join('.')))].join(', ')}`,
    );
  }
  const value = result.data;
  if (value.NODE_ENV === 'production') {
    for (const key of ['WEB_ORIGIN', 'PUBLIC_WEB_URL'] as const) {
      if (new URL(value[key]).protocol !== 'https:')
        throw new Error(`${key} requires HTTPS in production`);
    }
  }
  return value;
}
export function loadConfig(): Config {
  dotenv({ quiet: true });
  return parseConfig(process.env);
}
export function capabilities(config: Config) {
  return {
    rpc: Boolean(config.SOLANA_RPC_URL || config.HELIUS_API_KEY),
    holderIndex: Boolean(config.HELIUS_API_KEY),
    telegram: Boolean(config.TELEGRAM_BOT_TOKEN),
  };
}
export const loggerOptions = (config: Config) => ({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-scan-cancel-token"]',
      'req.body',
      'res.headers.set-cookie',
      'token',
      'apiKey',
      'password',
      'databaseUrl',
      'rpcUrl',
    ],
    censor: '[REDACTED]',
  },
});
export function installShutdown(close: () => Promise<void>) {
  let closing = false;
  const handler = () => {
    if (closing) return;
    closing = true;
    const timeout = setTimeout(() => process.exit(1), 10000).unref();
    close().then(
      () => {
        clearTimeout(timeout);
        process.exit(0);
      },
      () => process.exit(1),
    );
  };
  process.once('SIGINT', handler);
  process.once('SIGTERM', handler);
}
