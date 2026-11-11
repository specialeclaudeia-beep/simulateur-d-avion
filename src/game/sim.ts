/**
 * Moteur de simulation.
 *
 * La partie avance par événements, dans l'ordre chronologique : arrivée d'un
 * vol, fin d'escale, fin de révision, livraison, fin de formation, nouveau
 * jour (salaires, entretien, intérêts), nouveau mois (bilan, impôt). On peut
 * donc rattraper n'importe quelle durée d'un coup (vitesse ×10 000, onglet
 * en arrière-plan, retour après une absence) sans rien manquer.
 *
 * Chaque vol est entièrement décidé au décollage (horaires, passagers,
 * recettes) : sa position sur la carte se calcule à tout instant à partir de
 * l'horloge du jeu (voir flights.ts).
 */
import {
  BANKRUPTCY_DAYS,
  BREAKDOWN_MAJOR_SHARE,
  CHECK_COST_PER_POINT,
  CHECK_HOURS_BASE,
  CHECK_HOURS_PER_POINT,
  COMPENSATION_PER_PAX,
  DAY,
  HOUR,
  HUB_UPKEEP_PER_DAY,
  INSURANCE_PER_DAY,
  MAINTENANCE_EFFECT,
  MAINTENANCE_UPKEEP_PER_DAY,
  MARKET_REFRESH_DAYS,
  OPS_END_MIN,
  OPS_START_MIN,
  OVERDRAFT_EXTRA_RATE,
  PILOT_HOURS_SHARE,
  PILOT_RAISE,
  REPAIR_AWAY_MULT,
  REPAIR_MAJOR,
  REPAIR_MINOR,
  loanRate,
} from './config';
import { evaluate } from './campaign';
import { dailyCompetition, demandContext } from './competition';
import { invalidate, log, type Ctx } from './context';
import {
  ageYears,
  aircraftValue,
  blockMinutes,
  breakdownChance,
  cargoCapOf,
  domesticVatRate,
  legCosts,
  pilotProblem,
  playerCargoPerDay,
  playerPaxPerDay,
  referenceCargoRate,
  referencePrice,
  referenceFare,
  routeProblem,
  seatsOf,
  starsFromHours,
  totalCosts,
  turnaroundMinutes,
  wearPerLeg,
} from './economy';
import { generateUsedListings } from './fleet';
import { closeMonth, earn, snapDay, spend } from './ledger';
import { generateCandidates, pilotName } from './pilots';
import { randRange } from './rng';
import { lineFrequency } from './schedule';
import type { Aircraft, Line, Pilot } from './state';
import { localMinutes, nextLocalTime, nextUtcMonth } from './time';

// ───────────────────────── Boucle principale ─────────────────────────

/** Fait avancer la partie jusqu'à l'instant `to` (temps de jeu, ms). */
export function advance(ctx: Ctx, to: number): void {
  const s = ctx.state;
  if (s.bankrupt) {
    s.time = Math.max(s.time, to);
    return;
  }
  for (let guard = 0; guard < 5_000_000; guard++) {
    let best = Infinity;
    let kind = 0;
    let pilot: Pilot | null = null;
    let aircraft: Aircraft | null = null;
    // À égalité : jour, puis mois, puis formations, puis avions.
    if (s.nextDay <= to && s.nextDay < best) {
      best = s.nextDay;
      kind = 1;
    }
    if (s.nextMonth <= to && s.nextMonth < best) {
      best = s.nextMonth;
      kind = 2;
    }
    for (const p of s.pilots) {
      if (p.training && p.training.until <= to && p.training.until < best) {
        best = p.training.until;
        kind = 3;
        pilot = p;
      }
    }
    for (const ac of s.aircraft) {
      const t = nextEventTime(ac);
      if (t !== null && t <= to && t < best) {
        best = t;
        kind = 4;
        aircraft = ac;
      }
    }
    if (kind === 0) break;
    const t = Math.max(best, s.time);
    s.time = t;
    if (kind === 1) onDay(ctx, t);
    else if (kind === 2) onMonth(ctx, t);
    else if (kind === 3) onTrainingDone(ctx, pilot!, t);
    else onAircraftEvent(ctx, aircraft!, t);
    if (s.bankrupt) break;
  }
  s.time = Math.max(s.time, to);
}

