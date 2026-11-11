/**
 * Pile des écrans posés par-dessus le reste (menu du jeu, paramètres, pages de
 * l'accueil…). La touche « retour » (Échap) ferme celui du dessus.
 */

interface Layer {
  close(): void;
}

const stack: Layer[] = [];

/** Déclare un écran ouvert ; renvoie la fonction à appeler quand il se ferme. */
export function pushLayer(close: () => void): () => void {
  const layer: Layer = { close };
  stack.push(layer);
  return () => {
    const i = stack.indexOf(layer);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** Ferme l'écran du dessus. Renvoie false s'il n'y en avait pas. */
export function closeTopLayer(): boolean {
  const layer = stack[stack.length - 1];
  if (!layer) return false;
  layer.close();
  return true;
}

export function layerOpen(): boolean {
  return stack.length > 0;
}
