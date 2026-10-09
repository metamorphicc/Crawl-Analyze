import type { Config } from '@crawlspider/config';

// Only development loopback aliases share an origin policy. Production stays exact.
export function allowedWebOrigins(config: Pick<Config, 'NODE_ENV' | 'WEB_ORIGIN'>): string[] {
  const configured = new URL(config.WEB_ORIGIN);
  const origins = new Set([configured.origin]);
  const loopback = ['localhost', '127.0.0.1', '[::1]'];
  if (config.NODE_ENV === 'development' && loopback.includes(configured.hostname)) {
    for (const hostname of loopback) {
      const alias = new URL(configured);
      alias.hostname = hostname;
      origins.add(alias.origin);
    }
  }
  return [...origins];
}
