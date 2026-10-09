import { describe, it, expect } from 'vitest';
import { isolatedEnvironment } from './environment.js';
import { mockTelegram, message, callback } from '../fixtures/telegram.js';
import { key } from '../fixtures/analytics.js';
import { fixtureReport } from '../fixtures/report.js';
import { TelegramStore } from '@crawlspider/storage';
import { createBot, startBotProcessor } from '../../apps/bot/src/app.js';
import { webhookServer } from '../../apps/bot/src/runtime.js';
describe('Telegram uses durable shared reports without live outbound calls', () => {
  it('ingests a batch and its offset atomically, deduplicates and records ambiguous recovery', async () => {
    const e = await isolatedEnvironment(),
      s = new TelegramStore(e.storage.pool, e.config);
    try {
      await s.ingestBatch([message(10, '/help'), message(11, '/help')]);
      await s.ingestBatch([message(11, '/help')]);
      expect(await s.offset()).toBe(12);
      await expect(s.ingestBatch([message(12, '/help'), { update_id: NaN }])).rejects.toThrow();
      expect(await s.offset()).toBe(12);
      expect(
        (await e.storage.pool.query('SELECT count(*) FROM telegram_updates')).rows[0].count,
      ).toBe('2');
      const claim = (await s.claim())!;
      await e.storage.pool.query(
        "UPDATE telegram_updates SET lease_until=now()-interval '1 second' WHERE id=$1",
        [claim.id],
      );
      await s.claim();
      expect(
        (await e.storage.pool.query('SELECT state,body FROM telegram_updates WHERE id=10')).rows[0],
      ).toEqual({ state: 'uncertain', body: {} });
    } finally {
      await e.close();
    }
  });
  it('accepts a direct mint but ignores ordinary group messages, edits preview/final and enforces callback sender', async () => {
    const e = await isolatedEnvironment(),
      mock = mockTelegram(),
      app = createBot(e.config, e.storage, { bot: mock.bot, pace: false }),
      processor = startBotProcessor(e.config, e.storage, app.bot, { manual: true });
    try {
      await app.store.enqueue(message(1, key(1), 7, true));
      await processor.tick();
      expect(mock.calls).toEqual([]);
      expect((await e.storage.pool.query('SELECT count(*) FROM scan_jobs')).rows[0].count).toBe(
        '0',
      );
      await app.store.enqueue(message(2, key(1)));
      await processor.tick();
      expect(mock.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);
      let row = (await e.storage.pool.query('SELECT * FROM telegram_scan_messages')).rows[0];
      const lease = (await e.scans.claim(row.job_id))!;
      const preview = fixtureReport(row.job_id, 'preview');
      await e.scans.checkpoint(lease, 'preview', preview);
      await e.storage.pool.query('UPDATE telegram_scan_messages SET next_at=now()');
      await processor.tick();
      expect(mock.calls.at(-1)!.payload.text).toContain('Предварительный результат');
      expect(mock.calls.at(-1)!.method).toBe('editMessageText');
      const final = fixtureReport(row.job_id, 'deep', key(1), new Date().toISOString());
      await e.scans.finish(lease, final);
      await e.storage.pool.query('UPDATE telegram_scan_messages SET next_at=now()');
      await processor.tick();
      expect(mock.calls.at(-1)!.payload.text).toContain(final.identity.mint);
      expect(mock.calls.at(-1)!.payload.reply_markup.inline_keyboard[0][0].url).toContain(
        `/report/${final.id}`,
      );
      expect(mock.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(1);
      row = (await e.storage.pool.query('SELECT * FROM telegram_scan_messages')).rows[0];
      await app.store.enqueue(callback(3, `watch:${row.id}`, row.message_id, 8));
      await processor.tick();
      expect(mock.calls.at(-1)!.payload.text).toContain('только автору');
      expect(
        (await e.storage.pool.query('SELECT state FROM telegram_scan_messages')).rows[0].state,
      ).toBe('done');
    } finally {
      await processor.close();
      await e.close();
    }
  });
  it('accepts explicit group commands, bounds input and handles 429 before retrying acknowledgement', async () => {
    const e = await isolatedEnvironment(),
      mock = mockTelegram(),
      app = createBot(e.config, e.storage, { bot: mock.bot, pace: false }),
      p = startBotProcessor(e.config, e.storage, app.bot, { manual: true });
    try {
      await app.store.enqueue(message(1, `/scan@crawlspider_test preview ${key(1)}`, 7, true));
      mock.fail(429, 3);
      await p.tick();
      expect(
        (await e.storage.pool.query('SELECT state FROM telegram_scan_messages')).rows[0].state,
      ).toBe('pending');
      await e.storage.pool.query('UPDATE telegram_scan_messages SET next_at=now()');
      await p.tick();
      expect(
        (await e.storage.pool.query('SELECT state FROM telegram_scan_messages')).rows[0].state,
      ).toBe('ready');
      expect(mock.calls.filter((c) => c.method === 'sendMessage')).toHaveLength(2);
      await app.store.enqueue(message(2, '/scan evil'));
      await p.tick();
      expect(mock.calls.at(-1)!.payload.text).toContain('Не удалось проверить ввод');
    } finally {
      await p.close();
      await e.close();
    }
  });
  it('requires the webhook secret and commits before a 200 response; replays have one inbox row', async () => {
    const e = await isolatedEnvironment(),
      s = new TelegramStore(e.storage.pool, e.config),
      secret = 'x'.repeat(32),
      server = webhookServer({ ...e.config, TELEGRAM_WEBHOOK_SECRET: secret }, s);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error();
    const url = `http://127.0.0.1:${address.port}/telegram`;
    try {
      expect(
        (await fetch(url, { method: 'POST', body: JSON.stringify(message(3, '/help')) })).status,
      ).toBe(403);
      for (let i = 0; i < 2; i++)
        expect(
          (
            await fetch(url, {
              method: 'POST',
              headers: { 'x-telegram-bot-api-secret-token': secret },
              body: JSON.stringify(message(3, '/help')),
            })
          ).status,
        ).toBe(200);
      expect(
        (await e.storage.pool.query('SELECT count(*) FROM telegram_updates')).rows[0].count,
      ).toBe('1');
    } finally {
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
      await e.close();
    }
  });
});
