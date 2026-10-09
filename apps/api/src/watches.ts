import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '@crawlspider/config';
import { PublicError, notificationSettingsSchema, addressSchema } from '@crawlspider/contracts';
import { WatchStore, type Storage } from '@crawlspider/storage';
import { parseInput } from '@crawlspider/providers';
import { allowedWebOrigins } from './web-origin.js';

export function registerWatches(app: FastifyInstance, config: Config, storage: Storage) {
  const store = new WatchStore(storage.pool, config),
    secure = config.NODE_ENV === 'production',
    origins = allowedWebOrigins(config);
  const sessionName = secure ? '__Host-crawlspider' : 'csp_session',
    flowName = secure ? '__Host-crawlspider-link' : 'csp_link';
  function cookie(request: FastifyRequest, name: string) {
    const values = (request.headers.cookie || '')
      .split(';')
      .map((v) => v.trim())
      .filter((v) => v.startsWith(`${name}=`));
    return values.length === 1 && /^[a-f0-9]{64}$/.test(values[0]!.slice(name.length + 1))
      ? values[0]!.slice(name.length + 1)
      : '';
  }
  const setCookie = (name: string, value: string, age: number) =>
    `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure ? '; Secure' : ''}`;
  app.addHook('onRequest', async (request, reply) => {
    if (/^\/v1\/(me|auth|watches|settings|logout|unlink)(\/|$)/.test(request.url))
      reply.header('Cache-Control', 'private, no-store');
  });
  function origin(request: FastifyRequest) {
    if (!request.headers.origin || !origins.includes(request.headers.origin))
      throw new PublicError('ORIGIN_REJECTED', 'Origin rejected', 403);
  }
  async function user(request: FastifyRequest, mutate = false) {
    const value = await store.session(cookie(request, sessionName));
    if (!value) throw new PublicError('NOT_LINKED', 'Link Telegram first', 401);
    if (mutate) {
      origin(request);
      const csrf = request.headers['x-csrf-token'];
      if (
        typeof csrf !== 'string' ||
        !/^[a-f0-9]{64}$/.test(csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(value.csrf))
      )
        throw new PublicError('CSRF_REJECTED', 'CSRF rejected', 403);
    }
    return value;
  }
  app.get('/v1/me', async (request) => ({
    user: await store.session(cookie(request, sessionName)),
  }));
  app.post(
    '/v1/auth/link',
    { config: { rateLimit: { max: 3, timeWindow: '1 minute' } } },
    async (request, reply) => {
      origin(request);
      if (!config.TELEGRAM_BOT_USERNAME || !config.TELEGRAM_BOT_TOKEN)
        throw new PublicError('TELEGRAM_NOT_CONFIGURED', 'Telegram linking unavailable', 503);
      const link = await store.beginLink();
      reply.header('Set-Cookie', setCookie(flowName, link.browser, 300));
      return {
        id: link.id,
        code: link.code,
        expiresAt: link.expiresAt,
        url: `https://t.me/${config.TELEGRAM_BOT_USERNAME}?start=link_${link.id}`,
      };
    },
  );
  app.get('/v1/auth/link/:id', async (request) => ({
    state: await store.linkStatus(
      z.object({ id: z.uuid() }).parse(request.params).id,
      cookie(request, flowName),
    ),
  }));
  app.post('/v1/auth/complete', async (request, reply) => {
    origin(request);
    const { id } = z.object({ id: z.uuid() }).strict().parse(request.body);
    const session = await store.completeLink(id, cookie(request, flowName));
    reply.header('Set-Cookie', [
      setCookie(sessionName, session.token, 2592000),
      setCookie(flowName, '', 0),
    ]);
    return { ok: true };
  });
  app.get('/v1/watches', async (request) => store.list((await user(request)).id));
  app.post('/v1/watches', async (request) => {
    const u = await user(request, true),
      { mint } = z.object({ mint: addressSchema }).strict().parse(request.body);
    parseInput(mint);
    await store.add(u.id, mint);
    return { ok: true };
  });
  app.delete('/v1/watches/:mint', async (request) => {
    const u = await user(request, true),
      { mint } = z.object({ mint: addressSchema }).parse(request.params);
    await store.remove(u.id, mint);
    return { ok: true };
  });
  app.patch('/v1/settings', async (request) => {
    await store.updateSettings(
      (await user(request, true)).id,
      notificationSettingsSchema.parse(request.body),
    );
    return { ok: true };
  });
  app.post('/v1/logout', async (request, reply) => {
    await user(request, true);
    await store.logout(cookie(request, sessionName));
    reply.header('Set-Cookie', setCookie(sessionName, '', 0));
    return { ok: true };
  });
  app.post('/v1/unlink', async (request, reply) => {
    await store.unlink((await user(request, true)).id);
    reply.header('Set-Cookie', setCookie(sessionName, '', 0));
    return { ok: true };
  });
  app.delete('/v1/me', async (request, reply) => {
    await store.deleteUser((await user(request, true)).id);
    reply.header('Set-Cookie', setCookie(sessionName, '', 0));
    return { ok: true };
  });
}
