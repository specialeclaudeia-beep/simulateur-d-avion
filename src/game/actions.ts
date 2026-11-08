/**
 * Actions du joueur. Chacune vérifie qu'elle est possible, puis modifie la
 * partie. Elles renvoient { ok: true } ou { ok: false, error: "…" } avec un
 * message en français à afficher tel quel.
 *
 * L'instant `t` est le temps de jeu actuel (la partie doit déjà être simulée
 * jusqu'à `t`, voir Game.run).
 */
import {
  LINE_OPEN_BASE,
  LINE_OPEN_PER_KM,
  LOAN_ASSET_SHARE,
  LOAN_MIN_CAP,
  PILOT_SALARY,
  PILOT_SEVERANCE_MONTHS,
  PRICE_FACTOR_MAX,
  PRICE_FACTOR_MIN,
  TRAINING_DAYS,
  DAY,
  HOUR,
  USED_DELIVERY_HOURS,
} from './config';
import { fail, invalidate, log, ok, type ActionResult, type Ctx } from './context';
import { GameData } from './data';
import { aircraftValue, blockMinutes, pilotProblem, routeProblem } from './economy';
import { orderQuote } from './fleet';
import { HUB_UPGRADE_LABEL, hubPrice, hubResale, hubValue, newHub, upgradeInfo, type HubUpgrade } from './hubs';
import { earn, money, spend } from './ledger';
import { randomName, namePoolFor, randomRegistration } from './names';
import { baseSalary, ensureQualifiedCandidate, pilotName, trainingCost, typeRatingSpec } from './pilots';
import { aircraftDailyDepartures, basedAircraft, hubDepartures, programLines } from './schedule';
import { isPlayerHub, maintenanceQuote, planNext, repairQuote, startMaintenance, startRepair } from './sim';
import { emptyStats, type Aircraft, type Hub, type Line, type Pilot } from './state';
import { utcYear } from './time';

// ───────────────────────── Outils ─────────────────────────

function findHub(ctx: Ctx, iata: string): Hub | undefined {
  return ctx.state.hubs.find((h) => h.iata === iata);
}

function findAircraft(ctx: Ctx, id: string): Aircraft | undefined {
  return ctx.state.aircraft.find((a) => a.id === id);
}

function findPilot(ctx: Ctx, id: string): Pilot | undefined {
  return ctx.state.pilots.find((p) => p.id === id);
}

function findLine(ctx: Ctx, id: string): Line | undefined {
  return ctx.state.lines.find((l) => l.id === id);
}

function cantAfford(ctx: Ctx, amount: number): ActionResult | null {
  if (ctx.state.cash >= amount) return null;
  return fail(`Pas assez d'argent : il faut ${money(amount)}, tu as ${money(Math.max(0, ctx.state.cash))}.`);
}

function city(ctx: Ctx, iata: string): string {
  const a = ctx.data.airportByIata.get(iata);
  return a ? a.city || a.name : iata;
}

/** Relance un avion inactif (nouveau pilote, nouveau programme…). */
function wake(ctx: Ctx, ac: Aircraft, t: number): void {
  invalidate(ctx);
  if (ac.status === 'idle') planNext(ctx, ac, t);
}

// ───────────────────────── Hubs ─────────────────────────

export function buyHub(ctx: Ctx, t: number, iata: string): ActionResult {
  const { data, state: s } = ctx;
  const a = data.airportByIata.get(iata);
  if (!a) return fail('Aéroport inconnu.');
  if (findHub(ctx, iata)) return fail(`${a.name} est déjà un de tes hubs.`);
  if (!data.routesFrom(iata).length) return fail(`${a.name} n'a aucune ligne régulière.`);
  const price = hubPrice(s, a);
  const no = cantAfford(ctx, price);
  if (no) return no;
  spend(s, 'hubPurchase', price);
  s.hubs.push(newHub(data, a, price, t));
  log(ctx, 'money', `Achat du hub ${a.name} (${a.iata}) pour ${money(price)}`, { type: 'hub', id: iata }, t);
  return ok(`Bienvenue à ${a.city || a.name} : ce hub est à toi !`);
}

