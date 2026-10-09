import { Bot, GrammyError, HttpError, BotError, type Context } from 'grammy';
import { setTimeout as delay } from 'node:timers/promises';
import { capabilities, type Config } from '@crawlspider/config';
import { PublicError, scanRequestSchema } from '@crawlspider/contracts';
import {
  TelegramStore,
  ScanStore,
  tgHash,
  sharedProviderBudget,
  type Storage,
} from '@crawlspider/storage';
import { RpcClient, parseInput, resolveInput } from '@crawlspider/providers';
import { HELP, reportText, jobText, reportButtons } from './messages.js';
export class TelegramRateLimit extends Error {
  constructor(readonly seconds: number) {
    super('Telegram rate limit');
  }
}
export function telegramFailure(e: unknown) {
  if (e instanceof BotError) return telegramFailure(e.error);
  if (e instanceof TelegramRateLimit)
    return { code: 'TELEGRAM_RATE_LIMIT', retry: Math.min(86400, Math.max(1, e.seconds)) };
  if (e instanceof GrammyError) {
    const seconds = e.parameters.retry_after;
    if (e.error_code === 429 && seconds)
      return { code: 'TELEGRAM_RATE_LIMIT', retry: Math.min(86400, Math.max(1, seconds)) };
    return {
      code:
        e.error_code === 403
          ? 'TELEGRAM_BLOCKED'
          : e.error_code === 400
            ? 'TELEGRAM_MESSAGE_REJECTED'
            : 'TELEGRAM_ERROR',
      retry: undefined,
    };
  }
  return {
    code: e instanceof HttpError ? 'TELEGRAM_DELIVERY_UNCERTAIN' : 'PROCESSING_UNCERTAIN',
    retry: undefined,
  };
}
export type BotHooks = {
  command?: (ctx: Context, name: string) => Promise<boolean>;
  watch?: (ctx: Context, mint: string) => Promise<void>;
  start?: (ctx: Context, payload: string) => Promise<boolean>;
};
export function createBot(
  config: Config,
  storage: Storage,
  options: {
    bot?: Bot;
    resolve?: (input: string, signal: AbortSignal) => Promise<string>;
    hooks?: BotHooks;
    pace?: boolean;
  } = {},
) {
  const bot =
      options.bot ?? new Bot(config.TELEGRAM_BOT_TOKEN!, { client: { timeoutSeconds: 15 } }),
    store = new TelegramStore(storage.pool, config),
    scans = new ScanStore(storage.pool, config);
  const rpc = new RpcClient(config, fetch, {
    budget: sharedProviderBudget(
      storage,
      config.PROVIDER_MAX_RPS,
      config.PROVIDER_DAILY_REQUEST_LIMIT,
    ),
  });
  if (options.pace !== false)
    bot.api.config.use(async (prev, method, payload, signal) => {
      if (['sendMessage', 'editMessageText', 'answerCallbackQuery'].includes(method)) {
        const chat =
          'chat_id' in payload && typeof payload.chat_id === 'number' ? payload.chat_id : undefined;
        const wait = await store.reserve(chat, chat !== undefined && chat < 0);
        if (wait) {
          if (method === 'answerCallbackQuery') await delay(Math.min(wait, 3) * 1000);
          else throw new TelegramRateLimit(wait);
        }
      }
      return prev(method, payload, signal);
    });
  const reply = async (ctx: Context, text: string) => {
    await ctx.reply(text, {
      link_preview_options: { is_disabled: true },
      ...(ctx.msg?.message_thread_id ? { message_thread_id: ctx.msg.message_thread_id } : {}),
    });
  };
  const resolve =
    options.resolve ??
    (async (input: string, signal: AbortSignal) => {
      const p = parseInput(input);
      return p.mayBePool ? (await resolveInput(input, rpc, signal)).identity.mint : p.address;
    });
  async function submit(ctx: Context, input: string, mode: 'preview' | 'deep' = 'deep') {
    if (!ctx.from || !ctx.chat || ctx.from.is_bot) return;
    try {
      if (!capabilities(config).rpc || !capabilities(config).holderIndex)
        throw new PublicError(
          'PROVIDER_NOT_CONFIGURED',
          'Источники сканирования ещё не подключены.',
          503,
        );
      const parsed = scanRequestSchema.safeParse({ input, mode });
      if (!parsed.success)
        throw new PublicError('INVALID_INPUT', 'Введите /scan <mint или поддерживаемая ссылка>.');
      const mint = await resolve(
        parsed.data.input,
        AbortSignal.timeout(Math.min(20000, config.SCAN_PREVIEW_DEADLINE_MS)),
      );
      await store.request(
        ctx.update.update_id,
        ctx.from.id,
        ctx.chat.id,
        mint,
        mode,
        ctx.msg?.message_thread_id,
      );
    } catch (e) {
      if (e instanceof PublicError)
        await reply(
          ctx,
          e.code === 'SCAN_QUOTA'
            ? 'Лимит сканов исчерпан. Попробуйте позже.'
            : e.code === 'QUEUE_FULL'
              ? 'Очередь заполнена. Попробуйте позже.'
              : e.code === 'PROVIDER_NOT_CONFIGURED'
                ? 'Источники сканирования ещё не подключены.'
                : 'Не удалось проверить ввод. Используйте Solana mint или ссылку pump.fun / Axiom / GMGN.',
        );
      else throw e;
    }
  }
  bot.use(async (ctx, next) => {
    if (
      !ctx.from ||
      ctx.from.is_bot ||
      !ctx.chat ||
      !['private', 'group', 'supergroup'].includes(ctx.chat.type)
    )
      return;
    if (ctx.chat.type === 'private' && ctx.chat.id === ctx.from.id)
      await store.recoverIdentity(ctx.from.id, ctx.chat.id);
    await next();
  });
  bot.command('start', async (ctx) => {
    if (options.hooks?.start && (await options.hooks.start(ctx, String(ctx.match)))) return;
    await reply(ctx, HELP);
  });
  bot.command('help', (ctx) => reply(ctx, HELP));
  bot.command('scan', async (ctx) => {
    let input = String(ctx.match).trim(),
      mode: 'preview' | 'deep' = 'deep';
    if (input.startsWith('preview ')) {
      mode = 'preview';
      input = input.slice(8).trim();
    }
    await submit(ctx, input, mode);
  });
  bot.command('status', async (ctx) => {
    const health = await storage.readiness(),
      c = capabilities(config),
      rows = await scans.queueStatus();
    await reply(
      ctx,
      `Инфраструктура: ${Object.values(health).every(Boolean) ? 'доступна' : 'работа ограничена'}.\nRPC: ${c.rpc ? 'настроен' : 'не подключён'}; индекс держателей: ${c.holderIndex ? 'настроен' : 'не подключён'}.\nВ очереди/работе: ${rows.reduce((n, r) => n + r.count, 0)}. Наличие настроек не гарантирует успешный внешний запрос.`,
    );
  });
  for (const name of ['watch', 'watchlist', 'unwatch', 'settings', 'unlink', 'delete'])
    bot.command(name, async (ctx) => {
      if (options.hooks?.command && (await options.hooks.command(ctx, name))) return;
      await reply(
        ctx,
        'Постоянное наблюдение и настройки будут доступны после подключения этой функции. Сканирование работает без входа.',
      );
    });
  bot.callbackQuery(/^(deep|watch):([\da-f-]{36})$/, async (ctx) => {
    const id = ctx.match[2]!,
      action = ctx.match[1],
      message = ctx.callbackQuery.message;
    const owned = message
      ? await store.owned(id, ctx.from.id, message.chat.id, message.message_id)
      : null;
    if (!owned) {
      await ctx.answerCallbackQuery({
        text: 'Кнопка доступна только автору запроса.',
        show_alert: true,
      });
      return;
    }
    await ctx.answerCallbackQuery();
    const job = await scans.details(owned.job_id);
    if (action === 'deep') await submit(ctx, job.mint, 'deep');
    else if (options.hooks?.watch) await options.hooks.watch(ctx, job.mint);
    else await reply(ctx, 'Наблюдение пока не подключено.');
  });
  bot.on('callback_query:data', (ctx) =>
    ctx.answerCallbackQuery({ text: 'Эта кнопка больше не действует.' }),
  );
  bot.on('message:text', async (ctx) => {
    if (ctx.chat.type !== 'private') return;
    const input = ctx.message.text.trim();
    if (input.startsWith('/')) {
      await reply(ctx, 'Команда не найдена. /help');
      return;
    }
    await submit(ctx, input);
  });
  return { bot, store, scans };
}
export function startBotProcessor(
  config: Config,
  storage: Storage,
  bot: Bot,
  options: { manual?: boolean } = {},
) {
  const store = new TelegramStore(storage.pool, config),
    scans = new ScanStore(storage.pool, config),
    stop = new AbortController();
  let active: Promise<void> | undefined;
  async function tick() {
    for (let i = 0; i < 5 && !stop.signal.aborted; i++) {
      const update = await store.claim();
      if (!update) break;
      try {
        await bot.handleUpdate(update.body as Parameters<Bot['handleUpdate']>[0]);
        await store.finish(update.id, update.token);
      } catch (e) {
        const failure = telegramFailure(e);
        await store.fail(update.id, update.token, failure.code, failure.retry);
      }
    }
    for (const message of await store.pending()) {
      if (stop.signal.aborted) break;
      try {
        const job = await scans.details(message.job_id),
          terminal = !['queued', 'running'].includes(job.state),
          report = job.reportId ? await scans.report(job.reportId) : job.preview;
        const text = report
            ? `${['failed', 'cancelled'].includes(job.state) ? `${jobText(job)}\n` : ''}${reportText(report, !job.reportId)}`
            : jobText(job),
          keyboard = report
            ? reportButtons(report, config.PUBLIC_WEB_URL, message.id, !job.reportId)
            : undefined,
          digest = tgHash(JSON.stringify({ text, keyboard }));
        if (message.state === 'pending') {
          if (!(await store.beginSend(message.id))) continue;
          const sent = await bot.api.sendMessage(Number(message.chat_id), text, {
            parse_mode: 'HTML',
            link_preview_options: { is_disabled: true },
            ...(keyboard ? { reply_markup: keyboard } : {}),
            ...(message.thread_id ? { message_thread_id: message.thread_id } : {}),
          });
          await store.sent(message.id, sent.message_id, digest);
          if (terminal) await store.edited(message.id, digest, true);
        } else if (message.last_digest !== digest) {
          try {
            await bot.api.editMessageText(Number(message.chat_id), message.message_id!, text, {
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true },
              ...(keyboard ? { reply_markup: keyboard } : {}),
            });
          } catch (e) {
            if (!(
              e instanceof GrammyError &&
              e.error_code === 400 &&
              e.description.includes('message is not modified')
            ))
              throw e;
          }
          await store.edited(message.id, digest, terminal);
        } else await store.edited(message.id, digest, terminal);
      } catch (e) {
        const failure = telegramFailure(e);
        await store.defer(
          message.id,
          failure.retry ?? 60,
          failure.retry !== undefined
            ? message.state === 'pending'
              ? 'pending'
              : message.state
            : message.state === 'pending'
              ? 'uncertain'
              : (failure.code === 'TELEGRAM_DELIVERY_UNCERTAIN' ||
                    failure.code === 'PROCESSING_UNCERTAIN') &&
                  message.attempts < 12
                ? 'ready'
                : 'failed',
        );
      }
    }
  }
  const run = () => {
    if (!active && !stop.signal.aborted)
      active = tick()
        .catch(() => {})
        .finally(() => {
          active = undefined;
        });
  };
  const timer = options.manual ? undefined : setInterval(run, 1000);
  if (!options.manual) run();
  return {
    tick,
    async close() {
      if (timer) clearInterval(timer);
      stop.abort();
      await active;
    },
  };
}
