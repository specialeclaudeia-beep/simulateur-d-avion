/**
 * Réglages d'équilibrage du jeu.
 *
 * Toutes les constantes qui décident de « combien ça coûte » et « combien ça
 * rapporte » sont ici, pour pouvoir équilibrer le jeu sans fouiller la logique.
 * Les montants sont en dollars US (comme les prix des avions et des hubs).
 */

export const HOUR = 3_600_000;
export const DAY = 24 * HOUR;

// ───────────────────────── Départ ─────────────────────────

export type Difficulty = 'facile' | 'normal' | 'difficile';

export const DIFFICULTIES: Record<Difficulty, { label: string; capital: number; hint: string }> = {
  facile: { label: 'Facile', capital: 1_000_000_000, hint: 'De quoi viser un très grand hub' },
  normal: { label: 'Normal', capital: 300_000_000, hint: 'Un grand aéroport régional et quelques avions' },
  difficile: { label: 'Difficile', capital: 100_000_000, hint: 'Un petit hub, des avions d’occasion' },
};

// ───────────────────────── Richesse des pays ─────────────────────────

/** PIB par habitant utilisé quand la Banque mondiale n'a pas de chiffre. */
export const FALLBACK_GDP = 15_000;
export const FALLBACK_TAX = 20;

/**
 * Coefficient de richesse d'un pays (billets, salaires, redevances) :
 * (PIB par habitant / 30 000)^0,22, borné entre 0,5 et 1,3.
 * France ≈ 1,11 ; États-Unis ≈ 1,27 ; Chine ≈ 0,84 ; Inde ≈ 0,59.
 */
export function wealthCoef(gdpPerCapita: number | null | undefined): number {
  const gdp = gdpPerCapita && gdpPerCapita > 0 ? gdpPerCapita : FALLBACK_GDP;
  return Math.min(1.3, Math.max(0.5, (gdp / 30_000) ** 0.22));
}

/** Taux d'intérêt annuel des emprunts selon la richesse du pays (3 % à 7 %). */
export function loanRate(gdpPerCapita: number | null | undefined): number {
  const gdp = gdpPerCapita && gdpPerCapita > 0 ? gdpPerCapita : FALLBACK_GDP;
  return 0.03 + 0.04 * (1 - Math.min(1, gdp / 60_000));
}

// ───────────────────────── Demande des lignes ─────────────────────────

/** Poids d'une destination : trafic^0,8 × facteur distance × (1 + nombre de compagnies)^0,7. */
export const DEMAND_PAX_EXP = 0.8;
export const DEMAND_AIRLINES_EXP = 0.7;
/** Multiplicateur global de la demande (équilibrage). */
export const DEMAND_SCALE = 2;

/** Les trajets très courts sont concurrencés par le train et la voiture, les très longs sont plus rares. */
export function distanceFactor(km: number): number {
  if (km < 100) return 0.15;
  if (km < 500) return 0.3 + (0.7 * (km - 100)) / 400;
  if (km <= 3000) return 1;
  return (3000 / km) ** 0.4;
}

/** Le marché total baisse quand le billet est plus cher que le prix de référence. */
export const PRICE_ELASTICITY_MARKET = 0.8;
/** Et la part de marché du joueur aussi, face aux concurrents. */
export const PRICE_ELASTICITY_SHARE = 1.0;
/** Force d'une compagnie concurrente réelle (le joueur vaut ~1 avec une réputation moyenne). */
export const COMPETITOR_STRENGTH = 1;
/** Avantage d'être la compagnie du hub de départ. */
export const HOME_HUB_BONUS = 1.1;
/** Fret : tonnes par jour pour 1 passager par jour de demande, et part des concurrents. */
export const CARGO_T_PER_PAX = 0.07;

// ───────────────────────── Billets et fret ─────────────────────────

/** Prix moyen d'un billet (USD, toutes classes) : (30 + 0,85 × km^0,7 + 0,012 × km) × richesse. */
export function baseFare(km: number): number {
  return 30 + 0.85 * km ** 0.7 + 0.012 * km;
}

/** Recette par tonne de fret : (100 + 0,28 × km) × √richesse. */
export function baseCargoRate(km: number): number {
  return 100 + 0.28 * km;
}

export const PRICE_FACTOR_MIN = 0.5;
export const PRICE_FACTOR_MAX = 2;

/** La TVA ne s'applique qu'aux vols intérieurs, à taux réduit (moitié du taux normal, 10 % au plus). */
export const DOMESTIC_VAT_SHARE = 0.5;
export const DOMESTIC_VAT_MAX = 0.1;

// ───────────────────────── Coûts d'un vol ─────────────────────────

