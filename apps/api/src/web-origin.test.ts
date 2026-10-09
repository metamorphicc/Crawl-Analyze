import { describe, expect, it } from 'vitest';
import { allowedWebOrigins } from './web-origin.js';

describe('browser origin policy', () => {
  it.each(['localhost', '127.0.0.1', '[::1]'])(
    'accepts matching local aliases from %s in development',
    (hostname) => {
      const allowed = allowedWebOrigins({
        NODE_ENV: 'development',
        WEB_ORIGIN: `http://${hostname}:5173`,
      });
      expect(new Set(allowed)).toEqual(
        new Set(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173']),
      );
      expect(allowed).not.toContain('http://localhost:5174');
      expect(allowed).not.toContain('https://localhost:5173');
      expect(allowed).not.toContain('http://localhost.evil.example:5173');
    },
  );
  it.each(['test', 'production'] as const)('does not broaden origins in %s', (NODE_ENV) => {
    expect(allowedWebOrigins({ NODE_ENV, WEB_ORIGIN: 'https://localhost:5173' })).toEqual([
      'https://localhost:5173',
    ]);
  });
  it('does not broaden a remote development origin', () => {
    expect(
      allowedWebOrigins({ NODE_ENV: 'development', WEB_ORIGIN: 'https://scanner.example' }),
    ).toEqual(['https://scanner.example']);
  });
});
