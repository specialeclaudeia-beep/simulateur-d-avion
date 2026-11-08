/**
 * Ma compagnie : identité, installation du jeu comme une appli, chiffres
 * clés, classement face aux vraies compagnies, réglages, journal des
 * événements et sauvegarde (code à copier-coller, export et import d'un
 * fichier, nouvelle partie).
 */
import * as act from '../../../game/actions';
import { DIFFICULTIES } from '../../../game/config';
import { exportFileName, parseSave, serialize } from '../../../game/save';
import type { LogEntry } from '../../../game/state';
import { music } from '../../../audio/music';
import { canInstall, install, isInstalled } from '../../../pwa';
import { btn, compact, dateLong, esc, flagEmoji, kv, money, num, section, when } from '../dom';
import { logoHtml } from '../logo';
import type { Ui, View } from '../ui';

export interface CompanyHooks {
  /** Le joueur veut recommencer (la sauvegarde actuelle sera effacée). */
  newGame(): void;
  /** Une sauvegarde importée vient d'être chargée. */
  loaded(): void;
}

const LOG_ICON: Record<LogEntry['kind'], string> = { info: '•', good: '✅', bad: '⚠️', money: '💰' };
const JOURNAL_SIZE = 40;

/** Rang qu'aurait la compagnie parmi les vraies, selon son nombre de lignes. */
function ranking(ui: Ui): { rank: number; total: number; neighbour: string | null } {
  const lines = ui.game.state.lines.length;
  const airlines = ui.game.data.airlines.filter((a) => a.routes > 0).sort((a, b) => b.routes - a.routes);
  const rank = 1 + airlines.filter((a) => a.routes > lines).length;
  const neighbour = airlines[rank - 2]?.name ?? null;
  return { rank, total: airlines.length + 1, neighbour };
}

/** Installer le jeu comme une appli : rien à afficher s'il l'est déjà. */
function installSection(): string {
  if (isInstalled()) return '';
  return section(
    'Appli',
    canInstall()
      ? `<p class="g-small">Installe le jeu sur ton écran d’accueil : il s’ouvrira en plein écran, comme une appli, même sans connexion.</p>
         ${btn('📲 Installer le jeu', 'install')}`
      : '<p class="g-small">Pour installer le jeu comme une appli : menu ⋮ de Chrome, puis « Installer l’application » (ou « Ajouter à l’écran d’accueil »). Il s’ouvrira en plein écran, même sans connexion.</p>',
  );
}

