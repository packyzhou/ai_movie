import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The dev server proxies to the Express API so cookies and /view streaming
// behave exactly as they do in production.
const port = Number(process.env.VITE_PORT) || 5173;
const apiPort = Number(process.env.VITE_API_PORT) || 3000;
const apiTarget = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [vue()],
  server: {
    port,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
      '/resources': { target: apiTarget, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
