import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { capabilities, loggerOptions, type Config } from '@crawlspider/config';
import { CONTRACT_VERSION, PublicError } from '@crawlspider/contracts';
import type { Storage } from '@crawlspider/storage';
import { RpcClient, resolveInput } from '@crawlspider/providers';
import { scanRequestSchema } from '@crawlspider/contracts';

export function createApp(config: Config, storage: Storage) {
  const app = Fastify({
    logger: config.NODE_ENV === 'test' ? false : loggerOptions(config),
    bodyLimit: 4096,
    requestTimeout: 10000,
    logController: new LogController({ disableRequestLogging: true }),
    trustProxy: false,
  });
  app.register(helmet);
  app.register(cors, { origin: config.WEB_ORIGIN, credentials: true });
  app.register(rateLimit, { max: 60, timeWindow: '1 minute' });
  const rpc = new RpcClient(config);
  app.post('/v1/resolve', async (request) => {
    const parsed = scanRequestSchema.safeParse(request.body);
    if (!parsed.success)
      throw new PublicError('INVALID_INPUT', 'Expected a mint address or supported token URL');
    return resolveInput(
      parsed.data.input,
      rpc,
      AbortSignal.timeout(config.SCAN_PREVIEW_DEADLINE_MS),
    );
  });
  app.setErrorHandler((error: Error, _request, reply) => {
    if (error instanceof PublicError)
      return reply.code(error.status).send({ code: error.code, message: error.message });
    const status =
      'statusCode' in error && typeof error.statusCode === 'number' ? error.statusCode : 500;
    if (status >= 500) app.log.error({ errorType: error.name }, 'Request failed');
    return reply.code(status).send({
      code: status >= 500 ? 'INTERNAL_ERROR' : 'INVALID_REQUEST',
      message: status >= 500 ? 'Service temporarily unavailable' : 'Invalid request',
    });
  });
  app.get('/health/live', async () => ({ ok: true, contractVersion: CONTRACT_VERSION }));
  app.get('/health/ready', async (_request, reply) => {
    const dependencies = await storage.readiness();
    const ready = Object.values(dependencies).every(Boolean);
    return reply.code(ready ? 200 : 503).send({
      contractVersion: CONTRACT_VERSION,
      status: ready ? 'ready' : 'degraded',
      dependencies,
      capabilities: capabilities(config),
    });
  });
  app.get('/v1/status', async () => {
    const dependencies = await storage.readiness();
    return {
      contractVersion: CONTRACT_VERSION,
      status: Object.values(dependencies).every(Boolean) ? 'ready' : 'degraded',
      dependencies,
      capabilities: capabilities(config),
    };
  });
  return app;
}
