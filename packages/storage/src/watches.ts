import { randomUUID, randomBytes, randomInt } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '@crawlspider/config';
import {
  PublicError,
  notificationSettingsSchema,
  type NotificationSettings,
} from '@crawlspider/contracts';
import { tgHash } from './telegram.js';
export function quietAt(settings: NotificationSettings, now = new Date()) {
  if (!settings.quietHours) return false;
  const hour = new Date(now.getTime() + settings.utcOffsetMinutes * 60000).getUTCHours(),
    { start, end } = settings.quietHours;
  return start === end
    ? true
    : start < end
      ? hour >= start && hour < end
      : hour >= start || hour < end;
}
export class WatchStore {
  constructor(
    readonly pool: pg.Pool,
    readonly config: Config,
  ) {}
  async tx<T>(fn: (c: pg.PoolClient) => Promise<T>) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await fn(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async beginLink() {
    const id = randomUUID(),
      browser = randomBytes(32).toString('hex'),
      code = String(randomInt(100000, 1000000)),
      r = await this.pool.query(
        'INSERT INTO telegram_links(id,browser_hash,display_code) VALUES($1,$2,$3) RETURNING expires_at',
        [id, tgHash(browser), code],
      );
    return { id, browser, code, expiresAt: r.rows[0].expires_at.toISOString() as string };
  }
  async linkStatus(id: string, browser: string) {
    const r = await this.pool.query(
      'SELECT state FROM telegram_links WHERE id=$1 AND browser_hash=$2 AND expires_at>now()',
      [id, tgHash(browser)],
    );
    if (!r.rows[0]) throw new PublicError('LINK_EXPIRED', 'Link expired or invalid', 410);
    return r.rows[0].state as 'pending' | 'requested' | 'approved' | 'consumed';
  }
  async requestLink(id: string, userId: number) {
    const r = await this.pool.query(
      "UPDATE telegram_links SET state='requested',approver_id=$2 WHERE id=$1 AND expires_at>now() AND (state='pending' OR (state='requested' AND approver_id=$2)) RETURNING display_code",
      [id, userId],
    );
    if (!r.rows[0]) throw new PublicError('LINK_EXPIRED', 'Link expired or already used', 410);
    return r.rows[0].display_code as string;
  }
  async approveLink(id: string, userId: number) {
    const r = await this.pool.query(
      "UPDATE telegram_links SET state='approved' WHERE id=$1 AND state='requested' AND approver_id=$2 AND expires_at>now() RETURNING id",
      [id, userId],
    );
    if (!r.rowCount) throw new PublicError('LINK_REJECTED', 'Link approval rejected', 403);
  }
  async completeLink(id: string, browser: string) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE telegram_links SET state='consumed' WHERE id=$1 AND browser_hash=$2 AND state='approved' AND expires_at>now() RETURNING approver_id::text",
        [id, tgHash(browser)],
      );
      if (!r.rows[0])
        throw new PublicError('LINK_REJECTED', 'Link is not approved or already consumed', 403);
      const token = randomBytes(32).toString('hex'),
        csrf = randomBytes(32).toString('hex');
      await c.query(
        "INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,now()+interval '30 days')",
        [tgHash(token), r.rows[0].approver_id, csrf],
      );
      return { token };
    });
  }
  async session(token: string) {
    const r = await this.pool.query(
      'SELECT s.user_id::text AS id,s.csrf_token AS csrf,i.settings,i.notification_pause_reason AS "pauseReason" FROM sessions s JOIN telegram_identities i ON i.user_id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now()',
      [tgHash(token)],
    );
    return r.rows[0]
      ? ({ ...r.rows[0], settings: notificationSettingsSchema.parse(r.rows[0].settings) } as {
          id: string;
          csrf: string;
          settings: NotificationSettings;
          pauseReason: string | null;
        })
      : null;
  }
  async logout(token: string) {
    await this.pool.query('DELETE FROM sessions WHERE token_hash=$1', [tgHash(token)]);
  }
  async settings(userId: string) {
    const r = await this.pool.query(
      'SELECT settings,notification_pause_reason FROM telegram_identities WHERE user_id=$1',
      [userId],
    );
    if (!r.rows[0]) throw new PublicError('NOT_LINKED', 'Telegram identity not found', 401);
    return {
      settings: notificationSettingsSchema.parse(r.rows[0].settings),
      pauseReason: r.rows[0].notification_pause_reason as string | null,
    };
  }
  async updateSettings(userId: string, settings: NotificationSettings) {
    const value = notificationSettingsSchema.parse(settings);
    await this.pool.query(
      'UPDATE telegram_identities SET settings=$2,notification_pause_reason=CASE WHEN $3 THEN NULL ELSE notification_pause_reason END WHERE user_id=$1',
      [userId, JSON.stringify(value), value.enabled],
    );
    return value;
  }
  async list(userId: string) {
    return (
      await this.pool.query(
        'SELECT w.mint,w.last_report_id AS "lastReportId",w.pending_job_id AS "pendingJobId",w.next_check_at AS "nextCheckAt",w.last_check_at AS "lastCheckAt",r.body->\'snapshot\'->\'quality\'->>\'status\' AS "lastQuality" FROM watches w LEFT JOIN reports r ON r.id=w.last_report_id WHERE user_id=$1 ORDER BY w.created_at',
        [userId],
      )
    ).rows.map((r) => ({
      ...r,
      nextCheckAt: r.nextCheckAt.toISOString(),
      lastCheckAt: r.lastCheckAt?.toISOString() ?? null,
    }));
  }
  async add(userId: string, mint: string) {
    await this.tx(async (c) => {
      await c.query('SELECT user_id FROM telegram_identities WHERE user_id=$1 FOR UPDATE', [
        userId,
      ]);
      if (
        (await c.query('SELECT 1 FROM watches WHERE user_id=$1 AND mint=$2', [userId, mint]))
          .rowCount
      )
        return;
      const n = Number(
        (await c.query('SELECT count(*) AS n FROM watches WHERE user_id=$1', [userId])).rows[0].n,
      );
      if (n >= this.config.WATCHLIST_LIMIT)
        throw new PublicError('WATCH_LIMIT', 'Watchlist limit reached', 429);
      await c.query(
        'INSERT INTO watches(id,user_id,mint,last_report_id) VALUES($1,$2,$3,(SELECT id FROM reports WHERE mint=$3 ORDER BY observed_at DESC LIMIT 1))',
        [randomUUID(), userId, mint],
      );
    });
  }
  async remove(userId: string, mint: string) {
    await this.pool.query('DELETE FROM watches WHERE user_id=$1 AND mint=$2', [userId, mint]);
  }
  async unlink(userId: string) {
    await this.tx(async (c) => {
      await c.query('DELETE FROM sessions WHERE user_id=$1', [userId]);
      await c.query('DELETE FROM telegram_links WHERE approver_id=$1', [userId]);
    });
  }
  async deleteUser(userId: string) {
    await this.tx(async (c) => {
      await c.query('DELETE FROM telegram_scan_messages WHERE user_id=$1', [userId]);
      await c.query('DELETE FROM telegram_identities WHERE user_id=$1', [userId]);
    });
  }
  async claimAlerts() {
    return this.tx(async (c) => {
      if (!(await c.query('SELECT pg_try_advisory_xact_lock(733930) AS ok')).rows[0].ok)
        return null;
      await c.query(
        "UPDATE notification_outbox SET state='uncertain' WHERE state='sending' AND locked_at<now()-interval '60 seconds'",
      );
      const chosen = (
        await c.query(
          "SELECT user_id::text AS id FROM notification_outbox WHERE state='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 1 FOR UPDATE SKIP LOCKED",
        )
      ).rows[0];
      if (!chosen) return null;
      const user = (
        await c.query(
          'SELECT private_chat_id::text AS chat,settings,notification_pause_reason FROM telegram_identities WHERE user_id=$1 FOR UPDATE',
          [chosen.id],
        )
      ).rows[0];
      if (!user) return null;
      const settings = notificationSettingsSchema.parse(user.settings);
      if (!settings.enabled || user.notification_pause_reason || quietAt(settings)) {
        await c.query(
          "UPDATE notification_outbox SET next_attempt_at=now()+interval '15 minutes' WHERE user_id=$1 AND state='pending'",
          [chosen.id],
        );
        return null;
      }
      const last = (
        await c.query('SELECT max(last_delivery_at) AS last FROM watches WHERE user_id=$1', [
          chosen.id,
        ])
      ).rows[0].last;
      if (last && new Date(last).getTime() + settings.cadenceMinutes * 60000 > Date.now()) {
        await c.query(
          "UPDATE notification_outbox SET next_attempt_at=$2 WHERE user_id=$1 AND state='pending'",
          [chosen.id, new Date(new Date(last).getTime() + settings.cadenceMinutes * 60000)],
        );
        return null;
      }
      const lease = randomUUID(),
        rows = (
          await c.query(
            "UPDATE notification_outbox SET state='sending',lease_token=$2,locked_at=now(),attempts=attempts+1 WHERE id IN (SELECT id FROM notification_outbox WHERE user_id=$1 AND state='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at LIMIT 20 FOR UPDATE SKIP LOCKED) RETURNING id,payload,attempts",
            [chosen.id, lease],
          )
        ).rows;
      return { userId: chosen.id as string, chatId: Number(user.chat), lease, rows };
    });
  }
  async alertResult(
    ids: string[],
    lease: string,
    state: 'sent' | 'pending' | 'failed' | 'uncertain',
    retrySeconds = 0,
  ) {
    await this.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(733930)');
      if (state === 'pending')
        for (const id of ids) {
          const sending = (
            await c.query(
              "SELECT watch_id,payload FROM notification_outbox WHERE id=$1 AND lease_token=$2 AND state='sending'",
              [id, lease],
            )
          ).rows[0];
          if (!sending) continue;
          const pending = (
            await c.query(
              "SELECT id,payload FROM notification_outbox WHERE watch_id=$1 AND state='pending' FOR UPDATE",
              [sending.watch_id],
            )
          ).rows[0];
          if (pending) {
            const payload = {
              ...pending.payload,
              changes: [...sending.payload.changes, ...pending.payload.changes].slice(-10),
              eventCount: sending.payload.eventCount + pending.payload.eventCount,
            };
            await c.query('UPDATE notification_outbox SET payload=$2 WHERE id=$1', [
              pending.id,
              JSON.stringify(payload),
            ]);
            await c.query(
              'UPDATE notification_outbox SET state=\'failed\',payload=payload||\'{"deliveryNote":"merged-into-pending"}\'::jsonb WHERE id=$1 AND lease_token=$2',
              [id, lease],
            );
          }
        }
      const rows = await c.query(
        "UPDATE notification_outbox SET state=$3,next_attempt_at=now()+$4::integer*interval '1 second',sent_at=CASE WHEN $3='sent' THEN now() ELSE sent_at END WHERE id=ANY($1::uuid[]) AND lease_token=$2 AND state='sending' RETURNING watch_id",
        [ids, lease, state, Math.max(0, Math.min(86400, retrySeconds))],
      );
      if (state === 'sent')
        await c.query('UPDATE watches SET last_delivery_at=now() WHERE id=ANY($1::uuid[])', [
          rows.rows.map((r) => r.watch_id),
        ]);
    });
  }
  async block(userId: string) {
    await this.pool.query(
      "UPDATE telegram_identities SET notification_pause_reason='bot-blocked' WHERE user_id=$1",
      [userId],
    );
  }
}
