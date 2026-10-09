import { z } from 'zod';

export const CONTRACT_VERSION = '1' as const;
export const ANALYSIS_VERSION = 'heuristic-1' as const;
export const PARSER_VERSION = 'pump-idl-1' as const;
export const rawAmountSchema = z.string().regex(/^(0|[1-9]\d*)$/);
export const addressSchema = z.string().regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
export const scanRequestSchema = z
  .object({
    input: z.string().trim().min(32).max(512),
    mode: z.enum(['preview', 'deep']).default('preview'),
  })
  .strict();
export const jobStateSchema = z.enum([
  'queued',
  'running',
  'complete',
  'partial',
  'failed',
  'cancelled',
]);
export type JobState = z.infer<typeof jobStateSchema>;
export type ScanRequest = z.infer<typeof scanRequestSchema>;
export const qualitySchema = z.object({
  status: z.enum(['complete', 'partial', 'unavailable']),
  reasons: z.array(z.string()),
  observedAt: z.iso.datetime(),
  minSlot: rawAmountSchema.nullable(),
  maxSlot: rawAmountSchema.nullable(),
  indexedSlot: rawAmountSchema.nullable(),
  supplyReconciled: z.boolean(),
  atomic: z.literal(false),
});
export type DataQuality = z.infer<typeof qualitySchema>;
export const provenanceSchema = z.object({
  provider: z.string(),
  observedAt: z.iso.datetime(),
  slot: rawAmountSchema.nullable(),
  commitment: z.enum(['confirmed', 'finalized']),
  parserVersion: z.string(),
});
export type Provenance = z.infer<typeof provenanceSchema>;
export const mintIdentitySchema = z.object({
  mint: addressSchema,
  program: addressSchema,
  decimals: z.number().int().min(0).max(255),
  supply: rawAmountSchema,
  mintAuthority: addressSchema.nullable(),
  freezeAuthority: addressSchema.nullable(),
  token2022Extensions: z.array(z.number().int().nonnegative()),
  provenance: provenanceSchema,
});
export type MintIdentity = z.infer<typeof mintIdentitySchema>;
export const terminalLinksSchema = z.object({
  pump: z.url(),
  axiom: z.url(),
  gmgn: z.url(),
  solscan: z.url(),
});
export type TerminalLinks = z.infer<typeof terminalLinksSchema>;
export const resolvedInputSchema = z.object({
  identity: mintIdentitySchema,
  links: terminalLinksSchema,
  source: z.enum(['mint', 'pump', 'gmgn', 'axiom']),
  pool: addressSchema.nullable(),
});
export type ResolvedInput = z.infer<typeof resolvedInputSchema>;
export const serviceStatusSchema = z.object({
  contractVersion: z.literal(CONTRACT_VERSION),
  status: z.enum(['ready', 'degraded']),
  dependencies: z.object({ postgres: z.boolean(), redis: z.boolean(), schema: z.boolean() }),
  capabilities: z.object({ rpc: z.boolean(), holderIndex: z.boolean(), telegram: z.boolean() }),
});
export type ServiceStatus = z.infer<typeof serviceStatusSchema>;
export const evidenceSchema = z.object({
  id: z.string(),
  kind: z.enum(['transfer', 'swap', 'funding', 'shared-funder', 'behavior', 'authority']),
  from: addressSchema,
  to: addressSchema,
  strength: z.enum(['onchain-interaction', 'inferred-control', 'behavioral-hypothesis']),
  signature: z.string().nullable(),
  amount: rawAmountSchema.nullable(),
  explanation: z.string(),
  provenance: provenanceSchema,
});
export type Evidence = z.infer<typeof evidenceSchema>;
export const walletLabelSchema = z.object({
  address: addressSchema,
  kind: z.enum(['exchange', 'router', 'pool', 'distributor']),
  source: z.string().min(1),
  reviewedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  version: z.string().min(1),
  verified: z.boolean(),
});
export const relationshipEdgeSchema = evidenceSchema.extend({
  signatures: z.array(z.string()),
  transactionLinks: z.array(z.url()),
  ruleVersion: z.string(),
  confidence: z.enum(['low', 'medium', 'high']),
  assetMint: addressSchema.nullable(),
  supportsControlHypothesis: z.boolean(),
  serviceExcluded: z.boolean(),
  relatedEvidenceIds: z.array(z.string()),
});
export const evidenceGraphSchema = z.object({
  ruleVersion: z.string(),
  nodes: z.array(
    z.object({
      owner: addressSchema,
      amount: rawAmountSchema,
      label: walletLabelSchema.nullable(),
      observedHub: z.boolean(),
    }),
  ),
  edges: z.array(relationshipEdgeSchema),
  controlHypotheses: z.array(
    z.object({
      id: z.string(),
      owners: z.array(addressSchema),
      amount: rawAmountSchema,
      evidenceIds: z.array(z.string()),
      confidence: z.literal('medium'),
      identityProven: z.literal(false),
    }),
  ),
  suspiciousOwners: z.array(addressSchema),
  limitations: z.array(z.string()),
  analyzedOwners: z.array(addressSchema),
});
export const jobSchema = z.object({
  id: z.uuid(),
  mint: addressSchema,
  mode: z.enum(['preview', 'deep']),
  state: jobStateSchema,
  createdAt: z.iso.datetime(),
  reportId: z.uuid().nullable(),
  errorCode: z.string().nullable(),
});
export type ScanJob = z.infer<typeof jobSchema>;
export const scanEventSchema = z.object({
  id: rawAmountSchema,
  jobId: z.uuid(),
  kind: z.string(),
  data: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
});
export type ScanEvent = z.infer<typeof scanEventSchema>;
export * from './intelligence.js';
export class PublicError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'PublicError';
  }
}
