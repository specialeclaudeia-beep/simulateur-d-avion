import { defineConfig } from 'vite';

// `base: './'` : le build fonctionne aussi s'il est servi depuis un sous-dossier
// (GitHub Pages, Netlify, simple serveur de fichiers…).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
});
