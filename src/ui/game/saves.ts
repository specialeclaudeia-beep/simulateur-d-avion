/**
 * Outils communs pour sortir une partie du navigateur ou en faire entrer une :
 * fichier à télécharger, code à copier-coller, et lecture d'une sauvegarde
 * importée (avec la confirmation qui convient quand elle en remplace une).
 *
 * Servent à la fois dans la partie (écran « Ma compagnie ») et à l'accueil
 * (« Mon compte »).
 */
import { SLOT_LABEL, parseSave, slotOf, slotSummary, type SaveFile, type SlotId } from '../../game/save';
import type { GameState } from '../../game/state';
import { levelSpec } from '../../game/campaign';
import { esc } from './dom';
import type { Ui } from './ui';

/** Fait télécharger un texte sous forme de fichier. */
export function downloadText(fileName: string, text: string): void {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Copie un texte dans le presse-papiers ; false si le navigateur refuse. */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Le mode d'une partie, en clair (ex. « Mode par échelons · échelon 2, Inter-régional »). */
export function modeLabel(s: Pick<GameState, 'mode' | 'competition' | 'campaign'>): string {
  if (s.mode === 'echelons') {
    const c = s.campaign;
    if (!c) return SLOT_LABEL.echelons;
    return c.finished ? `${SLOT_LABEL.echelons} · tous les échelons gravis` : `${SLOT_LABEL.echelons} · échelon ${c.level}, ${levelSpec(c.level).name}`;
  }
  return SLOT_LABEL[slotOf(s)];
}

/**
 * Lit une sauvegarde venue d'un fichier ou d'un code. Chaque mode de jeu a son
 * emplacement : la partie importée se range dans celui de son mode, et on
 * demande confirmation si elle y remplace une autre partie.
 *
 * `current` : emplacement de la partie en cours (null à l'accueil).
 * Renvoie la sauvegarde à charger, ou null (illisible, ou refus du joueur).
 */
export async function readImport(ui: Ui, text: string, current: SlotId | null): Promise<SaveFile | null> {
  const res = parseSave(text);
  if (!res.ok) {
    ui.toast(res.error, 'bad');
    return null;
  }
  const state = res.save.state;
  const slot = slotOf(state);
  const name = esc(state.company.name);
  const label = esc(SLOT_LABEL[slot].toLowerCase());
  if (slot === current) {
    const yes = await ui.confirm({
      title: 'Charger cette partie ?',
      text: `« ${name} » remplacera la partie en cours dans ce navigateur.`,
      ok: 'Charger',
      danger: true,
    });
    return yes ? res.save : null;
  }
  const existing = slotSummary(slot);
  if (existing) {
    const yes = await ui.confirm({
      title: 'Remplacer une partie ?',
      text: `« ${name} » est une ${label}. Elle remplacera « ${esc(existing.name)} », déjà enregistrée dans ce mode.`,
      ok: 'Remplacer',
      danger: true,
    });
    return yes ? res.save : null;
  }
  if (current !== null) {
    const yes = await ui.confirm({
      title: 'Charger cette partie ?',
      text: `« ${name} » est une ${label}. Ta partie en cours reste enregistrée : tu la retrouveras à l’accueil.`,
      ok: 'Charger',
    });
    return yes ? res.save : null;
  }
  return res.save;
}
