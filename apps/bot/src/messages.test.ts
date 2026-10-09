import { it, expect } from 'vitest';
import { reportText, reportButtons, escapeHtml } from './messages.js';
import { fixtureReport } from '../../../tests/fixtures/report.js';
import { randomUUID } from 'node:crypto';
import { validWebhookSecret } from './runtime.js';
it('escapes provider text and keeps report buttons within Telegram limits', () => {
  const r = fixtureReport(randomUUID());
  r.limitations = ['<script>bad & "text"</script>'];
  const text = reportText(r);
  expect(text).toContain('&lt;script&gt;');
  expect(text.length).toBeLessThan(4096);
  expect(escapeHtml('<&>')).toBe('&lt;&amp;&gt;');
  const buttons = reportButtons(r, 'https://site.example', randomUUID()).inline_keyboard.flat();
  for (const b of buttons)
    if ('callback_data' in b) expect(Buffer.byteLength(b.callback_data!)).toBeLessThanOrEqual(64);
});
it('compares webhook credentials without accepting prefixes or missing values', () => {
  expect(validWebhookSecret(undefined, 'abcd')).toBe(false);
  expect(validWebhookSecret('abcd1', 'abcd')).toBe(false);
  expect(validWebhookSecret('abcd', 'abcd')).toBe(true);
});
