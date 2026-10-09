import { it, expect } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { startPolling } from './polling.js';
import { mockTelegram, message } from '../../../tests/fixtures/telegram.js';
it('does not acknowledge a fetched update until its durable batch and offset commit', async () => {
  const { bot } = mockTelegram(),
    offsets: number[] = [];
  let offset = 0,
    ingests = 0,
    failures = 0;
  bot.api.config.use(async (_prev, _method, payload) => {
    offsets.push(Number((payload as any).offset));
    await delay(10);
    return { ok: true, result: offset === 0 ? [message(42, '/help')] : [] } as any;
  });
  const poll = startPolling(
    bot,
    {
      async offset() {
        return offset;
      },
      async ingestBatch(updates) {
        if (ingests++ === 0) throw new Error('Synthetic DB outage');
        if (updates.length) offset = updates.at(-1)!.update_id + 1;
      },
    },
    () => {
      failures++;
    },
  );
  try {
    for (let i = 0; i < 100 && offsets.length < 3; i++) await delay(30);
    expect(failures).toBe(1);
    expect(offsets.slice(0, 3)).toEqual([0, 0, 43]);
  } finally {
    await poll.close();
  }
});
