import type { Countries, CountryInfo } from '../map/countries';
import { flagEmoji } from '../map/countries';
import { icon } from './icons';

/** Petite fiche en bas de l'écran pour le pays touché. */
export function mountCountryCard(root: HTMLElement, countries: Countries): void {
  const card = document.createElement('div');
  card.className = 'country-card';
  card.hidden = true;
  root.appendChild(card);

  countries.onSelect((c: CountryInfo | null) => {
    if (!c) {
      card.hidden = true;
      return;
    }
    card.hidden = false;
    card.innerHTML = `
      <span class="country-flag">${flagEmoji(c.iso)}</span>
      <div class="country-text">
        <strong>${escapeHtml(c.nom)}</strong>
        <small>Pays sélectionné</small>
      </div>
      <button type="button" class="hud-btn country-close" aria-label="Fermer">${icon('close', 18)}</button>
    `;
    card.querySelector('.country-close')!.addEventListener('click', () => countries.clearSelection());
  });
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
