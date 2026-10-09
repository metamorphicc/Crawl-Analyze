import type { Bot } from 'grammy';
import { setTimeout as delay } from 'node:timers/promises';
import type { TelegramStore } from '@crawlspider/storage';
import { telegramFailure } from './app.js';
export function startPolling(
  bot: Bot,
  store: Pick<TelegramStore, 'offset' | 'ingestBatch'>,
  onFailure: () => void,
) {
  const stop = new AbortController();
  // grammY's node typings use an older AbortSignal shim; its client accepts native signals.
  const signal = stop.signal as unknown as NonNullable<Parameters<typeof bot.api.getUpdates>[1]>;
  const running = (async () => {
    while (!stop.signal.aborted) {
      try {
        const offset = await store.offset();
        const updates = await bot.api.getUpdates(
          { offset, limit: 100, timeout: 10, allowed_updates: ['message', 'callback_query'] },
          signal,
        );
        await store.ingestBatch(updates);
      } catch (e) {
        if (stop.signal.aborted) break;
        onFailure();
        const failure = telegramFailure(e);
        await delay((failure.retry ?? 2) * 1000, undefined, { signal: stop.signal }).catch(
          () => {},
        );
      }
    }
  })();
  return {
    async close() {
      stop.abort();
      await running;
    },
  };
}