export function sellHub(ctx: Ctx, t: number, iata: string): ActionResult {
  const s = ctx.state;
  const hub = findHub(ctx, iata);
  if (!hub) return fail('Ce hub ne t’appartient pas.');
  if (s.hubs.length <= 1) return fail('Une compagnie doit garder au moins un hub.');
  if (basedAircraft(s, iata).length) return fail('Change d’abord la base des avions rattachés à ce hub.');
  if (s.lines.some((l) => l.hub === iata)) return fail('Ferme d’abord les lignes qui partent de ce hub.');
  const value = hubResale(hub);
  s.hubs = s.hubs.filter((h) => h !== hub);
  earn(s, 'assetSales', value);
  log(ctx, 'money', `Vente du hub ${city(ctx, iata)} pour ${money(value)}`, undefined, t);
  return ok();
}

export function upgradeHub(ctx: Ctx, t: number, iata: string, kind: HubUpgrade): ActionResult {
  const hub = findHub(ctx, iata);
  if (!hub) return fail('Ce hub ne t’appartient pas.');
  const info = upgradeInfo(ctx.data, hub, kind);
  if (!info) return fail('Déjà au maximum.');
  const no = cantAfford(ctx, info.cost);
  if (no) return no;
  spend(ctx.state, 'upgrades', info.cost);
  hub.invested += info.cost;
  hub[kind] = info.next;
  log(ctx, 'money', `${HUB_UPGRADE_LABEL[kind].title} à ${city(ctx, iata)} : ${info.current} → ${info.next} (${money(info.cost)})`, { type: 'hub', id: iata }, t);
  return ok();
}

// ───────────────────────── Avions ─────────────────────────

function parkingLeft(ctx: Ctx, iata: string): number {
  const hub = findHub(ctx, iata);
  return hub ? hub.parking - basedAircraft(ctx.state, iata).length : 0;
}

function newAircraft(ctx: Ctx, modelId: string, base: string, t: number, extra: Partial<Aircraft>): Aircraft {
  const s = ctx.state;
  const taken = new Set(s.aircraft.map((a) => a.registration));
  return {
    id: `A${++s.counters.aircraft}`,
    modelId,
    registration: randomRegistration(ctx.rng, s.company.country, taken),
    name: null,
    builtAt: t,
    acquiredAt: t,
    pricePaid: 0,
    condition: 100,
    hours: 0,
    cycles: 0,
    base,
    location: base,
    status: 'delivery',
    until: t,
    leg: null,
    pilotId: null,
    program: [],
    programIndex: 0,
    breakdown: null,
    stats: { flights: 0, pax: 0, cargoT: 0, revenue: 0, costs: 0 },
    ...extra,
  };
}

/** Contrat d'achat d'avions neufs chez un constructeur. */
export function orderAircraft(ctx: Ctx, t: number, modelId: string, qty: number, base: string): ActionResult {
  const { data, state: s } = ctx;
  const model = data.modelById.get(modelId);
  if (!model) return fail('Modèle inconnu.');
  if (!model.inProduction) return fail(`Le ${model.name} n'est plus fabriqué : cherche-le sur le marché de l'occasion.`);
  if (!Number.isInteger(qty) || qty < 1 || qty > 30) return fail('Commande entre 1 et 30 avions.');
  if (!findHub(ctx, base)) return fail('Choisis un de tes hubs pour la livraison.');
  if (parkingLeft(ctx, base) < qty) return fail(`Pas assez de place au parking de ${city(ctx, base)} (${parkingLeft(ctx, base)} place(s) libre(s)).`);
  const q = orderQuote(data, s, model, qty, t);
  const no = cantAfford(ctx, q.total);
  if (no) return no;
  spend(s, 'aircraftPurchase', q.total);
  s.relations[model.mfr] = (s.relations[model.mfr] ?? 0) + qty;
  for (const when of q.deliveries) {
    s.aircraft.push(newAircraft(ctx, model.id, base, t, { builtAt: when, acquiredAt: when, until: when, pricePaid: q.unitPrice }));
  }
  const mfr = data.manufacturerById.get(model.mfr)!;
  log(ctx, 'money', `Contrat signé avec ${mfr.name} : ${qty} × ${model.name} pour ${money(q.total)}`, undefined, t);
  offerPilotFor(ctx, t, model.family);
  return ok(`Contrat signé : ${qty} × ${model.name}. Première livraison à ${city(ctx, base)}.`);
}

