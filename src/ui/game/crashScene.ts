/**
 * Animation d'un accident sur la carte, là où l'avion se trouvait.
 *
 * La caméra part sur les lieux, puis on rejoue les dernières secondes selon
 * la phase du vol : sortie de piste à l'atterrissage, décrochage après le
 * décollage, chute en vrille en croisière. Viennent ensuite l'impact (éclair,
 * boule de feu, débris), l'incendie, la fumée poussée par le vent et, près
 * d'un aéroport, les véhicules de secours. L'épave fume encore un moment.
 *
 * Tout est en DOM + Web Animations dans un marqueur MapLibre aligné sur la
 * carte : rien n'est ajouté au rendu WebGL.
 */
import { Marker, type Map as MapLibreMap } from 'maplibre-gl';
import { playImpact, playSound } from '../../audio/engine';
import { liveryOf, shade } from '../../map/aircraftIcons';
import type { CrashRecord } from '../../game/state';

/** Silhouette vue de dessus (nez vers le haut), 64 × 64. */
function planeSvg(body: string, accent: string): string {
  return `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true">
    <path d="M32 3c2.4 0 3.6 3 3.6 6.5V24l22 13v5l-22-6.5V50l6.5 5v4L32 56.5 23.9 59v-4l6.5-5V35.5L8.4 42v-5l22-13V9.5C30.4 6 29.6 3 32 3z" fill="${body}" stroke="${shade(body, -0.35)}" stroke-width="1.2"/>
    <path d="M30.6 9.5h2.8v40h-2.8z" fill="${accent}" opacity=".85"/>
  </svg>`;
}

