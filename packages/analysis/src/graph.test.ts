import { describe, expect, it } from 'vitest';
import type { WalletLabel } from '@crawlspider/contracts';
import {
  holder,
  history,
  funding,
  signal,
  transfer,
} from '../../../tests/fixtures/intelligence.js';
import { buildEvidenceGraph } from './graph.js';
const now = '2026-10-09T00:00:00.000Z';
const run = (extras: Partial<Parameters<typeof buildEvidenceGraph>[0]> = {}) =>
  buildEvidenceGraph({
    mint: 'mint',
    holders: ['a', 'b', 'c'].map((o) => holder(o)),
    histories: ['a', 'b', 'c'].map((o) => history(o)),
    signals: ['a', 'b', 'c'].map((o) => signal(o)),
    funding: { steps: [], nodesRead: 0, complete: true, reasons: [] },
    observedAt: now,
    ...extras,
  });
describe('evidence and control hypotheses', () => {
  it('one common payer does not glue independently owned wallets', () => {
    const graph = run({
      funding: {
        steps: [funding('a', 'payer', 'fa'), funding('b', 'payer', 'fb')],
        nodesRead: 0,
        complete: true,
        reasons: [],
      },
    });
    expect(graph.edges.some((e) => e.kind === 'shared-funder')).toBe(true);
    expect(graph.controlHypotheses).toEqual([]);
  });
  it('excludes reviewed CEX funding and observed fanout hubs from control evidence', () => {
    const label: WalletLabel = {
      address: 'cex',
      kind: 'exchange',
      source: 'reviewed public evidence',
      reviewedAt: '2026-10-08T00:00:00.000Z',
      expiresAt: '2026-11-08T00:00:00.000Z',
      version: 'labels-1',
      verified: true,
    };
    const graph = run({
      labels: [label],
      histories: [history('a', [transfer('a', 'b', 'mint', 't')])],
      funding: {
        steps: [funding('a', 'cex', 'fa'), funding('b', 'cex', 'fb')],
        nodesRead: 0,
        complete: true,
        reasons: [],
      },
    });
    expect(graph.controlHypotheses).toEqual([]);
    expect(graph.edges.find((e) => e.kind === 'funding')?.serviceExcluded).toBe(true);
    const hub = run({
      holders: Array.from({ length: 6 }, (_, i) => holder(`h${i}`)),
      funding: {
        steps: Array.from({ length: 6 }, (_, i) => funding(`h${i}`, 'hub', `f${i}`)),
        nodesRead: 0,
        complete: true,
        reasons: [],
      },
    });
    expect(hub.nodes.find((n) => n.owner === 'hub')?.observedHub).toBe(true);
    expect(hub.controlHypotheses).toEqual([]);
  });
  it('similar buys by independent bots remain behavioral hypotheses', () => {
    const graph = run();
    expect(graph.edges.some((e) => e.kind === 'behavior')).toBe(true);
    expect(graph.controlHypotheses).toEqual([]);
  });
  it('soft links do not upgrade an entire mixed component to common control', () => {
    const graph = run({
      histories: [history('a', [transfer('a', 'b', 'mint', 'transfer')])],
      funding: {
        steps: [funding('a', 'payer', 'fa'), funding('b', 'payer', 'fb')],
        nodesRead: 0,
        complete: true,
        reasons: [],
      },
    });
    expect(graph.controlHypotheses[0]?.owners).toEqual(['a', 'b']);
    expect(graph.controlHypotheses[0]?.identityProven).toBe(false);
    expect(graph.suspiciousOwners).not.toContain('c');
    for (const edge of graph.edges) {
      expect(edge.signatures.length).toBeGreaterThan(0);
      expect(edge.transactionLinks.every((link) => link.startsWith('https://solscan.io/tx/'))).toBe(
        true,
      );
    }
  });
  it('duplicates do not inflate the same control-hypothesis balance', () => {
    const transferTx = transfer('a', 'b', 'mint', 'transfer');
    const graph = run({
      histories: [history('a', [transferTx]), history('b', [transferTx])],
      funding: {
        steps: [funding('a', 'payer', 'fa'), funding('b', 'payer', 'fb')],
        nodesRead: 0,
        complete: true,
        reasons: [],
      },
    });
    expect(graph.controlHypotheses[0]?.amount).toBe('20');
  });
});
