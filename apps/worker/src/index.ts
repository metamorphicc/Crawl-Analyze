import { loadConfig, installShutdown } from '@crawlspider/config';
import { createStorage } from '@crawlspider/storage';
import pino from 'pino';
import { loggerOptions } from '@crawlspider/config';
import { startRunner } from './runner.js';
const config = loadConfig();
const log = pino(loggerOptions(config));
const storage = createStorage(config);
const dependencies = await storage.readiness();
if (!Object.values(dependencies).every(Boolean)) {
  log.error({ dependencies }, 'Worker dependencies unavailable; run migrations first');
  await storage.close();
  process.exitCode = 1;
} else {
  const runner = startRunner(config, storage);
  log.info('Durable scan worker ready');
  installShutdown(async () => {
    await runner.close();
    await storage.close();
  });
}
