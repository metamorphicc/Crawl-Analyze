import React, { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  sessionInfoSchema,
  watchlistSchema,
  linkBeginSchema,
  linkStatusSchema,
  successSchema,
  notificationSettingsSchema,
  type NotificationSettings,
} from '@crawlspider/contracts';
import { request, useResource, errorMessage } from './api.js';
export function Watchlist() {
  const me = useResource('/v1/me', sessionInfoSchema),
    client = useQueryClient();
  const [link, setLink] = useState<ReturnType<typeof linkBeginSchema.parse> | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!link) return;
    const stop = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const state = await request(`/v1/auth/link/${link!.id}`, linkStatusSchema, {
          signal: stop.signal,
        });
        if (state.state === 'approved') {
          await request('/v1/auth/complete', successSchema, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: link!.id }),
            signal: stop.signal,
          });
          setLink(null);
          await client.invalidateQueries({ queryKey: ['/v1/me'] });
          return;
        }
        if (Date.now() > Date.parse(link!.expiresAt))
          throw new Error('Ссылка истекла. Начните привязку снова.');
        if (!stop.signal.aborted) timer = setTimeout(() => void poll(), 3000);
      } catch (e) {
        if (!stop.signal.aborted) {
          setError(errorMessage(e));
          setLink(null);
        }
      }
    }
    void poll();
    return () => {
      stop.abort();
      clearTimeout(timer);
    };
  }, [link, client]);
  async function begin() {
    setBusy(true);
    setError('');
    try {
      setLink(await request('/v1/auth/link', linkBeginSchema, { method: 'POST' }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h1>Наблюдение</h1>
      {error && <p role="alert">{error}</p>}
      {me.isPending ? (
        <p>Проверяем сессию…</p>
      ) : me.error ? (
        <p role="alert">{errorMessage(me.error)}</p>
      ) : me.data?.user ? (
        <Personal user={me.data.user} />
      ) : (
        <>
          <p>
            Привяжите Telegram для общего списка на сайте и в боте. Публичное сканирование доступно
            без входа.
          </p>
          <button onClick={() => void begin()} disabled={busy}>
            Привязать Telegram
          </button>
          {link && (
            <p>
              Код: <strong>{link.code}</strong>.{' '}
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                Открыть бота
              </a>
              . Подтвердите совпадение кода в личном чате. Ссылка действует пять минут.
            </p>
          )}
        </>
      )}
    </>
  );
}
function Personal({
  user,
}: {
  user: NonNullable<ReturnType<typeof sessionInfoSchema.parse>['user']>;
}) {
  const watches = useResource('/v1/watches', watchlistSchema, true),
    client = useQueryClient();
  const [mint, setMint] = useState(
      new URLSearchParams(window.location.search).get('mint')?.slice(0, 44) || '',
    ),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [settings, setSettings] = useState<NotificationSettings>(user.settings);
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError('');
    try {
      await request(path, successSchema, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          'x-csrf-token': user.csrf,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      await client.invalidateQueries({ queryKey: ['/v1/watches'] });
      await client.invalidateQueries({ queryKey: ['/v1/me'] });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <p>
        Telegram ID: {user.id}.{' '}
        {user.pauseReason &&
          `Доставка приостановлена: ${user.pauseReason}. Разблокируйте бота и включите уведомления.`}
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate('/v1/watches', 'POST', { mint });
        }}
      >
        <label>
          Mint для наблюдения
          <input value={mint} onChange={(e) => setMint(e.target.value)} required maxLength={44} />
        </label>
        <button disabled={busy}>Добавить</button>
      </form>
      {watches.error ? (
        <p role="alert">{errorMessage(watches.error)}</p>
      ) : (
        <ul>
          {watches.data?.map((w) => (
            <li key={w.mint}>
              <a href={`/token/${w.mint}`}>{w.mint}</a> — проверка{' '}
              {new Date(w.nextCheckAt).toLocaleString()};{' '}
              {w.pendingJobId ? 'в очереди / работе' : w.lastQuality || 'исходный отчёт ожидается'}{' '}
              {w.lastReportId && <a href={`/report/${w.lastReportId}`}>Отчёт</a>}{' '}
              <button
                disabled={busy}
                onClick={() => void mutate(`/v1/watches/${w.mint}`, 'DELETE')}
              >
                Убрать
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          try {
            void mutate('/v1/settings', 'PATCH', notificationSettingsSchema.parse(settings));
          } catch {
            setError('Проверьте диапазоны настроек.');
          }
        }}
      >
        <h2>Уведомления</h2>
        <label>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          />
          Включены
        </label>
        {(
          [
            {
              key: 'cadenceMinutes',
              label: 'Минимальный интервал доставки, минут',
              min: 15,
              max: 1440,
            },
            { key: 'utcOffsetMinutes', label: 'Сдвиг UTC, минут', min: -720, max: 840 },
            { key: 'riskDelta', label: 'Порог изменения риска', min: 5, max: 100 },
            {
              key: 'positionDeltaBps',
              label: 'Порог изменения позиции, bps от оборотного предложения',
              min: 10,
              max: 10000,
            },
          ] as const
        ).map((f) => (
          <label key={f.key}>
            {f.label}
            <input
              type="number"
              required
              min={f.min}
              max={f.max}
              value={settings[f.key]}
              onChange={(e) => setSettings({ ...settings, [f.key]: Number(e.target.value) })}
            />
          </label>
        ))}
        <label>
          <input
            type="checkbox"
            checked={settings.quietHours !== null}
            onChange={(e) =>
              setSettings({
                ...settings,
                quietHours: e.target.checked ? { start: 22, end: 8 } : null,
              })
            }
          />
          Тихие часы
        </label>
        {settings.quietHours && (
          <>
            {(['start', 'end'] as const).map((k) => (
              <label key={k}>
                {k === 'start' ? 'Начало' : 'Конец'}
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={settings.quietHours![k]}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      quietHours: { ...settings.quietHours!, [k]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
            <p>
              Одинаковые часы означают тишину весь день. Сдвиг фиксированный, без автоматического
              перехода на летнее время.
            </p>
          </>
        )}
        <button disabled={busy}>Сохранить настройки</button>
      </form>
      <p>
        Проверки планируются каждые 15 минут при доступных источниках и бюджете. Несопоставимые
        снимки не вызывают уведомлений. Накопленные изменения объединяются, в сообщении показаны
        последние; подробности находятся в отчётах.
      </p>
      <button disabled={busy} onClick={() => void mutate('/v1/logout', 'POST')}>
        Выйти
      </button>{' '}
      <button disabled={busy} onClick={() => void mutate('/v1/unlink', 'POST')}>
        Отключить все сессии сайта
      </button>
      <details>
        <summary>Удаление персональных данных</summary>
        <p>Будут удалены списки, настройки и сессии. Публичные отчёты о блокчейне сохраняются.</p>
        <button disabled={busy} onClick={() => void mutate('/v1/me', 'DELETE')}>
          Удалить мои данные
        </button>
      </details>
    </>
  );
}
