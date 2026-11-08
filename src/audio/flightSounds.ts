/**
 * Bruitages de l'avion sélectionné : tant qu'une fiche de vol est ouverte, on
 * entend l'avion selon l'étape du vol (au sol, mise en route, décollage,
 * montée, croisière, descente, approche, atterrissage), la météo du vol, et
 * cela depuis trois endroits au choix (bouton 🎧 de la fiche) :
 *
 * - dehors : moteurs, vent, pluie, l'aéroport au sol (passerelle, tracteur,
 *   bus, escalier, bagages, carburant, traiteur, cales…), et les bruits de l'avion (train, volets, aérofreins) ;
 * - en cabine : moteurs étouffés, passagers, portes, annonces, service à bord ;
 * - au poste de pilotage : interrupteurs, radio, balises, pilote automatique
 *   et, de temps en temps, une alarme (trafic proche, cisaillement de vent…).
 *
 * Les étapes suivent l'heure du jeu : en accéléré, elles défilent plus vite.
 * Météo et incidents sont tirés au sort une fois par vol (même vol, même tirage).
 */
import type { GameClock } from '../core/clock';
import type { Flight } from '../flights/types';
import type { AircraftLayer } from '../map/aircraft';
import { LoopSet, audio, onAudioReady, playSound } from './engine';

// ── Où l'on écoute ──

export type ListenPoint = 'dehors' | 'cabine' | 'cockpit';
export const LISTEN_POINTS: { id: ListenPoint; icon: string; label: string }[] = [
  { id: 'dehors', icon: '🎧', label: 'Dehors' },
  { id: 'cabine', icon: '💺', label: 'Cabine' },
  { id: 'cockpit', icon: '👨‍✈️', label: 'Cockpit' },
];

let listen: ListenPoint = 'dehors';
const listenListeners = new Set<() => void>();

export function listenPoint(): ListenPoint {
  return listen;
}

/** Passe à l'endroit d'écoute suivant (dehors → cabine → cockpit). */
export function nextListenPoint(): void {
  const i = LISTEN_POINTS.findIndex((p) => p.id === listen);
  listen = LISTEN_POINTS[(i + 1) % LISTEN_POINTS.length].id;
  for (const fn of listenListeners) fn();
}

// ── Les sons, rangés par endroit ──

const CABIN = new Set(
  'air_nozzle_click beverage_pour blanket_rustle boarding_chime cabin_ambience_busy cabin_ambience cabin_door_close cabin_door_open cabin_turbulence_rattle call_button_chime curtain_slide galley_cart_brake galley_cart_roll galley_oven_beep galley_steam ice_cubes interphone_pickup lavatory_flush lavatory_lock meal_foil overhead_bin_close overhead_bin_open pa_chime seat_recline seatbelt_buckle seatbelt_sign_ding window_shade reading_light_click oxygen_mask_drop rain_on_fuselage cabin_clean_vacuum decompression evac_slide'.split(' '),
);
const COCKPIT = new Set(
  'altitude_alert_horn autopilot_disconnect autothrottle_disconnect fire_bell gear_warning hydraulic_low_chime master_caution master_warning overspeed_warning stall_warning tcas_resolution tcas_traffic terrain_whoop wind_shear_alert button_press circuit_breaker cockpit_ambience fuel_pump_switch guard_open knob_detent marker_inner marker_middle marker_outer nav_ident_cdg oxygen_test_hiss rudder_pedal switch_off switch_on trim_wheel windshield_wiper yoke_movement radio_morse_ident radio_squelch radio_static_burst radio_comms_loop windshield_crack fire_discharge'.split(' '),
);

/** Volume de chaque endroit selon où l'on écoute ; dehors passe par un filtre en cabine et au cockpit. */
const MIX: Record<ListenPoint, { outside: number; muffleHz: number; cabin: number; cockpit: number }> = {
  dehors: { outside: 1, muffleHz: 20_000, cabin: 0, cockpit: 0 },
  cabine: { outside: 0.6, muffleHz: 700, cabin: 1, cockpit: 0 },
  cockpit: { outside: 0.55, muffleHz: 900, cabin: 0.1, cockpit: 1 },
};

// ── Étapes du vol ──

