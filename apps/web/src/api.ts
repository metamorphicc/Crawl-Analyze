import { useQuery } from '@tanstack/react-query';
export const apiUrl = (path: string) =>
  `${(import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/$/, '')}${path}`;
const messages: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: 'Источники сканирования ещё не подключены.',
  INVALID_INPUT: 'Введите Solana mint или поддерживаемую ссылку.',
  INVALID_ADDRESS: 'Некорректный адрес Solana.',
  UNSUPPORTED_URL: 'Ссылка не поддерживается. Введите адрес mint.',
  UNSUPPORTED_HOST: 'Поддерживаются pump.fun, Axiom и GMGN. Для других сервисов введите mint.',
  INVALID_URL: 'Введите полную HTTPS-ссылку на токен.',
  UNSUPPORTED_PAIR: 'Этот пул пока не поддерживается. Введите mint токена.',
  ACCOUNT_NOT_FOUND: 'Адрес не найден в Solana.',
  NOT_A_MINT: 'Это не mint токена. Введите mint или поддерживаемую ссылку на пул.',
  AMBIGUOUS_INPUT: 'Ссылка содержит разные адреса. Введите один mint.',
  SCAN_QUOTA: 'Лимит сканов исчерпан. Попробуйте позже.',
  QUEUE_FULL: 'Очередь заполнена. Попробуйте позже.',
  CANCEL_REJECTED: 'Этот браузер не может отменить скан.',
};
export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Не удалось получить данные.';
}
export async function request<T>(
  path: string,
  schema: { parse(value: unknown): T },
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(apiUrl(path), {
    credentials: 'include',
    ...options,
    signal: AbortSignal.any([
      AbortSignal.timeout(20000),
      ...(options.signal ? [options.signal] : []),
    ]),
  });
  const value: unknown = await response.json();
  if (!response.ok) {
    const code = value && typeof value === 'object' && 'code' in value ? String(value.code) : '';
    throw new Error(
      messages[code] ||
        (response.status === 429
          ? 'Слишком много запросов. Попробуйте позже.'
          : response.status === 404
            ? 'Результат не найден.'
            : 'Сервис временно недоступен. Попробуйте снова.'),
    );
  }
  try {
    return schema.parse(value);
  } catch {
    throw new Error('Получен несовместимый ответ сервиса. Обновите страницу позже.');
  }
}
export function useResource<T>(
  path: string,
  schema: { parse(value: unknown): T },
  refresh = false,
) {
  return useQuery({
    queryKey: [path],
    queryFn: ({ signal }) => request(path, schema, { signal }),
    retry: false,
    refetchInterval: refresh ? 15000 : false,
  });
}
export function saveCancellation(id: string, token: string | null) {
  if (token)
    try {
      sessionStorage.setItem(`scan-cancel:${id}`, token);
    } catch {
      /* restricted storage */
    }
}
export function cancellation(id: string) {
  try {
    return sessionStorage.getItem(`scan-cancel:${id}`);
  } catch {
    return null;
  }
}
export function clearCancellation(id: string) {
  try {
    sessionStorage.removeItem(`scan-cancel:${id}`);
  } catch {
    /* restricted storage */
  }
}