export function buyUsed(ctx: Ctx, t: number, listingId: string, base: string): ActionResult {
  const { data, state: s } = ctx;
  const listing = s.market.used.find((l) => l.id === listingId);
  if (!listing) return fail('Cette annonce n’est plus disponible.');
  if (!findHub(ctx, base)) return fail('Choisis un de tes hubs pour la livraison.');
  if (parkingLeft(ctx, base) < 1) return fail(`Plus de place au parking de ${city(ctx, base)}.`);
  const no = cantAfford(ctx, listing.price);
  if (no) return no;
  spend(s, 'aircraftPurchase', listing.price);
  s.market.used = s.market.used.filter((l) => l !== listing);
  const when = t + USED_DELIVERY_HOURS * HOUR;
  s.aircraft.push(
    newAircraft(ctx, listing.modelId, base, t, {
      builtAt: listing.builtAt,
      condition: listing.condition,
      hours: listing.hours,
      cycles: Math.round(listing.hours / 2),
      until: when,
      pricePaid: listing.price,
    }),
  );
  log(ctx, 'money', `Achat d'occasion : ${data.model(listing.modelId).name} pour ${money(listing.price)}`, undefined, t);
  offerPilotFor(ctx, t, data.model(listing.modelId).family);
  return ok('Avion acheté : il arrive à son hub d’ici un jour et demi.');
}

/** Premier avion d'une famille : un pilote qualifié se présente (voir ensureQualifiedCandidate). */
function offerPilotFor(ctx: Ctx, t: number, family: string): void {
  const c = ensureQualifiedCandidate(ctx, t, family);
  if (c) log(ctx, 'good', `${pilotName(c)}, pilote qualifié(e) ${family}, propose ses services : onglet Pilotes, « Recruter ».`, undefined, t);
}

/** Prix de revente proposé (5 % de frais de courtage, moins s'il est en panne). */
export function resalePrice(ctx: Ctx, ac: Aircraft, t: number): number {
  const v = aircraftValue(ctx.data, ac, t) * 0.95 * (ac.status === 'broken' ? 0.85 : 1);
  return Math.round(v / 10_000) * 10_000;
}

export function sellAircraft(ctx: Ctx, t: number, id: string): ActionResult {
  const s = ctx.state;
  const ac = findAircraft(ctx, id);
  if (!ac) return fail('Avion introuvable.');
  if (ac.status === 'flying') return fail('Attends que l’avion se pose.');
  if (ac.status === 'delivery') return fail('L’avion n’est pas encore livré.');
  const price = resalePrice(ctx, ac, t);
  if (ac.pilotId) {
    const p = findPilot(ctx, ac.pilotId);
    if (p) p.aircraftId = null;
  }
  s.aircraft = s.aircraft.filter((a) => a !== ac);
  earn(s, 'assetSales', price);
  invalidate(ctx);
  log(ctx, 'money', `Vente de ${ac.registration} (${ctx.data.model(ac.modelId).name}) pour ${money(price)}`, undefined, t);
  return ok();
}

export function renameAircraft(ctx: Ctx, _t: number, id: string, name: string): ActionResult {
  const ac = findAircraft(ctx, id);
  if (!ac) return fail('Avion introuvable.');
  ac.name = name.trim().slice(0, 30) || null;
  return ok();
}

