export function units(raw: string | null, decimals: number): string {
  if (raw === null) return 'unknown';
  const negative = raw.startsWith('-'),
    digits = negative ? raw.slice(1) : raw,
    padded = digits.padStart(decimals + 1, '0');
  return `${negative ? '-' : ''}${decimals ? `${padded.slice(0, -decimals)}.${padded.slice(-decimals)}` : padded}`;
}
export const percent = (bps: number) => `${(bps / 100).toFixed(2)}%`;
export const date = (value: string) => new Date(value).toLocaleString('en-US');
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
  queued: 'Queued',
  running: 'Analyzing',
  complete: 'Completed',
  partial: 'Completed with partial data',
  failed: 'Scan failed',
  cancelled: 'Cancelled',
  preview: 'Preview',
  deep: 'Deep',
  available: 'Available',
  unavailable: 'Unavailable',
};
export const phaseLabel: Record<string, string> = {
  'verify-mint': 'Verifying token',
  'launch-history': 'Finding launch and first buys',
  'old-owner-positions': 'Checking previous holders',
  'wallet-history': 'Wallet history',
  accepted: 'Accepted',
  queued: 'Waiting',
  mint: 'Verifying token',
  holders: 'Reading holders',
  markets: 'Checking markets',
  preview: 'Preview result',
  launch: 'Finding first buys',
  history: 'Wallet history',
  funding: 'Funding sources',
  analysis: 'Calculating report',
  complete: 'Done',
};
