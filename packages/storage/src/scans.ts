import { randomUUID, randomBytes, createHash } from 'node:crypto';
import type pg from 'pg';
import type { Config } from '@crawlspider/config';
import {
  PublicError,
  jobSchema,
  reportSchema,
  CONTRACT_VERSION,
  ANALYSIS_VERSION,
  PARSER_VERSION,
  type AnalysisReport,
  type ScanAcceptance,
} from '@crawlspider/contracts';
export type Lane = 'preview' | 'deep' | 'monitor';
export type Lease = {
  id: string;
  mint: string;
  mode: 'preview' | 'deep';
  lane: Lane;
  token: string;
  attempt: number;
  deadline: string;
};
type Row = Record<string, any>;
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const job = (row: Row) =>
  jobSchema.parse({
    id: row.id,
    mint: row.mint,
    mode: row.mode,
    state: row.state,
    createdAt: row.created_at.toISOString(),
    reportId: row.report_id,
    errorCode: row.error_code,
  });
export class ScanStore {
  constructor(
    readonly pool: pg.Pool,
    readonly config: Config,
  ) {}
  private async tx<T>(work: (c: pg.PoolClient) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try {
      await c.query('BEGIN');
      const result = await work(c);
      await c.query('COMMIT');
      return result;
    } catch (e) {
      await c.query('ROLLBACK');
      throw e;
    } finally {
      c.release();
    }
  }
  private async event(c: pg.PoolClient, id: string, kind: string, data: unknown) {
    await c.query('INSERT INTO scan_events(job_id,kind,data) VALUES($1,$2,$3)', [
      id,
      kind,
      JSON.stringify(data),
    ]);
  }
  async admit(
    mint: string,
    mode: 'preview' | 'deep',
    bucket: string,
    lane: Lane = mode,
    force = false,
  ): Promise<ScanAcceptance> {
    return this.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(710007)');
      const dedupe = [mint, mode, CONTRACT_VERSION, ANALYSIS_VERSION, PARSER_VERSION].join('/');
      const active = await c.query(
        "SELECT * FROM scan_jobs WHERE dedupe_key=$1 AND state IN ('queued','running')",
        [dedupe],
      );
      if (active.rows[0])
        return { job: job(active.rows[0]), reused: true, report: null, cancelToken: null };
      if (!force) {
        const cache = await c.query(
          `SELECT r.body,j.* FROM reports r JOIN scan_jobs j ON j.id=r.job_id WHERE r.mint=$1 AND r.mode=$2 AND r.contract_version=$3 AND r.analysis_version=$4 AND r.parser_version=$5 AND r.observed_at > now()-$6::integer*interval '1 millisecond' ORDER BY r.quality_rank DESC,r.observed_at DESC LIMIT 1`,
          [
            mint,
            mode,
            CONTRACT_VERSION,
            ANALYSIS_VERSION,
            PARSER_VERSION,
            this.config.SCAN_CACHE_MS,
          ],
        );
        if (cache.rows[0])
          return {
            job: job(cache.rows[0]),
            reused: true,
            report: reportSchema.parse(cache.rows[0].body),
            cancelToken: null,
          };
      }
      for (const [window, cap, expiry] of [
        ['minute', this.config.SCAN_IP_MINUTE_LIMIT, 120],
        ['day', this.config.SCAN_IP_DAILY_LIMIT, 172800],
      ] as const) {
        const stamp = (await c.query(`SELECT date_trunc($1,now())::text AS stamp`, [window]))
          .rows[0].stamp;
        const used = await c.query(
          `INSERT INTO scan_admission(bucket,interval_key,requests,expires_at) VALUES($1,$2,1,now()+$3::integer*interval '1 second') ON CONFLICT(bucket,interval_key) DO UPDATE SET requests=scan_admission.requests+1 RETURNING requests`,
          [bucket, `${window}/${stamp}`, expiry],
        );
        if (used.rows[0].requests > cap)
          throw new PublicError('SCAN_QUOTA', 'Scan request limit reached', 429);
      }
      const depth = await c.query(
        "SELECT count(*)::integer AS count FROM scan_jobs WHERE state IN ('queued','running')",
      );
      if (depth.rows[0].count >= this.config.SCAN_QUEUE_LIMIT)
        throw new PublicError('QUEUE_FULL', 'Scan queue is full; retry later', 429);
      const id = randomUUID(),
        cancelToken = randomBytes(32).toString('hex');
      const inserted = await c.query(
        "INSERT INTO scan_jobs(id,mint,mode,state,dedupe_key,lane,cancel_hash) VALUES($1,$2,$3,'queued',$4,$5,$6) RETURNING *",
        [id, mint, mode, dedupe, lane, hash(cancelToken)],
      );
      await this.event(c, id, 'queued', { mode, lane });
      return { job: job(inserted.rows[0]), reused: false, report: null, cancelToken };
    });
  }
  async details(id: string) {
    const r = await this.pool.query('SELECT * FROM scan_jobs WHERE id=$1', [id]);
    if (!r.rows[0]) throw new PublicError('JOB_NOT_FOUND', 'Scan not found', 404);
    const row = r.rows[0];
    return {
      ...job(row),
      phase: row.phase,
      attempt: row.attempt,
      deadlineAt: row.deadline_at?.toISOString() || null,
      preview: row.preview ? reportSchema.parse(row.preview) : null,
    };
  }
  async cancel(id: string, token: string) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE scan_jobs SET state='cancelled',phase='cancelled',finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND cancel_hash=$2 AND state IN ('queued','running') RETURNING id",
        [id, hash(token)],
      );
      if (!r.rowCount)
        throw new PublicError(
          'CANCEL_REJECTED',
          'Cancellation capability invalid or scan already finished',
          409,
        );
      await this.event(c, id, 'cancelled', {});
      return { cancelled: true };
    });
  }
  async pending(lane: Lane) {
    return (
      await this.pool.query(
        "SELECT id,attempt FROM scan_jobs WHERE lane=$1 AND state='queued' AND next_attempt_at<=now() ORDER BY created_at LIMIT 50",
        [lane],
      )
    ).rows as { id: string; attempt: number }[];
  }
  async claim(id: string): Promise<Lease | null> {
    return this.tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(710008)');
      const r = await c.query(
        "SELECT * FROM scan_jobs WHERE id=$1 AND state='queued' AND next_attempt_at<=now() FOR UPDATE",
        [id],
      );
      const row = r.rows[0];
      if (!row) return null;
      const active = (
        await c.query(
          "SELECT lane,count(*)::integer AS n FROM scan_jobs WHERE state='running' AND lease_until>now() GROUP BY lane",
        )
      ).rows;
      if (active.reduce((n, r) => n + r.n, 0) >= this.config.SCAN_CONCURRENCY) return null;
      const cap = row.lane === 'deep' ? Math.max(1, this.config.SCAN_CONCURRENCY - 2) : 1;
      if ((active.find((r) => r.lane === row.lane)?.n || 0) >= cap) return null;
      const oldest = (
        await c.query(
          `SELECT id FROM scan_jobs WHERE state='queued' AND next_attempt_at<=now() AND ($1::boolean OR lane=$2) ORDER BY created_at LIMIT 1`,
          [this.config.SCAN_CONCURRENCY === 1, row.lane],
        )
      ).rows[0];
      if (oldest?.id !== id) return null;
      const token = randomUUID(),
        duration =
          row.mode === 'preview'
            ? this.config.SCAN_PREVIEW_DEADLINE_MS
            : this.config.SCAN_DEEP_DEADLINE_MS;
      const u = await c.query(
        `UPDATE scan_jobs SET state='running',phase='verify-mint',started_at=coalesce(started_at,now()),deadline_at=coalesce(deadline_at,now()+$3::integer*interval '1 millisecond'),heartbeat_at=now(),lease_until=now()+interval '15 seconds',lease_token=$2,attempt=attempt+1 WHERE id=$1 RETURNING *`,
        [id, token, duration],
      );
      const next = u.rows[0];
      await this.event(c, id, 'running', { attempt: next.attempt });
      return {
        id,
        mint: next.mint,
        mode: next.mode,
        lane: next.lane,
        token,
        attempt: next.attempt,
        deadline: next.deadline_at.toISOString(),
      };
    });
  }
  async heartbeat(lease: Lease) {
    return (
      (
        await this.pool.query(
          "UPDATE scan_jobs SET heartbeat_at=now(),lease_until=now()+interval '15 seconds' WHERE id=$1 AND lease_token=$2 AND state='running' AND deadline_at>clock_timestamp() AND lease_until>clock_timestamp()",
          [lease.id, lease.token],
        )
      ).rowCount === 1
    );
  }
  async checkpoint(lease: Lease, phase: string, preview?: AnalysisReport) {
    return this.tx(async (c) => {
      const r = await c.query(
        "UPDATE scan_jobs SET phase=$3,preview=coalesce($4::jsonb,preview) WHERE id=$1 AND lease_token=$2 AND state='running' AND deadline_at>clock_timestamp() AND lease_until>clock_timestamp() RETURNING id",
        [
          lease.id,
          lease.token,
          phase,
          preview ? JSON.stringify(reportSchema.parse(preview)) : null,
        ],
      );
      if (r.rowCount) await this.event(c, lease.id, 'progress', { phase, hasPreview: !!preview });
      return r.rowCount === 1;
    });
  }
  async finish(lease: Lease, report: AnalysisReport) {
    const body = reportSchema.parse(report);
    if (body.jobId !== lease.id || body.identity.mint !== lease.mint)
      throw new Error('Report does not match lease');
    if (Buffer.byteLength(JSON.stringify(body)) > 8 * 1024 * 1024)
      throw new PublicError('REPORT_TOO_LARGE', 'Analysis exceeds report size limit', 500);
    return this.tx(async (c) => {
      const r = await c.query(
        "SELECT id FROM scan_jobs WHERE id=$1 AND lease_token=$2 AND state='running' AND deadline_at>clock_timestamp() AND lease_until>clock_timestamp() FOR UPDATE",
        [lease.id, lease.token],
      );
      if (!r.rowCount) return false;
      const rank = body.risk.eligible
        ? 3
        : body.snapshot.quality.status === 'complete'
          ? 2
          : body.snapshot.quality.status === 'partial'
            ? 1
            : 0;
      await c.query(
        'INSERT INTO reports(id,job_id,mint,contract_version,analysis_version,parser_version,body,quality_rank,observed_at,mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [
          body.id,
          lease.id,
          lease.mint,
          body.contractVersion,
          body.analysisVersion,
          body.parserVersion,
          JSON.stringify(body),
          rank,
          body.observedAt,
          body.mode,
        ],
      );
      const state =
        body.limitations.length ||
        body.snapshot.quality.status !== 'complete' ||
        !body.risk.eligible
          ? 'partial'
          : 'complete';
      const finished = await c.query(
        'UPDATE scan_jobs SET state=$2,phase=$2,report_id=$3,finished_at=now(),lease_token=NULL,lease_until=NULL WHERE id=$1 AND deadline_at>clock_timestamp() AND lease_until>clock_timestamp()',
        [lease.id, state, body.id],
      );
      if (!finished.rowCount)
        throw new PublicError('LEASE_LOST', 'Scan completed after its lease', 409);
      await c.query(
        'INSERT INTO token_identities(mint,identity,observed_at) VALUES($1,$2,$3) ON CONFLICT(mint) DO UPDATE SET identity=excluded.identity,observed_at=excluded.observed_at WHERE token_identities.observed_at<=excluded.observed_at',
        [lease.mint, JSON.stringify(body.identity), body.identity.provenance.observedAt],
      );
      await this.event(c, lease.id, state, { reportId: body.id });
      return true;
    });
  }
  async fail(lease: Lease, code: string, retry = false) {
    return this.tx(async (c) => {
      const r = await c.query(
        "SELECT * FROM scan_jobs WHERE id=$1 AND lease_token=$2 AND state='running' FOR UPDATE",
        [lease.id, lease.token],
      );
      if (!r.rowCount) return;
      const queued =
        retry && r.rows[0].attempt < 3 && r.rows[0].deadline_at.getTime() > Date.now() + 2000;
      await c.query(
        "UPDATE scan_jobs SET state=$3,phase=$3,error_code=$4,lease_token=NULL,lease_until=NULL,next_attempt_at=now()+interval '2 seconds',finished_at=CASE WHEN $3='failed' THEN now() ELSE NULL END WHERE id=$1 AND lease_token=$2",
        [lease.id, lease.token, queued ? 'queued' : 'failed', code],
      );
      await this.event(c, lease.id, queued ? 'retrying' : 'failed', { code });
    });
  }
  async recover() {
    return this.tx(async (c) => {
      const rows = await c.query(
        "SELECT * FROM scan_jobs WHERE state='running' AND (lease_until<now() OR deadline_at<=now()) FOR UPDATE SKIP LOCKED LIMIT 100",
      );
      for (const row of rows.rows) {
        const expired = row.deadline_at.getTime() <= Date.now(),
          retry = !expired && row.attempt < 3;
        await c.query(
          "UPDATE scan_jobs SET state=$2,phase=$2,error_code=$3,lease_token=NULL,lease_until=NULL,finished_at=CASE WHEN $2='failed' THEN now() ELSE NULL END WHERE id=$1",
          [row.id, retry ? 'queued' : 'failed', expired ? 'DEADLINE_EXCEEDED' : 'WORKER_LOST'],
        );
        await this.event(c, row.id, retry ? 'recovered' : 'failed', {
          code: expired ? 'DEADLINE_EXCEEDED' : 'WORKER_LOST',
        });
      }
      await c.query('DELETE FROM scan_admission WHERE expires_at<now()');
      return rows.rowCount;
    });
  }
  async events(id: string, after: string) {
    return (
      await this.pool.query(
        'SELECT id::text,job_id AS "jobId",kind,data,created_at AS "createdAt" FROM scan_events WHERE job_id=$1 AND id>$2::bigint ORDER BY id LIMIT 100',
        [id, after],
      )
    ).rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() }));
  }
  async report(id: string) {
    const r = await this.pool.query('SELECT body FROM reports WHERE id=$1', [id]);
    if (!r.rows[0]) throw new PublicError('REPORT_NOT_FOUND', 'Report not found', 404);
    return reportSchema.parse(r.rows[0].body);
  }
  async latest(mint: string) {
    const r = await this.pool.query(
      `SELECT body FROM reports WHERE mint=$1 AND contract_version=$2 AND analysis_version=$3 AND parser_version=$4 ORDER BY observed_at DESC,quality_rank DESC LIMIT 1`,
      [mint, CONTRACT_VERSION, ANALYSIS_VERSION, PARSER_VERSION],
    );
    return r.rows[0] ? reportSchema.parse(r.rows[0].body) : null;
  }
  async recent() {
    return (
      await this.pool.query(
        'SELECT r.id,r.mint,r.mode,r.observed_at,j.state FROM reports r JOIN scan_jobs j ON j.id=r.job_id ORDER BY r.created_at DESC LIMIT 20',
      )
    ).rows.map((r) => ({
      id: r.id,
      mint: r.mint,
      mode: r.mode,
      observedAt: r.observed_at.toISOString(),
      state: r.state,
    }));
  }
  async queueStatus() {
    return (
      await this.pool.query(
        "SELECT lane,state,count(*)::integer AS count FROM scan_jobs WHERE state IN ('queued','running') GROUP BY lane,state",
      )
    ).rows;
  }
}