/** Change le hub de rattachement : vol de convoyage, programme vidé. */
export function transferAircraft(ctx: Ctx, t: number, id: string, newBase: string): ActionResult {
  const { data } = ctx;
  const ac = findAircraft(ctx, id);
  if (!ac) return fail('Avion introuvable.');
  if (ac.base === newBase) return fail('L’avion est déjà basé ici.');
  if (!findHub(ctx, newBase)) return fail('Choisis un de tes hubs.');
  if (!(ac.status === 'idle' || ac.status === 'ground') || ac.location !== ac.base) return fail('L’avion doit être au sol à son hub actuel.');
  if (parkingLeft(ctx, newBase) < 1) return fail(`Plus de place au parking de ${city(ctx, newBase)}.`);
  const model = data.model(ac.modelId);
  const km = Math.round(data.distanceKm(ac.base, newBase));
  if (km > model.rangeKm) return fail(`Trop loin pour un ${model.name} (${km} km).`);
  const minutes = blockMinutes(km, model);
  const from = ac.base;
  ac.base = newBase;
  ac.program = [];
  ac.programIndex = 0;
  ac.leg = {
    id: `${ac.id}-${++ctx.state.counters.flight}`,
    kind: 'ferry',
    lineId: null,
    from,
    to: newBase,
    dep: t,
    arr: t + minutes * 60_000,
    callsign: `${ctx.state.company.code} ${9000 + (ctx.state.counters.flight % 1000)}`,
    pax: 0,
    seats: model.seats ?? 0,
    cargoT: 0,
    cargoMaxT: model.cargoT ?? 0,
    revenue: 0,
    vat: 0,
    costs: { fuel: model.fuelKgH * (minutes / 60) * ctx.state.fuelPrice, airport: 0, maintenance: 0, service: 0 },
  };
  ac.status = 'flying';
  ac.until = null;
  invalidate(ctx);
  log(ctx, 'info', `${ac.registration} part s'installer à ${city(ctx, newBase)}`, { type: 'aircraft', id: ac.id }, t);
  return ok();
}

export function maintainAircraft(ctx: Ctx, t: number, id: string): ActionResult {
  const ac = findAircraft(ctx, id);
  if (!ac) return fail('Avion introuvable.');
  if (!(ac.status === 'idle' || ac.status === 'ground')) return fail('L’avion doit être au sol et disponible.');
  if (!isPlayerHub(ctx, ac.location)) return fail('Les révisions se font dans un de tes hubs.');
  if (ac.condition >= 99) return fail('L’avion est déjà comme neuf.');
  const q = maintenanceQuote(ctx, ac);
  const no = cantAfford(ctx, q.cost);
  if (no) return no;
  startMaintenance(ctx, ac, t, false);
  return ok(`Révision lancée : ${q.hours} h pour ${money(q.cost)}.`);
}

export function repairAircraft(ctx: Ctx, t: number, id: string): ActionResult {
  const ac = findAircraft(ctx, id);
  if (!ac) return fail('Avion introuvable.');
  if (ac.status !== 'broken' || !ac.breakdown) return fail('Cet avion n’est pas en panne.');
  const q = repairQuote(ctx, ac);
  const no = cantAfford(ctx, q.cost);
  if (no) return no;
  startRepair(ctx, ac, t);
  return ok(`Réparation lancée : ${q.hours} h pour ${money(q.cost)}.`);
}

// ───────────────────────── Lignes ─────────────────────────

export function lineOpeningCost(km: number): number {
  return Math.round((LINE_OPEN_BASE + LINE_OPEN_PER_KM * km) / 1000) * 1000;
}

export function openLine(ctx: Ctx, t: number, hubIata: string, dest: string): ActionResult {
  const { data, state: s } = ctx;
  const hub = findHub(ctx, hubIata);
  if (!hub) return fail('Ce hub ne t’appartient pas.');
  const route = data.route(hubIata, dest);
  if (!route) return fail('Aucune ligne régulière n’existe entre ces deux aéroports.');
  const key = GameData.routeKey(hubIata, dest);
  if (s.lines.some((l) => GameData.routeKey(l.hub, l.dest) === key)) return fail('Tu exploites déjà cette ligne.');
  const used = s.lines.filter((l) => l.hub === hubIata).length;
  if (used >= hub.lineSlots) return fail(`Toutes les licences de lignes de ${city(ctx, hubIata)} sont utilisées (${used}/${hub.lineSlots}). Achète une licence de plus au hub.`);
  const cost = lineOpeningCost(route.km);
  const no = cantAfford(ctx, cost);
  if (no) return no;
  spend(s, 'lineOpening', cost);
  const line: Line = {
    id: `L${++s.counters.line}`,
    number: 100 + 10 * s.counters.lineNumber++,
    hub: hubIata,
    dest,
    km: route.km,
    priceFactor: 1,
    openedAt: t,
    stats: emptyStats(),
    month: emptyStats(),
  };
  s.lines.push(line);
  log(ctx, 'info', `Nouvelle ligne ${city(ctx, hubIata)} ⇄ ${city(ctx, dest)} (${route.km} km)`, { type: 'line', id: line.id }, t);
  return ok(`Ligne ouverte. Affecte-lui un avion et un pilote pour la faire voler.`);
}

