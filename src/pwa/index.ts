/**
 * Appli installable : enregistre le service worker (jeu disponible hors
 * connexion, voir sw.js) et garde la proposition d'installation de Chrome pour
 * le bouton « Installer le jeu » de l'onglet Ma compagnie.
 */

/** Ce que Chrome fournit quand le jeu peut être installé (absent des types du DOM). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installPrompt: InstallPromptEvent | null = null;
let justInstalled = false;

/** À appeler au démarrage : Chrome peut proposer l'installation avant que le jeu soit affiché. */
export function setupPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    installPrompt = e as InstallPromptEvent;
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    justInstalled = true;
  });
  // Pas de service worker en développement : il garderait d'anciennes versions du code.
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker
      .register(new URL(`${import.meta.env.BASE_URL}sw.js`, location.href))
      .catch((err: unknown) => console.warn('Jeu hors connexion indisponible :', err));
  };
  // Après le chargement de la page, pour ne pas ralentir le premier affichage.
  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });
}

/** Le jeu tourne déjà comme une appli installée (ou vient d'être installé). */
export function isInstalled(): boolean {
  return justInstalled || matchMedia('(display-mode: fullscreen), (display-mode: standalone), (display-mode: minimal-ui)').matches;
}

/** Chrome propose l'installation ; sinon, elle passe par son menu. */
export function canInstall(): boolean {
  return installPrompt !== null;
}

/** Ouvre la fenêtre d'installation de Chrome ; vrai si le joueur accepte. */
export async function install(): Promise<boolean> {
  const prompt = installPrompt;
  if (!prompt) return false;
  installPrompt = null; // une proposition ne sert qu'une fois
  await prompt.prompt();
  return (await prompt.userChoice).outcome === 'accepted';
}