export function companyView(ui: Ui, hooks: CompanyHooks): View {
  return {
    tab: 'company',
    live: true,
    title: () => ui.game.state.company.name,
    render() {
      const s = ui.game.state;
      const d = ui.game.data;
      const c = s.company;
      const now = ui.now;
      const country = d.country(c.country);
      const r = ranking(ui);
      const st = s.settings;
      const journal = s.log
        .slice(0, JOURNAL_SIZE)
        .map((e) => `<li class="${e.kind}"><span class="g-log-icon">${LOG_ICON[e.kind]}</span><span>${esc(e.text)}</span><time>${esc(when(e.t, now))}</time></li>`)
        .join('');
      return `
        <div class="g-card g-company" style="--company:${esc(c.color)}">
          <span class="g-company-logo">${logoHtml(c.logo, c.code, 64)}</span>
          <span><b>${esc(c.name)}</b><small>Code ${esc(c.code)} · ${flagEmoji(c.country)} ${esc(country?.name ?? c.country)} · fondée le ${esc(dateLong(c.founded))}</small>
          <small>Niveau ${esc(DIFFICULTIES[c.difficulty].label)}</small></span>
        </div>
        ${installSection()}
        ${section(
          'En chiffres',
          kv([
            ['Valeur de la compagnie', money(act.companyValue(ui.ctx, now))],
            ['Hubs · lignes · avions', `${s.hubs.length} · ${s.lines.length} · ${s.aircraft.length}`],
            ['Pilotes', num(s.pilots.length)],
            ['Vols effectués', num(s.stats.flights)],
            ['Passagers transportés', num(s.stats.pax)],
            ['Distance parcourue', `${compact(s.stats.km)} km`],
            ['Recettes totales', money(s.stats.revenue)],
          ]),
        )}
        ${section(
          'Classement mondial',
          `<p>Avec <b>${s.lines.length}</b> ligne(s), ta compagnie serait <b>${num(r.rank)}<sup>e</sup></b> sur ${num(r.total)} compagnies réelles${r.neighbour ? `, juste derrière ${esc(r.neighbour)}` : ' : la première du monde !'}.</p>`,
        )}
        ${section(
          'Réglages',
          `<label class="g-toggle"><input type="checkbox" data-in="autoMaintenance"${st.autoMaintenance ? ' checked' : ''}><span>Révision automatique au hub quand l’état passe sous
             <select class="g-input inline" data-in="maintenanceThreshold">${[40, 50, 60, 70, 80].map((v) => `<option value="${v}"${v === st.maintenanceThreshold ? ' selected' : ''}>${v}\u202f%</option>`).join('')}</select></span></label>
           <label class="g-toggle"><input type="checkbox" data-in="autoRepair"${st.autoRepair ? ' checked' : ''}><span>Réparer automatiquement les pannes</span></label>
           <label class="g-toggle"><input type="checkbox" data-in="offlineProgress"${st.offlineProgress ? ' checked' : ''}><span>Le temps continue quand le jeu est fermé (jusqu’à 7 jours, à vitesse réelle)</span></label>`,
        )}
        ${section(
          'Son',
          `<label class="g-toggle"><input type="checkbox" data-in="musicOn"${music.on ? ' checked' : ''}><span>Musique</span></label>
           <label class="g-volume"><span>Volume</span><input type="range" min="0" max="100" step="5" value="${Math.round(music.volume * 100)}" data-in="musicVolume" aria-label="Volume de la musique"></label>
           <p class="g-small">${music.on ? `${music.playing ? '♪ En cours' : 'Prochain morceau'} : <b>${esc(music.track.title)}</b>` : 'Musique coupée.'}</p>
           ${btn('⏭ Morceau suivant', 'nextTrack', { cls: 'ghost' })}`,
        )}
        ${section('Journal', journal ? `<ul class="g-log">${journal}</ul>` : '<p class="g-small">Rien pour l’instant.</p>')}
        ${section(
          'Sauvegarde',
          `<p class="g-small">La partie s’enregistre toute seule dans ce navigateur, et chaque navigateur garde la sienne. Pour la continuer ailleurs (autre navigateur, appli installée, autre appareil) : copie son code ici et colle-le là-bas, ou passe par un fichier.</p>
           <div class="g-actions">
             ${btn('📋 Copier le code', 'copy', { cls: 'ghost' })}
             ${btn('📥 Coller un code', 'paste', { cls: 'ghost' })}
           </div>
           <div class="g-actions">
             ${btn('⬇️ Exporter la partie', 'export', { cls: 'ghost' })}
             <label class="g-btn ghost g-file">⬆️ Importer une partie<input type="file" accept="application/json,.json" data-in="import"></label>
           </div>
           ${btn('Nouvelle partie', 'new', { cls: 'ghost danger' })}`,
        )}
      `;
    },
    input(el, final) {
      const key = el.dataset.in!;
      if (key === 'import' && final) {
        void importSave(ui, el as HTMLInputElement, hooks);
        return;
      }
      if (key === 'musicVolume') {
        music.setVolume(Number(el.value) / 100);
        return;
      }
      if (!final) return;
      if (key === 'musicOn') {
        music.setOn((el as HTMLInputElement).checked);
        return;
      }
      if (key === 'maintenanceThreshold') ui.act(act.updateSettings, { maintenanceThreshold: Number(el.value) });
      else if (key === 'autoMaintenance' || key === 'autoRepair' || key === 'offlineProgress') {
        ui.act(act.updateSettings, { [key]: (el as HTMLInputElement).checked });
      }
    },
    action(a) {
      if (a === 'export') exportSave(ui);
      else if (a === 'nextTrack') music.next();
      else if (a === 'copy') void copySaveCode(ui);
      else if (a === 'paste') void pasteSaveCode(ui, hooks);
      else if (a === 'install') {
        void install().then((ok) => {
          if (ok) ui.toast('Le jeu s’installe sur ton écran d’accueil.', 'good');
        });
      } else if (a === 'new') {
        void ui
          .confirm({
            title: 'Recommencer une partie ?',
            text: 'La partie actuelle sera <b>effacée de ce navigateur</b>. Exporte-la avant si tu veux pouvoir la reprendre.',
            ok: 'Effacer et recommencer',
            danger: true,
          })
          .then((yes) => {
            if (yes) hooks.newGame();
          });
      }
    },
  };
}

function exportSave(ui: Ui): void {
  ui.game.saveNow();
  const state = ui.game.state;
  const blob = new Blob([serialize(state)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(state);
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  ui.toast('Fichier de sauvegarde téléchargé.', 'good');
}

/** Copie la partie sous forme de code, à coller dans un autre navigateur (« Coller un code »). */
async function copySaveCode(ui: Ui): Promise<void> {
  ui.game.saveNow();
  try {
    await navigator.clipboard.writeText(serialize(ui.game.state));
    ui.toast('Code copié. Dans l’autre navigateur : Ma compagnie, puis « Coller un code ».', 'good');
  } catch {
    ui.toast('Ce navigateur refuse la copie : utilise plutôt « Exporter la partie ».', 'bad');
  }
}

/** Charge une partie à partir d'un code collé (copié dans un autre navigateur). */
async function pasteSaveCode(ui: Ui, hooks: CompanyHooks): Promise<void> {
  const code = await ui.prompt({
    title: 'Coller le code d’une partie',
    text: 'Dans l’autre navigateur : Ma compagnie, puis « Copier le code ». Ici, touche longuement la zone ci-dessous, puis « Coller ».',
    value: '',
    placeholder: 'Code de la partie',
    multiline: true,
    ok: 'Charger',
  });
  if (code?.trim()) await importSaveText(ui, code, hooks);
}

async function importSave(ui: Ui, input: HTMLInputElement, hooks: CompanyHooks): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (file) await importSaveText(ui, await file.text(), hooks);
}

/** Remplace la partie en cours par celle d'un fichier ou d'un code, après confirmation. */
async function importSaveText(ui: Ui, text: string, hooks: CompanyHooks): Promise<void> {
  const res = parseSave(text);
  if (!res.ok) {
    ui.toast(res.error, 'bad');
    return;
  }
  const name = res.save.state.company.name;
  const yes = await ui.confirm({
    title: 'Charger cette partie ?',
    text: `« ${esc(name)} » remplacera la partie en cours dans ce navigateur.`,
    ok: 'Charger',
    danger: true,
  });
  if (!yes) return;
  // Pas de « temps écoulé pendant l'absence » pour un fichier importé : on reprend où il s'était arrêté.
  ui.game.loadSave({ ...res.save, savedAtReal: Date.now() });
  ui.game.saveNow();
  hooks.loaded();
  ui.toast(`Partie « ${name} » chargée.`, 'good');
}
