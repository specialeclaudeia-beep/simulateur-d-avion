import type { AircraftLayer } from '../map/aircraft';
import { icon } from './icons';

/**
 * Petit bouton « 12 345 en vol » : affiche ou masque le trafic des autres
 * compagnies (les avions du joueur restent toujours visibles).
 */
export function mountTrafficToggle(root: HTMLElement, layer: AircraftLayer): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hud-btn traffic-toggle active';
  btn.title = 'Afficher ou masquer le trafic aérien réel';
  btn.setAttribute('aria-pressed', 'true');
  btn.innerHTML = `${icon('plane', 16)}<span></span>`;
  const label = btn.querySelector('span')!;
  root.appendChild(btn);

  const nf = new Intl.NumberFormat('fr-FR');
  const render = () => {
    const n = layer.airborne;
    const text = !layer.showTraffic ? 'trafic masqué' : n ? `${nf.format(n)} en vol` : 'chargement…';
    if (label.textContent !== text) label.textContent = text;
    btn.classList.toggle('active', layer.showTraffic);
    btn.setAttribute('aria-pressed', String(layer.showTraffic));
  };
  btn.addEventListener('click', () => {
    layer.setShowTraffic(!layer.showTraffic);
    render();
  });
  render();
  setInterval(render, 1000);
}
