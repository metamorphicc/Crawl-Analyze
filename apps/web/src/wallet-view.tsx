import type { AnalysisReport } from '@crawlspider/contracts';

export const shortAddress = (value: string) => `${value.slice(0, 5)}…${value.slice(-4)}`;
export function shareBps(amount: string, denominator: string): number | null {
  const total = BigInt(denominator);
  if (total <= 0n) return null;
  const share = (BigInt(amount) * 10000n) / total;
  return Number(share < 0n ? 0n : share > 10000n ? 10000n : share);
}
export function walletFlags(report: AnalysisReport, owner: string) {
  const flags: { label: string; tone: string }[] = [];
  const node = report.graph.nodes.find((n) => n.owner === owner);
  const signal = report.signals.find((s) => s.owner === owner);
  if (node?.label?.verified) flags.push({ label: node.label.kind, tone: 'service' });
  if (node?.observedHub) flags.push({ label: 'Service hub', tone: 'service' });
  if (report.risk.metrics.flaggedOwners.includes(owner))
    flags.push({ label: 'Risk evidence', tone: 'risk' });
  if (signal?.earlyObservedEntry === true) flags.push({ label: 'Early entry', tone: 'watch' });
  if (signal?.shortObservedHistory === true) flags.push({ label: 'Short history', tone: 'watch' });
  if (signal?.entry?.kind === 'transfer') flags.push({ label: 'Transfer entry', tone: 'watch' });
  if (!signal) flags.push({ label: 'History not read', tone: 'unknown' });
  else if (signal.coverage.status !== 'complete')
    flags.push({ label: 'History partial', tone: 'unknown' });
  if (!flags.length) flags.push({ label: 'No matched flags', tone: 'neutral' });
  return flags;
}
export function WalletFlags({ report, owner }: { report: AnalysisReport; owner: string }) {
  return (
    <span className="wallet-flags">
      {walletFlags(report, owner).map((flag) => (
        <span className={`wallet-flag flag-${flag.tone}`} key={flag.label}>
          {flag.label}
        </span>
      ))}
    </span>
  );
}