type Stage = 'parked' | 'starting' | 'takeoff' | 'climb' | 'cruise' | 'descent' | 'approach' | 'final' | 'landed';
/** Un bruit : [son, décalage en secondes, volume de 0 à 1]. */
type Cue = [string, number, number];

const MIN = 60_000;

function stageOf(f: Flight, t: number, phase: string | undefined): Stage {
  if (t >= f.arrMs) return 'landed';
  if (t < f.depMs) return t >= f.depMs - 3 * MIN ? 'starting' : 'parked';
  if (t < f.depMs + 1.5 * MIN) return 'takeoff';
  const left = f.arrMs - t;
  if (left < 2 * MIN) return 'final';
  if (left < 6 * MIN) return 'approach';
  return phase === 'montée' ? 'climb' : phase === 'descente' ? 'descent' : 'cruise';
}

/** Étapes proches du sol (on y entend la pluie et l'aéroport). */
const LOW: Stage[] = ['parked', 'starting', 'takeoff', 'approach', 'final', 'landed'];

const LOOPS: Record<Stage, Record<string, number>> = {
  parked: { apron_ambience: 0.4, gpu_hum: 0.25, cabin_ambience_busy: 0.5, cockpit_ambience: 0.25 },
  starting: { engine_idle: 0.35, apron_ambience: 0.3, cabin_ambience_busy: 0.4, cockpit_ambience: 0.35, radio_comms_loop: 0.3 },
  takeoff: { engine_full_power: 0.4, cabin_ambience: 0.3, cockpit_ambience: 0.4, radio_comms_loop: 0.25 },
  climb: { engine_full_power: 0.3, wind_external: 0.25, cabin_ambience: 0.35, cockpit_ambience: 0.4 },
  cruise: { engine_cruise: 0.35, wind_external: 0.35, cabin_ambience: 0.4, cockpit_ambience: 0.4 },
  descent: { engine_idle: 0.3, wind_external: 0.4, cabin_ambience: 0.4, cockpit_ambience: 0.4 },
  approach: { engine_idle: 0.3, wind_external: 0.3, cabin_ambience: 0.35, cockpit_ambience: 0.4, radio_comms_loop: 0.25 },
  final: { engine_idle: 0.35, wind_external: 0.25, cabin_ambience: 0.3, cockpit_ambience: 0.4, radio_comms_loop: 0.2 },
  landed: { engine_taxi: 0.35, cabin_ambience_busy: 0.45, cockpit_ambience: 0.35, radio_comms_loop: 0.25 },
};

const ENTER: Partial<Record<Stage, Cue[]>> = {
  starting: [
    ['cabin_door_close', 0.5, 0.9], ['seatbelt_sign_ding', 2, 0.8], ['towbar_connect', 1, 0.9], ['chock_remove', 2.2, 0.9],
    ['pushback_tug', 3, 0.8], ['engine_start', 4, 0.8], ['towbar_disconnect', 10, 0.9], ['tug_horn', 11, 0.7],
    ['switch_on', 0, 0.8], ['fuel_pump_switch', 1.5, 0.8], ['button_press', 3.5, 0.8], ['pa_chime', 6, 0.7],
  ],
  takeoff: [['engine_spool_up', 0, 0.8], ['knob_detent', 0, 0.8], ['rudder_pedal', 2, 0.8], ['yoke_movement', 4, 0.8]],
  climb: [['gear_retract', 0, 1], ['flaps_retract', 2.5, 1], ['trim_wheel', 1, 0.8], ['switch_off', 4, 0.8], ['call_button_chime', 4, 0.6]],
  cruise: [['seatbelt_sign_ding', 0, 0.8], ['pa_chime', 2, 0.7], ['knob_detent', 0, 0.8]],
  descent: [['airbrake_deploy', 0, 1], ['altitude_alert_horn', 0.5, 0.6], ['interphone_pickup', 1, 0.8], ['pa_chime', 2, 0.7]],
  approach: [['flaps_extend', 0, 1], ['hydraulic_pump', 0.4, 0.8], ['seatbelt_sign_ding', 0, 0.8], ['marker_outer', 1, 0.6], ['trim_wheel', 3, 0.8]],
  final: [['gear_extend', 0, 1], ['marker_middle', 0.5, 0.6], ['autopilot_disconnect', 3, 0.7], ['marker_inner', 6, 0.6]],
  landed: [
    ['touchdown', 0, 1], ['thrust_reverse', 0.6, 0.9], ['rudder_pedal', 1, 0.8], ['autothrottle_disconnect', 1.5, 0.6],
    ['seatbelt_sign_ding', 7, 0.8], ['seatbelt_buckle', 7.8, 1], ['overhead_bin_open', 9, 0.9],
  ],
};

