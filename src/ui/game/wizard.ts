/**
 * Création de la compagnie, en 4 étapes :
 *   1. nom, code, couleur et logo ;
 *   2. pays d'administration (impôts, aéroports, trafic) — liste ou toucher le globe ;
 *   3. capital de départ (difficulté) ;
 *   4. premier hub parmi les vrais aéroports du pays, classés par trafic.
 *
 * En mode par échelons, il n'y a pas d'étape « capital » (il est fixé par
 * l'échelon) et on ne propose que les pays et les hubs où le premier échelon
 * est jouable : un petit aéroport relié à au moins deux autres du même pays.
 */
import type { Map as MapLibreMap } from 'maplibre-gl';
import { LEVELS, domesticDests, eligibleCountries, hubsFor, levelGoals } from '../../game/campaign';
import { DIFFICULTIES, DOMESTIC_VAT_MAX, DOMESTIC_VAT_SHARE, FIRST_HUB_BUDGET_SHARE, FIRST_HUB_MIN_LEFT, HUB_START, type Difficulty } from '../../game/config';
import { TIER_LABEL, type Airport, type Country, type GameData } from '../../game/data';
import { suggestCode, type NewGameParams } from '../../game/newGame';
import type { GameMode, Logo, LogoShape } from '../../game/state';
import type { Countries } from '../../map/countries';
import { globeZoom } from '../../map/createMap';
import type { NetworkLayer } from '../../map/networkLayer';
import { icon } from '../icons';
import { compact, esc, flagEmoji, fold, kv, money, note, num, num1, plural, withIcon } from './dom';
import { LOGO_SHAPES, LOGO_SYMBOLS, PALETTE, imageToLogo, logoHtml } from './logo';
import { mapPadding } from './ui';

export interface WizardDeps {
  data: GameData;
  map: MapLibreMap;
  countries: Countries;
  network: NetworkLayer;
  /** Partie libre ou mode par échelons. */
  mode: GameMode;
  /** Partie libre : avec ou sans concurrence. */
  competition: boolean;
  /** Message à afficher en haut (ex. sauvegarde illisible mise de côté). */
  notice?: string;
  onDone(params: NewGameParams): void;
  /** Le joueur abandonne la création (retour à l'accueil). */
  onCancel(): void;
}

/** Pour piloter la création au clavier (touche Échap). */
export interface WizardHandle {
  /** Étape précédente ; à la première étape, abandonne la création. */
  back(): void;
  /** Ferme la création sans rien créer. */
  cancel(): void;
}

type StepId = 'company' | 'country' | 'capital' | 'hub';
const STEP_LABEL: Record<StepId, string> = { company: 'Compagnie', country: 'Pays', capital: 'Capital', hub: 'Premier hub' };
const LIST_LIMIT = 60;

/** Texte lisible sur une couleur de fond (blanc ou presque noir). */
function contrastOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 165 ? '#111827' : '#ffffff';
}

