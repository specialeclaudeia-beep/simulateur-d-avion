import { music } from '../audio/music';

/**
 * Petit bouton 🔊 / 🔇 au-dessus du bouton du trafic : coupe ou remet la
 * musique. Le volume et le morceau se règlent dans l'onglet Ma compagnie.
 */
export function mountSoundToggle(root: HTMLElement): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hud-btn sound-toggle';
  root.appendChild(btn);

  const render = () => {
    btn.textContent = music.on ? '🔊' : '🔇';
    btn.title = music.on ? 'Couper la musique' : 'Remettre la musique';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(!music.on));
  };
  btn.addEventListener('click', () => music.setOn(!music.on));
  music.onChange(render);
  render();
}