export function nextEventTime(ac: Aircraft): number | null {
  switch (ac.status) {
    case 'flying':
      return ac.leg ? ac.leg.arr : null;
    case 'delivery':
    case 'ground':
    case 'maintenance':
    case 'repair':
      return ac.until;
    default:
      return null;
  }
}

// ───────────────────────── Avions ─────────────────────────

function onAircraftEvent(ctx: Ctx, ac: Aircraft, t: number): void {
  const { data } = ctx;
  switch (ac.status) {
    case 'flying':
      arrive(ctx, ac, t);
      return;
    case 'delivery': {
      ac.status = 'ground';
      ac.location = ac.base;
      ac.until = null;
      const m = data.model(ac.modelId);
      log(ctx, 'good', `${ac.registration} (${m.name}) est livré à ${cityOf(ctx, ac.base)}`, { type: 'aircraft', id: ac.id }, t);
      invalidate(ctx);
      planNext(ctx, ac, t);
      return;
    }
    case 'maintenance':
      ac.condition = 100;
      ac.status = 'ground';
      ac.until = null;
      planNext(ctx, ac, t);
      return;
    case 'repair':
      ac.breakdown = null;
      ac.status = 'ground';
      ac.until = null;
      log(ctx, 'good', `${ac.registration} est réparé à ${cityOf(ctx, ac.location)}`, { type: 'aircraft', id: ac.id }, t);
      planNext(ctx, ac, t);
      return;
    case 'ground':
      planNext(ctx, ac, t);
      return;
    default:
      return;
  }
}

function pilotOf(ctx: Ctx, ac: Aircraft): Pilot | null {
  if (!ac.pilotId) return null;
  return ctx.state.pilots.find((p) => p.id === ac.pilotId) ?? null;
}

function lineById(ctx: Ctx, id: string | null): Line | null {
  if (!id) return null;
  return ctx.state.lines.find((l) => l.id === id) ?? null;
}

/** Pourquoi cet avion ne peut pas voler sur cette ligne maintenant (ou null). */
export function flightProblem(ctx: Ctx, ac: Aircraft, line: Line, pilot: Pilot | null): string | null {
  const { data } = ctx;
  const m = data.model(ac.modelId);
  if (line.hub !== ac.base) return 'La ligne ne part pas du hub de cet avion';
  const p = routeProblem(data, m, data.airport(line.hub), data.airport(line.dest), line.km);
  if (p) return p;
  if (!pilot) return 'Aucun pilote dans cet avion';
  return pilotProblem(pilot, m);
}

/**
 * L'avion est au sol et prêt : décide de la suite (retour au hub, révision,
 * prochain départ du programme, attente de l'ouverture du hub ou inactivité).
 */
