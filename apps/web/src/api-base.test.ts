import { expect, it } from 'vitest';
import { apiBase } from './api-base.js';

it('uses same-origin routes in public builds without embedding a development hostname', () => {
  expect(`${apiBase(undefined, false)}/v1/scans`).toBe('/v1/scans');
  expect(`${apiBase('', true)}/v1/scans`).toBe('/v1/scans');
  expect(`${apiBase(undefined, true)}/v1/scans`).toBe('http://localhost:3001/v1/scans');
});
it('retains an explicitly configured external API for other hosting arrangements', () => {
  expect(`${apiBase('https://api.example.com/', false)}/v1/status`).toBe(
    'https://api.example.com/v1/status',
  );
});
