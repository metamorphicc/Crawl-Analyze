// Read literals from the pinned publisher's test fixture. Never execute SDK or retrieved code.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import ts from 'typescript';
const archive = '.local/protocol-sources/pump-fun-pump-swap-sdk-2.1.0.tgz';
const archiveBytes = readFileSync(archive);
if (
  createHash('sha256').update(archiveBytes).digest('hex') !==
  '1ef56832347f06653acf154d8e2072f1bfc9343f0e6c203cf4517bb1948e8865'
)
  throw new Error('Pinned SDK archive integrity differs');
const result = spawnSync('tar', [
  '-xOf',
  archive,
  'package/src/__tests__/feeConfigMainnetFixture.ts',
]);
if (result.status !== 0) throw new Error('Pinned SDK archive is unavailable');
if (
  createHash('sha256').update(result.stdout).digest('hex') !==
  'ec0df00ff7c1ca8e7aa1d98c805aa4a666106a4a6a6f35b89578c58fdb4ba882'
)
  throw new Error('Publisher fixture integrity differs');
const source = result.stdout.toString('utf8');
const file = ts.createSourceFile('reference.ts', source, ts.ScriptTarget.Latest, true);
function literal(node) {
  if (ts.isStringLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(literal);
  if (ts.isAsExpression(node)) return literal(node.expression);
  if (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'join' &&
    node.arguments.length === 1 &&
    ts.isStringLiteral(node.arguments[0]) &&
    node.arguments[0].text === ''
  )
    return literal(node.expression.expression).join('');
  throw new Error('Reference contains a nonliteral expression');
}
const values = {};
for (const statement of file.statements)
  if (ts.isVariableStatement(statement))
    for (const declaration of statement.declarationList.declarations) {
      if (
        ts.isIdentifier(declaration.name) &&
        declaration.name.text.startsWith('MAINNET_') &&
        declaration.initializer
      )
        values[declaration.name.text] = literal(declaration.initializer);
    }
const data = values.MAINNET_FEE_CONFIG_DATA_BASE64;
if (typeof data !== 'string' || Buffer.from(data, 'base64').length !== 4073)
  throw new Error('Reference fixture size differs');
const fixture = {
  source: '@pump-fun/pump-swap-sdk@2.1.0/src/__tests__/feeConfigMainnetFixture.ts',
  attribution: 'pump.fun, MIT',
  sourceSha256: createHash('sha256').update(result.stdout).digest('hex'),
  archiveSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
  provenance: 'Publisher-provided mainnet capture; not independently fetched by this project',
  capturedDate: '2026-09-08',
  slot: '445186127',
  account: values.MAINNET_FEE_CONFIG_ACCOUNT,
  dataBase64: data,
  bump: values.MAINNET_FEE_CONFIG_BUMP,
  admin: values.MAINNET_FEE_CONFIG_ADMIN,
  flatFees: values.MAINNET_FLAT_FEES,
  feeTiers: values.MAINNET_FEE_TIERS,
  stableFeeTiers: values.MAINNET_STABLE_FEE_TIERS,
};
writeFileSync(
  'tests/fixtures/pump-fee-config-mainnet.json',
  `${JSON.stringify(fixture, null, 2)}\n`,
  { flag: 'wx' },
);
console.log('Imported publisher-provided, attributed fee account fixture (4073 bytes)');