export function planNext(ctx: Ctx, ac: Aircraft, t: number): void {
  const { state: s, data } = ctx;
  const pilot = pilotOf(ctx, ac);

  // Loin de son hub : on rentre (avec des passagers si la ligne existe encore).
  if (ac.location !== ac.base) {
    if (!pilot || pilot.training) {
      ac.status = 'idle';
      ac.until = null;
      return;
    }
    const line = lineById(ctx, ac.leg?.lineId ?? null);
    const usable = line && line.dest === ac.location && line.hub === ac.base ? line : null;
    depart(ctx, ac, ac.location, ac.base, usable, t);
    return;
  }

  // Révision automatique au hub.
  if (s.settings.autoMaintenance && ac.condition < s.settings.maintenanceThreshold && isPlayerHub(ctx, ac.location)) {
    startMaintenance(ctx, ac, t, true);
    return;
  }

  if (!pilot || pilot.training || !ac.program.length) {
    ac.status = 'idle';
    ac.until = null;
    return;
  }

  // Le hub n'accepte des départs qu'entre 5 h 30 et 23 h, heure locale.
  const hub = data.airport(ac.base);
  const local = localMinutes(t, hub.tz, hub.lon);
  if (local < OPS_START_MIN || local >= OPS_END_MIN) {
    ac.status = 'ground';
    const next = nextLocalTime(t, hub.tz, hub.lon, OPS_START_MIN);
    ac.until = next > t ? next : t + 60_000;
    return;
  }

  for (let k = 0; k < ac.program.length; k++) {
    const idx = ac.programIndex % ac.program.length;
    ac.programIndex = (idx + 1) % ac.program.length;
    const line = lineById(ctx, ac.program[idx]);
    if (!line || flightProblem(ctx, ac, line, pilot)) continue;
    depart(ctx, ac, ac.base, line.dest, line, t);
    return;
  }
  ac.status = 'idle';
  ac.until = null;
}

export function isPlayerHub(ctx: Ctx, iata: string): boolean {
  return ctx.state.hubs.some((h) => h.iata === iata);
}

function cityOf(ctx: Ctx, iata: string): string {
  const a = ctx.data.airportByIata.get(iata);
  return a ? a.city || a.name : iata;
}

/** Numéro de vol : chaque avion garde une paire de numéros sur une ligne (aller pair, retour impair). */
function callsign(ctx: Ctx, ac: Aircraft, line: Line | null, outbound: boolean): string {
  const code = ctx.state.company.code;
  if (!line) return `${code} ${9000 + (ctx.state.counters.flight % 1000)}`;
  let h = 0;
  for (const ch of ac.id) h = (h * 31 + ch.charCodeAt(0)) % 5;
  return `${code} ${line.number + 2 * h + (outbound ? 0 : 1)}`;
}

/** Décollage : on fixe l'horaire, les passagers (ou le fret), les recettes et les coûts du vol. */
export function depart(ctx: Ctx, ac: Aircraft, from: string, to: string, line: Line | null, t: number): void {
  const { state: s, data, rng } = ctx;
  const model = data.model(ac.modelId);
  const A = data.airport(from);
  const B = data.airport(to);
  const km = line ? line.km : Math.round(data.distanceKm(from, to));
  const minutes = blockMinutes(km, model);
  const pilot = pilotOf(ctx, ac);
  const seats = seatsOf(model);
  const capT = cargoCapOf(model);
  let pax = 0;
  let cargoT = 0;
  let revenue = 0;
  let vat = 0;

  const route = line ? data.route(line.hub, line.dest) : undefined;
  if (line && route) {
    const freq = lineFrequency(ctx, line.id);
    const dctx = demandContext(ctx, line, route, ac.condition, model.kind === 'pax' ? freq.pax : freq.cargo, t);
    const noise = 0.85 + 0.3 * rng();
    if (model.kind === 'pax') {
      const perLeg = playerPaxPerDay(dctx) / Math.max(1, freq.pax);
      pax = Math.min(seats, Math.round(perLeg * noise));
      revenue = pax * referenceFare(data, A, B, km) * line.priceFactor;
      const r = domesticVatRate(data, s, A, B);
      vat = (revenue * r) / (1 + r);
    } else {
      const perLeg = playerCargoPerDay(dctx) / Math.max(1, freq.cargo);
      cargoT = Math.min(capT, Math.round(perLeg * noise * 10) / 10);
      revenue = cargoT * referenceCargoRate(data, A, B, km) * line.priceFactor;
    }
  }

  const costs = legCosts({
    model,
    from: A,
    minutes,
    pax,
    cargoT,
    age: ageYears(ac, t),
    pilotStars: pilot?.stars ?? 1,
    fuelPrice: s.fuelPrice,
    fromPlayerHub: isPlayerHub(ctx, from),
    coefFrom: data.coef(A.country),
    coefCompany: data.coef(s.company.country),
  });

  s.counters.flight++;
  ac.leg = {
    id: `${ac.id}-${s.counters.flight}`,
    kind: line && route ? 'line' : 'ferry',
    lineId: line && route ? line.id : null,
    from,
    to,
    dep: t,
    arr: t + minutes * 60_000,
    callsign: callsign(ctx, ac, line && route ? line : null, from === ac.base),
    pax,
    seats,
    cargoT,
    cargoMaxT: capT,
    revenue,
    vat,
    costs,
  };
  ac.status = 'flying';
  ac.until = null;
}

