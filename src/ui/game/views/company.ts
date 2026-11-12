/**
 * Ma compagnie : identité et mode de jeu, objectifs (mode par échelons),
 * installation du jeu comme une appli, chiffres clés, classement face aux
 * vraies compagnies, réglages de la partie, journal des événements et
 * sauvegarde (code à copier-coller, export et import d'un fichier, retour à
 * l'accueil, nouvelle partie).
 */
import * as act from '../../../game/actions';
import { goalsReached, levelSpec } from '../../../game/campaign';
import { DIFFICULTIES } from '../../../game/config';
import { exportFileName, serialize } from '../../../game/save';
import type { CrashFrequency } from '../../../game/safety';
import type { LogEntry } from '../../../game/state';
import { canInstall, install, isInstalled } from '../../../pwa';
import { icon, type IconName } from '../../icons';
import { badge, btn, compact, dateLong, esc, flagEmoji, kv, money, num, row, section, when, withIcon } from '../dom';
import { logoHtml } from '../logo';
import { copyText, downloadText, readImport } from '../saves';
import type { Ui, View } from '../ui';
import { playTime as statsPlayTime, statsView } from './stats';

export interface CompanyHooks {
  /** Recommencer une partie dans le même mode (l'actuelle n'est remplacée qu'à la création de la nouvelle). */
  newGame(): void;
  /** Une sauvegarde importée vient d'être chargée. */
  loaded(): void;
  /** Ouvrir les paramètres (son, graphismes, touches). */
  settings(): void;
  /** Enregistrer et revenir à l'accueil. */
  home(): void;
  /** Mode par échelons : voir les objectifs. */
  goals(): void;
}