/** Prix du kérosène de départ (USD/kg) et bornes de ses variations mensuelles. */
export const FUEL_PRICE_START = 0.8;
export const FUEL_PRICE_MIN = 0.55;
export const FUEL_PRICE_MAX = 1.2;
/** Surconsommation roulage + montée par rapport à la croisière. */
export const FUEL_OVERHEAD = 1.05;

/** Maintenance courante par heure de vol : 100 $ + 7,5 $ par siège (ou par 1/3 de tonne de fret). */
export const MAINT_PER_HOUR_BASE = 100;
export const MAINT_PER_HOUR_PER_SEAT = 7.5;

/**
 * Équipages, par heure de vol : équipage technique (selon la taille de l'avion)
 * et équipage de cabine (par siège), × richesse du pays de la compagnie.
 */
export const CREW_PER_HOUR = 150;
export const CREW_PER_HOUR_PER_SEAT = 1.5;
export const CABIN_PER_SEAT_HOUR = 1.8;
/** Services au sol et à bord : par passager (repas, escale) ou par tonne de fret (manutention), × richesse. */
export const SERVICE_PER_PAX = 4;
export const SERVICE_PER_CARGO_T = 12;

/** Redevances d'un aéroport qui n'est pas un hub du joueur. */
export const AIRPORT_LANDING_BASE = 40;
export const AIRPORT_LANDING_PER_SEAT = 2.5;
export const AIRPORT_FEE_PER_PAX = 7;
export const AIRPORT_FEE_PER_CARGO_T = 5;
export const AIRPORT_TIER_MULT = [0, 0.6, 0.8, 1, 1.2, 1.4];

/** Assurance par jour, en part de la valeur de l'avion. */
export const INSURANCE_PER_DAY = 0.00003;

/** Indemnisation par passager d'un vol annulé (× richesse du pays de départ). */
export const COMPENSATION_PER_PAX = 250;

// ───────────────────────── Horaires ─────────────────────────

/** Les avions décollent de leur hub entre 5 h 30 et 23 h, heure locale. */
export const OPS_START_MIN = 5 * 60 + 30;
export const OPS_END_MIN = 23 * 60;
/** Temps de vol : 35 min (roulage, montée, approche) + croisière à 90 % de la vitesse. */
export const BLOCK_OVERHEAD_MIN = 35;
export const BLOCK_SPEED_FACTOR = 0.9;
/** Escale (débarquement, nettoyage, embarquement) selon la taille de l'avion, en minutes. */
export const TURNAROUND_MIN: Record<string, number> = {
  regional_turboprop: 25,
  regional_jet: 30,
  narrowbody: 40,
  widebody: 75,
  jumbo: 100,
};
/** Chaque porte d'embarquement permet ce nombre de départs par jour. */
export const DEPARTURES_PER_GATE = 8;

// ───────────────────────── Usure, pannes, révisions ─────────────────────────

/** Usure par vol (points d'état sur 100) : par heure de vol + par décollage, × (1 + âge/20). */
export const WEAR_PER_HOUR = 0.02;
export const WEAR_PER_CYCLE = 0.08;
/** Probabilité de panne par vol : 0,06 % + 3 % × ((100 − état)/100)^3. */
export const BREAKDOWN_BASE = 0.0006;
export const BREAKDOWN_WEAR = 0.03;
/** Part des pannes graves (sinon mineures). */
export const BREAKDOWN_MAJOR_SHARE = 0.3;
/** Réparations : durée (heures) et coût (part du prix catalogue). */
export const REPAIR_MINOR = { hours: [4, 10], cost: [0.0003, 0.0008] } as const;
export const REPAIR_MAJOR = { hours: [24, 72], cost: [0.003, 0.008] } as const;
/** Réparer loin de ses hubs coûte plus cher. */
export const REPAIR_AWAY_MULT = 1.3;
/** Révision : durée 6 h + 0,3 h par point d'usure ; coût 0,008 % du prix catalogue par point. */
export const CHECK_HOURS_BASE = 6;
export const CHECK_HOURS_PER_POINT = 0.3;
export const CHECK_COST_PER_POINT = 0.00008;

// ───────────────────────── Avions ─────────────────────────

