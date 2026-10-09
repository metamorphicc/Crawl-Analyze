import pino from 'pino';
import { loadConfig, loggerOptions, installShutdown } from '@crawlspider/config';
import { createStorage } from '@crawlspider/storage';
import { createBot, startBotProcessor } from './app.js';
import { webhookServer } from './runtime.js';
import { startPolling } from './polling.js';
const config = loadConfig(),
  log = pino(loggerOptions(config));
if (!config.TELEGRAM_BOT_TOKEN) {
  log.error('TELEGRAM_BOT_TOKEN is not configured in local .env');
  process.exitCode = 1;
} else {
  const storage = createStorage(config),
    lock = await storage.pool.connect();
  let processor: ReturnType<typeof startBotProcessor> | undefined,
    poll: ReturnType<typeof startPolling> | undefined,
    server: ReturnType<typeof webhookServer> | undefined;
  let closing: Promise<void> | undefined;
  function close() {
    return (closing ??= clean());
  }
  async function clean() {
    await poll?.close();
    if (server) {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server!.close(() => resolve()));
    }
    await processor?.close();
    await lock.query('SELECT pg_advisory_unlock(733920)');
    lock.release();
    await storage.close();
  }
  installShutdown(close);
  lock.on('error', () => {
    log.error('Bot singleton connection lost; stopping intake');
    void close().finally(() => process.exit(1));
  });
  try {
    if (!(await lock.query('SELECT pg_try_advisory_lock(733920) AS acquired')).rows[0].acquired)
      throw new Error('Another bot runtime is already active');
    if (!Object.values(await storage.readiness()).every(Boolean))
      throw new Error('Migrate and restore local storage first');
    const app = createBot(config, storage);
    await app.bot.init();
    const webhook = await app.bot.api.getWebhookInfo();
    if (config.TELEGRAM_MODE === 'polling' && webhook.url)
      throw new Error('Existing webhook must be intentionally removed before polling');
    await app.bot.api.setMyCommands([
      { command: 'start', description: 'Как пользоваться сканером' },
      { command: 'scan', description: 'Анализ Solana mint или ссылки' },
      { command: 'help', description: 'Команды и ограничения' },
      { command: 'status', description: 'Состояние источников и очереди' },
      { command: 'watch', description: 'Наблюдать токен' },
      { command: 'watchlist', description: 'Список наблюдения' },
      { command: 'unwatch', description: 'Убрать токен из наблюдения' },
      { command: 'settings', description: 'Настройки уведомлений' },
    ]);
    processor = startBotProcessor(config, storage, app.bot);
    if (config.TELEGRAM_MODE === 'webhook') {
      server = webhookServer(config, app.store);
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(config.TELEGRAM_PORT, '127.0.0.1', resolve);
      });
      await app.bot.api.setWebhook(config.TELEGRAM_WEBHOOK_URL!, {
        secret_token: config.TELEGRAM_WEBHOOK_SECRET!,
        allowed_updates: ['message', 'callback_query'],
        drop_pending_updates: false,
      });
      log.info('Telegram webhook listener started; reverse proxy must forward /telegram');
    } else {
      poll = startPolling(app.bot, app.store, () =>
        log.error('Telegram intake failed; retrying without advancing durable offset'),
      );
      log.info('Telegram polling started');
    }
  } catch {
    log.error('Telegram startup failed; check mode, storage, credentials and existing runtime');
    await close();
    process.exitCode = 1;
  }
}
