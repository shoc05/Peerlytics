import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // '/' locally and on Firebase Hosting; '/<repo>/' for the GitHub Pages staging site
  // (.github/workflows/deploy-pages.yml). The router reads it back as import.meta.env.BASE_URL.
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});