/** Délai de livraison en jours de jeu = mois annoncés par le constructeur × ce facteur. */
export const DELIVERY_DAYS_PER_MONTH = 0.25;
/** Jours entre deux livraisons d'une même commande. */
export const DELIVERY_SPACING_DAYS = 2;
/** Remise de volume : part de la fourchette du constructeur selon la quantité commandée. */
export function volumeShare(qty: number): number {
  if (qty <= 1) return 0;
  return Math.min(1, Math.log(qty) / Math.log(20));
}
/** Remise de fidélité : +1 % par tranche de 5 avions déjà achetés chez ce constructeur, 5 % max. */
export const LOYALTY_STEP = 5;
export const LOYALTY_MAX = 0.05;
/** Décote annuelle d'un avion et valeur selon son état. */
export const DEPRECIATION_PER_YEAR = 0.92;
/** Modèles plus fabriqués : leur prix (« occasion ») est celui d'un exemplaire de cet âge et cet état. */
export const USED_REFERENCE_AGE = 12;
export const USED_REFERENCE_CONDITION = 75;
/** Âge maximal d'un avion proposé sur le marché de l'occasion (années). */
export const USED_MAX_AGE = 30;
/** Délai d'un avion d'occasion (convoyage jusqu'au hub), en heures. */
export const USED_DELIVERY_HOURS = 36;
export const USED_MARKET_SIZE = 10;
export const MARKET_REFRESH_DAYS = 7;

// ───────────────────────── Pilotes ─────────────────────────

/** Salaire mensuel de base selon les étoiles (× richesse du pays de la compagnie). */
export const PILOT_SALARY = [0, 5_000, 7_000, 9_500, 12_500, 16_000];
/** Heures de vol pour passer 2, 3, 4, 5 étoiles. */
export const PILOT_STAR_HOURS = [0, 0, 1_500, 4_000, 8_000, 12_000];
/** Un « pilote » du jeu représente un équipage qui se relaie : il ne compte qu'une part des heures. */
export const PILOT_HOURS_SHARE = 0.35;
/** Augmentation de salaire à chaque nouvelle étoile. */
export const PILOT_RAISE = 0.08;
/** Prime d'embauche (en mois de salaire) et indemnité de licenciement. */
export const PILOT_SIGNING_MONTHS = 1.5;
export const PILOT_SEVERANCE_MONTHS = 1;
/** Formation initiale : coût (× richesse) et durée (jours). */
export const TRAINING_COST = 90_000;
export const TRAINING_DAYS = 20;
/** Qualification de type sur une nouvelle famille d'avions. */
export const TYPE_RATING = {
  small: { cost: 25_000, days: 5 },
  large: { cost: 45_000, days: 8 },
} as const;
/** Étoiles minimales pour commander un gros-porteur ou un très gros-porteur. */
export const MIN_STARS: Record<string, number> = { widebody: 2, jumbo: 3 };
export const PILOT_MARKET_SIZE = 8;

// ───────────────────────── Hubs ─────────────────────────

/** Ce qu'on obtient à l'achat d'un hub, selon sa taille (niveau 1 à 5). */
export const HUB_START = {
  gates: [0, 1, 2, 3, 4, 5],
  lineSlots: [0, 2, 3, 4, 5, 6],
  parking: [0, 2, 3, 4, 6, 8],
};
/** Acheter un hub hors de son pays coûte plus cher (droits de trafic). */
export const FOREIGN_HUB_MULT = 1.25;
/** Revente d'un hub : part de ce qu'il a coûté (achat + améliorations). */
export const HUB_RESALE = 0.7;
/** Entretien quotidien d'un hub : part de son prix. */
export const HUB_UPKEEP_PER_DAY = 0.0001;
export const QUALITY_MAX = 5;
export const MAINTENANCE_MAX = 3;
/** Atelier de maintenance : réduction des durées et coûts de révision/réparation, et des pannes. */
export const MAINTENANCE_EFFECT = [0, 0.25, 0.45, 0.6];
export const MAINTENANCE_BREAKDOWN_EFFECT = [0, 0.1, 0.2, 0.3];
export const MAINTENANCE_UPKEEP_PER_DAY = [0, 4_000, 12_000, 30_000];

// ───────────────────────── Finances ─────────────────────────

/** Plafond d'emprunt : 60 % de la valeur des avions et des hubs, au moins 20 M$. */
export const LOAN_MIN_CAP = 20_000_000;
export const LOAN_ASSET_SHARE = 0.6;
/** Découvert : taux annuel ajouté au taux normal quand la trésorerie est négative. */
export const OVERDRAFT_EXTRA_RATE = 0.1;
/** Faillite après ce nombre de jours de trésorerie négative. */
export const BANKRUPTCY_DAYS = 60;
/** Ouverture d'une ligne : frais fixes + par km (marketing, droits). */
export const LINE_OPEN_BASE = 100_000;
export const LINE_OPEN_PER_KM = 20;

// ───────────────────────── Sauvegarde ─────────────────────────

/** Quand le jeu est fermé, le temps continue à vitesse réelle, au plus 7 jours. */
export const OFFLINE_MAX_MS = 7 * DAY;
export const LOG_MAX = 120;
export const HISTORY_MONTHS = 24;
