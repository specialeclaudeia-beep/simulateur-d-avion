/*
 * Service worker du jeu : il garde le jeu sur l'appareil pour qu'il se lance
 * même sans connexion, une fois installé comme une appli.
 *
 * Ce fichier n'est pas servi tel quel : au moment du build, vite.config.ts écrit
 * dist/sw.js en ajoutant en tête VERSION (empreinte des fichiers du jeu, qui
 * change à chaque mise à jour) et PRECACHE (la liste de ces fichiers).
 */
/* global VERSION, PRECACHE */

// ── Réglages ──

/** Fichiers du jeu (code, données, icônes) : une seule version gardée à la fois. */
const GAME_CACHE = `jeu-${VERSION}`;
/** Morceaux de carte déjà vus (images satellite, noms, lumières de nuit), gardés d'une version à l'autre. */
const MAP_CACHE = 'carte';
/** Au-delà, les plus anciens morceaux de carte sont effacés (50 à 100 Mo au plus). */
const MAP_MAX_ENTRIES = 2500;
/** Réseau trop lent : on prend la copie gardée. */
const NETWORK_TIMEOUT_MS = 4000;
const INDEX = 'index.html';

/** Serveurs de la carte : images satellite EOX, noms et routes OpenFreeMap, lumières de nuit NASA. */
const MAP_PREFIXES = [
  'https://tiles.maps.eox.at/wmts/',
  'https://tiles.openfreemap.org/',
  'https://gibs.earthdata.nasa.gov/wmts/',
];
/**
 * Liste des tuiles OpenFreeMap : elle change chaque semaine, on prend donc la
 * version en ligne quand c'est possible. Sans elle, les noms et les frontières
 * ne s'affichent pas : elle est gardée dès l'installation (même adresse que
 * dans src/map/baseStyle.ts).
 */
const MAP_FRESH = /^https:\/\/tiles\.openfreemap\.org\/planet$/;
const MAP_ESSENTIALS = ['https://tiles.openfreemap.org/planet'];

// ── Installation : tous les fichiers du jeu sont gardés sur l'appareil ──

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const game = await caches.open(GAME_CACHE);
      await game.addAll(PRECACHE);
      const map = await caches.open(MAP_CACHE);
      await Promise.all(MAP_ESSENTIALS.map((url) => fetchAndKeep(map, new Request(url)).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

// ── Activation : les anciennes versions du jeu sont effacées ──

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n.startsWith('jeu-') && n !== GAME_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// ── Requêtes ──

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  if (req.mode === 'navigate') event.respondWith(page(req));
  else if (new URL(req.url).origin === self.location.origin) event.respondWith(gameFile(req));
  else if (MAP_PREFIXES.some((p) => req.url.startsWith(p))) event.respondWith(mapFile(event));
});

/**
 * La page : la version en ligne d'abord (pour les mises à jour), celle gardée
 * si le réseau manque ou si le serveur est en panne. Une page de connexion
 * (accès Netlify protégé) passe telle quelle : il faut pouvoir se reconnecter.
 */
async function page(req) {
  const network = quiet(fetch(req));
  try {
    const res = await withTimeout(network, NETWORK_TIMEOUT_MS);
    return res.status < 500 ? res : ((await keptGameFile(INDEX)) ?? res);
  } catch {
    // Pas de réseau, ou il traîne : la copie gardée ; sans copie, on attend quand même le réseau.
    return (await keptGameFile(INDEX)) ?? network.catch(() => Response.error());
  }
}

/** Fichiers du jeu : la copie gardée, sinon le réseau (fichier d'une version plus récente). */
async function gameFile(req) {
  const kept = await keptGameFile(req);
  if (kept) return kept;
  try {
    return await fetch(req);
  } catch {
    return Response.error();
  }
}

/** Morceaux de carte : ceux déjà vus restent disponibles hors connexion. */
async function mapFile(event) {
  const req = event.request;
  const map = await caches.open(MAP_CACHE);
  const kept = () => map.match(req, { ignoreVary: true });
  const save = (res) => {
    if (res.ok) event.waitUntil(keep(map, req, res.clone()));
    return res;
  };
  try {
    if (!MAP_FRESH.test(req.url)) return (await kept()) ?? save(await fetch(req));
    const network = quiet(fetch(req));
    try {
      const res = await withTimeout(network, NETWORK_TIMEOUT_MS);
      return res.ok ? save(res) : ((await kept()) ?? res);
    } catch {
      return (await kept()) ?? save(await network);
    }
  } catch {
    return (await kept()) ?? Response.error();
  }
}

// ── Outils ──

/**
 * Copie gardée d'un fichier du jeu. Les en-têtes « Vary » du serveur (Origin…)
 * sont ignorés : la page demande ses scripts avec un en-tête Origin que la copie
 * faite à l'installation n'avait pas, mais le fichier est le même.
 */
function keptGameFile(req) {
  return caches.match(req, { cacheName: GAME_CACHE, ignoreVary: true });
}

async function fetchAndKeep(cache, req) {
  const res = await fetch(req);
  if (res.ok) await keep(cache, req, res);
}

let added = 0;

/** Garde une réponse ; de temps en temps, efface les plus anciens morceaux de carte. */
async function keep(cache, req, res) {
  try {
    await cache.put(req, res);
    if (++added % 50 !== 0) return;
    const tiles = (await cache.keys()).filter((r) => !MAP_FRESH.test(r.url));
    for (const r of tiles.slice(0, Math.max(0, tiles.length - MAP_MAX_ENTRIES))) await cache.delete(r);
  } catch {
    // Plus de place sur l'appareil : la carte se rechargera en ligne.
  }
}

/** Un échec réseau qu'on a déjà remplacé par la copie gardée ne doit pas s'afficher comme une erreur. */
function quiet(promise) {
  promise.catch(() => undefined);
  return promise;
}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Réseau trop lent')), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
