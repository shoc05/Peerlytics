import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import pages404 from './vite-plugins/pages404.js';

// '/' locally and on Firebase Hosting; '/<repo>/' for the GitHub Pages staging site
// (.github/workflows/deploy-pages.yml). The router reads it back as import.meta.env.BASE_URL.
// Always one leading and one trailing slash, so "peerlytics" or "/peerlytics" work too.
const base = `/${(process.env.VITE_BASE || '').replace(/^\/+|\/+$/g, '')}/`.replace(/^\/\/$/, '/');

export default defineConfig({
  base,
  // dist/404.html for GitHub Pages deep links.
  plugins: [react(), pages404()],
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': { target: 'http://localhost:5000', changeOrigin: true },
    },
  },
});
