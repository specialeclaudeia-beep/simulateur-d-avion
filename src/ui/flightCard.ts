import type { GameClock } from '../core/clock';
import type { AircraftLayer } from '../map/aircraft';
import type { Flight } from '../flights/types';

/**
 * Fiche de l'avion touché : compagnie, numéro de vol, départ → arrivée,
 * modèle, passagers (ou charge pour un cargo), altitude, vitesse, heure d'arrivée.
 * Mise à jour en continu tant que l'avion est sélectionné.
 */
export function mountFlightCard(root: HTMLElement, layer: AircraftLayer, clock: GameClock): void {
  const card = document.createElement('div');
  card.className = 'flight-card';
  card.hidden = true;
  root.appendChild(card);

  let current: Flight | null = null;
  const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const nf = new Intl.NumberFormat('fr-FR');

  const render = (f: Flight) => {
    const world = layer.data;
    const from = world?.airports.get(f.from);
    const to = world?.airports.get(f.to);
    const model = world?.aircraft.get(f.aircraftId);
    const mfr = model ? world?.manufacturers.get(model.mfr) : undefined;
    const airline = world?.airlines.get(f.airline);
    const logo = airline?.logo ?? null;
    const load =
      f.cargoMaxT !== undefined
        ? `<span class="fc-k">Cargo</span><span class="fc-v">${nf.format(f.cargoT ?? 0)} t / ${nf.format(f.cargoMaxT)} t</span>`
        : `<span class="fc-k">Passagers</span><span class="fc-v">${nf.format(f.pax ?? 0)} / ${nf.format(f.seats ?? 0)} places</span>`;
    const ratio = f.cargoMaxT ? (f.cargoT ?? 0) / f.cargoMaxT : f.seats ? (f.pax ?? 0) / f.seats : 0;

    card.innerHTML = `
      <div class="fc-head" style="--airline:${f.color}">
        ${logo ? `<img class="fc-logo" src="${esc(logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="fc-dot"></span>`}
        <div class="fc-title">
          <strong>${esc(f.callsign)}</strong>
          <small>${esc(f.airlineName)}${f.player ? ' · ta compagnie' : ''}</small>
        </div>
        <button type="button" class="hud-btn fc-follow" title="La caméra suit l'avion" aria-pressed="false">🎯 Suivre</button>
        <button type="button" class="hud-btn fc-close" aria-label="Fermer">✕</button>
      </div>
      <div class="fc-route">
        <div class="fc-ap">
          <b>${esc(f.from)}</b>
          <small>${esc(from?.city || from?.name || '')}</small>
          <small class="fc-time">${timeFmt.format(f.depMs)} UTC</small>
        </div>
        <div class="fc-bar"><div class="fc-bar-fill"></div><span class="fc-plane">✈</span></div>
        <div class="fc-ap fc-ap-to">
          <b>${esc(f.to)}</b>
          <small>${esc(to?.city || to?.name || '')}</small>
          <small class="fc-time">${timeFmt.format(f.arrMs)} UTC</small>
        </div>
      </div>
      <div class="fc-grid">
        <span class="fc-k">Avion</span><span class="fc-v">${esc(mfr ? `${mfr.name} ${model?.name}` : (model?.name ?? f.aircraftId))}${f.registration ? ` · ${esc(f.registration)}` : ''}</span>
        ${load}
        <span class="fc-k">Altitude</span><span class="fc-v fc-alt"></span>
        <span class="fc-k">Vitesse</span><span class="fc-v fc-speed"></span>
        <span class="fc-k">Arrivée</span><span class="fc-v fc-eta"></span>
      </div>
      <div class="fc-load" title="Remplissage"><div style="width:${Math.round(ratio * 100)}%"></div></div>
    `;
    card.querySelector('.fc-close')!.addEventListener('click', () => layer.clearSelection());
    card.querySelector('.fc-follow')!.addEventListener('click', () => layer.follow(!layer.isFollowing));
    const img = card.querySelector<HTMLImageElement>('.fc-logo');
    img?.addEventListener('error', () => img.replaceWith(Object.assign(document.createElement('span'), { className: 'fc-dot' })));
    refresh();
  };

  const refresh = () => {
    if (!current) return;
    const t = clock.now();
    const pos = layer.positionOf(current, t);
    const fill = card.querySelector<HTMLDivElement>('.fc-bar-fill');
    const plane = card.querySelector<HTMLSpanElement>('.fc-plane');
    const progress = pos?.progress ?? (t >= current.arrMs ? 1 : 0);
    if (fill) fill.style.width = `${progress * 100}%`;
    if (plane) plane.style.left = `${progress * 100}%`;
    set('.fc-alt', pos ? `${nf.format(pos.altitudeFt)} ft · ${pos.phase}` : 'au sol');
    set('.fc-speed', pos ? `${nf.format(pos.speedKmh)} km/h` : '—');
    const left = Math.max(0, current.arrMs - t);
    const h = Math.floor(left / 3_600_000);
    const m = Math.floor((left % 3_600_000) / 60_000);
    set('.fc-eta', left > 0 ? `dans ${h ? `${h} h ` : ''}${m} min` : 'posé');
    const follow = card.querySelector<HTMLButtonElement>('.fc-follow');
    if (follow) {
      follow.classList.toggle('active', layer.isFollowing);
      follow.setAttribute('aria-pressed', String(layer.isFollowing));
    }
  };

  const set = (sel: string, text: string) => {
    const el = card.querySelector(sel);
    if (el && el.textContent !== text) el.textContent = text;
  };

  layer.onSelect((f) => {
    const same = current && f && current.id === f.id;
    current = f;
    card.hidden = !f;
    if (f && !same) render(f);
    else refresh();
  });

  // Rafraîchit altitude, vitesse et progression 4 fois par seconde.
  setInterval(refresh, 250);
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