const LOG_ICON: Record<LogEntry['kind'], IconName> = { info: 'info', good: 'checkCircle', bad: 'alert', money: 'money' };
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
         ${btn(withIcon('install', 'Installer le jeu'), 'install')}`
      : '<p class="g-small">Pour installer le jeu comme une appli : menu ⋮ de Chrome, puis « Installer l’application » (ou « Ajouter à l’écran d’accueil »). Il s’ouvrira en plein écran, même sans connexion.</p>',
  );
}

/** Le mode de la partie, sous le nom de la compagnie. */
function modeLine(ui: Ui): string {
  const s = ui.game.state;
  const c = s.campaign;
  if (c) return c.finished ? 'Mode par échelons · tous les échelons gravis' : `Mode par échelons · échelon ${c.level}, ${esc(levelSpec(c.level).name)}`;
  return `Partie libre ${s.competition ? 'avec' : 'sans'} concurrence · niveau ${esc(DIFFICULTIES[s.company.difficulty].label.toLowerCase())}`;
}

/** Mode par échelons : raccourci vers les objectifs, en tête de l'écran. */
function goalsRow(ui: Ui): string {
  const c = ui.game.state.campaign;
  if (!c) return '';
  if (c.finished) {
    return `<div class="g-list">${row({ action: 'goals', icon: icon('trophy', 22), title: 'Campagne terminée', sub: 'Ton parcours, pays par pays' })}</div>`;
  }
  const n = goalsReached(c);
  return `<div class="g-list">${row({
    action: 'goals',
    icon: icon('stairs', 22),
    title: `Objectifs de l’échelon ${c.level}`,
    sub: `${n} objectif${n > 1 ? 's' : ''} atteint${n > 1 ? 's' : ''} sur 3`,
    right: c.cleared ? badge('Réussi', 'good') : '',
  })}</div>`;
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
        .map((e) => `<li class="${e.kind}"><span class="g-log-icon">${icon(LOG_ICON[e.kind], 16)}</span><span>${esc(e.text)}</span><time>${esc(when(e.t, now))}</time></li>`)
        .join('');
      return `
        <div class="g-card g-company" style="--company:${esc(c.color)}">
          <span class="g-company-logo">${logoHtml(c.logo, c.code, 64)}</span>
          <span><b>${esc(c.name)}</b><small>Code ${esc(c.code)} · ${flagEmoji(c.country)} ${esc(country?.name ?? c.country)} · fondée le ${esc(dateLong(c.founded))}</small>
          <small>${modeLine(ui)}</small></span>
        </div>
        ${goalsRow(ui)}
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
          ]) +
            `<div class="g-list">${row({ action: 'stats', icon: icon('chart', 22), title: 'Toutes les statistiques', sub: `Temps de jeu ${statsPlayTime(s.stats.playMs)} · ${num(s.stats.hours)} h de vol · ${num(s.stats.crashes)} crash${s.stats.crashes > 1 ? 's' : ''}` })}</div>`,
        )}
        ${section(
          'Classement mondial',
          `<p>Avec <b>${s.lines.length}</b> ${s.lines.length > 1 ? 'lignes' : 'ligne'}, ta compagnie serait <b>${num(r.rank)}<sup>e</sup></b> sur ${num(r.total)} compagnies réelles${r.neighbour ? `, juste derrière ${esc(r.neighbour)}` : ' : la première du monde !'}.</p>`,
        )}
        ${section(
          'Réglages de la partie',
          `<label class="g-toggle"><input type="checkbox" data-in="autoMaintenance"${st.autoMaintenance ? ' checked' : ''}><span>Révision automatique au hub quand l’état passe sous
             <select class="g-input inline" data-in="maintenanceThreshold">${[40, 50, 60, 70, 80].map((v) => `<option value="${v}"${v === st.maintenanceThreshold ? ' selected' : ''}>${v} %</option>`).join('')}</select></span></label>
           <label class="g-toggle"><input type="checkbox" data-in="autoRepair"${st.autoRepair ? ' checked' : ''}><span>Réparer automatiquement les pannes</span></label>
           <label class="g-toggle"><input type="checkbox" data-in="offlineProgress"${st.offlineProgress ? ' checked' : ''}><span>Le temps continue quand le jeu est fermé (jusqu’à 7 jours, à vitesse réelle)</span></label>
           <label class="g-toggle"><span>Accidents d’avion
             <select class="g-input inline" data-in="crashFrequency">${(
               [
                 ['realiste', 'réalistes (vraies statistiques)'],
                 ['frequent', 'fréquents (× 100)'],
                 ['aucun', 'désactivés'],
               ] as const
             )
               .map(([v, l]) => `<option value="${v}"${v === st.crashFrequency ? ' selected' : ''}>${l}</option>`)
               .join('')}</select></span></label>
           <div class="g-list">${row({ action: 'settings', icon: icon('gear', 22), title: 'Paramètres du jeu', sub: 'Son, graphismes, images par seconde, touches du clavier' })}</div>`,
        )}
        ${section('Journal', journal ? `<ul class="g-log">${journal}</ul>` : '<p class="g-small">Rien pour l’instant.</p>')}
        ${section(
          'Sauvegarde',
          `<p class="g-small">La partie s’enregistre toute seule dans ce navigateur, et chaque navigateur garde les siennes. Pour la continuer ailleurs (autre navigateur, appli installée, autre appareil) : copie son code ici et colle-le là-bas, ou passe par un fichier.</p>
           <div class="g-actions">
             ${btn(withIcon('copy', 'Copier le code'), 'copy', { cls: 'ghost' })}
             ${btn(withIcon('paste', 'Coller un code'), 'paste', { cls: 'ghost' })}
           </div>
           <div class="g-actions">
             ${btn(withIcon('download', 'Exporter la partie'), 'export', { cls: 'ghost' })}
             <label class="g-btn ghost g-file">${withIcon('upload', 'Importer une partie')}<input type="file" accept="application/json,.json" data-in="import"></label>
           </div>
           ${btn(withIcon('home', 'Enregistrer et revenir à l’accueil'), 'home', { cls: 'ghost' })}
           ${btn(withIcon('plus', 'Nouvelle partie'), 'new', { cls: 'ghost danger' })}`,
        )}
      `;
    },
    input(el, final) {
      const key = el.dataset.in!;
      if (key === 'import') {
        if (final) void importSave(ui, el as HTMLInputElement, hooks);
        return;
      }
      if (!final) return;
      if (key === 'crashFrequency') ui.act(act.updateSettings, { crashFrequency: el.value as CrashFrequency });
      else if (key === 'maintenanceThreshold') ui.act(act.updateSettings, { maintenanceThreshold: Number(el.value) });
      else if (key === 'autoMaintenance' || key === 'autoRepair' || key === 'offlineProgress') {
        ui.act(act.updateSettings, { [key]: (el as HTMLInputElement).checked });
      }
    },
    action(a) {
      if (a === 'export') exportSave(ui);
      else if (a === 'copy') void copySaveCode(ui);
      else if (a === 'paste') void pasteSaveCode(ui, hooks);
      else if (a === 'goals') hooks.goals();
      else if (a === 'stats') ui.push(statsView(ui));
      else if (a === 'settings') hooks.settings();
      else if (a === 'home') hooks.home();
      else if (a === 'install') {
        void install().then((ok) => {
          if (ok) ui.toast('Le jeu s’installe sur ton écran d’accueil.', 'good');
        });
      } else if (a === 'new') {
        void ui
          .confirm({
            title: 'Recommencer une partie ?',
            text: 'Tu vas créer une nouvelle compagnie dans ce mode de jeu. La partie actuelle sera <b>remplacée</b> dès que la nouvelle sera créée. Exporte-la avant si tu veux pouvoir la reprendre.',
            ok: 'Nouvelle partie',
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
  downloadText(exportFileName(state), serialize(state));
  ui.toast('Fichier de sauvegarde téléchargé.', 'good');
}

/** Copie la partie sous forme de code, à coller dans un autre navigateur (« Coller un code »). */
async function copySaveCode(ui: Ui): Promise<void> {
  ui.game.saveNow();
  if (await copyText(serialize(ui.game.state))) ui.toast('Code copié. Dans l’autre navigateur : Mon compte (à l’accueil), puis « Coller un code ».', 'good');
  else ui.toast('Ce navigateur refuse la copie : utilise plutôt « Exporter la partie ».', 'bad');
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

/** Charge la partie d'un fichier ou d'un code à la place de la partie en cours, après confirmation. */
async function importSaveText(ui: Ui, text: string, hooks: CompanyHooks): Promise<void> {
  const save = await readImport(ui, text, ui.game.slot);
  if (!save) return;
  // La partie en cours reste enregistrée dans son emplacement (sauf si l'importée prend sa place).
  ui.game.saveNow();
  // Pas de « temps écoulé pendant l'absence » pour un fichier importé : on reprend où il s'était arrêté.
  ui.game.loadSave({ ...save, savedAtReal: Date.now() });
  ui.game.saveNow();
  hooks.loaded();
  ui.toast(`Partie « ${save.state.company.name} » chargée.`, 'good');
}
