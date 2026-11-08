/**
 * Ma compagnie : identité, installation du jeu comme une appli, chiffres
 * clés, classement face aux vraies compagnies, réglages, journal des
 * événements et sauvegarde (export, import, nouvelle partie).
 */
import * as act from '../../../game/actions';
import { DIFFICULTIES } from '../../../game/config';
import { exportFileName, parseSave, serialize } from '../../../game/save';
import type { LogEntry } from '../../../game/state';
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
        ${section('Journal', journal ? `<ul class="g-log">${journal}</ul>` : '<p class="g-small">Rien pour l’instant.</p>')}
        ${section(
          'Sauvegarde',
          `<p class="g-small">La partie s’enregistre toute seule dans ce navigateur. Exporte-la pour la garder en lieu sûr ou la continuer sur un autre appareil.</p>
           <div class="g-actions">
             ${btn('⬇️ Exporter la partie', 'export', { cls: 'ghost' })}
             <label class="g-btn ghost g-file">⬆️ Importer une partie<input type="file" accept="application/json,.json" data-in="import"></label>
           </div>
           ${btn('Nouvelle partie', 'new', { cls: 'ghost danger' })}`,
        )}
      `;
    },
    input(el, final) {
      if (!final) return;
      const key = el.dataset.in!;
      if (key === 'import') {
        void importSave(ui, el as HTMLInputElement, hooks);
        return;
      }
      if (key === 'maintenanceThreshold') ui.act(act.updateSettings, { maintenanceThreshold: Number(el.value) });
      else if (key === 'autoMaintenance' || key === 'autoRepair' || key === 'offlineProgress') {
        ui.act(act.updateSettings, { [key]: (el as HTMLInputElement).checked });
      }
    },
    action(a) {
      if (a === 'export') exportSave(ui);
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

async function importSave(ui: Ui, input: HTMLInputElement, hooks: CompanyHooks): Promise<void> {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  const res = parseSave(await file.text());
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
