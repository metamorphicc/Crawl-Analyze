import { loadConfig, installShutdown } from '@crawlspider/config';
import { createStorage } from '@crawlspider/storage';
import pino from 'pino';
import { loggerOptions } from '@crawlspider/config';
import { startRunner } from './runner.js';
import { startMonitoring } from './monitor.js';
import { startOutcomes } from './outcomes.js';
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
  const monitor = startMonitoring(config, storage);
  const outcomes = startOutcomes(config, storage);
  log.info('Durable scan worker ready');
  installShutdown(async () => {
    await monitor.close();
    await outcomes.close();
    await runner.close();
    await storage.close();
  });
}
