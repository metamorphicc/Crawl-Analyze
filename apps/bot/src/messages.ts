import { InlineKeyboard } from 'grammy';
import type { AnalysisReport, JobDetails } from '@crawlspider/contracts';
export const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
const pct = (bps: number) => `${(bps / 100).toFixed(2)}%`;
const labels: Record<string, string> = {
  queued: 'В очереди',
  running: 'Анализируем',
  complete: 'Завершён',
  partial: 'Неполный результат',
  failed: 'Ошибка скана',
  cancelled: 'Отменён',
  preview: 'Предварительный',
  deep: 'Глубокий',
  mint: 'Проверка токена',
  holders: 'Держатели',
  markets: 'Рынки',
  'launch-history': 'Первые покупатели',
  'wallet-history': 'История',
  'old-owner-positions': 'Прежние держатели',
  funding: 'Финансирование',
  analysis: 'Расчёт отчёта',
};
export function reportText(r: AnalysisReport, preview = false) {
  const distribution = r.distributionRisk?.eligible ? r.distributionRisk : r.risk;
  const m = r.risk.metrics,
    q = r.snapshot.quality;
  const known = r.scenarios.scenarios
    .find((s) => s.fractionBps === 10000)
    ?.quotes.find((q) => q.status === 'available');
  const lines = [
    `<b>${preview ? 'Предварительный результат' : 'CrawlSpider · отчёт'}</b>`,
    `<code>${r.identity.mint}</code>`,
    `${labels[r.mode]} · ${escapeHtml(r.observedAt)}`,
    `Риск распределения: <b>${distribution.riskScore === null ? 'недостаточно данных' : `${distribution.riskScore}/100`}</b>`,
    ...(distribution.scope === 'distribution'
      ? [
          'Только распределение, полномочия и флаги счетов. Это не полная оценка безопасности токена.',
          `Расширенная оценка: ${r.risk.riskScore === null ? 'недостаточно данных' : `${r.risk.riskScore}/100`}.`,
        ]
      : []),
    `Полнота данных: ${r.risk.confidence.dataCompleteness}% — не точность прогноза.`,
    `Держателей в индексе: ${m.ownerCount}. Top 1: ${pct(m.top1Bps)}; Top 10: ${pct(m.top10Bps)}.`,
    `Отмеченный баланс: ${pct(m.flaggedBps)}; гипотеза контроля: ${pct(m.largestHypothesisBps)}.`,
    `Качество: ${q.status}; слоты ${q.minSlot ?? '?'}–${q.maxSlot ?? '?'}. Снимок не атомарен.`,
    `Ранние покупатели: ${r.earlyBuyers?.status ?? 'не читались'}; наблюдено ${r.earlyBuyers?.buyers.length ?? 'неизвестно'}.`,
    `Сценарий продажи 100% отмеченного баланса: ${known?.status === 'available' ? `${known.netQuoteOut} raw в ${known.quoteMint}; модель ${known.modelVersion}` : 'недоступен'}.`,
    `Эвристика не откалибрована. Связи не доказывают личность владельца.`,
  ];
  const reasons = [...new Set([...r.risk.eligibilityReasons, ...q.reasons, ...r.limitations])];
  if (reasons.length)
    lines.push(
      `Ограничения: ${reasons
        .slice(0, 5)
        .map((v) => escapeHtml(v.slice(0, 160)))
        .join('; ')}${reasons.length > 5 ? '; остальные в отчёте' : ''}.`,
    );
  if (Date.now() - Date.parse(r.observedAt) > 120000)
    lines.push('Устаревший снимок: старше двух минут.');
  return lines.join('\n');
}
export function jobText(job: JobDetails) {
  return `<b>${labels[job.state] ?? job.state}</b> · ${escapeHtml(labels[job.phase] ?? job.phase)}\n<code>${job.mint}</code>\n${job.errorCode ? `Код: ${escapeHtml(job.errorCode)}. Повторите /scan.` : 'Результат появится в этом сообщении.'}`;
}
const terminal = (url: string) => {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      ['pump.fun', 'axiom.trade', 'gmgn.ai', 'solscan.io'].includes(u.hostname)
      ? u.href
      : null;
  } catch {
    return null;
  }
};
export function reportButtons(
  r: AnalysisReport,
  publicWeb: string,
  requestId: string,
  preview = false,
) {
  const k = new InlineKeyboard();
  if (!preview) k.url('Отчёт', new URL(`/report/${r.id}`, publicWeb).href).row();
  for (const name of ['pump', 'axiom', 'gmgn', 'solscan'] as const) {
    const url = terminal(r.links[name]);
    if (url)
      k.url(
        name === 'pump'
          ? 'pump.fun'
          : name === 'axiom'
            ? 'Axiom'
            : name === 'gmgn'
              ? 'GMGN'
              : 'Solscan',
        url,
      );
  }
  k.row();
  if (r.mode === 'preview') k.text('Глубокий анализ', `deep:${requestId}`);
  k.text('Наблюдать', `watch:${requestId}`);
  return k;
}
export const HELP =
  'Пришлите Solana mint или ссылку pump.fun / Axiom / GMGN в личном чате.\n/scan <mint или ссылка> — глубокий анализ\n/scan preview <mint или ссылка> — предварительный\n/status — состояние источников\n/watch, /watchlist, /unwatch, /settings — наблюдение\nВ группах используются явные команды /scan. Риск — эвристика, не вероятность мошенничества.';
