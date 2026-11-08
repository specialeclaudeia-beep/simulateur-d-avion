import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// ── Appli hors connexion : service worker ──

/**
 * Après le build, écrit dist/sw.js : le service worker de src/pwa/sw.js,
 * précédé de la liste des fichiers du jeu à garder sur l'appareil et d'un
 * numéro de version (empreinte de leur contenu, qui change à chaque mise à jour).
 */
function serviceWorker(): Plugin {
  let root = '';
  let outDir = '';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(config) {
      root = config.root;
      outDir = resolve(config.root, config.build.outDir);
    },
    writeBundle: {
      order: 'post',
      handler() {
        const files = listFiles(outDir)
          .filter((f) => f !== 'sw.js')
          .sort();
        const hash = createHash('sha256');
        for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
        const header = `const VERSION = '${hash.digest('hex').slice(0, 12)}';\nconst PRECACHE = ${JSON.stringify(files)};\n`;
        writeFileSync(join(outDir, 'sw.js'), header + readFileSync(resolve(root, 'src/pwa/sw.js'), 'utf8'));
      },
    },
  };
}

/** Tous les fichiers d'un dossier, chemins relatifs avec des « / ». */
function listFiles(dir: string, prefix = ''): string[] {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(dir, `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  );
}

// ── Configuration ──

// `base: './'` : le build fonctionne aussi s'il est servi depuis un sous-dossier
// (GitHub Pages, Netlify, simple serveur de fichiers…).
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 1500,
  },
  plugins: [serviceWorker()],
});
