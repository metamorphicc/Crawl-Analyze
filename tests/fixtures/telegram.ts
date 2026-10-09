import { Bot } from 'grammy';
import type { Update } from 'grammy/types';
export function mockTelegram() {
  const calls: { method: string; payload: Record<string, any> }[] = [],
    bot = new Bot('123:synthetic-test-token', {
      botInfo: {
        id: 123,
        is_bot: true,
        first_name: 'Synthetic CrawlSpider',
        username: 'crawlspider_test',
        can_join_groups: true,
        can_read_all_group_messages: false,
        supports_inline_queries: false,
        can_connect_to_business: false,
        has_main_web_app: false,
        has_topics_enabled: false,
        allows_users_to_create_topics: false,
        can_manage_bots: false,
        supports_join_request_queries: false,
      },
    });
  let fail: { code: number; retry?: number } | undefined;
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, any> });
    if (fail) {
      const current = fail;
      fail = undefined;
      return {
        ok: false,
        error_code: current.code,
        description: 'SYNTHETIC_TELEGRAM_FAILURE',
        parameters: current.retry ? { retry_after: current.retry } : {},
      };
    }
    return {
      ok: true,
      result:
        method === 'sendMessage'
          ? {
              message_id: 100 + calls.length,
              date: 1,
              chat: { id: (payload as any).chat_id, type: 'private' },
              text: (payload as any).text,
            }
          : true,
    } as any;
  });
  return {
    bot,
    calls,
    fail(code: number, retry?: number) {
      fail = { code, ...(retry !== undefined ? { retry } : {}) };
    },
  };
}
export function message(updateId: number, text: string, user = 7, group = false): Update {
  return {
    update_id: updateId,
    message: {
      message_id: updateId,
      date: 1,
      chat: group
        ? { id: -10, type: 'supergroup', title: 'Synthetic group' }
        : { id: user, type: 'private', first_name: 'Synthetic User' },
      from: { id: user, is_bot: false, first_name: 'Synthetic User' },
      text,
      ...(text.startsWith('/')
        ? {
            entities: [
              { type: 'bot_command' as const, offset: 0, length: text.split(' ')[0]!.length },
            ],
          }
        : {}),
    },
  };
}
export function callback(updateId: number, data: string, messageId: number, user = 7): Update {
  return {
    update_id: updateId,
    callback_query: {
      id: String(updateId),
      chat_instance: 'synthetic',
      from: { id: user, is_bot: false, first_name: 'Synthetic User' },
      message: {
        message_id: messageId,
        date: 1,
        chat: { id: 7, type: 'private', first_name: 'Synthetic User' },
        from: { id: 123, is_bot: true, first_name: 'Synthetic Bot' },
        text: 'synthetic',
      },
      data,
    },
  };
}
