export function apiBase(configured: string | undefined, development: boolean): string {
  // Production defaults to the public API on the website's own domain, not the user's localhost.
  // Explicit empty values also select the same origin for local service-router testing.
  return (configured ?? (development ? 'http://localhost:3001' : '')).replace(/\/$/, '');
}
