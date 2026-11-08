import { music } from '../audio/music';

/**
 * Petit bouton 🔊 / 🔇 au-dessus du bouton du trafic : coupe ou remet tout
 * le son. Les volumes et le morceau se règlent dans l'onglet Ma compagnie.
 */
export function mountSoundToggle(root: HTMLElement): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hud-btn sound-toggle';
  root.appendChild(btn);

  const render = () => {
    btn.textContent = music.on ? '🔊' : '🔇';
    btn.title = music.on ? 'Couper le son' : 'Remettre le son';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(!music.on));
  };
  btn.addEventListener('click', () => music.setOn(!music.on));
  music.onChange(render);
  render();
}