/** Arrivée : on encaisse, on use l'avion, on fait progresser le pilote, et parfois… une panne. */
function arrive(ctx: Ctx, ac: Aircraft, t: number): void {
  const { state: s, data, rng } = ctx;
  const leg = ac.leg!;
  const model = data.model(ac.modelId);
  const pilot = pilotOf(ctx, ac);

  earn(s, model.kind === 'pax' ? 'tickets' : 'cargo', leg.revenue);
  spend(s, 'vat', leg.vat);
  spend(s, 'fuel', leg.costs.fuel);
  spend(s, 'airport', leg.costs.airport);
  spend(s, 'maintenance', leg.costs.maintenance);
  spend(s, 'service', leg.costs.service);
  const costs = totalCosts(leg.costs) + leg.vat;

  const minutes = (leg.arr - leg.dep) / 60_000;
  ac.hours += minutes / 60;
  ac.cycles++;
  ac.condition = Math.max(0, ac.condition - wearPerLeg(minutes, ageYears(ac, t)));
  ac.location = leg.to;
  ac.stats.flights++;
  ac.stats.pax += leg.pax;
  ac.stats.cargoT += leg.cargoT;
  ac.stats.revenue += leg.revenue;
  ac.stats.costs += costs;

  s.stats.flights++;
  s.stats.pax += leg.pax;
  s.stats.cargoT += leg.cargoT;
  s.stats.km += Math.round(data.distanceKm(leg.from, leg.to));
  s.stats.revenue += leg.revenue;
  s.ledger.flights++;
  s.ledger.pax += leg.pax;
  s.ledger.cargoT += leg.cargoT;

  const line = lineById(ctx, leg.lineId);
  if (line) {
    for (const st of [line.stats, line.month]) {
      st.flights++;
      st.pax += leg.pax;
      st.seats += leg.seats;
      st.cargoT += leg.cargoT;
      st.capT += leg.cargoMaxT;
      st.revenue += leg.revenue;
      st.costs += costs;
    }
    updateReputation(ctx, ac, line, leg.seats ? leg.pax / leg.seats : leg.cargoMaxT ? leg.cargoT / leg.cargoMaxT : 0);
  }

  if (pilot) {
    pilot.hours += (minutes / 60) * PILOT_HOURS_SHARE;
    const stars = starsFromHours(pilot.hours);
    if (stars > pilot.stars) {
      pilot.stars = stars;
      pilot.salary = Math.round((pilot.salary * (1 + PILOT_RAISE)) / 100) * 100;
      log(ctx, 'good', `${pilotName(pilot)} passe pilote ${stars} étoiles (salaire +${Math.round(PILOT_RAISE * 100)}\u202f%)`, { type: 'pilot', id: pilot.id }, t);
    }
  }

  const baseLevel = s.hubs.find((h) => h.iata === ac.base)?.maintenance ?? 0;
  if (rng() < breakdownChance(ac.condition, pilot?.stars ?? 1, baseLevel)) {
    breakDown(ctx, ac, t);
    return;
  }
  ac.status = 'ground';
  ac.until = t + turnaroundMinutes(model) * 60_000;
}