export function closeLine(ctx: Ctx, t: number, id: string): ActionResult {
  const s = ctx.state;
  const line = findLine(ctx, id);
  if (!line) return fail('Ligne introuvable.');
  for (const ac of s.aircraft) {
    if (!ac.program.includes(id)) continue;
    ac.program = ac.program.filter((x) => x !== id);
    ac.programIndex = 0;
  }
  s.lines = s.lines.filter((l) => l !== line);
  invalidate(ctx);
  log(ctx, 'info', `Ligne ${city(ctx, line.hub)} ⇄ ${city(ctx, line.dest)} fermée`, undefined, t);
  return ok();
}

export function setLinePrice(ctx: Ctx, _t: number, id: string, factor: number): ActionResult {
  const line = findLine(ctx, id);
  if (!line) return fail('Ligne introuvable.');
  line.priceFactor = Math.min(PRICE_FACTOR_MAX, Math.max(PRICE_FACTOR_MIN, Math.round(factor * 100) / 100));
  invalidate(ctx);
  return ok();
}

/** Pourquoi cet avion ne peut pas desservir cette ligne (ou null s'il le peut). */
export function aircraftLineProblem(ctx: Ctx, ac: Aircraft, line: Line): string | null {
  const { data } = ctx;
  if (line.hub !== ac.base) return `L’avion est basé à ${city(ctx, ac.base)}, la ligne part de ${city(ctx, line.hub)}`;
  return routeProblem(data, data.model(ac.modelId), data.airport(line.hub), data.airport(line.dest), line.km);
}

/** Remplace le programme de vols d'un avion (les lignes sont desservies à tour de rôle). */
export function setProgram(ctx: Ctx, t: number, aircraftId: string, lineIds: string[]): ActionResult {
  const ac = findAircraft(ctx, aircraftId);
  if (!ac) return fail('Avion introuvable.');
  const lines: Line[] = [];
  for (const id of lineIds) {
    const line = findLine(ctx, id);
    if (!line) return fail('Ligne introuvable.');
    const problem = aircraftLineProblem(ctx, ac, line);
    if (problem) return fail(problem);
    lines.push(line);
  }
  const hub = findHub(ctx, ac.base);
  if (hub && lines.length) {
    const dep = hubDepartures(ctx, hub, { aircraftId: ac.id, program: lines });
    if (dep.used > dep.capacity + 1e-6) {
      return fail(
        `Pas assez de portes à ${city(ctx, hub.iata)} : il faudrait ${Math.ceil(dep.used)} départs par jour pour ${dep.capacity} possibles. Ajoute une porte au hub.`,
      );
    }
  }
  ac.program = lines.map((l) => l.id);
  ac.programIndex = 0;
  if (!lines.length) invalidate(ctx);
  wake(ctx, ac, t);
  return ok();
}

/** Ajoute une ligne au programme d'un avion. */
export function addLineToAircraft(ctx: Ctx, t: number, aircraftId: string, lineId: string): ActionResult {
  const ac = findAircraft(ctx, aircraftId);
  if (!ac) return fail('Avion introuvable.');
  if (ac.program.includes(lineId)) return fail('Cet avion dessert déjà cette ligne.');
  return setProgram(ctx, t, aircraftId, [...ac.program, lineId]);
}

export function removeLineFromAircraft(ctx: Ctx, t: number, aircraftId: string, lineId: string): ActionResult {
  const ac = findAircraft(ctx, aircraftId);
  if (!ac) return fail('Avion introuvable.');
  return setProgram(
    ctx,
    t,
    aircraftId,
    ac.program.filter((x) => x !== lineId),
  );
}

/** Départs par jour estimés d'un avion avec son programme actuel. */
export function dailyDepartures(ctx: Ctx, ac: Aircraft): number {
  return aircraftDailyDepartures(ctx, ac, programLines(ctx.state, ac));
}