/** Petits bruits tirés au hasard ; chaque groupe se joue d'un bloc. */
const RANDOM: Partial<Record<Stage, Cue[][]>> = {
  parked: [
    [['belt_loader', 0, 0.6]], [['luggage_thud', 0, 0.8], ['luggage_thud', 1.6, 0.7]], [['cargo_door', 0, 0.8]],
    [['fuel_nozzle_connect', 0, 0.9], ['refuel_pump', 1.2, 0.6]], [['catering_truck_lift', 0, 0.8], ['catering_trolley_load', 4, 0.8]],
    [['water_service', 0, 0.8]], [['lav_service', 0, 0.8]], [['cone_place', 0, 0.9]], [['gpu_connect', 0, 0.8]], [['pca_hose_connect', 0, 0.8]],
    [['air_start_cart', 0, 0.5]], [['cabin_clean_vacuum', 0, 0.6]], [['bird_chirp', 0, 0.6]], [['bird_flock', 0, 0.5]], [['distant_chime', 0, 0.6]], [['tug_horn', 0, 0.5]],
    [['overhead_bin_open', 0, 0.8], ['overhead_bin_close', 2.5, 0.9]], [['seatbelt_buckle', 0, 1]], [['reading_light_click', 0, 0.8]],
    [['window_shade', 0, 0.8]], [['air_nozzle_click', 0, 0.8]], [['call_button_chime', 0, 0.5]],
    [['oxygen_test_hiss', 0, 0.7]], [['switch_on', 0, 0.8], ['button_press', 0.6, 0.8]], [['circuit_breaker', 0, 0.8]], [['radio_squelch', 0, 0.8]],
  ],
  climb: [[['radio_squelch', 0, 0.8]], [['knob_detent', 0, 0.8], ['knob_detent', 0.3, 0.8]], [['reading_light_click', 0, 0.8]]],
  cruise: [
    [['galley_cart_roll', 0, 0.8], ['galley_cart_brake', 4, 0.8], ['beverage_pour', 5.5, 0.7], ['ice_cubes', 7.8, 0.7]],
    [['galley_oven_beep', 0, 0.5], ['galley_steam', 1.2, 0.6], ['meal_foil', 3.5, 0.8]],
    [['lavatory_lock', 0, 0.8], ['lavatory_flush', 6, 0.7], ['lavatory_lock', 11, 0.8]],
    [['call_button_chime', 0, 0.5]], [['air_nozzle_click', 0, 0.8]], [['blanket_rustle', 0, 0.7]], [['curtain_slide', 0, 0.7]],
    [['seat_recline', 0, 1]], [['window_shade', 0, 0.8]], [['reading_light_click', 0, 0.8]],
    [['cabin_turbulence_rattle', 0, 0.6], ['wind_gust', 0, 0.4]],
    [['radio_squelch', 0, 0.8]], [['radio_static_burst', 0, 1]], [['radio_morse_ident', 0, 0.4]],
    [['knob_detent', 0, 0.8]], [['button_press', 0, 0.8]], [['trim_wheel', 0, 0.7]], [['switch_on', 0, 0.8]], [['switch_off', 0, 0.8]],
  ],
  descent: [[['blanket_rustle', 0, 0.7]], [['seat_recline', 0, 1]], [['radio_squelch', 0, 0.8]], [['knob_detent', 0, 0.8]], [['cabin_turbulence_rattle', 0, 0.5]]],
  approach: [[['radio_squelch', 0, 0.8]], [['yoke_movement', 0, 0.8]], [['trim_wheel', 0, 0.8]]],
};

// ── Météo et incidents du vol (tirés au sort une fois par vol) ──

type Weather = 'beau' | 'pluie' | 'averse' | 'orage' | 'neige' | 'brouillard';

