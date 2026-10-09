export function units(raw: string | null, decimals: number): string {
  if (raw === null) return 'неизвестно';
  const negative = raw.startsWith('-'),
    digits = negative ? raw.slice(1) : raw,
    padded = digits.padStart(decimals + 1, '0');
  return `${negative ? '-' : ''}${decimals ? `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}` : padded}`;
}
export const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;
export const date = (value: string) => new Date(value).toLocaleString('ru-RU');
export function safeLink(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      [
        'pump.fun',
        'axiom.trade',
        'gmgn.ai',
        'solscan.io',
        'www.geckoterminal.com',
        'www.tradingview.com',
      ].includes(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export const stateLabel: Record<string, string> = {
  queued: 'В очереди',
  running: 'Анализируем',
  complete: 'Завершён',
  partial: 'Завершён с неполными данными',
  failed: 'Ошибка сканирования',
  cancelled: 'Отменён',
  preview: 'Предварительный',
  deep: 'Глубокий',
  available: 'Доступен',
  unavailable: 'Недоступен',
};
export const phaseLabel: Record<string, string> = {
  'launch-history': 'Поиск запуска и первых покупок',
  'old-owner-positions': 'Проверка прежних держателей',
  'wallet-history': 'История кошельков',
  accepted: 'Принят',
  queued: 'Ожидание',
  mint: 'Проверка токена',
  holders: 'Чтение держателей',
  markets: 'Проверка рынков',
  preview: 'Предварительный результат',
  launch: 'Поиск первых покупок',
  history: 'История кошельков',
  funding: 'Источники финансирования',
  analysis: 'Расчёт отчёта',
  complete: 'Готово',
};
