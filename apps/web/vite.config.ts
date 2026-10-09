import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  plugins: [react()],
  envDir: fileURLToPath(new URL('../../', import.meta.url)),
  resolve: { conditions: ['development'] },
  // The automatically mounted lazy chart must be optimized before the first scan route.
  optimizeDeps: { include: ['lightweight-charts'] },
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
});
