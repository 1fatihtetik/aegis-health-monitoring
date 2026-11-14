import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend port can be overridden (e.g. when :8000 is busy): AEGIS_BACKEND_PORT=8010 npm run dev
const backendPort = process.env.AEGIS_BACKEND_PORT ?? '8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // config/limits.yaml is bundled from the repo root (src/api/limits.ts).
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${backendPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://127.0.0.1:${backendPort}`,
        ws: true,
      },
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
  },
});