/** Épave : fuselage brisé en trois morceaux et ailes arrachées, noircis. */
function wreckSvg(body: string): string {
  const burnt = shade(body, -0.6);
  return `<svg viewBox="0 0 96 96" width="96" height="96" aria-hidden="true">
    <ellipse cx="48" cy="52" rx="20" ry="40" fill="#1b130d" opacity=".75"/>
    <path d="M45 14h7l1 24-9 2z" fill="${burnt}" transform="rotate(-8 48 26)"/>
    <path d="M44 44h8l-1 22h-7z" fill="#2b2622" transform="rotate(14 48 55)"/>
    <path d="M45 70h6l3 14-11 1z" fill="${burnt}" transform="rotate(-20 48 77)"/>
    <path d="M28 46l16-6 1 5-16 7z" fill="#3a332d"/>
    <path d="M70 58l-17-4 1-5 17 3z" fill="${burnt}"/>
  </svg>`;
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const IMPACT_MS = { decollage: 5200, montee: 5600, croisiere: 6200, approche: 5200, atterrissage: 5600 } as const;

interface Scene {
  marker: Marker;
  timers: number[];
}

let current: Scene | null = null;

/** Arrête la scène en cours (une nouvelle la remplace). */
function stop(): void {
  if (!current) return;
  for (const t of current.timers) window.clearTimeout(t);
  current.marker.remove();
  current = null;
}

export interface CrashSceneOpts {
  color: string;
  code: string;
  /** Appelé au moment de l'impact (pour afficher le bilan). */
  onImpact?: () => void;
}

export function playCrashScene(map: MapLibreMap, c: CrashRecord, opts: CrashSceneOpts): void {
  stop();
  const nearAirport = c.phase === 'decollage' || c.phase === 'atterrissage' || c.phase === 'approche';
  map.flyTo({ center: [c.lon, c.lat], zoom: nearAirport ? 12.5 : 8.5, pitch: 45, bearing: c.heading - 30, duration: 2200, essential: true });

  const { body, accent } = liveryOf(opts.code, opts.color);
  const root = document.createElement('div');
  root.className = 'cr-scene';
  // Repère tourné selon le cap : « vers le haut » = sens de vol.
  root.innerHTML = `
    <div class="cr-frame" style="transform: rotate(${c.heading}deg)">
      <div class="cr-scorch"></div>
      <div class="cr-wreck">${wreckSvg(body)}</div>
      <div class="cr-debris"></div>
      <div class="cr-fire"></div>
      <div class="cr-shadow">${planeSvg('#000', '#000')}</div>
      <div class="cr-plane">${planeSvg(body, accent)}</div>
      <div class="cr-flash"></div>
    </div>
    <div class="cr-smoke"></div>
    <div class="cr-rescue"></div>`;
  const marker = new Marker({ element: root, rotationAlignment: 'map', pitchAlignment: 'map' }).setLngLat([c.lon, c.lat]).addTo(map);
  const scene: Scene = { marker, timers: [] };
  current = scene;
  const later = (ms: number, fn: () => void) => scene.timers.push(window.setTimeout(fn, ms));

  const plane = root.querySelector<HTMLElement>('.cr-plane')!;
  const shadow = root.querySelector<HTMLElement>('.cr-shadow')!;
  const impactAt = IMPACT_MS[c.phase];
  const startAt = 2000; // le temps que la caméra arrive
  const dur = impactAt - startAt;
  const ease = 'cubic-bezier(.45,.05,.8,.6)';

  // ── Les dernières secondes, selon la phase ──
  // translate en px dans le repère de l'avion (y négatif = vers l'avant).
  let path: Keyframe[];
  let shade_: Keyframe[];
  if (c.phase === 'atterrissage') {
    // Toucher trop long et trop rapide : l'avion sort de piste en dérapant.
    const side = Math.random() < 0.5 ? -1 : 1;
    path = [
      { transform: 'translate(0, 260px) scale(1.12) rotate(0deg)' },
      { transform: 'translate(0, 70px) scale(1.02) rotate(0deg)', offset: 0.45 },
      { transform: `translate(${side * 4}px, 0px) scale(1) rotate(${side * 4}deg)`, offset: 0.62 },
      { transform: `translate(${side * 30}px, -60px) scale(1) rotate(${side * 28}deg)`, offset: 0.85 },
      { transform: `translate(${side * 46}px, -82px) scale(.98) rotate(${side * 55}deg)` },
    ];
    shade_ = [
      { transform: 'translate(26px, 290px) scale(1.12)', opacity: 0.25 },
      { transform: 'translate(6px, 74px) scale(1.02)', opacity: 0.4, offset: 0.45 },
      { transform: `translate(${side * 4}px, 0px) scale(1) rotate(${side * 4}deg)`, opacity: 0.5, offset: 0.62 },
      { transform: `translate(${side * 46}px, -82px) scale(.98) rotate(${side * 55}deg)`, opacity: 0.5 },
    ];
  } else if (c.phase === 'decollage' || c.phase === 'montee') {
    // Rotation, perte de portance (moteur, décrochage) : l'avion s'incline et retombe.
    const side = Math.random() < 0.5 ? -1 : 1;
    path = [
      { transform: 'translate(0, 160px) scale(1) rotate(0deg)' },
      { transform: 'translate(0, 20px) scale(1.12) rotate(0deg)', offset: 0.4 },
      { transform: `translate(${side * 14}px, -60px) scale(1.22) rotate(${side * 18}deg)`, offset: 0.68 },
      { transform: `translate(${side * 48}px, -110px) scale(1.05) rotate(${side * 62}deg)`, offset: 0.9 },
      { transform: `translate(${side * 58}px, -122px) scale(.95) rotate(${side * 80}deg)` },
    ];
    shade_ = [
      { transform: 'translate(0, 160px)', opacity: 0.5 },
      { transform: 'translate(14px, 30px) scale(1.04)', opacity: 0.4, offset: 0.4 },
      { transform: `translate(${side * 14 + 40}px, -40px) scale(1.06) rotate(${side * 18}deg)`, opacity: 0.25, offset: 0.68 },
      { transform: `translate(${side * 58}px, -122px) scale(.95) rotate(${side * 80}deg)`, opacity: 0.5 },
    ];
  } else {
    // En vol : perte de contrôle, descente en spirale vers le sol.
    path = [
      { transform: 'translate(-40px, 220px) scale(1.7) rotate(0deg)' },
      { transform: 'translate(60px, 80px) scale(1.5) rotate(120deg)', offset: 0.35 },
      { transform: 'translate(-30px, -10px) scale(1.3) rotate(300deg)', offset: 0.7 },
      { transform: 'translate(0, 0) scale(.95) rotate(470deg)' },
    ];
    shade_ = [
      { transform: 'translate(120px, 300px) scale(1.2) rotate(0deg)', opacity: 0.12 },
      { transform: 'translate(120px, 130px) scale(1.15) rotate(120deg)', opacity: 0.18, offset: 0.35 },
      { transform: 'translate(10px, 20px) scale(1.05) rotate(300deg)', opacity: 0.3, offset: 0.7 },
      { transform: 'translate(0, 0) scale(.95) rotate(470deg)', opacity: 0.5 },
    ];
  }
  later(startAt, () => {
    plane.style.visibility = shadow.style.visibility = 'visible';
    plane.animate(path, { duration: dur, easing: ease, fill: 'forwards' });
    shadow.animate(shade_, { duration: dur, easing: ease, fill: 'forwards' });
    // Alarmes du poste de pilotage : vrille ou approche → « terrain » ; décollage → alarme de décrochage.
    playSound(c.phase === 'decollage' || c.phase === 'montee' ? 'stall_warning' : 'terrain_whoop', 0.7);
  });

  // ── Impact ──
  later(impactAt, () => {
    plane.style.visibility = shadow.style.visibility = 'hidden';
    root.classList.add('cr-hit');
    playImpact(1);
    playSound('fire_discharge', 0.4, 1.2);
    opts.onImpact?.();
    burst(root.querySelector('.cr-debris')!, c.phase === 'atterrissage' ? 0.6 : 1);
    fire(root.querySelector('.cr-fire')!, c.fatalities > 0 ? 1 : 0.6);
    smoke(root.querySelector('.cr-smoke')!, c.heading, scene, later);
  });

  // ── Secours (près d'un aéroport, les pompiers sont sur place en 2 à 3 minutes : ici, quelques secondes) ──
  if (nearAirport) {
    later(impactAt + 2500, () => {
      playSound('fire_bell', 0.35);
      rescue(root.querySelector('.cr-rescue')!);
    });
  }

  // L'incendie s'éteint, la fumée retombe, puis la scène disparaît.
  later(impactAt + 30_000, () => root.classList.add('cr-out-fire'));
  later(impactAt + 70_000, () => root.classList.add('cr-out'));
  later(impactAt + 74_000, () => {
    if (current === scene) stop();
  });
}

/** Débris projetés vers l'avant (dans le sens du vol), en éventail. */
function burst(host: HTMLElement, strength: number): void {
  const n = Math.round(26 * strength);
  for (let i = 0; i < n; i++) {
    const d = document.createElement('i');
    const a = rand(-75, 75) * (Math.PI / 180); // autour de l'avant
    const r = rand(20, 120) * strength;
    const x = Math.sin(a) * r;
    const y = -Math.cos(a) * r;
    d.style.width = `${rand(2, 7)}px`;
    d.style.height = `${rand(2, 4)}px`;
    host.appendChild(d);
    d.animate(
      [
        { transform: 'translate(0,0) rotate(0deg)', opacity: 1 },
        { transform: `translate(${x}px, ${y}px) rotate(${rand(-540, 540)}deg)`, opacity: 1 },
      ],
      { duration: rand(500, 1300), easing: 'cubic-bezier(.1,.7,.3,1)', fill: 'forwards' },
    );
  }
}

/** Boule de feu puis foyers qui vacillent le long de la traînée de l'épave. */
function fire(host: HTMLElement, strength: number): void {
  const n = Math.round(14 * strength) + 4;
  for (let i = 0; i < n; i++) {
    const f = document.createElement('i');
    const size = rand(10, 30) * (0.6 + strength * 0.5);
    f.style.width = f.style.height = `${size}px`;
    f.style.left = `${rand(-14, 14)}px`;
    f.style.top = `${rand(-40, 30)}px`;
    f.style.animationDelay = `${rand(0, 0.8)}s`;
    f.style.animationDuration = `${rand(0.35, 0.8)}s`;
    host.appendChild(f);
  }
}

/** Fumée : panaches qui grossissent et dérivent avec le vent, en continu. */
function smoke(host: HTMLElement, heading: number, scene: Scene, later: (ms: number, fn: () => void) => void): void {
  const wind = rand(0, 360) * (Math.PI / 180);
  const wx = Math.sin(wind);
  const wy = -Math.cos(wind);
  void heading;
  const puff = (dark: boolean) => {
    const p = document.createElement('i');
    const size = rand(18, 34);
    p.style.width = p.style.height = `${size}px`;
    p.style.background = dark ? 'radial-gradient(circle, rgba(25,22,20,.85), rgba(25,22,20,0) 70%)' : 'radial-gradient(circle, rgba(120,118,115,.7), rgba(120,118,115,0) 70%)';
    host.appendChild(p);
    const dist = rand(140, 260);
    const anim = p.animate(
      [
        { transform: `translate(${rand(-8, 8)}px, ${rand(-8, 8)}px) scale(.5)`, opacity: 0 },
        { opacity: 0.95, offset: 0.12 },
        { transform: `translate(${wx * dist + rand(-30, 30)}px, ${wy * dist + rand(-30, 30)}px) scale(${rand(3.5, 6)})`, opacity: 0 },
      ],
      { duration: rand(5000, 8000), easing: 'linear', fill: 'forwards' },
    );
    anim.onfinish = () => p.remove();
  };
  // Fumée noire épaisse pendant l'incendie, plus claire et rare ensuite.
  for (let t = 0; t < 70_000; t += 220) {
    const dark = t < 30_000;
    if (!dark && Math.random() < 0.6) continue;
    later(t, () => {
      if (current === scene) puff(dark);
    });
  }
}

/** Véhicules de secours (gyrophares) qui convergent vers l'épave. */
function rescue(host: HTMLElement): void {
  for (let i = 0; i < 5; i++) {
    const v = document.createElement('i');
    host.appendChild(v);
    const a = rand(0, Math.PI * 2);
    const r = rand(160, 230);
    const stopR = rand(30, 50);
    v.animate(
      [
        { transform: `translate(${Math.cos(a) * r}px, ${Math.sin(a) * r}px)`, opacity: 0 },
        { opacity: 1, offset: 0.1 },
        { transform: `translate(${Math.cos(a) * stopR}px, ${Math.sin(a) * stopR}px)`, opacity: 1 },
      ],
      { duration: rand(5000, 8000), delay: i * 600, easing: 'ease-out', fill: 'forwards' },
    );
  }
}
