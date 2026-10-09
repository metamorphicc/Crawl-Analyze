import { randomUUID, createHash } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '@crawlspider/config';
import { ScanStore } from './scans.js';
export const tgHash = (text: string) => createHash('sha256').update(text).digest('hex');
export type BotMessage = {
  id: string;
  update_id: string;
  user_id: string;
  chat_id: string;
  thread_id: number | null;
  job_id: string;
  message_id: number | null;
  state: string;
  last_digest: string | null;
  attempts: number;
};
export class TelegramStore {
  constructor(
    readonly pool: pg.Pool,
    readonly config: Config,
  ) {}
  async enqueue(body: { update_id: number }) {
    if (
      !Number.isSafeInteger(body.update_id) ||
      body.update_id < 0 ||
      Buffer.byteLength(JSON.stringify(body)) > 262144
    )
      throw new Error('Invalid Telegram update');
    return (
      (
        await this.pool.query(
          'INSERT INTO telegram_updates(id,body) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING id',
          [body.update_id, JSON.stringify(body)],
        )
      ).rowCount === 1
    );
  }
  async offset() {
    const r = await this.pool.query(
      "SELECT next_offset::text FROM telegram_poll_offset WHERE updated_at>now()-interval '6 days'",
    );
    return r.rows[0] ? Number(r.rows[0].next_offset) : 0;
  }
  async ingestBatch(updates: { update_id: number }[]) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      for (const body of updates) {
        if (
          !Number.isSafeInteger(body.update_id) ||
          body.update_id < 0 ||
          Buffer.byteLength(JSON.stringify(body)) > 262144
        )
          throw new Error('Invalid Telegram update');
        await c.query(
          'INSERT INTO telegram_updates(id,body) VALUES($1,$2) ON CONFLICT DO NOTHING',
          [body.update_id, JSON.stringify(body)],
        );
      }
      if (updates.length)
        await c.query(
          'INSERT INTO telegram_poll_offset(singleton,next_offset) VALUES(true,$1) ON CONFLICT(singleton) DO UPDATE SET next_offset=excluded.next_offset,updated_at=now()',
          [updates.at(-1)!.update_id + 1],
        );
      await c.query('COMMIT');
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async claim() {
    // A send can have succeeded before a process died: never blindly replay the update.
    await this.pool.query(
      "UPDATE telegram_updates SET state=CASE WHEN EXISTS(SELECT 1 FROM telegram_scan_messages m WHERE m.update_id=telegram_updates.id) THEN 'done' ELSE 'uncertain' END,body='{}'::jsonb WHERE state='processing' AND lease_until<now()",
    );
    const token = randomUUID(),
      r = await this.pool.query(
        "UPDATE telegram_updates SET state='processing',lease_token=$1,lease_until=now()+interval '120 seconds',attempts=attempts+1 WHERE id=(SELECT id FROM telegram_updates WHERE state='queued' AND next_at<=now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING id::text,body",
        [token],
      );
    return r.rows[0]
      ? { id: r.rows[0].id as string, body: r.rows[0].body as { update_id: number }, token }
      : null;
  }
  async finish(id: string, token: string) {
    await this.pool.query(
      "UPDATE telegram_updates SET state='done',body='{}'::jsonb,lease_token=NULL,lease_until=NULL WHERE id=$1 AND lease_token=$2 AND state='processing'",
      [id, token],
    );
  }
  async fail(id: string, token: string, code: string, retrySeconds?: number) {
    await this.pool.query(
      "UPDATE telegram_updates SET state=$3,error_code=$4,next_at=now()+$5::integer*interval '1 second',body=CASE WHEN $3='queued' THEN body ELSE '{}'::jsonb END WHERE id=$1 AND lease_token=$2 AND state='processing'",
      [id, token, retrySeconds !== undefined ? 'queued' : 'uncertain', code, retrySeconds ?? 0],
    );
  }
  async request(
    updateId: number,
    userId: number,
    chatId: number,
    mint: string,
    mode: 'preview' | 'deep',
    threadId?: number,
  ) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(710020)');
      const existing = await c.query('SELECT * FROM telegram_scan_messages WHERE update_id=$1', [
        updateId,
      ]);
      if (existing.rows[0]) {
        await c.query('COMMIT');
        return existing.rows[0] as BotMessage;
      }
      const accepted = await new ScanStore(this.pool, this.config).admit(
        mint,
        mode,
        tgHash(`telegram:${userId}:${this.config.DATABASE_URL}`),
        mode,
        false,
        c,
      );
      const r = await c.query(
        'INSERT INTO telegram_scan_messages(id,update_id,user_id,chat_id,thread_id,job_id) VALUES($1,$2,$3,$4,$5,$6) RETURNING *',
        [randomUUID(), updateId, userId, chatId, threadId ?? null, accepted.job.id],
      );
      await c.query('COMMIT');
      return r.rows[0] as BotMessage;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  async owned(id: string, userId: number, chatId: number, messageId: number) {
    const r = await this.pool.query(
      'SELECT * FROM telegram_scan_messages WHERE id=$1 AND user_id=$2 AND chat_id=$3 AND message_id=$4',
      [id, userId, chatId, messageId],
    );
    return (r.rows[0] as BotMessage | undefined) ?? null;
  }
  async pending() {
    await this.pool.query(
      "UPDATE telegram_scan_messages SET state='uncertain' WHERE state='sending' AND updated_at<now()-interval '30 seconds'",
    );
    return (
      await this.pool.query(
        "SELECT * FROM telegram_scan_messages WHERE state IN ('pending','ready') AND next_at<=now() ORDER BY next_at LIMIT 20",
      )
    ).rows as BotMessage[];
  }
  async beginSend(id: string) {
    return (
      (
        await this.pool.query(
          "UPDATE telegram_scan_messages SET state='sending',attempts=attempts+1,updated_at=now() WHERE id=$1 AND state='pending' RETURNING id",
          [id],
        )
      ).rowCount === 1
    );
  }
  async sent(id: string, messageId: number, digest: string) {
    await this.pool.query(
      "UPDATE telegram_scan_messages SET state='ready',message_id=$2,last_digest=$3,next_at=now()+interval '5 seconds',updated_at=now() WHERE id=$1 AND state='sending'",
      [id, messageId, digest],
    );
  }
  async edited(id: string, digest: string, terminal: boolean) {
    await this.pool.query(
      "UPDATE telegram_scan_messages SET state=$3,last_digest=$2,next_at=now()+interval '5 seconds',updated_at=now() WHERE id=$1 AND state='ready'",
      [id, digest, terminal ? 'done' : 'ready'],
    );
  }
  async defer(id: string, seconds: number, state?: string) {
    await this.pool.query(
      "UPDATE telegram_scan_messages SET next_at=now()+$2::integer*interval '1 second',state=COALESCE($3,state),attempts=attempts+1,updated_at=now() WHERE id=$1",
      [id, Math.min(86400, Math.max(1, seconds)), state ?? null],
    );
  }
  async recoverIdentity(userId: number, chatId: number) {
    await this.pool.query(
      'INSERT INTO telegram_identities(user_id,private_chat_id) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET private_chat_id=excluded.private_chat_id',
      [userId, chatId],
    );
  }
  async reserve(chatId?: number, group = false) {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(710021)');
      const keys = ['global', ...(chatId !== undefined ? [`chat:${chatId}`] : [])];
      const r = await c.query(
        'SELECT greatest(0,ceil(extract(epoch FROM (max(until_at)-clock_timestamp()))))::integer AS wait FROM telegram_cooldowns WHERE key=ANY($1)',
        [keys],
      );
      const wait = Number(r.rows[0].wait ?? 0);
      if (wait > 0) {
        await c.query('COMMIT');
        return wait;
      }
      for (const key of keys)
        await c.query(
          "INSERT INTO telegram_cooldowns(key,until_at) VALUES($1,clock_timestamp()+$2::integer*interval '1 millisecond') ON CONFLICT(key) DO UPDATE SET until_at=excluded.until_at",
          [key, key === 'global' ? 50 : group ? 3100 : 1100],
        );
      await c.query('COMMIT');
      return 0;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
}
