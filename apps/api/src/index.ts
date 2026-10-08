import { loadConfig, installShutdown } from '@crawlspider/config';
import { createStorage } from '@crawlspider/storage';
import { createApp } from './app.js';
const config = loadConfig();
const storage = createStorage(config);
const app = createApp(config, storage);
installShutdown(async () => {
  await app.close();
  await storage.close();
});
try {
  await app.listen({ port: config.API_PORT, host: config.API_HOST });
} catch {
  app.log.error('API startup failed; verify configuration and port availability');
  await storage.close();
  process.exitCode = 1;
}