export function runWizard(deps: WizardDeps): WizardHandle {
  const { data, map, countries, network } = deps;
  const campaign = deps.mode === 'echelons';
  const steps: StepId[] = campaign ? ['company', 'country', 'hub'] : ['company', 'country', 'capital', 'hub'];
  const modeText = campaign ? 'Mode par échelons' : `Partie libre ${deps.competition ? 'avec' : 'sans'} concurrence`;

  // ── État du formulaire ──
  const st = {
    step: 0,
    name: '',
    code: '',
    codeTouched: false,
    color: PALETTE[0],
    logo: { kind: 'symbol', symbol: 'plane', shape: 'circle', fg: '#ffffff', bg: PALETTE[0] } as Logo,
    logoBgTouched: false,
    country: null as string | null,
    countrySearch: '',
    difficulty: 'normal' as Difficulty,
    hub: null as string | null,
    hubSearch: '',
  };
  // Mode par échelons : seulement les pays où le premier échelon est jouable.
  const playable = campaign ? eligibleCountries(data, 1) : data.playableCountries();
  const playableSet = new Set(playable.map((c) => c.code));
  const stepId = (): StepId => steps[st.step];
  const capital = (): number => (campaign ? LEVELS[0].capital : DIFFICULTIES[st.difficulty].capital);
  const hubsOf = (country: string): Airport[] => (campaign ? hubsFor(data, country, 1) : data.airportsOfCountry(country));

  // ── Structure ──
  const root = document.createElement('section');
  root.className = 'g-sheet g-wizard';
  root.innerHTML = `
    <header class="g-sheet-head">
      <div class="g-wizard-top">
        <h2 class="g-sheet-title">Nouvelle compagnie <small>${esc(modeText)}</small></h2>
        <button type="button" class="g-icon-btn g-wizard-cancel" aria-label="Abandonner et revenir à l’accueil">${icon('close', 20)}</button>
      </div>
      <ol class="g-steps"></ol>
    </header>
    <div class="g-body"></div>
    <footer class="g-wizard-foot">
      <button type="button" class="g-btn ghost" data-nav="back">${withIcon('back', 'Retour')}</button>
      <button type="button" class="g-btn" data-nav="next"></button>
    </footer>
  `;
  const body = root.querySelector<HTMLElement>('.g-body')!;
  const stepsEl = root.querySelector<HTMLElement>('.g-steps')!;
  const backBtn = root.querySelector<HTMLButtonElement>('[data-nav=back]')!;
  const nextBtn = root.querySelector<HTMLButtonElement>('[data-nav=next]')!;
  const cancelBtn = root.querySelector<HTMLButtonElement>('.g-wizard-cancel')!;
  document.body.appendChild(root);
  document.body.classList.add('wizard-on');

  // ── Rendu des étapes ──

  function render(): void {
    // Aux étapes Pays et Premier hub, le panneau est plus bas pour laisser voir le globe.
    root.dataset.step = stepId();
    stepsEl.innerHTML = steps
      .map((id, i) => `<li class="${i === st.step ? 'on' : i < st.step ? 'done' : ''}" title="${STEP_LABEL[id]}"><span>${i < st.step ? icon('check', 14) : i + 1}</span><small>${STEP_LABEL[id]}</small></li>`)
      .join('');
    body.innerHTML = { company: renderCompany, country: renderCountry, capital: renderCapital, hub: renderHub }[stepId()]();
    body.scrollTop = 0;
    updateFooter();
  }

  let footerKey = '';
  function updateFooter(): void {
    backBtn.style.visibility = st.step === 0 ? 'hidden' : 'visible';
    const last = stepId() === 'hub';
    if (footerKey !== stepId()) {
      footerKey = stepId();
      nextBtn.innerHTML = last ? withIcon('takeoff', 'Acheter ce hub et démarrer') : `<span>Suivant</span>${icon('chevron', 18)}`;
    }
    nextBtn.disabled = !canGoOn();
  }

  function canGoOn(): boolean {
    switch (stepId()) {
      case 'company':
        return st.name.trim().length >= 2 && /^[A-Z0-9]{2}$/.test(st.code);
      case 'country':
        return st.country !== null;
      case 'capital':
        return true;
      default: {
        const a = st.hub && st.country ? hubsOf(st.country).find((x) => x.iata === st.hub) : undefined;
        return !!a && a.price <= capital();
      }
    }
  }

  function logoPreview(size: number): string {
    return logoHtml(st.logo, st.code || '··', size);
  }

  function renderCompany(): string {
    const logo = st.logo;
    const symbolLogo = logo.kind === 'symbol' ? logo : null;
    return `
      ${deps.notice ? note(esc(deps.notice), 'warn') : ''}
      <p class="g-lead">${campaign ? 'Crée ta compagnie aérienne. Tu choisiras ensuite le pays où tout commence, puis ton premier hub : un petit aéroport régional.' : 'Crée ta compagnie aérienne. Tu choisiras ensuite ton pays, ton capital et ton premier hub.'}</p>
      <div class="g-preview" style="--company:${esc(st.color)}">
        <span class="g-preview-logo">${logoPreview(64)}</span>
        <span class="g-preview-text"><strong>${esc(st.name.trim() || 'Ma compagnie')}</strong><small>Vols ${esc(st.code || '··')} 100, ${esc(st.code || '··')} 101…</small></span>
      </div>
      <label class="g-field"><span>Nom de la compagnie</span>
        <input class="g-input" type="text" data-w="name" maxlength="40" placeholder="Ex. Air Breizh" value="${esc(st.name)}" autocomplete="off"></label>
      <label class="g-field"><span>Code à 2 caractères <small>(numéros de vol)</small></span>
        <input class="g-input g-code" type="text" data-w="code" maxlength="2" placeholder="AB" value="${esc(st.code)}" autocomplete="off" autocapitalize="characters"></label>
      <div class="g-field"><span>Couleur de la compagnie</span>
        <div class="g-swatches">${PALETTE.map((c) => `<button type="button" class="g-swatch${c === st.color ? ' on' : ''}" style="background:${c}" data-w="color" data-v="${c}" aria-label="Couleur ${c}"></button>`).join('')}
          <label class="g-swatch g-swatch-custom" aria-label="Autre couleur"><input type="color" data-w="colorCustom" value="${esc(st.color)}">+</label>
        </div>
      </div>
      <div class="g-field"><span>Logo</span>
        <div class="g-symbols">${Object.entries(LOGO_SYMBOLS)
          .map(([id, s]) => {
            const preview: Logo = { kind: 'symbol', symbol: id, shape: symbolLogo?.shape ?? 'circle', fg: symbolLogo?.fg ?? '#fff', bg: symbolLogo?.bg ?? st.color };
            return `<button type="button" class="g-symbol${symbolLogo?.symbol === id ? ' on' : ''}" data-w="symbol" data-v="${id}" aria-label="${s.label}">${logoHtml(preview, st.code || 'AB', 34)}</button>`;
          })
          .join('')}</div>
        <div class="g-chips">${LOGO_SHAPES.map((s) => `<button type="button" class="g-chip${symbolLogo?.shape === s.id ? ' on' : ''}" data-w="shape" data-v="${s.id}">${s.label}</button>`).join('')}</div>
        <div class="g-logo-colors">
          <label>Fond <input type="color" data-w="bg" value="${esc(symbolLogo?.bg ?? st.color)}"></label>
          <label>Dessin <input type="color" data-w="fg" value="${esc(symbolLogo?.fg ?? '#ffffff')}"></label>
          <label class="g-btn ghost small g-file">${withIcon('image', 'Importer une image', 16)}<input type="file" accept="image/*" data-w="image"></label>
          ${logo.kind === 'image' ? `<button type="button" class="g-btn ghost small" data-w="noImage">Retirer l’image</button>` : ''}
        </div>
      </div>
    `;
  }

  function countryRow(c: Country): string {
    const tax = c.corporateTax ?? null;
    return `<button type="button" class="g-row${c.code === st.country ? ' on' : ''}" data-w="country" data-v="${c.code}">
      <span class="g-row-icon g-flag">${flagEmoji(c.code)}</span>
      <span class="g-row-main"><span class="g-row-title">${esc(c.name)}</span>
        <span class="g-row-sub">${campaign ? `${plural(hubsFor(data, c.code, 1).length, 'hub')} de départ` : `${num(data.airportsOfCountry(c.code).length)} aéroports`} · impôt ${tax === null ? '?' : num1(tax)}\u202f%</span></span>
      <span class="g-row-right">${compact(c.pax)} pass./an</span>
    </button>`;
  }

  function renderCountry(): string {
    const sel = st.country ? data.country(st.country) : undefined;
    const q = fold(st.countrySearch.trim());
    const list = q ? playable.filter((c) => fold(c.name).includes(q) || c.code.toLowerCase() === q) : [...playable].sort((a, b) => b.pax - a.pax);
    let details = '';
    if (sel) {
      const airports = data.airportsOfCountry(sel.code);
      const big = airports.filter((a) => a.tier >= 4).length;
      const vat = data.vat(sel.code);
      const domestic = Math.min(DOMESTIC_VAT_MAX * 100, vat * DOMESTIC_VAT_SHARE);
      const coef = data.coef(sel.code);
      details = `
        <div class="g-card g-selected">
          <h3 class="g-h3"><span class="g-flag">${flagEmoji(sel.code)}</span> ${esc(sel.name)}</h3>
          ${kv([
            ['Impôt sur les sociétés', `${num1(data.corporateTax(sel.code))}\u202f% du bénéfice`],
            ['TVA sur les vols intérieurs', `${num(domestic)}\u202f%`],
            ['Aéroports avec des lignes', `${num(airports.length)} (dont ${big} grands hubs)`],
            ['Trafic du pays', `${compact(sel.pax)} passagers par an`],
            ['Prix des billets et salaires', `× ${coef.toFixed(2).replace('.', ',')} <small>(niveau de vie)</small>`],
          ])}
          <p class="g-small">${campaign ? 'Tu y joueras le premier échelon. Aux échelons suivants, tu changeras de pays.' : 'Tes hubs dans ce pays coûtent le prix normal ; ailleurs, 25\u202f% de plus.'}</p>
        </div>`;
    }
    return `
      <p class="g-lead">${campaign ? 'Dans quel pays commencer ? Il fixe tes impôts et tes premiers aéroports.' : 'Où installer le siège ? Le pays fixe tes impôts et la liste des hubs possibles.'} <b>Touche un pays sur le globe</b> ou cherche-le.</p>
      ${details}
      <input class="g-input" type="search" data-w="countrySearch" placeholder="Rechercher un pays…" value="${esc(st.countrySearch)}">
      <p class="g-small">${q ? `${plural(list.length, 'résultat')}` : 'Classés par trafic aérien'}</p>
      <div class="g-list">${list.map(countryRow).join('')}</div>
    `;
  }

  function renderCapital(): string {
    return `
      <p class="g-lead">Avec combien d’argent démarres-tu ? Le premier hub se paie avec ce capital.</p>
      <div class="g-options">${(Object.keys(DIFFICULTIES) as Difficulty[])
        .map((d) => {
          const o = DIFFICULTIES[d];
          return `<button type="button" class="g-option${d === st.difficulty ? ' on' : ''}" data-w="difficulty" data-v="${d}">
            <strong>${o.label}</strong><span class="g-option-money">${money(o.capital)}</span><small>${esc(o.hint)}</small></button>`;
        })
        .join('')}</div>
      <p class="g-small">Tu pourras emprunter à la banque plus tard, selon la valeur de ta compagnie.</p>
    `;
  }

  function hubRow(a: Airport, cap: number): string {
    const tooExpensive = a.price > cap;
    return `<button type="button" class="g-row${a.iata === st.hub ? ' on' : ''}${tooExpensive ? ' dim' : ''}" data-w="hub" data-v="${a.iata}">
      <span class="g-row-icon g-rank">${a.rankCountry}</span>
      <span class="g-row-main"><span class="g-row-title">${esc(a.city || a.name)} <small>${a.iata}</small></span>
        <span class="g-row-sub">${TIER_LABEL[a.tier]} · ${compact(a.pax)} pass./an · ${num(data.routesFrom(a.iata).length)} destinations</span></span>
      <span class="g-row-right ${tooExpensive ? 'neg' : ''}">${money(a.price)}</span>
    </button>`;
  }

  function renderHub(): string {
    const cap = capital();
    const all = hubsOf(st.country!);
    const q = fold(st.hubSearch.trim());
    const list = q ? all.filter((a) => fold(`${a.city} ${a.name} ${a.iata}`).includes(q)) : all;
    const shown = list.slice(0, LIST_LIMIT);
    const a = st.hub ? all.find((x) => x.iata === st.hub) : undefined;
    let details = '';
    if (a) {
      const routes = data.routesFrom(a.iata).length;
      const home = domesticDests(data, a.iata).length;
      details = `
        <div class="g-card g-selected">
          <h3 class="g-h3">${esc(a.name)} <small>${a.iata}</small></h3>
          ${kv([
            ['Prix', `<b>${money(a.price)}</b>`],
            ['Il te restera', a.price <= cap ? money(cap - a.price) : `<span class="neg">il manque ${money(a.price - cap)}</span>`],
          ])}
          ${a.price <= cap && cap - a.price < (campaign ? cap * 0.4 : FIRST_HUB_MIN_LEFT) ? note('Il ne te resterait presque rien pour acheter un avion : choisis plutôt un hub moins cher.', 'warn') : ''}
          ${kv([
            ['Taille', `${TIER_LABEL[a.tier]} · n° ${a.rank} mondial`],
            ['Passagers par an', num(a.pax)],
            campaign ? ['Lignes intérieures possibles', num(home)] : ['Destinations réelles', num(routes)],
            ...(campaign ? ([['Premier objectif', `relier ${levelGoals(data, 1, a.iata).airports} aéroports du pays`]] as [string, string][]) : []),
            ['Pour commencer', `${plural(Math.min(HUB_START.gates[a.tier], Math.max(1, a.gates)), 'porte')}, ${plural(Math.min(HUB_START.lineSlots[a.tier], routes), 'licence')} de lignes, ${plural(HUB_START.parking[a.tier], 'place')} de parking`],
          ])}
        </div>`;
    }
    return `
      <p class="g-lead">${campaign ? `Ton premier hub : tu démarres avec <b>${money(cap)}</b>, de quoi acheter un petit aéroport et deux avions à hélices.` : 'Ton premier hub, parmi les vrais aéroports du pays. Plus il y a de trafic, plus il coûte cher… et plus il rapporte.'}</p>
      ${details}
      ${all.length > 12 ? `<input class="g-input" type="search" data-w="hubSearch" placeholder="Rechercher une ville, un aéroport…" value="${esc(st.hubSearch)}">` : ''}
      <div class="g-list">${shown.map((x) => hubRow(x, cap)).join('')}</div>
      ${list.length > shown.length ? `<p class="g-small">… et ${list.length - shown.length} autres : précise ta recherche.</p>` : ''}
    `;
  }

  // ── Interactions ──

  function selectCountry(code: string, fly: boolean): void {
    if (st.country !== code) {
      st.country = code;
      st.hub = null;
      st.hubSearch = '';
    }
    if (fly) {
      const top = hubsOf(code)[0] ?? data.airportsOfCountry(code)[0];
      if (top) map.flyTo({ center: [top.lon, top.lat], zoom: 3.6, padding: mapPadding(), duration: 1500 });
    }
    render();
  }

  /** Cadre le globe entier dans la partie de l'écran que le panneau laisse visible. */
  function showGlobe(): void {
    const pad = mapPadding(0);
    const visible = Math.min(window.innerWidth - pad.left - pad.right, window.innerHeight - pad.top - pad.bottom);
    const minSide = Math.min(window.innerWidth, window.innerHeight);
    map.easeTo({ zoom: Math.max(0.6, globeZoom() + Math.log2(visible / minSide)), padding: pad, duration: 900 });
  }

  function selectHub(iata: string): void {
    st.hub = iata;
    const a = data.airport(iata);
    const dests = data
      .routesFrom(iata)
      .slice()
      .sort((x, y) => y.demand - x.demand)
      .map((r) => data.airport(r.a === iata ? r.b : r.a))
      // Mode par échelons : on commence par des lignes intérieures.
      .filter((x) => !campaign || x.country === a.country)
      .slice(0, 80);
    network.setPreview({ focus: a, dests });
    map.flyTo({ center: [a.lon, a.lat], zoom: campaign ? 4.6 : 4, padding: mapPadding(), duration: 1500 });
    render();
  }

  body.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-w]');
    if (!el || el instanceof HTMLInputElement) return;
    const v = el.dataset.v ?? '';
    switch (el.dataset.w) {
      case 'color': {
        st.color = v;
        if (st.logo.kind === 'symbol' && !st.logoBgTouched) st.logo = { ...st.logo, bg: v, fg: contrastOn(v) };
        break;
      }
      case 'symbol':
        st.logo = st.logo.kind === 'symbol' ? { ...st.logo, symbol: v } : { kind: 'symbol', symbol: v, shape: 'circle', fg: contrastOn(st.color), bg: st.color };
        break;
      case 'shape':
        if (st.logo.kind === 'symbol') st.logo = { ...st.logo, shape: v as LogoShape };
        break;
      case 'noImage':
        st.logo = { kind: 'symbol', symbol: 'plane', shape: 'circle', fg: contrastOn(st.color), bg: st.color };
        break;
      case 'country':
        selectCountry(v, true);
        return;
      case 'difficulty':
        st.difficulty = v as Difficulty;
        break;
      case 'hub':
        selectHub(v);
        return;
      default:
        return;
    }
    render();
  });

  body.addEventListener('input', (e) => {
    const el = e.target as HTMLInputElement;
    switch (el.dataset.w) {
      case 'name':
        st.name = el.value;
        if (!st.codeTouched) st.code = suggestCode(el.value.trim() || 'X');
        if (!el.value.trim() && !st.codeTouched) st.code = '';
        refreshCompanyPreview();
        return;
      case 'code': {
        const clean = el.value
          .normalize('NFD')
          .replace(/[̀-ͯ]/g, '')
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, '');
        if (clean !== el.value) el.value = clean;
        st.code = clean;
        st.codeTouched = clean.length > 0;
        refreshCompanyPreview();
        return;
      }
      case 'countrySearch':
      case 'hubSearch': {
        st[el.dataset.w] = el.value;
        const pos = el.selectionStart;
        render();
        const again = body.querySelector<HTMLInputElement>(`[data-w=${el.dataset.w}]`);
        again?.focus();
        if (again && pos !== null) again.setSelectionRange(pos, pos);
        return;
      }
    }
  });

  body.addEventListener('change', async (e) => {
    const el = e.target as HTMLInputElement;
    switch (el.dataset.w) {
      case 'colorCustom':
        st.color = el.value;
        if (st.logo.kind === 'symbol' && !st.logoBgTouched) st.logo = { ...st.logo, bg: el.value, fg: contrastOn(el.value) };
        break;
      case 'bg':
        if (st.logo.kind === 'symbol') st.logo = { ...st.logo, bg: el.value };
        st.logoBgTouched = true;
        break;
      case 'fg':
        if (st.logo.kind === 'symbol') st.logo = { ...st.logo, fg: el.value };
        break;
      case 'image': {
        const file = el.files?.[0];
        if (!file) return;
        try {
          st.logo = await imageToLogo(file);
        } catch (err) {
          alertInline(err instanceof Error ? err.message : 'Image illisible.');
          return;
        }
        break;
      }
      default:
        return;
    }
    render();
  });

  /** Met à jour l'aperçu sans redessiner les champs (le clavier reste ouvert). */
  function refreshCompanyPreview(): void {
    const preview = body.querySelector('.g-preview');
    if (preview) {
      preview.querySelector('.g-preview-logo')!.innerHTML = logoPreview(64);
      preview.querySelector('strong')!.textContent = st.name.trim() || 'Ma compagnie';
      preview.querySelector('small')!.textContent = `Vols ${st.code || '··'} 100, ${st.code || '··'} 101…`;
    }
    const codeInput = body.querySelector<HTMLInputElement>('[data-w=code]');
    if (codeInput && document.activeElement !== codeInput) codeInput.value = st.code;
    updateFooter();
  }

  function alertInline(text: string): void {
    body.querySelector('.g-inline-alert')?.remove();
    body.insertAdjacentHTML('afterbegin', `<p class="g-note bad g-inline-alert">${esc(text)}</p>`);
  }

  function goBack(): void {
    if (st.step === 0) return;
    st.step--;
    if (stepId() !== 'hub') network.setPreview(null);
    render();
  }

  backBtn.addEventListener('click', goBack);

  nextBtn.addEventListener('click', () => {
    if (!canGoOn()) return;
    if (stepId() !== 'hub') {
      st.step++;
      render();
      if (stepId() === 'country' && !st.country) showGlobe();
      if (stepId() === 'hub' && !st.hub) {
        // Propose d'emblée le plus grand hub qui laisse de quoi acheter des avions.
        const cap = capital();
        const airports = hubsOf(st.country!);
        const best = airports.find((a) => a.price <= cap * FIRST_HUB_BUDGET_SHARE) ?? airports.find((a) => a.price <= cap);
        if (best) selectHub(best.iata);
      }
      return;
    }
    finish();
  });

  // Abandonner : un premier toucher demande confirmation (le bouton change), le second ferme.
  let cancelArmed = 0;
  cancelBtn.addEventListener('click', () => {
    const typed = st.name.trim().length > 0;
    if (typed && !cancelArmed) {
      cancelBtn.classList.add('armed');
      cancelBtn.innerHTML = '<span>Abandonner ?</span>';
      cancelArmed = window.setTimeout(() => {
        cancelArmed = 0;
        cancelBtn.classList.remove('armed');
        cancelBtn.innerHTML = icon('close', 20);
      }, 3000);
      return;
    }
    cancel();
  });

  // Toucher un pays sur le globe pendant l'étape « Pays ».
  const offCountry = countries.onSelect((c) => {
    if (!c || stepId() !== 'country') return;
    if (playableSet.has(c.iso)) selectCountry(c.iso, false);
    else if (campaign && data.playableCountries().some((x) => x.code === c.iso)) alertInline(`${c.nom} : aucun petit hub assez bien relié au reste du pays pour le premier échelon.`);
    else alertInline(`${c.nom} : aucun aéroport avec des lignes régulières dans nos données.`);
  });

  function close(): void {
    window.clearTimeout(cancelArmed);
    offCountry();
    countries.clearSelection();
    network.setPreview(null);
    root.remove();
    document.body.classList.remove('wizard-on');
  }

  function cancel(): void {
    if (!root.isConnected) return;
    close();
    deps.onCancel();
  }

  function finish(): void {
    const params: NewGameParams = {
      name: st.name.trim(),
      code: st.code,
      color: st.color,
      logo: st.logo,
      country: st.country!,
      difficulty: st.difficulty,
      hub: st.hub!,
      mode: deps.mode,
      competition: deps.competition,
    };
    close();
    deps.onDone(params);
  }

  render();
  return {
    // À la première étape, comme le bouton ✕ : un nom déjà écrit demande une confirmation.
    back: () => (st.step === 0 ? cancelBtn.click() : goBack()),
    cancel,
  };
}