function updateReputation(ctx: Ctx, ac: Aircraft, line: Line, load: number): void {
  const s = ctx.state;
  const quality = s.hubs.find((h) => h.iata === line.hub)?.quality ?? 1;
  const stars = pilotOf(ctx, ac)?.stars ?? 1;
  let sat = 45 + 6 * quality + (15 * ac.condition) / 100 + 2 * stars - 30 * (line.priceFactor - 1);
  if (load > 0.97) sat -= 3; // avion bondé
  sat = Math.min(100, Math.max(0, sat));
  s.reputation += (sat - s.reputation) * 0.003;
}

function breakDown(ctx: Ctx, ac: Aircraft, t: number): void {
  const { state: s, data, rng } = ctx;
  const model = data.model(ac.modelId);
  const major = rng() < BREAKDOWN_MAJOR_SHARE;
  const spec = major ? REPAIR_MAJOR : REPAIR_MINOR;
  ac.breakdown = {
    severity: major ? 'major' : 'minor',
    hours: Math.round(randRange(rng, spec.hours)),
    cost: Math.round((referencePrice(data, model) * randRange(rng, spec.cost)) / 1000) * 1000,
    at: t,
  };
  ac.status = 'broken';
  ac.until = null;
  invalidate(ctx);

  // En escale loin du hub, le vol retour est annulé : on indemnise ses passagers.
  const leg = ac.leg;
  let extra = '';
  if (ac.location !== ac.base && leg?.kind === 'line' && leg.pax > 0) {
    const comp = leg.pax * COMPENSATION_PER_PAX * data.coef(data.airport(ac.location).country);
    spend(s, 'compensation', comp);
    s.reputation = Math.max(0, s.reputation - 1.5);
    extra = `, vol retour annulé (${leg.pax} passagers indemnisés)`;
  } else {
    s.reputation = Math.max(0, s.reputation - 0.5);
  }
  log(
    ctx,
    'bad',
    `Panne ${major ? 'grave' : 'mineure'} de ${ac.registration} à ${cityOf(ctx, ac.location)}${extra}. Réparation : ${ac.breakdown.hours} h`,
    { type: 'aircraft', id: ac.id },
    t,
  );
  if (s.settings.autoRepair) startRepair(ctx, ac, t);
}

/** Coût et durée d'une réparation, selon l'endroit où se trouve l'avion. */
export function repairQuote(ctx: Ctx, ac: Aircraft): { cost: number; hours: number } {
  const b = ac.breakdown;
  if (!b) return { cost: 0, hours: 0 };
  const hub = ctx.state.hubs.find((h) => h.iata === ac.location);
  const mult = hub ? 1 - MAINTENANCE_EFFECT[hub.maintenance] : REPAIR_AWAY_MULT;
  const timeMult = hub ? 1 - MAINTENANCE_EFFECT[hub.maintenance] : 1.2;
  return { cost: Math.round(b.cost * mult), hours: Math.max(1, Math.round(b.hours * timeMult)) };
}

export function startRepair(ctx: Ctx, ac: Aircraft, t: number): void {
  const q = repairQuote(ctx, ac);
  spend(ctx.state, 'repairs', q.cost);
  ac.status = 'repair';
  ac.until = t + q.hours * HOUR;
}

/** Coût et durée d'une révision complète (retour à 100 %), au hub où se trouve l'avion. */
export function maintenanceQuote(ctx: Ctx, ac: Aircraft): { cost: number; hours: number } {
  const model = ctx.data.model(ac.modelId);
  const points = Math.max(0, 100 - ac.condition);
  const level = ctx.state.hubs.find((h) => h.iata === ac.location)?.maintenance ?? 0;
  const eff = 1 - MAINTENANCE_EFFECT[level];
  return {
    cost: Math.round((referencePrice(ctx.data, model) * CHECK_COST_PER_POINT * points * eff) / 1000) * 1000,
    hours: Math.max(2, Math.round((CHECK_HOURS_BASE + CHECK_HOURS_PER_POINT * points) * eff)),
  };
}

