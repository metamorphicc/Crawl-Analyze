// Explicit teardown also on Windows, where process signals may be force-killed.
export default async function cleanup() {
  const response = await fetch('http://127.0.0.1:3098/__test__/cleanup', {
    method: 'POST',
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('Isolated browser environment cleanup failed');
}
