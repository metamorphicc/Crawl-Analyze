import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadConfig } from '@crawlspider/config';
import { createStorage } from '@crawlspider/storage';
import { ANALYSIS_VERSION, forwardOutcomeSchema } from '@crawlspider/contracts';
import { evaluateRules, type EvaluationSample } from '@crawlspider/analysis';
const storage = createStorage(loadConfig());
try {
  const rows = (
    await storage.pool.query(
      "SELECT r.id,r.mint,r.observed_at,r.analysis_version,r.body->'risk'->'riskScore' AS score,o.result FROM reports r JOIN token_outcomes o ON o.report_id=r.id WHERE o.horizon_seconds=3600 AND o.result IS NOT NULL ORDER BY r.observed_at,r.id",
    )
  ).rows;
  const samples: EvaluationSample[] = rows.map((r) => {
    const outcome = forwardOutcomeSchema.parse(r.result);
    return {
      reportId: r.id,
      mint: r.mint,
      observedAt: r.observed_at.toISOString(),
      labelObservedAt: outcome.current.observedAt,
      score: r.score,
      ruleVersion: r.analysis_version,
      policyVersion: outcome.policyVersion,
      horizonSeconds: outcome.horizonSeconds,
      label: outcome.labels.marketDrawdown,
    };
  });
  // Missed windows remain censored samples; their time still follows the planned horizon.
  const result = evaluateRules(samples, ANALYSIS_VERSION),
    dataset = JSON.stringify(samples, null, 2),
    hash = createHash('sha256').update(dataset).digest('hex');
  const out = resolve('.local/evaluation');
  await mkdir(out, { recursive: true });
  await writeFile(resolve(out, 'dataset.json'), dataset);
  await writeFile(
    resolve(out, 'evaluation.json'),
    JSON.stringify(
      { ...result, datasetSha256: hash, source: 'local-forward-observations' },
      null,
      2,
    ),
  );
  const bars = result.bins
    .map(
      (b, i) =>
        `<rect x="${70 + i * 60}" y="${330 - (b.rate || 0) * 250}" width="38" height="${(b.rate || 0) * 250}" fill="#445b87"/><text x="${70 + i * 60}" y="350">${b.from}</text><text x="${70 + i * 60}" y="370">n=${b.n}</text>`,
    )
    .join('');
  await writeFile(
    resolve(out, 'calibration.svg'),
    `<svg xmlns="http://www.w3.org/2000/svg" width="750" height="420" viewBox="0 0 750 420"><rect width="750" height="420" fill="white"/><g font-family="sans-serif" font-size="12" fill="#222"><text x="25" y="25">Observed market drawdown rate by heuristic score (not probability)</text><text x="25" y="48">${result.status}; held-out tokens: ${result.holdout}; censored: ${result.censored}</text><path d="M60 80 V330 H700" fill="none" stroke="#222"/><text x="20" y="85">100%</text><text x="25" y="330">0%</text>${bars}<text x="65" y="405">Fixed rule threshold 50. Labels: ≥50% price decline at 1h. No threshold fitting.</text></g></svg>`,
  );
  console.log(
    JSON.stringify({
      status: result.status,
      total: result.total,
      holdout: result.holdout,
      datasetSha256: hash,
      output: out,
    }),
  );
} finally {
  await storage.close();
}
