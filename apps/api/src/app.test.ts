import { describe, expect, it } from 'vitest';
import { parseConfig } from '@crawlspider/config';
import { serviceStatusSchema } from '@crawlspider/contracts';
import type { Storage } from '@crawlspider/storage';
import { createApp } from './app.js';
const config = parseConfig({
  NODE_ENV: 'test',
  DATABASE_URL: 'postgresql://localhost/test',
  REDIS_URL: 'redis://localhost',
});

describe('public website through a local tunnel', () => {
  const db = { readiness: async () => ({ postgres: true, redis: true, schema: true }) } as Storage;
  it('accepts credentialed requests and preflights only from the configured production website', async () => {
    const app = createApp(
      parseConfig({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://localhost/test',
        REDIS_URL: 'redis://localhost',
        WEB_ORIGIN: 'https://crawlspider.example',
        PUBLIC_WEB_URL: 'https://crawlspider.example',
        LOG_LEVEL: 'silent',
      }),
      db,
    );
    try {
      const allowed = await app.inject({
        url: '/health/live',
        headers: { origin: 'https://crawlspider.example' },
      });
      expect(allowed.headers['access-control-allow-origin']).toBe('https://crawlspider.example');
      expect(allowed.headers['access-control-allow-credentials']).toBe('true');
      const preflight = await app.inject({
        method: 'OPTIONS',
        url: '/v1/scans',
        headers: {
          origin: 'https://crawlspider.example',
          'access-control-request-method': 'POST',
          'access-control-request-headers': 'content-type,x-scan-cancel-token',
        },
      });
      expect(preflight.statusCode).toBe(204);
      expect(preflight.headers['access-control-allow-headers']).toContain('x-scan-cancel-token');
      const denied = await app.inject({
        url: '/health/live',
        headers: { origin: 'https://other.example' },
      });
      expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    } finally {
      await app.close();
    }
  });

  it('uses the nearest forwarded visitor for a trusted local hop, with direct and remote peers protected', async () => {
    for (const enabled of [false, true]) {
      const app = createApp({ ...config, API_TRUST_LOOPBACK_PROXY: enabled }, db);
      app.get('/test/client-ip', (request) => ({ ip: request.ip }));
      try {
        for (const remoteAddress of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '203.0.113.7']) {
          const response = await app.inject({
            url: '/test/client-ip',
            remoteAddress,
            headers: { 'x-forwarded-for': '192.0.2.99, 198.51.100.8' },
          });
          expect(response.json().ip).toBe(
            enabled && remoteAddress !== '203.0.113.7' ? '198.51.100.8' : remoteAddress,
          );
        }
        expect(
          (await app.inject({ url: '/test/client-ip', remoteAddress: '127.0.0.1' })).json().ip,
        ).toBe('127.0.0.1');
      } finally {
        await app.close();
      }
    }
  });
});
describe('service health', () => {
  it('stays alive but is not ready when the database is unavailable', async () => {
    const db = {
      readiness: async () => ({ postgres: false, redis: true, schema: false }),
    } as Storage;
    const app = createApp(config, db);
    try {
      expect((await app.inject('/health/live')).statusCode).toBe(200);
      const ready = await app.inject('/health/ready');
      expect(ready.statusCode).toBe(503);
      expect(serviceStatusSchema.parse(ready.json()).status).toBe('degraded');
      const text = (await app.inject('/v1/status')).body;
      expect(text).not.toContain('DATABASE_URL');
    } finally {
      await app.close();
    }
  });
});
