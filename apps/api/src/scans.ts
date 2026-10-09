import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Config } from '@crawlspider/config';
import { capabilities } from '@crawlspider/config';
import { PublicError, scanRequestSchema } from '@crawlspider/contracts';
import { ScanStore, type Storage } from '@crawlspider/storage';
import { parseInput, validAddress, resolveInput, type RpcClient } from '@crawlspider/providers';
const uuid = (value: unknown) => {
  const r = z.uuid().safeParse(value);
  if (!r.success) throw new PublicError('INVALID_ID', 'Invalid identifier');
  return r.data;
};
export function registerScans(
  app: FastifyInstance,
  config: Config,
  storage: Storage,
  rpc: RpcClient,
) {
  const store = new ScanStore(storage.pool, config),
    connections = new Set<AbortController>();
  app.addHook('onClose', async () => {
    for (const c of connections) c.abort();
  });
  app.post(
    '/v1/scans',
    { config: { rateLimit: { max: config.SCAN_IP_MINUTE_LIMIT * 2, timeWindow: '1 minute' } } },
    async (request, reply) => {
      if (!capabilities(config).holderIndex || !capabilities(config).rpc)
        throw new PublicError(
          'PROVIDER_NOT_CONFIGURED',
          'Configure the Solana RPC and holder index locally',
          503,
        );
      const parsed = scanRequestSchema.safeParse(request.body);
      if (!parsed.success)
        throw new PublicError('INVALID_INPUT', 'Expected a mint or supported URL');
      const normalized = parseInput(parsed.data.input);
      const mint = normalized.mayBePool
        ? (
            await resolveInput(
              parsed.data.input,
              rpc,
              AbortSignal.timeout(config.SCAN_PREVIEW_DEADLINE_MS),
            )
          ).identity.mint
        : normalized.address;
      const bucket = createHash('sha256')
        .update(config.DATABASE_URL)
        .update(request.ip)
        .digest('hex');
      const accepted = await store.admit(mint, parsed.data.mode, bucket);
      return reply.code(accepted.report ? 200 : 202).send(accepted);
    },
  );
  app.get<{ Params: { id: string } }>('/v1/scans/:id', async (req) =>
    store.details(uuid(req.params.id)),
  );
  app.post<{ Params: { id: string } }>('/v1/scans/:id/cancel', async (req) => {
    const token = req.headers['x-scan-cancel-token'];
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token))
      throw new PublicError('CANCEL_REJECTED', 'Cancellation capability required', 403);
    return store.cancel(uuid(req.params.id), token);
  });
  app.get<{ Params: { id: string } }>('/v1/reports/:id', async (req) =>
    store.report(uuid(req.params.id)),
  );
  app.get<{ Params: { mint: string } }>('/v1/tokens/:mint/latest', async (req) => ({
    report: await store.latest(validAddress(req.params.mint)),
  }));
  app.get('/v1/reports', async () => store.recent());
  app.get('/v1/queue', async () => ({
    lanes: await store.queueStatus(),
    capacity: config.SCAN_QUEUE_LIMIT,
  }));
  app.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/v1/scans/:id/events',
    async (req, reply) => {
      const id = uuid(req.params.id);
      await store.details(id);
      const cursor = req.headers['last-event-id'] || req.query.after || '0';
      if (
        typeof cursor !== 'string' ||
        !/^\d{1,19}$/.test(cursor) ||
        BigInt(cursor) > 9223372036854775807n
      )
        throw new PublicError('INVALID_CURSOR', 'Invalid event cursor');
      if (connections.size >= config.SSE_CONNECTION_LIMIT)
        throw new PublicError('SSE_LIMIT', 'Too many live connections', 429);
      const stop = new AbortController();
      connections.add(stop);
      req.raw.socket.once('close', () => stop.abort());
      const headers: Record<string, string | string[]> = Object.fromEntries(
        Object.entries(reply.getHeaders())
          .filter(([, v]) => v !== undefined)
          .map(([k, v]) => [k, Array.isArray(v) ? v : String(v)]),
      );
      reply.hijack();
      reply.raw.writeHead(200, {
        ...headers,
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
      });
      let after = cursor;
      const deadline = setTimeout(() => stop.abort(), 60000);
      try {
        reply.raw.write(': connected\n\n');
        while (!stop.signal.aborted) {
          const events = await store.events(id, after);
          for (const event of events) {
            if (!reply.raw.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`))
              await once(reply.raw, 'drain', { signal: stop.signal });
            after = event.id;
          }
          const details = await store.details(id);
          if (!['queued', 'running'].includes(details.state) && events.length < 100) break;
          reply.raw.write(': heartbeat\n\n');
          await delay(1000, undefined, { signal: stop.signal });
        }
      } catch {
        /* disconnects and transient DB failures are resumed by cursor */
      } finally {
        clearTimeout(deadline);
        connections.delete(stop);
        stop.abort();
        reply.raw.end();
      }
    },
  );
}
