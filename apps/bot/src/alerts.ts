import type { Bot } from 'grammy';
import type { Config } from '@crawlspider/config';
import { WatchStore, type Storage } from '@crawlspider/storage';
import { escapeHtml } from './messages.js';
import { telegramFailure } from './app.js';
export function startAlerts(config: Config, storage: Storage, bot: Bot, manual = false) {
  const store = new WatchStore(storage.pool, config);
  let active: Promise<void> | undefined,
    closed = false;
  async function tick() {
    const batch = await store.claimAlerts();
    if (!batch || !batch.rows.length) return;
    const ids = batch.rows.map((r) => r.id as string);
    const summaries = batch.rows.map((r) => {
      const p = r.payload as {
        mint: string;
        reportId: string;
        changes: string[];
        eventCount: number;
      };
      return `${escapeHtml(p.mint)} (${p.eventCount} наблюдений)\n${p.changes
        .slice(-2)
        .map((s) => escapeHtml(s))
        .join('\n')}`;
    });
    let text = 'Изменения наблюдаемых токенов. Подробности и полная история — на сайте.\n\n';
    let shown = 0;
    for (const summary of summaries) {
      if (text.length + summary.length > 3500) break;
      text += `${summary}\n\n`;
      shown++;
    }
    if (shown < batch.rows.length) text += `Ещё токенов: ${batch.rows.length - shown}.`;
    try {
      await bot.api.sendMessage(batch.chatId, text, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        reply_markup: {
          inline_keyboard: [
            [{ text: 'Список наблюдения', url: new URL('/watchlist', config.PUBLIC_WEB_URL).href }],
          ],
        },
      });
      await store.alertResult(ids, batch.lease, 'sent');
    } catch (e) {
      const failure = telegramFailure(e);
      if (failure.code === 'TELEGRAM_BLOCKED') await store.block(batch.userId);
      await store.alertResult(
        ids,
        batch.lease,
        failure.retry !== undefined
          ? batch.rows.every((r) => r.attempts < 12)
            ? 'pending'
            : 'failed'
          : failure.code === 'TELEGRAM_BLOCKED' || failure.code === 'TELEGRAM_MESSAGE_REJECTED'
            ? 'failed'
            : 'uncertain',
        failure.retry || 0,
      );
    }
  }
  const run = () => {
    if (!active && !closed)
      active = tick()
        .catch(() => {})
        .finally(() => {
          active = undefined;
        });
  };
  const timer = manual ? undefined : setInterval(run, 5000);
  if (!manual) run();
  return {
    tick,
    async close() {
      closed = true;
      if (timer) clearInterval(timer);
      await active;
    },
  };
}
