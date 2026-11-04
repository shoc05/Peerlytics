// Vite plugin (step 5.8): after `vite build`, copy dist/index.html to dist/404.html.
// GitHub Pages has no rewrites; it answers unknown paths such as /<repo>/courses with
// 404.html, which then boots the app and lets the router handle the path.
import { copyFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export default function pages404() {
  let outDir;
  return {
    name: 'peerlytics-pages-404',
    apply: 'build',
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const index = join(outDir, 'index.html');
      if (existsSync(index)) copyFileSync(index, join(outDir, '404.html'));
    },
  };
}