// ───────────────────────── Pilotes ─────────────────────────

/** Met un pilote dans un avion (ou retire le pilote si pilotId est null). */
export function assignPilot(ctx: Ctx, t: number, aircraftId: string, pilotId: string | null): ActionResult {
  const ac = findAircraft(ctx, aircraftId);
  if (!ac) return fail('Avion introuvable.');
  if (pilotId === null) {
    if (ac.pilotId) {
      const old = findPilot(ctx, ac.pilotId);
      if (old) old.aircraftId = null;
    }
    ac.pilotId = null;
    invalidate(ctx);
    return ok();
  }
  const p = findPilot(ctx, pilotId);
  if (!p) return fail('Pilote introuvable.');
  const problem = pilotProblem(p, ctx.data.model(ac.modelId));
  if (problem) return fail(problem);
  if (p.aircraftId && p.aircraftId !== ac.id) {
    const other = findAircraft(ctx, p.aircraftId);
    if (other) {
      if (other.status === 'flying') return fail(`${pilotName(p)} est en vol sur ${other.registration}.`);
      other.pilotId = null;
    }
  }
  if (ac.pilotId && ac.pilotId !== p.id) {
    const old = findPilot(ctx, ac.pilotId);
    if (old) old.aircraftId = null;
  }
  ac.pilotId = p.id;
  p.aircraftId = ac.id;
  wake(ctx, ac, t);
  return ok();
}

export function hirePilot(ctx: Ctx, t: number, candidateId: string): ActionResult {
  const s = ctx.state;
  const c = s.market.pilots.find((x) => x.id === candidateId);
  if (!c) return fail('Ce pilote n’est plus disponible.');
  const no = cantAfford(ctx, c.signingFee);
  if (no) return no;
  spend(s, 'recruitment', c.signingFee);
  s.market.pilots = s.market.pilots.filter((x) => x !== c);
  const p: Pilot = {
    id: `P${++s.counters.pilot}`,
    firstName: c.firstName,
    lastName: c.lastName,
    nationality: c.nationality,
    birthYear: c.birthYear,
    hours: c.hours,
    stars: c.stars,
    ratings: [...c.ratings],
    salary: c.salary,
    hiredAt: t,
    aircraftId: null,
    training: null,
  };
  s.pilots.push(p);
  log(ctx, 'info', `${pilotName(p)} rejoint la compagnie (${c.stars}★, ${c.ratings.join(', ')})`, { type: 'pilot', id: p.id }, t);
  return ok(`${pilotName(p)} est embauché(e).`);
}

/** Formation initiale d'un nouveau pilote (élève sans expérience). */
export function trainNewPilot(ctx: Ctx, t: number, family: string): ActionResult {
  const { data, state: s } = ctx;
  const fam = data.families.get(family);
  if (!fam) return fail('Famille d’avions inconnue.');
  if (fam.large) return fail('Un débutant commence sur un avion régional ou moyen-courrier.');
  const cost = trainingCost(data, s);
  const no = cantAfford(ctx, cost);
  if (no) return no;
  spend(s, 'training', cost);
  const country = s.company.country;
  const name = randomName(ctx.rng, namePoolFor(country, data.country(country)?.continent));
  const p: Pilot = {
    id: `P${++s.counters.pilot}`,
    ...name,
    nationality: country,
    birthYear: utcYear(t) - 22 - Math.floor(ctx.rng() * 6),
    hours: 250,
    stars: 1,
    ratings: [],
    salary: Math.round((PILOT_SALARY[1] * 0.8 * data.coef(country)) / 100) * 100,
    hiredAt: t,
    aircraftId: null,
    training: { kind: 'initial', family, until: t + TRAINING_DAYS * DAY },
  };
  s.pilots.push(p);
  log(ctx, 'info', `${pilotName(p)} commence sa formation de pilote (${family}, ${TRAINING_DAYS} jours)`, { type: 'pilot', id: p.id }, t);
  return ok(`Formation lancée : ${pilotName(p)} sera pilote dans ${TRAINING_DAYS} jours.`);
}

