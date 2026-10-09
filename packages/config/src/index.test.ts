import { describe, expect, it } from 'vitest';
import { capabilities, parseConfig } from './index.js';
const env = {
  DATABASE_URL: 'postgresql://test:password@localhost/test',
  REDIS_URL: 'redis://localhost',
};
describe('configuration', () => {
  it('exposes capabilities without exposing credentials', () => {
    expect(capabilities(parseConfig(env))).toEqual({
      rpc: false,
      holderIndex: false,
      telegram: false,
    });
  });
  it('fails on missing or malformed required settings without printing input', () => {
    expect(() => parseConfig({ ...env, DATABASE_URL: 'MY_SECRET' })).toThrow('DATABASE_URL');
    try {
      parseConfig({ ...env, DATABASE_URL: 'MY_SECRET' });
    } catch (e) {
      expect(String(e)).not.toContain('MY_SECRET');
    }
    expect(() => parseConfig({ ...env, SCAN_CONCURRENCY: '-1' })).toThrow('SCAN_CONCURRENCY');
  });
  it('rejects cleartext production origins', () => {
    expect(() => parseConfig({ ...env, NODE_ENV: 'production' })).toThrow('HTTPS');
  });
  it('only enables local proxy trust explicitly on a loopback listener', () => {
    expect(parseConfig(env).API_TRUST_LOOPBACK_PROXY).toBe(false);
    expect(
      parseConfig({ ...env, API_TRUST_LOOPBACK_PROXY: 'false' }).API_TRUST_LOOPBACK_PROXY,
    ).toBe(false);
    expect(parseConfig({ ...env, API_TRUST_LOOPBACK_PROXY: 'true' }).API_TRUST_LOOPBACK_PROXY).toBe(
      true,
    );
    expect(() => parseConfig({ ...env, API_TRUST_LOOPBACK_PROXY: 'yes' })).toThrow(
      'API_TRUST_LOOPBACK_PROXY',
    );
    expect(() =>
      parseConfig({ ...env, API_HOST: '0.0.0.0', API_TRUST_LOOPBACK_PROXY: 'true' }),
    ).toThrow('loopback');
  });
});