/** Nombre pseudo-aléatoire stable entre 0 et 1, tiré du numéro du vol. */
function roll(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10_000) / 10_000;
}

function weatherOf(f: Flight, lat: number, t: number): Weather {
  const r = roll(f.id, 1);
  const month = new Date(t).getUTCMonth();
  const winter = lat >= 0 ? month >= 10 || month <= 2 : month >= 4 && month <= 8;
  if (winter && Math.abs(lat) > 40 && r < 0.25) return 'neige';
  if (r < 0.06) return 'orage';
  if (r < 0.14) return 'averse';
  if (r < 0.3) return 'pluie';
  if (r < 0.36) return 'brouillard';
  return 'beau';
}

const WEATHER_LOOPS: Record<Weather, Record<string, number>> = {
  beau: {},
  pluie: { rain_light: 0.5, rain_on_fuselage: 0.3 },
  averse: { rain_heavy: 0.45, rain_on_fuselage: 0.5 },
  orage: { storm_ambience: 0.45, rain_heavy: 0.3, rain_on_fuselage: 0.5, wind_strong: 0.3 },
  neige: { snow_wind: 0.45, wind_strong: 0.2 },
  brouillard: {},
};

const WEATHER_RANDOM: Record<Weather, Cue[][]> = {
  beau: [],
  pluie: [[['windshield_wiper', 0, 0.7], ['windshield_wiper', 1.7, 0.7]]],
  averse: [[['windshield_wiper', 0, 0.7], ['windshield_wiper', 1.7, 0.7], ['windshield_wiper', 3.4, 0.7]]],
  orage: [[['thunder_distant', 0, 0.7]], [['thunder_close', 0, 0.6]], [['hail_fuselage', 0, 0.6]], [['windshield_wiper', 0, 0.7], ['windshield_wiper', 1.7, 0.7]]],
  neige: [[['ice_crackle', 0, 0.8]], [['snow_plow', 0, 0.5]], [['footsteps_snow', 0, 0.6]]],
  brouillard: [[['fog_horn', 0, 0.5]]],
};

/** Incident en croisière pour quelques vols : une alarme au cockpit, rien de grave. */
const INCIDENTS: Cue[][] = [
  [['tcas_traffic', 0, 0.8], ['tcas_resolution', 3, 0.8]],
  [['master_caution', 0, 0.8], ['hydraulic_low_chime', 2, 0.8], ['guard_open', 5, 0.8], ['button_press', 5.6, 0.8]],
  [['overspeed_warning', 0, 1], ['trim_wheel', 3.5, 0.8], ['autopilot_disconnect', 4, 0.6]],
  [['master_warning', 0, 0.6], ['decompression', 0, 0.7], ['oxygen_mask_drop', 1, 0.9], ['interphone_pickup', 4, 0.8], ['pa_chime', 5, 0.7]],
  [['bird_strike', 0, 0.9], ['master_caution', 0.8, 0.8], ['yoke_movement', 1.5, 0.8]],

];
/** Feu moteur éteint en vol : le seul incident qui se termine par une évacuation au sol. */
const FIRE: Cue[] = [['master_warning', 0, 0.7], ['fire_bell', 1.5, 0.5], ['guard_open', 4, 0.8], ['fire_discharge', 4.6, 0.8], ['switch_off', 6, 0.8], ['circuit_breaker', 7, 0.8]];
/** Grêle sous l'orage : le pare-brise se fissure. */
const HAIL: Cue[] = [['hail_fuselage', 0, 0.7], ['windshield_crack', 2, 0.8], ['master_caution', 3, 0.8]];

/** Alarme pendant l'approche, pour quelques vols. */
const APPROACH_ALERTS: Cue[][] = [
  [['terrain_whoop', 0, 0.6], ['yoke_movement', 1, 0.8]],
  [['gear_warning', 0, 0.7], ['gear_extend', 2, 1]],
  [['stall_warning', 0, 0.6], ['engine_spool_up', 1, 0.6]],
];

// ── Lecture ──

const FADE_S = 0.8;
const TICK_MS = 250;
const DOOR_OPEN_AFTER_S = 8;
const SHUTDOWN_AFTER_S = 11;