/** Qualification d'un pilote sur une autre famille d'avions. */
export function trainTypeRating(ctx: Ctx, t: number, pilotId: string, family: string): ActionResult {
  const { data, state: s } = ctx;
  const p = findPilot(ctx, pilotId);
  if (!p) return fail('Pilote introuvable.');
  if (p.training) return fail(`${pilotName(p)} est déjà en formation.`);
  if (p.aircraftId) return fail(`Retire d’abord ${pilotName(p)} de son avion.`);
  const fam = data.families.get(family);
  if (!fam) return fail('Famille d’avions inconnue.');
  if (p.ratings.includes(family)) return fail('Déjà qualifié(e) sur cette famille.');
  if (fam.large && p.stars < 2) return fail('Il faut au moins 2 étoiles pour se qualifier sur un gros-porteur.');
  const spec = typeRatingSpec(data, s, family);
  const no = cantAfford(ctx, spec.cost);
  if (no) return no;
  spend(s, 'training', spec.cost);
  p.training = { kind: 'type', family, until: t + spec.days * DAY };
  invalidate(ctx);
  log(ctx, 'info', `${pilotName(p)} part en qualification ${family} (${spec.days} jours)`, { type: 'pilot', id: p.id }, t);
  return ok();
}

export function firePilot(ctx: Ctx, t: number, pilotId: string): ActionResult {
  const s = ctx.state;
  const p = findPilot(ctx, pilotId);
  if (!p) return fail('Pilote introuvable.');
  if (p.aircraftId) {
    const ac = findAircraft(ctx, p.aircraftId);
    if (ac?.status === 'flying') return fail(`${pilotName(p)} est en vol : attends l’atterrissage.`);
    if (ac) ac.pilotId = null;
  }
  spend(s, 'salaries', p.salary * PILOT_SEVERANCE_MONTHS);
  s.pilots = s.pilots.filter((x) => x !== p);
  invalidate(ctx);
  log(ctx, 'info', `${pilotName(p)} quitte la compagnie`, undefined, t);
  return ok();
}

/** Salaire de base actuel d'un pilote débutant (pour l'interface). */
export function juniorSalary(ctx: Ctx): number {
  return baseSalary(ctx.data, ctx.state, 1);
}

// ───────────────────────── Finances ─────────────────────────

export function companyAssets(ctx: Ctx, t: number): { fleet: number; hubs: number } {
  const fleet = ctx.state.aircraft.reduce((sum, ac) => sum + aircraftValue(ctx.data, ac, t), 0);
  const hubs = ctx.state.hubs.reduce((sum, h) => sum + hubValue(h), 0);
  return { fleet, hubs };
}

export function companyValue(ctx: Ctx, t: number): number {
  const a = companyAssets(ctx, t);
  return ctx.state.cash - ctx.state.debt + a.fleet + a.hubs;
}

export function loanCapacity(ctx: Ctx, t: number): number {
  const a = companyAssets(ctx, t);
  const cap = Math.max(LOAN_MIN_CAP, LOAN_ASSET_SHARE * (a.fleet + a.hubs));
  return Math.max(0, Math.floor((cap - ctx.state.debt) / 100_000) * 100_000);
}

export function borrow(ctx: Ctx, t: number, amount: number): ActionResult {
  const max = loanCapacity(ctx, t);
  if (!(amount > 0)) return fail('Montant invalide.');
  if (amount > max) return fail(`La banque prête au plus ${money(max)} de plus.`);
  ctx.state.debt += amount;
  ctx.state.cash += amount;
  log(ctx, 'money', `Emprunt de ${money(amount)}`, undefined, t);
  return ok();
}

export function repay(ctx: Ctx, t: number, amount: number): ActionResult {
  const s = ctx.state;
  const a = Math.min(amount, s.debt, Math.max(0, s.cash));
  if (!(a > 0)) return fail(s.debt <= 0 ? 'Tu n’as aucune dette.' : 'Pas assez de trésorerie.');
  s.debt -= a;
  s.cash -= a;
  log(ctx, 'money', `Remboursement de ${money(a)}`, undefined, t);
  return ok();
}

export function updateSettings(ctx: Ctx, _t: number, patch: Partial<typeof ctx.state.settings>): ActionResult {
  Object.assign(ctx.state.settings, patch);
  return ok();
}
