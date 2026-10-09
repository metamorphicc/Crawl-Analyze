import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Config } from '@crawlspider/config';
import type { TelegramStore } from '@crawlspider/storage';
export function validWebhookSecret(actual: unknown, expected: string) {
  if (typeof actual !== 'string') return false;
  const a = Buffer.from(actual),
    b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function webhookServer(config: Config, store: TelegramStore) {
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health/live') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
      return;
    }
    if (
      req.method !== 'POST' ||
      req.url !== '/telegram' ||
      !validWebhookSecret(
        req.headers['x-telegram-bot-api-secret-token'],
        config.TELEGRAM_WEBHOOK_SECRET!,
      )
    ) {
      res.writeHead(403);
      res.end();
      return;
    }
    try {
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 262144) {
          res.writeHead(413);
          res.end();
          return;
        }
        chunks.push(chunk);
      }
      const update = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (
        typeof update !== 'object' ||
        update === null ||
        !Number.isSafeInteger(update.update_id) ||
        update.update_id < 0
      ) {
        res.writeHead(400);
        res.end();
        return;
      }
      await store.enqueue(update);
      res.writeHead(200);
      res.end('OK');
    } catch {
      if (!res.headersSent) res.writeHead(503);
      res.end();
    }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  server.maxRequestsPerSocket = 100;
  return server;
}
