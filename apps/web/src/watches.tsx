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
          throw new Error('Link expired. Start linking again.');
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
      <h1>Watchlist</h1>
      {error && <p role="alert">{error}</p>}
      {me.isPending ? (
        <p>Checking session…</p>
      ) : me.error ? (
        <p role="alert">{errorMessage(me.error)}</p>
      ) : me.data?.user ? (
        <Personal user={me.data.user} />
      ) : (
        <>
          <p>
            Link Telegram to share your watchlist between the website and bot. Public scanning
            requires no sign-in.
          </p>
          <button onClick={() => void begin()} disabled={busy}>
            Link Telegram
          </button>
          {link && (
            <p>
              Code: <strong>{link.code}</strong>.{' '}
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                Open bot
              </a>
              . Confirm the matching code in a private chat. The link expires in five minutes.
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
          `Delivery paused: ${user.pauseReason}. Unblock the bot and enable notifications.`}
      </p>
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void mutate('/v1/watches', 'POST', { mint });
        }}
      >
        <label>
          Mint to watch
          <input value={mint} onChange={(e) => setMint(e.target.value)} required maxLength={44} />
        </label>
        <button disabled={busy}>Add</button>
      </form>
      {watches.error ? (
        <p role="alert">{errorMessage(watches.error)}</p>
      ) : (
        <ul>
          {watches.data?.map((w) => (
            <li key={w.mint}>
              <a href={`/token/${w.mint}`}>{w.mint}</a> - check{' '}
              {new Date(w.nextCheckAt).toLocaleString('en-US')};{' '}
              {w.pendingJobId ? 'queued / running' : w.lastQuality || 'baseline report pending'}{' '}
              {w.lastReportId && <a href={`/report/${w.lastReportId}`}>Report</a>}{' '}
              <button
                disabled={busy}
                onClick={() => void mutate(`/v1/watches/${w.mint}`, 'DELETE')}
              >
                Remove
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
            setError('Check the settings ranges.');
          }
        }}
      >
        <h2>Notifications</h2>
        <label>
          <input
            type="checkbox"
            checked={settings.enabled}
            onChange={(e) => setSettings({ ...settings, enabled: e.target.checked })}
          />
          Enabled
        </label>
        {(
          [
            {
              key: 'cadenceMinutes',
              label: 'Minimum delivery interval, minutes',
              min: 15,
              max: 1440,
            },
            { key: 'utcOffsetMinutes', label: 'UTC offset, minutes', min: -720, max: 840 },
            { key: 'riskDelta', label: 'Risk change threshold', min: 5, max: 100 },
            {
              key: 'positionDeltaBps',
              label: 'Position change threshold, bps of eligible supply',
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
          Quiet hours
        </label>
        {settings.quietHours && (
          <>
            {(['start', 'end'] as const).map((k) => (
              <label key={k}>
                {k === 'start' ? 'Start' : 'End'}
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
              Matching hours mute notifications all day. The offset is fixed, with no automatic
              daylight-saving changes.
            </p>
          </>
        )}
        <button disabled={busy}>Save settings</button>
      </form>
      <p>
        Checks are scheduled every 15 minutes when data sources and budget are available.
        Incompatible snapshots do not trigger alerts. Accumulated changes are batched, with the
        latest shown in each message; reports contain the details.
      </p>
      <button disabled={busy} onClick={() => void mutate('/v1/logout', 'POST')}>
        Sign out
      </button>{' '}
      <button disabled={busy} onClick={() => void mutate('/v1/unlink', 'POST')}>
        Revoke all website sessions
      </button>
      <details>
        <summary>Delete personal data</summary>
        <p>
          Watchlists, settings and sessions will be deleted. Public blockchain reports are retained.
        </p>
        <button disabled={busy} onClick={() => void mutate('/v1/me', 'DELETE')}>
          Delete my data
        </button>
      </details>
    </>
  );
}
