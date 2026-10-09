import { randomUUID } from 'node:crypto';
import type { Config } from '@crawlspider/config';
import { capabilities } from '@crawlspider/config';
import { ScanStore, WatchStore, tgHash, type Storage } from '@crawlspider/storage';
import {
  notificationSettingsSchema,
  PublicError,
  type AnalysisReport,
  type NotificationSettings,
} from '@crawlspider/contracts';
import { comparePositions } from '@crawlspider/analysis';

export function meaningfulChanges(
  previous: AnalysisReport | null,
  current: AnalysisReport,
  settings: NotificationSettings,
) {
  const comparison = comparePositions(previous, current);
  if (!previous || !comparison.comparable) return [];
  const lines: string[] = [];
  if (
    previous.risk.eligible &&
    current.risk.eligible &&
    previous.risk.ruleVersion === current.risk.ruleVersion &&
    Math.abs(current.risk.riskScore! - previous.risk.riskScore!) >= settings.riskDelta
  )
    lines.push(
      `Риск распределения: ${previous.risk.riskScore} → ${current.risk.riskScore} (эвристика).`,
    );
  const supply =
    BigInt(current.identity.supply) -
    current.snapshot.holders.reduce((n, h) => n + BigInt(h.excludedAmount), 0n);
  if (supply > 0n)
    for (const position of comparison.positions) {
      const delta = BigInt(position.delta),
        absolute = delta < 0n ? -delta : delta;
      if (absolute * 10000n < supply * BigInt(settings.positionDeltaBps)) continue;
      const sale = comparison.movements.some(
        (m) => m.owner === position.owner && m.kind === 'sell',
      );
      lines.push(
        `${position.owner}: изменение баланса ${position.delta} raw${sale ? '; есть подтверждённая DEX-продажа' : '; продажа не установлена'}.`,
      );
    }
  return lines.slice(0, 10);
}
export async function monitorTick(config: Config, storage: Storage) {
  const watches = new WatchStore(storage.pool, config),
    scans = new ScanStore(storage.pool, config);
  await watches.tx(async (c) => {
    if (!(await c.query('SELECT pg_try_advisory_xact_lock(733930) AS ok')).rows[0].ok) return;
    const rows = (
      await c.query(
        "SELECT w.*,i.settings FROM watches w JOIN telegram_identities i ON i.user_id=w.user_id WHERE (w.pending_job_id IS NOT NULL OR w.next_check_at<=now()) AND COALESCE((i.settings->>'enabled')::boolean,true) AND i.notification_pause_reason IS NULL ORDER BY w.next_check_at LIMIT 20 FOR UPDATE OF w SKIP LOCKED",
      )
    ).rows;
    let admissions = 0;
    for (const watch of rows) {
      if (watch.pending_job_id) {
        const job = await scans.details(watch.pending_job_id);
        if (['queued', 'running'].includes(job.state)) continue;
        if (job.reportId) {
          const current = await scans.report(job.reportId),
            previous = watch.last_report_id ? await scans.report(watch.last_report_id) : null;
          const changes = meaningfulChanges(
            previous,
            current,
            notificationSettingsSchema.parse(watch.settings),
          );
          if (changes.length) {
            const old = (
              await c.query(
                "SELECT id,payload FROM notification_outbox WHERE watch_id=$1 AND state='pending' FOR UPDATE",
                [watch.id],
              )
            ).rows[0];
            const payload = {
              mint: watch.mint,
              reportId: current.id,
              changes: old
                ? [...(old.payload.changes as string[]), ...changes].slice(-10)
                : changes,
              eventCount: (old?.payload.eventCount || 0) + 1,
            };
            if (old)
              await c.query('UPDATE notification_outbox SET payload=$2,report_id=$3 WHERE id=$1', [
                old.id,
                JSON.stringify(payload),
                current.id,
              ]);
            else
              await c.query(
                'INSERT INTO notification_outbox(id,user_id,watch_id,report_id,idempotency_key,payload) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(idempotency_key) DO NOTHING',
                [
                  randomUUID(),
                  watch.user_id,
                  watch.id,
                  current.id,
                  `${watch.id}:${current.id}`,
                  JSON.stringify(payload),
                ],
              );
          }
          await c.query('UPDATE watches SET last_report_id=$2 WHERE id=$1', [watch.id, current.id]);
        }
        await c.query(
          "UPDATE watches SET pending_job_id=NULL,last_check_at=now(),next_check_at=now()+$2::integer*interval '1 millisecond' WHERE id=$1",
          [watch.id, config.ALERT_RECHECK_INTERVAL_MS],
        );
      } else if (admissions < 5 && capabilities(config).rpc && capabilities(config).holderIndex) {
        try {
          const admitted = await scans.admit(
            watch.mint,
            'deep',
            tgHash(`monitor:${watch.mint}`),
            'monitor',
            true,
            c,
          );
          await c.query('UPDATE watches SET pending_job_id=$2 WHERE id=$1', [
            watch.id,
            admitted.job.id,
          ]);
          admissions++;
        } catch (e) {
          if (!(e instanceof PublicError)) throw e;
          await c.query("UPDATE watches SET next_check_at=now()+interval '1 minute' WHERE id=$1", [
            watch.id,
          ]);
        }
      }
    }
  });
}
export function startMonitoring(config: Config, storage: Storage) {
  let active: Promise<void> | undefined,
    closed = false;
  const run = () => {
    if (!active && !closed)
      active = monitorTick(config, storage)
        .catch(() => {})
        .finally(() => {
          active = undefined;
        });
  };
  const timer = setInterval(run, 10000);
  run();
  return {
    async close() {
      closed = true;
      clearInterval(timer);
      await active;
    },
  };
}
