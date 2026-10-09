import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { isolatedEnvironment } from './environment.js';
import { WatchStore, TelegramStore, quietAt } from '@crawlspider/storage';
import { notificationSettingsSchema } from '@crawlspider/contracts';
import { createApp } from '../../apps/api/src/app.js';
import { meaningfulChanges, monitorTick } from '../../apps/worker/src/monitor.js';
import { startAlerts } from '../../apps/bot/src/alerts.js';
import { watchHooks } from '../../apps/bot/src/watches.js';
import { createBot } from '../../apps/bot/src/app.js';
import { mockTelegram, message, callback } from '../fixtures/telegram.js';
import { fixtureReport } from '../fixtures/report.js';
import { key } from '../fixtures/analytics.js';
describe('linked watches and durable notifications (synthetic external transports)', () => {
  it('atomically advances monitor baselines and coalesces alerts across scheduler restarts', async () => {
    const e = await isolatedEnvironment(),
      s = new WatchStore(e.storage.pool, e.config),
      tg = new TelegramStore(e.storage.pool, e.config);
    try {
      await tg.recoverIdentity(7, 7);
      await s.add('7', key(1));
      for (let i = 0; i < 3; i++) {
        await e.storage.pool.query('UPDATE watches SET next_check_at=now()');
        await monitorTick(e.config, e.storage);
        const w = (await s.list('7'))[0]!,
          lease = (await e.scans.claim(w.pendingJobId!))!;
        const report = fixtureReport(
          lease.id,
          'deep',
          key(1),
          new Date(Date.now() - 1800000 + i * 600000).toISOString(),
        );
        report.snapshot.quality.minSlot = String(445186127 + i * 100);
        report.snapshot.quality.maxSlot = String(445186127 + i * 100);
        report.snapshot.holders[0]!.amount = String(50 - i * 10);
        report.snapshot.holders[1]!.amount = String(50 + i * 10);
        await e.scans.finish(lease, report);
        await monitorTick(e.config, e.storage);
        await monitorTick(e.config, e.storage);
        expect((await s.list('7'))[0]!.lastReportId).toBe(report.id);
      }
      const out = (await e.storage.pool.query('SELECT payload FROM notification_outbox')).rows;
      expect(out).toHaveLength(1);
      expect(out[0].payload.eventCount).toBe(2);
      expect(out[0].payload.changes.join(' ')).toContain('продажа не установлена');
    } finally {
      await e.close();
    }
  });
  it('links only the approving Telegram user, checks expiry/replay, origin, CSRF and isolated lists', async () => {
    const e = await isolatedEnvironment(),
      s = new WatchStore(e.storage.pool, e.config),
      tg = new TelegramStore(e.storage.pool, e.config),
      app = createApp(
        { ...e.config, TELEGRAM_BOT_USERNAME: 'crawlspider_test', TELEGRAM_BOT_TOKEN: 'synthetic' },
        e.storage,
      );
    try {
      await tg.recoverIdentity(7, 7);
      await tg.recoverIdentity(8, 8);
      expect((await app.inject({ method: 'POST', url: '/v1/auth/link' })).statusCode).toBe(403);
      const r = await app.inject({
          method: 'POST',
          url: '/v1/auth/link',
          headers: { origin: e.config.WEB_ORIGIN },
        }),
        link = r.json(),
        flow = String(r.headers['set-cookie']).split(';')[0]!;
      expect((await app.inject({ url: `/v1/auth/link/${link.id}` })).statusCode).toBe(410);
      await s.requestLink(link.id, 7);
      await expect(s.approveLink(link.id, 8)).rejects.toThrow();
      await s.approveLink(link.id, 7);
      const done = await app.inject({
        method: 'POST',
        url: '/v1/auth/complete',
        headers: { origin: e.config.WEB_ORIGIN, cookie: flow },
        payload: { id: link.id },
      });
      expect(done.statusCode).toBe(200);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/auth/complete',
            headers: { origin: e.config.WEB_ORIGIN, cookie: flow },
            payload: { id: link.id },
          })
        ).statusCode,
      ).toBe(403);
      const cookies = done.headers['set-cookie'] as string[],
        session = cookies[0]!.split(';')[0]!,
        me = (await app.inject({ url: '/v1/me', headers: { cookie: session } })).json();
      expect(me.user.id).toBe('7');
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/watches',
            headers: { cookie: session, origin: e.config.WEB_ORIGIN },
            payload: { mint: key(1) },
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/v1/watches',
            headers: { cookie: session, origin: e.config.WEB_ORIGIN, 'x-csrf-token': me.user.csrf },
            payload: { mint: key(1) },
          })
        ).statusCode,
      ).toBe(200);
      expect(await s.list('7')).toHaveLength(1);
      expect(await s.list('8')).toEqual([]);
      await s.remove('8', key(1));
      expect(await s.list('7')).toHaveLength(1);
      const expired = await s.beginLink();
      await e.storage.pool.query(
        "UPDATE telegram_links SET expires_at=now()-interval '1 second' WHERE id=$1",
        [expired.id],
      );
      await expect(s.requestLink(expired.id, 7)).rejects.toThrow();
      await s.deleteUser('7');
      expect(await s.session(session.split('=')[1]!)).toBeNull();
      expect(await s.list('7')).toEqual([]);
    } finally {
      await app.close();
      await e.close();
    }
  });
  it('shares bot/site lists, enforces sender approval and persists settings', async () => {
    const e = await isolatedEnvironment(),
      s = new WatchStore(e.storage.pool, e.config),
      mock = mockTelegram(),
      app = createBot(e.config, e.storage, {
        bot: mock.bot,
        pace: false,
        hooks: watchHooks(e.config, e.storage),
      });
    try {
      await app.bot.handleUpdate(message(1, `/watch ${key(1)}`));
      expect(await s.list('7')).toHaveLength(1);
      await app.bot.handleUpdate(message(2, '/settings quiet 22-8'));
      expect(
        (await new WatchStore(e.storage.pool, e.config).settings('7')).settings.quietHours,
      ).toEqual({ start: 22, end: 8 });
      const link = await s.beginLink();
      await app.bot.handleUpdate(message(3, `/start link_${link.id}`));
      await app.bot.handleUpdate(callback(4, `link:${link.id}`, 103, 8));
      expect(await s.linkStatus(link.id, link.browser)).toBe('requested');
      await app.bot.handleUpdate(callback(5, `link:${link.id}`, 103));
      expect(await s.linkStatus(link.id, link.browser)).toBe('approved');
    } finally {
      await e.close();
    }
  });
  it('does not turn partial/stale/rank changes into sale alerts and schedules reserved monitor jobs', async () => {
    const e = await isolatedEnvironment(),
      s = new WatchStore(e.storage.pool, e.config),
      tg = new TelegramStore(e.storage.pool, e.config);
    try {
      await tg.recoverIdentity(7, 7);
      await s.add('7', key(1));
      await monitorTick(e.config, e.storage);
      const row = (await s.list('7'))[0]!;
      expect(row.pendingJobId).not.toBeNull();
      expect(
        (await e.storage.pool.query('SELECT lane FROM scan_jobs WHERE id=$1', [row.pendingJobId]))
          .rows[0].lane,
      ).toBe('monitor');
      const prev = fixtureReport(randomUUID(), 'deep', key(1), '2026-10-09T00:00:00.000Z'),
        next = fixtureReport(randomUUID(), 'deep', key(1), '2026-10-09T00:15:00.000Z');
      next.snapshot.quality.minSlot = '445186227';
      next.snapshot.quality.maxSlot = '445186227';
      next.snapshot.holders.reverse();
      const settings = notificationSettingsSchema.parse({});
      expect(meaningfulChanges(prev, next, settings)).toEqual([]);
      next.snapshot.holders[0]!.amount = '40';
      next.snapshot.holders[1]!.amount = '60';
      const lines = meaningfulChanges(prev, next, settings);
      expect(lines).toHaveLength(2);
      expect(lines.join(' ')).toContain('продажа не установлена');
      next.snapshot.quality.status = 'partial';
      expect(meaningfulChanges(prev, next, settings)).toEqual([]);
    } finally {
      await e.close();
    }
  });
  it('batches, preserves 429, pauses 403, respects quiet/cadence and records ambiguous restart', async () => {
    const e = await isolatedEnvironment(),
      s = new WatchStore(e.storage.pool, e.config),
      tg = new TelegramStore(e.storage.pool, e.config),
      mock = mockTelegram(),
      alerts = startAlerts(e.config, e.storage, mock.bot, true);
    try {
      await tg.recoverIdentity(7, 7);
      await s.add('7', key(1));
      const w = (await e.storage.pool.query('SELECT id FROM watches')).rows[0].id;
      const insert = async () =>
        e.storage.pool.query(
          'INSERT INTO notification_outbox(id,user_id,watch_id,idempotency_key,payload) VALUES($1,7,$2,$3,$4)',
          [
            randomUUID(),
            w,
            randomUUID(),
            JSON.stringify({
              mint: key(1),
              reportId: randomUUID(),
              changes: ['Баланс изменился; продажа не установлена.'],
              eventCount: 1,
            }),
          ],
        );
      await insert();
      mock.fail(429, 2);
      await alerts.tick();
      expect(
        (await e.storage.pool.query('SELECT state FROM notification_outbox')).rows[0].state,
      ).toBe('pending');
      await e.storage.pool.query('UPDATE notification_outbox SET next_attempt_at=now()');
      await alerts.tick();
      expect(
        (await e.storage.pool.query('SELECT state FROM notification_outbox')).rows[0].state,
      ).toBe('sent');
      await insert();
      expect(await s.claimAlerts()).toBeNull();
      await e.storage.pool.query('UPDATE watches SET last_delivery_at=NULL');
      await e.storage.pool.query('UPDATE notification_outbox SET next_attempt_at=now()');
      mock.fail(403);
      await alerts.tick();
      expect((await s.settings('7')).pauseReason).toBe('bot-blocked');
      await s.updateSettings(
        '7',
        notificationSettingsSchema.parse({ quietHours: { start: 0, end: 0 } }),
      );
      await insert();
      expect(await s.claimAlerts()).toBeNull();
      expect(
        quietAt(
          notificationSettingsSchema.parse({ quietHours: { start: 22, end: 8 } }),
          new Date('2026-10-09T23:00:00Z'),
        ),
      ).toBe(true);
      await s.updateSettings('7', notificationSettingsSchema.parse({}));
      await e.storage.pool.query('UPDATE notification_outbox SET next_attempt_at=now()');
      const claim = await s.claimAlerts();
      expect(claim).not.toBeNull();
      await e.storage.pool.query(
        "UPDATE notification_outbox SET locked_at=now()-interval '2 minutes' WHERE state='sending'",
      );
      await s.claimAlerts();
      expect(
        (
          await e.storage.pool.query(
            "SELECT count(*) FROM notification_outbox WHERE state='uncertain'",
          )
        ).rows[0].count,
      ).toBe('1');
    } finally {
      await alerts.close();
      await e.close();
    }
  });
});
