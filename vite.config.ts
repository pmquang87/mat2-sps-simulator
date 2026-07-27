import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

/**
 * Build config (ARCHITECTURE.md §1): `npm run build` must produce a static `dist/` whose
 * index.html opens directly from file:// (double-click install path). Plain ES-module
 * builds are CORS-blocked on file:// even with base './', therefore vite-plugin-singlefile
 * inlines all JS/CSS into the single HTML file.
 */
export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2022',
  },
});