export function mountFlightSounds(layer: AircraftLayer, clock: GameClock): void {
  let outside: GainNode | null = null;
  let muffle: BiquadFilterNode | null = null;
  let cabin: GainNode | null = null;
  let cockpit: GainNode | null = null;

  const applyMix = (ctx: AudioContext, instant = false) => {
    if (!outside || !muffle || !cabin || !cockpit) return;
    const m = MIX[listen];
    const k = instant ? 0.001 : 0.25;
    const now = ctx.currentTime;
    muffle.frequency.setTargetAtTime(m.muffleHz, now, k);
    outside.gain.setTargetAtTime(m.outside, now, k);
    cabin.gain.setTargetAtTime(m.cabin, now, k);
    cockpit.gain.setTargetAtTime(m.cockpit, now, k);
  };

  onAudioReady((ctx, master) => {
    muffle = ctx.createBiquadFilter();
    muffle.type = 'lowpass';
    outside = ctx.createGain();
    muffle.connect(outside).connect(master);
    cabin = ctx.createGain();
    cabin.connect(master);
    cockpit = ctx.createGain();
    cockpit.connect(master);
    applyMix(ctx, true);
  });

  const route = (name: string): AudioNode => (CABIN.has(name) ? cabin! : COCKPIT.has(name) ? cockpit! : muffle!);
  const loops = new LoopSet(route);
  const play = ([name, delay, volume]: Cue) => playSound(name, volume, delay, route(name));
  const playGroup = (pool: Cue[][] | undefined) => {
    if (pool?.length) for (const cue of pool[Math.floor(Math.random() * pool.length)]) play(cue);
  };

  let flight: Flight | null = null;
  let stage: Stage | null = null;
  let stageSince = 0;
  let weather: Weather = 'beau';
  /** Avion garé loin du terminal : escalier et bus au lieu de la passerelle. */
  let remote = false;
  let doorDone = false;
  let shutdownDone = false;
  let incidentAt = 0;
  /** Le vol a eu un feu moteur : évacuation par les toboggans à l'arrivée. */
  let hadFire = false;
  let nextRandom = 0;
  let nextWeather = 0;

  listenListeners.add(() => {
    const ctx = audio();
    if (ctx) applyMix(ctx);
  });

  const airportLat = (code: string) => layer.data?.airports.get(code)?.lat ?? 45;
  const airportLon = (code: string) => layer.data?.airports.get(code)?.lon ?? 0;

  /** Heure solaire locale (0-24) à un aéroport. */
  const localHour = (code: string, t: number) => ((((t / 3_600_000 + airportLon(code) / 15) % 24) + 24) % 24);

  const wantedLoops = (): Record<string, number> => {
    if (!stage || !flight) return {};
    const out = { ...LOOPS[stage] };
    if (stage === 'landed' && shutdownDone) {
      delete out.engine_taxi;
      out.apron_ambience = 0.4;
      out.radio_comms_loop = 0;
    }
    const groundNow = stage === 'parked' || (stage === 'landed' && doorDone);
    if (groundNow && remote) out.apron_bus_loop = 0.3;
    if (LOW.includes(stage) || stage === 'climb' || stage === 'descent') {
      const k = LOW.includes(stage) ? 1 : 0.5; // plus haut, la pluie s'éloigne
      for (const [n, v] of Object.entries(WEATHER_LOOPS[weather])) out[n] = v * k;
    }
    const ground = stage === 'parked' || (stage === 'landed' && shutdownDone);
    const at = stage === 'parked' ? flight.from : flight.to;
    const h = localHour(at, clock.now());
    if (ground && h >= 5 && h < 8 && weather === 'beau') out.birds_dawn = 0.4;
    return out;
  };

  const enter = (next: Stage, real: number, withCues: boolean) => {
    stage = next;
    stageSince = real;
    doorDone = false;
    shutdownDone = false;
    nextRandom = real + 6 + Math.random() * 6;
    if (withCues) {
      for (const cue of ENTER[next] ?? []) play(cue);
      const wet = weather === 'pluie' || weather === 'averse' || weather === 'orage';
      if (next === 'starting') play(remote ? ['mobile_stairs', 0, 0.8] : ['jet_bridge_disconnect', 0, 0.9]);
      if (next === 'starting' && weather === 'neige') {
        play(['deicing_boom', 0, 0.7]);
        play(['deicing_spray', 3, 0.8]);
      }
      if (next === 'takeoff') play([wet ? 'wet_runway_roll' : 'runway_roll', 0.5, 0.7]);
      if (next === 'landed' && wet) play(['wet_runway_roll', 0.3, 0.6]);
      if (next === 'approach' && flight?.to === 'CDG') play(['nav_ident_cdg', 2, 0.5]);
      else if (next === 'approach') play(['radio_morse_ident', 2, 0.4]);
      if (next === 'approach' && weather === 'orage' && roll(flight!.id, 3) < 0.5) play(['wind_shear_alert', 4, 0.7]);
      if (next === 'final' && roll(flight!.id, 4) < 0.08) playGroup(APPROACH_ALERTS);
    }
    loops.set(wantedLoops(), FADE_S);
  };

  const tick = () => {
    if (!audio()) return;
    const t = clock.now();
    const real = performance.now() / 1000;
    let f = layer.selectedFlight();
    // L'avion posé n'est plus sélectionné (sa fiche se ferme) : on écoute quand même la fin.
    if (!f && flight && stage && t >= flight.arrMs && !shutdownDone) f = flight;
    if (!f) {
      if (flight) {
        loops.set({});
        flight = null;
        stage = null;
      }
      return;
    }
    const next = stageOf(f, t, layer.positionOf(f, t)?.phase);
    if (f.id !== flight?.id) {
      // Nouvel avion : on entre directement dans son étape, sans bruits de transition.
      flight = f;
      weather = weatherOf(f, airportLat(next === 'parked' || next === 'starting' ? f.from : f.to), t);
      remote = roll(f.id, 5) < 0.3;
      hadFire = false;
      incidentAt = roll(f.id, 2) < 0.12 ? real + 25 + Math.random() * 40 : 0;
      enter(next, real, false);
      if (next === 'parked') play(['apu_start', 0, 0.6]);
      return;
    }
    flight = f;
    if (next !== stage) enter(next, real, true);

    if (stage === 'landed') {
      if (!doorDone && real - stageSince > DOOR_OPEN_AFTER_S) {
        doorDone = true;
        play(['chock_place', 0, 0.9]);
        if (hadFire) play(['evac_slide', 2, 0.9]);
        if (remote) {
          play(['mobile_stairs', 1, 0.8]);
          play(['apron_bus_door', 7, 0.8]);
        } else play(['jet_bridge_connect', 1, 0.9]);
        play(['cabin_door_open', 3, 0.9]);
        loops.set(wantedLoops());
      }
      if (!shutdownDone && real - stageSince > SHUTDOWN_AFTER_S) {
        shutdownDone = true;
        play(['engine_shutdown', 0, 0.8]);
        play(['switch_off', 0.5, 0.8]);
        play(['fuel_pump_switch', 2, 0.8]);
        play(['apu_shutdown', 6, 0.6]);
        play(['belt_loader', 5, 0.6]);
        play(['gpu_connect', 3, 0.8]);
        play(['pca_hose_connect', 8, 0.8]);
        play(['cone_place', 4, 0.9]);
        loops.set(wantedLoops());
      }
    }
    if (stage === 'cruise' && incidentAt && real > incidentAt) {
      incidentAt = 0;
      const r = roll(flight!.id, 6);
      if (weather === 'orage' && r < 0.4) for (const cue of HAIL) play(cue);
      else if (r < 0.1) {
        hadFire = true;
        for (const cue of FIRE) play(cue);
      } else playGroup(INCIDENTS);
    }
    if (real > nextRandom) {
      playGroup(RANDOM[stage!]);
      nextRandom = real + 8 + Math.random() * 12;
    }
    if (LOW.includes(stage!) && real > nextWeather) {
      if (nextWeather) playGroup(WEATHER_RANDOM[weather]);
      nextWeather = real + 10 + Math.random() * 15;
    }
    if ((stage === 'cruise' || stage === 'descent') && Math.random() < TICK_MS / 30_000) play(['wind_gust', 0, 0.5]);
  };

  layer.onSelect(() => tick());
  setInterval(tick, TICK_MS);
}
