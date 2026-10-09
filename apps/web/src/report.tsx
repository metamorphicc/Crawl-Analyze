import { useEffect, useRef, useState, lazy, Suspense, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { AnalysisReport, RelationshipEdge } from '@crawlspider/contracts';
import { date, percent, safeLink, units, stateLabel } from './format.js';
const PriceChart = lazy(() =>
  import('./price-chart.js').then((module) => ({ default: module.PriceChart })),
);
export function External({ url, children }: { url: string; children: ReactNode }) {
  const safe = safeLink(url);
  return safe ? (
    <a href={safe} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ) : (
    <span>{children} (ссылка недоступна)</span>
  );
}
const ownerLink = (owner: string) => (
  <External url={`https://solscan.io/account/${owner}`}>{owner}</External>
);
function Reasons({ values }: { values: string[] }) {
  return values.length ? (
    <ul>
      {[...new Set(values)].map((v) => (
        <li key={v}>{v}</li>
      ))}
    </ul>
  ) : null;
}
function Table({
  title,
  heads,
  rows,
}: {
  title: string;
  heads: string[];
  rows: { id: string; cells: () => ReactNode[] }[];
}) {
  const [page, setPage] = useState(0),
    size = 25,
    pages = Math.max(1, Math.ceil(rows.length / size)),
    actual = Math.min(page, pages - 1);
  return (
    <>
      <div className="table-scroll" tabIndex={0} role="region" aria-label={title}>
        <table>
          <caption>
            {title} · {rows.length}
          </caption>
          <thead>
            <tr>
              {heads.map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.slice(actual * size, (actual + 1) * size).map((r) => (
              <tr key={r.id}>
                {r.cells().map((c, i) => (
                  <td key={i}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length === 0 && <p>Записей в отчёте нет. Это не доказывает отсутствие активности.</p>}
      {pages > 1 && (
        <div className="actions">
          <button disabled={actual === 0} onClick={() => setPage(actual - 1)}>
            Предыдущая страница
          </button>
          <span role="status">
            Страница {actual + 1} из {pages}
          </span>
          <button disabled={actual === pages - 1} onClick={() => setPage(actual + 1)}>
            Следующая страница
          </button>
        </div>
      )}
    </>
  );
}
export function ReportView({
  report: r,
  provisional = false,
  historical = false,
}: {
  report: AnalysisReport;
  provisional?: boolean;
  historical?: boolean;
}) {
  const [search, setSearch] = useState(''),
    [edge, setEdge] = useState<RelationshipEdge>(),
    [copied, setCopied] = useState(''),
    [chart, setChart] = useState(false),
    [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  const quality = r.snapshot.quality,
    metrics = r.risk.metrics,
    stale = [
      r.observedAt,
      quality.observedAt,
      ...r.scenarios.scenarios.flatMap((s) => s.quotes.map((q) => q.observedAt)),
    ].some((time) => now - Date.parse(time) > 120000),
    decimals = r.identity.decimals;
  const share = async () => {
    try {
      await navigator.clipboard.writeText(new URL(`/report/${r.id}`, location.origin).href);
      setCopied('Ссылка скопирована');
    } catch {
      setCopied('Копирование недоступно. Откройте ссылку на отчёт и скопируйте адрес страницы.');
    }
  };
  const download = () => {
    const url = URL.createObjectURL(
        new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }),
      ),
      a = document.createElement('a');
    a.href = url;
    a.download = `crawlspider-${r.id}${provisional ? '-preview' : ''}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <article aria-label="Отчёт анализа">
      <header>
        <h2>{provisional ? 'Предварительный результат' : 'Отчёт анализа'}</h2>
        <p>
          {stateLabel[r.mode]} · {date(r.observedAt)} · качество: {quality.status}
        </p>
        {provisional && (
          <p role="status">Промежуточный результат скана. Итоговый отчёт ещё не сохранён.</p>
        )}
        {stale && (
          <p role="status">
            Устаревший снимок: старше 2 минут. Текущие балансы и резервы могли измениться.
          </p>
        )}
        {historical && <p>Исторический отчёт сохраняет значения на время анализа.</p>}
        <p>
          Mint: {r.identity.mint}. Decimals: {decimals}. Supply:{' '}
          {units(r.identity.supply, decimals)} (raw: {r.identity.supply}).
        </p>
        <p>
          Mint authority: {r.identity.mintAuthority ?? 'отозвана'} · Freeze authority:{' '}
          {r.identity.freezeAuthority ?? 'отозвана'}
        </p>
        <p>
          Источник: {r.identity.provenance.provider}; commitment: {r.identity.provenance.commitment}
          ; слот: {r.identity.provenance.slot ?? 'неизвестно'}.
        </p>
        <p>
          Версии: контракт {r.contractVersion}; анализ {r.analysisVersion}; парсер {r.parserVersion}
          .
        </p>
        <nav aria-label="Терминалы">
          {Object.entries(r.links).map(([name, url]) => (
            <External key={name} url={url}>
              {name === 'pump'
                ? 'pump.fun'
                : name === 'axiom'
                  ? 'Axiom'
                  : name === 'gmgn'
                    ? 'GMGN'
                    : 'Solscan'}
            </External>
          ))}
        </nav>
        <div className="actions">
          {!provisional && (
            <>
              <Link to="/report/$id" params={{ id: r.id }}>
                Постоянная ссылка на отчёт
              </Link>
              <button onClick={() => void share()}>Скопировать ссылку</button>
            </>
          )}
          <button onClick={download}>
            Скачать JSON{provisional ? ' предварительного результата' : ''}
          </button>
          <Link to="/token/$mint" params={{ mint: r.identity.mint }} search={{ job: undefined }}>
            Открыть токен
          </Link>
        </div>
        {copied && <p role="status">{copied}</p>}
      </header>
      <section>
        <h3>Риск распределения</h3>
        <p>
          Риск: {r.risk.riskScore === null ? 'Недостаточно данных' : `${r.risk.riskScore}/100`} ·{' '}
          {r.risk.classification}
        </p>
        <p>
          Полнота данных: {r.risk.confidence.dataCompleteness}%. Это покрытие данных, а не точность
          прогноза. Эвристика не откалибрована.
        </p>
        <p>
          Наблюдаемые баллы: {r.risk.observedRiskPoints}. При недостатке данных они не заменяют
          итоговый балл.
        </p>
        <Reasons values={r.risk.eligibilityReasons} />
        <Reasons values={r.risk.confidence.reasons} />
        <p>
          Держателей в индексе: {metrics.ownerCount}. Top 1: {percent(metrics.top1Bps)} · Top 10:{' '}
          {percent(metrics.top10Bps)} · наибольшая гипотеза контроля:{' '}
          {percent(metrics.largestHypothesisBps)}.
        </p>
        <p>
          Отмеченный баланс: {units(metrics.flaggedBalance, decimals)} (
          {percent(metrics.flaggedBps)}). Знаменатель: {units(metrics.eligibleBalance, decimals)};
          подтверждённая инфраструктура исключена: {units(metrics.excludedBalance, decimals)}.
        </p>
        <Table
          title="Правила риска"
          heads={['Правило', 'Состояние / баллы', 'Условие / наблюдение', 'Доказательства']}
          rows={r.risk.rules.map((rule) => ({
            id: rule.id,
            cells: () => [
              rule.id,
              `${rule.status} / ${rule.points}`,
              `${rule.threshold} / ${rule.observed ?? 'неизвестно'}`,
              <>
                {rule.evidenceIds.map((id) => {
                  const evidence = r.graph.edges.find((e) => e.id === id);
                  return evidence ? (
                    <button key={id} onClick={() => setEdge(evidence)}>
                      {id}
                    </button>
                  ) : (
                    <span key={id}>{id} </span>
                  );
                })}
              </>,
            ],
          }))}
        />
      </section>
      <section>
        <h3>Качество и ограничения</h3>
        <p>
          Перечисление держателей: {r.snapshot.enumerationComplete ? 'завершено' : 'неполное'}.
          Supply сверено: {quality.supplyReconciled ? 'да' : 'нет'}. Снимок не атомарен.
        </p>
        <p>
          Слоты: {quality.minSlot ?? 'неизвестно'} — {quality.maxSlot ?? 'неизвестно'}; индекс:{' '}
          {quality.indexedSlot ?? 'неизвестно'}; время: {date(quality.observedAt)}.
        </p>
        <Reasons values={[...quality.reasons, ...r.limitations, ...r.graph.limitations]} />
      </section>
      <section>
        <h3>Держатели</h3>
        <label htmlFor={`owner-search-${r.id}`}>Поиск держателя</label>
        <input
          id={`owner-search-${r.id}`}
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value.trim())}
        />
        <Table
          key={search}
          title="Держатели"
          heads={['Owner', 'Баланс / raw', 'Исключено', 'Заморожено / делегировано', 'Аккаунты']}
          rows={r.snapshot.holders
            .filter((h) => h.owner.includes(search))
            .map((h) => ({
              id: h.owner,
              cells: () => [
                ownerLink(h.owner),
                <>
                  {units(h.amount, decimals)}
                  <br />
                  raw: {h.amount}
                </>,
                units(h.excludedAmount, decimals),
                `${units(h.frozenAmount, decimals)} / ${units(h.delegatedAmount, decimals)}`,
                <details>
                  <summary>{h.accounts.length} аккаунтов</summary>
                  <ul>
                    {h.accounts.map((a) => (
                      <li key={a}>{ownerLink(a)}</li>
                    ))}
                  </ul>
                </details>,
              ],
            }))}
        />
      </section>
      <section>
        <h3>Связи и доказательства</h3>
        <p>
          Взаимодействие адресов не доказывает личность владельца. Предполагаемый общий контроль и
          сходство поведения остаются гипотезами.
        </p>
        <Table
          title="Связи кошельков"
          heads={['Откуда', 'Куда', 'Тип / сила', 'Уверенность', 'Доказательство']}
          rows={r.graph.edges.map((e) => ({
            id: e.id,
            cells: () => [
              ownerLink(e.from),
              ownerLink(e.to),
              `${e.kind} / ${e.strength}`,
              e.confidence,
              <button onClick={() => setEdge(e)}>Открыть доказательство</button>,
            ],
          }))}
        />
        <Table
          title="Гипотезы общего контроля"
          heads={['Группа', 'Баланс', 'Owners', 'Доказательства']}
          rows={r.graph.controlHypotheses.map((h) => ({
            id: h.id,
            cells: () => [
              `${h.id} · личность не доказана`,
              units(h.amount, decimals),
              h.owners.join(', '),
              h.evidenceIds.join(', '),
            ],
          }))}
        />
      </section>
      <section>
        <h3>История кошельков</h3>
        <Table
          title="Наблюдаемая история"
          heads={['Owner', 'Вход', 'Предыдущая торговля', 'Покрытие / причины']}
          rows={r.signals.map((s) => ({
            id: s.owner,
            cells: () => [
              ownerLink(s.owner),
              s.entry ? (
                <>
                  <External url={`https://solscan.io/tx/${encodeURIComponent(s.entry.signature)}`}>
                    {s.entry.kind} · слот {s.entry.slot}
                  </External>
                  <p>{units(s.entry.amount, decimals)}</p>
                </>
              ) : (
                'неизвестно'
              ),
              `${s.priorTrading} · ${s.priorTradeCount ?? 'неизвестно'}`,
              <>
                {s.coverage.status} · {s.coverage.decoded}/{s.coverage.signatures} · окно:{' '}
                {s.coverage.oldestSlot ?? '?'} — {s.coverage.newestSlot ?? '?'}
                <Reasons values={[...s.coverage.reasons, ...s.reasons]} />
              </>,
            ],
          }))}
        />
      </section>
      <section>
        <h3>Ранние покупатели</h3>
        {!r.earlyBuyers ? (
          <p>Эти данные не читались в данном отчёте.</p>
        ) : (
          <>
            <p>
              Статус: {r.earlyBuyers.status}. Прочитанное окно не гарантирует полный список всех
              покупателей.
            </p>
            <Reasons values={r.earlyBuyers.reasons} />
            {r.earlyBuyers.launch && (
              <p>
                Наблюдаемый запуск:{' '}
                <External
                  url={`https://solscan.io/tx/${encodeURIComponent(r.earlyBuyers.launch.signature)}`}
                >
                  {r.earlyBuyers.launch.signature}
                </External>
                , слот {r.earlyBuyers.launch.slot}.
              </p>
            )}
            <Table
              title="Первые наблюдаемые покупки"
              heads={['Owner', 'Покупка', 'Текущий баланс', 'Порядок / ранний вход']}
              rows={r.earlyBuyers.buyers.map((b) => ({
                id: b.owner,
                cells: () => [
                  ownerLink(b.owner),
                  <>
                    <External url={`https://solscan.io/tx/${encodeURIComponent(b.signature)}`}>
                      {b.signature}
                    </External>
                    <p>
                      {units(b.amount, decimals)} · слот {b.slot}
                    </p>
                  </>,
                  units(b.currentBalance, decimals),
                  `${b.transactionOrder ?? 'порядок неизвестен'} / ${b.early === null ? 'неизвестно' : b.early ? 'подтверждён в окне' : 'нет'} · ${b.entryClaim}`,
                ],
              }))}
            />
          </>
        )}
      </section>
      <section>
        <h3>Изменения позиций</h3>
        {!r.changes ? (
          <p>Сравнение ещё не выполнялось.</p>
        ) : (
          <>
            <p>
              Снимки {r.changes.comparable ? 'сопоставимы' : 'не сопоставимы'}. Изменение ранга не
              означает продажу.
            </p>
            {r.changes.previousReportId && (
              <Link to="/report/$id" params={{ id: r.changes.previousReportId }}>
                Предыдущий отчёт
              </Link>
            )}
            <Reasons values={r.changes.reasons} />
            <Table
              title="Разница балансов"
              heads={['Owner', 'До', 'После', 'Разница', 'Необъяснённая разница']}
              rows={r.changes.positions.map((p) => ({
                id: p.owner,
                cells: () => [
                  ownerLink(p.owner),
                  units(p.before, decimals),
                  units(p.after, decimals),
                  units(p.delta, decimals),
                  units(p.unexplainedDelta, decimals),
                ],
              }))}
            />
            <Table
              title="Наблюдаемые движения"
              heads={['Owner / контрагент', 'Тип', 'Количество', 'Слот / транзакция', 'Основание']}
              rows={r.changes.movements.map((m) => ({
                id: m.id,
                cells: () => [
                  `${m.owner} / ${m.counterparty ?? 'неизвестно'}`,
                  m.kind,
                  units(m.amount, decimals),
                  m.signature ? (
                    <External url={`https://solscan.io/tx/${encodeURIComponent(m.signature)}`}>
                      {m.slot ?? '?'} · {m.signature}
                    </External>
                  ) : (
                    'неизвестно'
                  ),
                  `${m.explanation}${m.controlHypothesis ? ` · гипотеза ${m.controlHypothesis}; личность не доказана` : ''}`,
                ],
              }))}
            />
          </>
        )}
      </section>
      <section>
        <h3>Сценарии продажи</h3>
        <p>
          База сценариев: отмеченный баланс {units(r.scenarios.basisAmount, decimals)}. Модель:{' '}
          {r.scenarios.modelVersion}. Время: {date(r.scenarios.observedAt)}. Это расчёт в известных
          рынках, а не прогноз продажи.
        </p>
        <Reasons values={r.scenarios.limitations} />
        {r.scenarios.scenarios.map((s) => (
          <details key={s.fractionBps} open>
            <summary>
              {percent(s.fractionBps)} отмеченного баланса · {units(s.baseIn, decimals)}
            </summary>
            {!s.quotes.length && <p>Поддерживаемые рынки недоступны.</p>}
            {s.quotes.map((q) => (
              <div key={q.market}>
                <p>
                  {q.venue} · {q.market} · слот {q.slot} · {stateLabel[q.status]}. Quote mint:{' '}
                  {q.quoteMint}.
                </p>
                {q.status === 'unavailable' ? (
                  <Reasons values={q.reasons} />
                ) : (
                  <>
                    <p>
                      Выход: {q.quoteUnits ?? `${q.netQuoteOut} raw (decimals неизвестны)`};
                      минимальный raw: {q.minQuoteOut}. Изменение спот-цены, bps:{' '}
                      {q.postSpotDropBps}; влияние на исполнение, bps: {q.executionImpactBps}.
                    </p>
                    <p>
                      Комиссии raw: LP {q.fees.lp}, протокол {q.fees.protocol}, создатель{' '}
                      {q.fees.creator}. Резервы raw: эффективный {q.effectiveQuoteReserve};
                      доступный {q.realQuoteAvailable}.
                    </p>
                    <Reasons values={q.assumptions} />
                  </>
                )}
              </div>
            ))}
            {s.routes.map((route) => (
              <p key={`${route.kind}:${route.quoteMint}`}>
                {route.kind} · quote {route.quoteMint} · выход {route.netQuoteOut} raw ·{' '}
                {route.legs.length} рынков; достижимо в модели, глобальный оптимум не доказан.
              </p>
            ))}
          </details>
        ))}
      </section>
      <section>
        <h3>График цены</h3>
        <p>Внешние свечи USD показываются отдельно от снимка отчёта и расчётов резервов.</p>
        {chart ? (
          <Suspense fallback={<p role="status">Загружаем график…</p>}>
            <PriceChart mint={r.identity.mint} />
          </Suspense>
        ) : (
          <button onClick={() => setChart(true)}>Загрузить свечи</button>
        )}
      </section>
      {edge && <EvidenceDialog edge={edge} close={() => setEdge(undefined)} />}
    </article>
  );
}
function EvidenceDialog({ edge: e, close }: { edge: RelationshipEdge; close: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current,
      previous = document.activeElement as HTMLElement | null;
    element?.showModal();
    return () => {
      element?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="evidence-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="evidence-title">Доказательство {e.id}</h2>
      <button autoFocus onClick={close}>
        Закрыть доказательство
      </button>
      <p>{e.explanation}</p>
      <p>
        {e.from} → {e.to}
      </p>
      <p>
        Тип: {e.kind}; сила: {e.strength}; уверенность: {e.confidence}. Личность владельца не
        доказана.
      </p>
      <p>
        Количество raw: {e.amount ?? 'неизвестно'}. Версия правила: {e.ruleVersion}.
      </p>
      <p>
        Поддерживает гипотезу общего контроля: {e.supportsControlHypothesis ? 'да' : 'нет'}; сервис
        исключён: {e.serviceExcluded ? 'да' : 'нет'}.
      </p>
      <p>
        Источник: {e.provenance.provider}; время: {date(e.provenance.observedAt)}; слот:{' '}
        {e.provenance.slot ?? 'неизвестно'}; commitment: {e.provenance.commitment}; парсер:{' '}
        {e.provenance.parserVersion}.
      </p>
      <ul>
        {e.transactionLinks.map((url) => (
          <li key={url}>
            <External url={url}>{url}</External>
          </li>
        ))}
      </ul>
      <p>
        Подписи: {e.signatures.join(', ') || e.signature || 'неизвестно'}. Связанные доказательства:{' '}
        {e.relatedEvidenceIds.join(', ') || 'нет'}.
      </p>
    </dialog>
  );
}
