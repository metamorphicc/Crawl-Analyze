import { Bot } from 'grammy';
import pino from 'pino';
import { loadConfig, loggerOptions, installShutdown } from '@crawlspider/config';
const config = loadConfig();
const log = pino(loggerOptions(config));
if (!config.TELEGRAM_BOT_TOKEN) {
  log.error('TELEGRAM_BOT_TOKEN is not configured in local .env');
  process.exitCode = 1;
} else {
  const bot = new Bot(config.TELEGRAM_BOT_TOKEN);
  bot.command('start', (ctx) =>
    ctx.reply('CrawlSpider: аналитика Solana. Сканер ещё разрабатывается. /status'),
  );
  bot.command('status', (ctx) =>
    ctx.reply('Инфраструктура настроена. Обработка токенов появится на следующем этапе.'),
  );
  bot.catch(() => log.error('Telegram update failed'));
  installShutdown(async () => {
    if (bot.isRunning()) await bot.stop();
  });
  await bot.start({ onStart: () => log.info('Telegram polling started') });
}
