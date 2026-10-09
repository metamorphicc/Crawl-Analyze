import { z } from 'zod';
import type { Context } from 'grammy';
import type { Config } from '@crawlspider/config';
import { WatchStore, sharedProviderBudget, type Storage } from '@crawlspider/storage';
import { RpcClient, parseInput, resolveInput } from '@crawlspider/providers';
import { notificationSettingsSchema, PublicError } from '@crawlspider/contracts';
import type { BotHooks } from './app.js';
export function watchHooks(config: Config, storage: Storage): BotHooks {
  const store = new WatchStore(storage.pool, config),
    rpc = new RpcClient(config, fetch, {
      budget: sharedProviderBudget(
        storage,
        config.PROVIDER_MAX_RPS,
        config.PROVIDER_DAILY_REQUEST_LIMIT,
      ),
    });
  const privateUser = (ctx: Context) =>
    ctx.chat?.type === 'private' && ctx.chat.id === ctx.from?.id;
  async function watch(ctx: Context, mint: string) {
    if (!privateUser(ctx)) {
      await ctx.reply('Наблюдение настраивается в личном чате с ботом.');
      return;
    }
    await store.add(String(ctx.from!.id), mint);
    await ctx.reply(
      'Токен добавлен. Уведомления используют только сопоставимые наблюдения; первый отчёт задаёт исходное состояние.',
    );
  }
  return {
    watch,
    async start(ctx, payload) {
      if (!payload.startsWith('link_')) return false;
      if (!privateUser(ctx)) {
        await ctx.reply('Откройте ссылку в личном чате.');
        return true;
      }
      const id = z.uuid().safeParse(payload.slice(5));
      if (!id.success) {
        await ctx.reply('Ссылка недействительна.');
        return true;
      }
      try {
        const code = await store.requestLink(id.data, ctx.from!.id);
        await ctx.reply(
          `Привязка к ${new URL(config.PUBLIC_WEB_URL).host}. Код: ${code}. Подтвердите только если этот код показан в вашем браузере и вы сами начали вход.`,
          {
            reply_markup: {
              inline_keyboard: [
                [{ text: 'Подтвердить привязку', callback_data: `link:${id.data}` }],
              ],
            },
          },
        );
      } catch (e) {
        if (!(e instanceof PublicError)) throw e;
        await ctx.reply('Ссылка истекла или уже использована.');
      }
      return true;
    },
    async callback(ctx) {
      const data = ctx.callbackQuery?.data;
      if (!data?.startsWith('link:')) return false;
      const id = z.uuid().safeParse(data.slice(5));
      if (!id.success || !privateUser(ctx)) {
        await ctx.answerCallbackQuery({ text: 'Привязка недоступна.' });
        return true;
      }
      try {
        await store.approveLink(id.data, ctx.from!.id);
        await ctx.answerCallbackQuery({ text: 'Подтверждено. Вернитесь в браузер.' });
      } catch (e) {
        if (!(e instanceof PublicError)) throw e;
        await ctx.answerCallbackQuery({
          text: 'Ссылка истекла или принадлежит другому пользователю.',
        });
      }
      return true;
    },
    async command(ctx, name) {
      if (!privateUser(ctx)) {
        await ctx.reply('Откройте личный чат с ботом для списков и настроек.');
        return true;
      }
      const uid = String(ctx.from!.id),
        arg = String(ctx.match || '').trim();
      try {
        if (name === 'watch' || name === 'unwatch') {
          const p = parseInput(arg),
            mint = p.mayBePool
              ? (await resolveInput(arg, rpc, AbortSignal.timeout(15000))).identity.mint
              : p.address;
          if (name === 'watch') await watch(ctx, mint);
          else {
            await store.remove(uid, mint);
            await ctx.reply('Токен убран из наблюдения.');
          }
        } else if (name === 'watchlist') {
          const rows = await store.list(uid);
          await ctx.reply(
            rows.length
              ? rows.map((r) => `${r.mint}\nСледующая проверка: ${r.nextCheckAt}`).join('\n\n')
              : 'Список пуст. /watch <mint>',
          );
        } else if (name === 'settings') {
          const current = await store.settings(uid);
          let value = current.settings;
          if (arg) {
            const [key, v] = arg.split(/\s+/);
            const updated = { ...value };
            if (key === 'enabled' && (v === 'on' || v === 'off')) updated.enabled = v === 'on';
            else if (key === 'cadence') updated.cadenceMinutes = Number(v);
            else if (key === 'offset') updated.utcOffsetMinutes = Number(v);
            else if (key === 'risk') updated.riskDelta = Number(v);
            else if (key === 'position') updated.positionDeltaBps = Number(v);
            else if (key === 'quiet') {
              if (v === 'off') updated.quietHours = null;
              else {
                const parts = v?.split('-');
                updated.quietHours = { start: Number(parts?.[0]), end: Number(parts?.[1]) };
              }
            } else throw new PublicError('INVALID_SETTINGS', 'Invalid settings');
            value = await store.updateSettings(uid, notificationSettingsSchema.parse(updated));
          }
          await ctx.reply(
            `Уведомления: ${value.enabled ? 'вкл' : 'выкл'}; интервал ${value.cadenceMinutes} мин; UTC-сдвиг ${value.utcOffsetMinutes} мин. Тишина: ${value.quietHours ? `${value.quietHours.start}-${value.quietHours.end}` : 'нет'}. Порог риска: ${value.riskDelta}; позиции: ${value.positionDeltaBps} bps.\n/settings enabled on|off\n/settings cadence 15..1440\n/settings offset -720..840\n/settings quiet 22-8|off\n/settings risk 5..100\n/settings position 10..10000`,
          );
        } else if (name === 'unlink') {
          await store.unlink(uid);
          await ctx.reply('Сессии сайта удалены. Наблюдения сохранены.');
        } else if (name === 'delete') {
          await store.deleteUser(uid);
          await ctx.reply(
            'Ваши списки, настройки и сессии удалены. Публичные отчёты о блокчейне сохраняются.',
          );
        }
      } catch (e) {
        if (e instanceof PublicError || e instanceof z.ZodError)
          await ctx.reply(
            'Не удалось изменить данные: проверьте ввод, срок ссылки или лимит списка. /help',
          );
        else throw e;
      }
      return true;
    },
  };
}