export function startMaintenance(ctx: Ctx, ac: Aircraft, t: number, auto: boolean): void {
  const q = maintenanceQuote(ctx, ac);
  spend(ctx.state, 'checks', q.cost);
  ac.status = 'maintenance';
  ac.until = t + q.hours * HOUR;
  if (!auto) return;
  log(ctx, 'info', `${ac.registration} part en révision à ${cityOf(ctx, ac.location)} (${q.hours} h)`, { type: 'aircraft', id: ac.id }, t);
}

// ───────────────────────── Pilotes ─────────────────────────

function onTrainingDone(ctx: Ctx, p: Pilot, t: number): void {
  const tr = p.training!;
  if (!p.ratings.includes(tr.family)) p.ratings.push(tr.family);
  p.training = null;
  invalidate(ctx);
  log(
    ctx,
    'good',
    tr.kind === 'initial'
      ? `${pilotName(p)} a terminé sa formation : pilote qualifié(e) ${tr.family}`
      : `${pilotName(p)} est maintenant qualifié(e) sur ${tr.family}`,
    { type: 'pilot', id: p.id },
    t,
  );
  // Un avion qui attendait ce pilote peut repartir.
  const ac = ctx.state.aircraft.find((a) => a.pilotId === p.id);
  if (ac && ac.status === 'idle') planNext(ctx, ac, t);
}

// ───────────────────────── Jour et mois ─────────────────────────

/** Coûts fixes d'une journée, marchés, faillite. */
function onDay(ctx: Ctx, t: number): void {
  const { state: s, data } = ctx;
  snapDay(s, t);

  const salaries = s.pilots.reduce((sum, p) => sum + p.salary, 0) * (12 / 365);
  spend(s, 'salaries', salaries);

  let hubs = 0;
  for (const h of s.hubs) {
    const a = data.airport(h.iata);
    hubs += (h.pricePaid + h.invested) * HUB_UPKEEP_PER_DAY + MAINTENANCE_UPKEEP_PER_DAY[h.maintenance] * data.coef(a.country);
  }
  spend(s, 'hubs', hubs);

  let insured = 0;
  for (const ac of s.aircraft) if (ac.status !== 'delivery') insured += aircraftValue(data, ac, t);
  spend(s, 'insurance', insured * INSURANCE_PER_DAY);

  const rate = loanRate(data.country(s.company.country)?.gdpPerCapita);
  let interest = (s.debt * rate) / 365;
  if (s.cash < 0) interest += (-s.cash * (rate + OVERDRAFT_EXTRA_RATE)) / 365;
  spend(s, 'interest', interest);

  if (t - s.market.refreshedAt >= MARKET_REFRESH_DAYS * DAY) refreshMarkets(ctx, t);
  dailyCompetition(ctx, t);

  if (s.cash < 0) {
    s.negativeSince ??= t;
    const days = Math.floor((t - s.negativeSince) / DAY);
    if (days >= BANKRUPTCY_DAYS) {
      s.bankrupt = true;
      log(ctx, 'bad', `Faillite : la trésorerie est restée négative pendant ${BANKRUPTCY_DAYS} jours.`, undefined, t);
    } else if (days === 0 || days === 30 || days === 50) {
      log(
        ctx,
        'bad',
        `Trésorerie négative : il reste ${BANKRUPTCY_DAYS - days} jours pour revenir dans le vert (emprunt, vente d'avion…).`,
        undefined,
        t,
      );
    }
  } else {
    s.negativeSince = null;
  }
  evaluate(ctx, t);
  s.nextDay = t + DAY;
}

function onMonth(ctx: Ctx, t: number): void {
  closeMonth(ctx, t);
  ctx.state.nextMonth = nextUtcMonth(t);
}

export function refreshMarkets(ctx: Ctx, t: number): void {
  ctx.state.market = {
    used: generateUsedListings(ctx, t),
    pilots: generateCandidates(ctx, t),
    refreshedAt: t,
  };
}
