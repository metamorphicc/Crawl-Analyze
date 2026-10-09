import { Bot } from 'grammy';
import { loadConfig } from '@crawlspider/config';
const config = loadConfig();
if (!config.TELEGRAM_BOT_TOKEN) {
  console.log('Telegram live verification pending: configure TELEGRAM_BOT_TOKEN locally.');
  process.exitCode = 2;
} else {
  try {
    const bot = new Bot(config.TELEGRAM_BOT_TOKEN, { client: { timeoutSeconds: 10 } });
    await bot.init();
    const webhook = await bot.api.getWebhookInfo();
    console.log(
      JSON.stringify({
        getMe: true,
        mode: config.TELEGRAM_MODE,
        webhookConfigured: Boolean(webhook.url),
      }),
    );
  } catch {
    console.error('Telegram verification failed; credentials and endpoint details redacted');
    process.exitCode = 1;
  }
}
