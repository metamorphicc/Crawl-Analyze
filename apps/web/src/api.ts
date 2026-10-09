import { useQuery } from '@tanstack/react-query';
import { apiBase } from './api-base.js';
export const apiUrl = (path: string) =>
  `${apiBase(import.meta.env.VITE_API_URL, import.meta.env.DEV)}${path}`;
const messages: Record<string, string> = {
  PROVIDER_NOT_CONFIGURED: 'Scan data sources are not connected yet.',
  INVALID_INPUT: 'Enter a Solana mint or a supported link.',
  INVALID_ADDRESS: 'Invalid Solana address.',
  UNSUPPORTED_URL: 'Unsupported link. Enter a mint address.',
  UNSUPPORTED_HOST: 'pump.fun, Axiom and GMGN are supported. For other services, enter the mint.',
  INVALID_URL: 'Enter a complete HTTPS token link.',
  UNSUPPORTED_PAIR: 'This pool is not supported yet. Enter the token mint.',
  ACCOUNT_NOT_FOUND: 'Address not found on Solana.',
  NOT_A_MINT: 'This is not a token mint. Enter a mint or a supported pool link.',
  AMBIGUOUS_INPUT: 'The link contains multiple addresses. Enter one mint.',
  SCAN_QUOTA: 'Scan limit reached. Try again later.',
  QUEUE_FULL: 'Queue is full. Try again later.',
  CANCEL_REJECTED: 'This browser cannot cancel the scan.',
};
export function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : 'Unable to retrieve data.';
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
          ? 'Too many requests. Try again later.'
          : response.status === 404
            ? 'Result not found.'
            : 'Service temporarily unavailable. Try again.'),
    );
  }
  try {
    return schema.parse(value);
  } catch {
    throw new Error('Incompatible service response. Refresh the page later.');
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
