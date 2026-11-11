import { music } from '../audio/music';
import { icon } from './icons';

/**
 * Petit bouton haut-parleur au-dessus du bouton du trafic : coupe ou remet
 * tout le son. Les volumes se règlent dans les paramètres.
 */
export function mountSoundToggle(root: HTMLElement): void {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'hud-btn sound-toggle';
  root.appendChild(btn);

  let shown: boolean | null = null;
  const render = () => {
    if (shown === music.on) return;
    shown = music.on;
    btn.innerHTML = icon(music.on ? 'soundOn' : 'soundOff', 20);
    btn.title = music.on ? 'Couper le son' : 'Remettre le son';
    btn.setAttribute('aria-label', btn.title);
    btn.setAttribute('aria-pressed', String(!music.on));
  };
  btn.addEventListener('click', () => music.setOn(!music.on));
  music.onChange(render);
  render();
}
