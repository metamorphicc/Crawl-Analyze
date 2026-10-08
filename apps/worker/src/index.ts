import { loadConfig, installShutdown } from '@crawlspider/config';
import { createStorage } from '@crawlspider/storage';
import pino from 'pino';
import { loggerOptions } from '@crawlspider/config';
const config = loadConfig();
const log = pino(loggerOptions(config));
const storage = createStorage(config);
const dependencies = await storage.readiness();
if (!Object.values(dependencies).every(Boolean)) {
  log.error({ dependencies }, 'Worker dependencies unavailable; run migrations first');
  await storage.close();
  process.exitCode = 1;
} else {
  log.info('Worker infrastructure ready; scan processor is not installed yet');
  const heartbeat = setInterval(() => {}, 30000);
  installShutdown(async () => {
    clearInterval(heartbeat);
    await storage.close();
  });
}
