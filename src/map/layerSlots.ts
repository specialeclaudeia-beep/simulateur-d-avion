/**
 * « Emplacements » de calques.
 *
 * Ce sont des calques vides insérés à des endroits précis de la pile. Les
 * futurs calques du jeu (lignes aériennes, aéroports, avions…) s'insèrent
 * avant l'un de ces emplacements avec `map.addLayer(layer, SLOT.xxx)`, ce qui
 * garantit un ordre d'affichage stable sans connaître le détail du fond de carte.
 *
 * Ordre de bas en haut :
 *   fond de carte (terre, eau, relief, routes…)
 *   → nuit (ombre + lumières des villes)
 *   → SLOT.routes      (tracés des lignes aériennes)
 *   → étiquettes du fond de carte (pays, villes, rivières…)
 *   → SLOT.airports    (hubs et aéroports du jeu)
 *   → SLOT.aircraft    (avions animés)
 *   → SLOT.overlay     (sélection, surbrillance)
 */
export const SLOT = {
  night: 'slot-night',
  routes: 'slot-routes',
  airports: 'slot-airports',
  aircraft: 'slot-aircraft',
  overlay: 'slot-overlay',
} as const;

export type SlotId = (typeof SLOT)[keyof typeof SLOT];
