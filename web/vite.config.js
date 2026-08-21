import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// The dev server proxies to the Express API so cookies and /view streaming
// behave exactly as they do in production.
export default defineConfig({
  plugins: [vue()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: 'http://127.0.0.1:3000', changeOrigin: true },
      '/resources': { target: 'http://127.0.0.1:3000', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
