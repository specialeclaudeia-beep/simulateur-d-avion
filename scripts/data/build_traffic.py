#!/usr/bin/env python3
"""Construit data/traffic.json : le trafic aérien réel qui vole sur la carte.

À lancer après fetch_traffic.py (et après build.py, dont il lit data/*.json) :
    python3 scripts/data/build_traffic.py

Pour chaque compagnie, on obtient :
- ses vrais numéros de vol sur chaque ligne actuelle (base Standing Data de
  Virtual Radar Server, CC0, alimentée par les récepteurs ADS-B),
- sa vraie flotte (immatriculations de la même base), traduite en modèles de
  data/aircraft.json,
- et pour chaque vol, le modèle d'avion le plus plausible (autonomie, longueur de
  piste, taille de la ligne).

Une ligne de data/routes.json qu'aucun numéro de vol connu ne couvre reçoit des vols
estimés (modèle de gravité : trafic des deux aéroports et distance).
"""
import csv
import hashlib
import json
import math
import re
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache"
SDM = CACHE / "sdm"
CURATED = ROOT / "curated"
DATA = ROOT.parent.parent / "data"

# Au plus N vols par jour pour une compagnie sur une ligne dans un sens (la base cumule
# des numéros de vol de plusieurs saisons : on évite de surcharger les grosses lignes).
MAX_PER_DAY = 16

# Vols commerciaux par jour dans le monde (IATA : ~38 millions de vols par an).
TARGET_PER_DAY = 100_000

# Type OACI -> modèle du jeu. Un second modèle sert quand la compagnie est un cargo.
ICAO_TYPES = {
    "A19N": "a319neo", "A20N": "a320neo", "A21N": "a321neo",
    "A318": "a319ceo", "A319": "a319ceo", "A320": "a320ceo", "A321": ("a321ceo", "a321p2f"),
    "A332": ("a330-200", "a330-200f"), "A333": "a330-300", "A338": "a330-800", "A339": "a330-900",
    "A342": "a340-300", "A343": "a340-300", "A345": "a340-600", "A346": "a340-600",
    "A359": "a350-900", "A35K": "a350-1000", "A388": "a380",
    "A306": ("a330-200", "a300-600f"), "A30B": ("a330-200", "a300-600f"), "A310": ("a330-200", "a300-600f"),
    "BCS1": "a220-100", "BCS3": "a220-300",
    "B37M": "b737-7", "B38M": "b737-8", "B39M": "b737-9", "B3XM": "b737-10",
    "B736": "b737-700", "B737": ("b737-700", "b737-800bcf"), "B738": ("b737-800", "b737-800bcf"),
    "B739": "b737-900er", "B733": ("b737-700", "b737-800bcf"), "B734": ("b737-700", "b737-800bcf"),
    "B735": "b737-700", "B712": "b717",
    "B752": ("b757-200", "b757-200f"), "B753": "b757-200",
    "B762": ("b767-300er", "b767-300f"), "B763": ("b767-300er", "b767-300f"), "B764": "b767-300er",
    "B772": "b777-200er", "B77L": ("b777-200er", "b777f"), "B773": "b777-300er", "B77W": "b777-300er",
    "B778": "b777-8", "B779": "b777-9", "B744": ("b747-400", "b747-400f"), "B748": ("b747-8i", "b747-8f"),
    "B788": "b787-8", "B789": "b787-9", "B78X": "b787-10", "MD11": ("md11f", "md11f"),
    "E170": "e170", "E75L": "e175", "E75S": "e175", "E190": "e190", "E195": "e195",
    "E290": "e190-e2", "E295": "e195-e2", "E135": "erj145", "E145": "erj145", "E45X": "erj145",
    "CRJ1": "crj200", "CRJ2": "crj200", "CRJ7": "crj700", "CRJ9": "crj900", "CRJX": "crj900",
    "AT43": "atr42-600", "AT45": "atr42-600", "AT46": "atr42-600",
    "AT72": ("atr72-600", "atr72-600f"), "AT75": ("atr72-600", "atr72-600f"), "AT76": ("atr72-600", "atr72-600f"),
    "DH8A": "dhc8-300", "DH8B": "dhc8-300", "DH8C": "dhc8-300", "DH8D": "dhc8-400", "DHC6": "dhc6-300g",
    "SF34": "saab340", "B190": "b1900d", "AJ27": "c909", "C919": "c919", "SU95": "ssj100", "MC23": "mc21-300",
}

# Codes IATA d'équipement (OpenFlights, routes.dat) -> type OACI, pour les compagnies dont
# on ne connaît pas la flotte par les immatriculations.
IATA_EQUIP = {
    "319": "A319", "320": "A320", "321": "A321", "318": "A318", "32A": "A320", "32B": "A321",
    "32N": "A20N", "32Q": "A21N", "31N": "A19N", "332": "A332", "333": "A333", "330": "A333",
    "342": "A343", "343": "A343", "346": "A346", "359": "A359", "351": "A35K", "388": "A388", "380": "A388",
    "AB6": "A306", "310": "A310", "221": "BCS1", "223": "BCS3", "7M8": "B38M", "7M9": "B39M",
    "73G": "B737", "737": "B737", "73W": "B737", "738": "B738", "73H": "B738", "739": "B739",
    "73J": "B739", "733": "B733", "734": "B734", "735": "B735", "717": "B712", "752": "B752",
    "757": "B752", "753": "B753", "762": "B762", "763": "B763", "767": "B763", "764": "B764",
    "772": "B772", "777": "B772", "77L": "B77L", "773": "B773", "77W": "B77W", "744": "B744",
    "747": "B744", "74H": "B748", "788": "B788", "789": "B789", "787": "B788", "M11": "MD11",
    "E70": "E170", "E75": "E75L", "E7W": "E75L", "E90": "E190", "E95": "E195", "ERJ": "E145",
    "ER4": "E145", "ER3": "E135", "ERD": "E145", "CR2": "CRJ2", "CRJ": "CRJ2", "CR7": "CRJ7",
    "CR9": "CRJ9", "CRK": "CRJX", "AT4": "AT45", "AT5": "AT45", "AT7": "AT72", "ATR": "AT72",
    "AT2": "AT43", "DH1": "DH8A", "DH2": "DH8B", "DH3": "DH8C", "DH4": "DH8D", "DH8": "DH8C",
    "DHT": "DHC6", "SF3": "SF34", "BEH": "B190", "SU9": "SU95",
}

CARGO_AIRLINES = {"FX", "5X", "CV", "PO", "K4", "QY", "D0", "5Y", "CK", "RU", "3S", "LD", "M6", "ER", "GB", "8V", "NC"}

# Types massivement retirés depuis 2014 : on ne les reprend pas des données OpenFlights.
RETIRED = {"a380", "b747-400", "a340-300", "a340-600"}

# Profil de taille par catégorie : distance « idéale » (km) d'utilisation.
CATEGORY_KM = {"regional_turboprop": 400, "regional_jet": 900, "narrowbody": 1800, "widebody": 7500, "jumbo": 9000}


def h(*parts) -> int:
    """Hachage stable (identique d'une génération à l'autre)."""
    return int.from_bytes(hashlib.blake2b("|".join(map(str, parts)).encode(), digest_size=8).digest(), "big")


def read_sdm_csv(path: Path):
    with path.open(encoding="utf-8-sig", newline="") as f:
        yield from csv.DictReader(f)


def sync_catalog() -> None:
    """Recopie les fiches avions et constructeurs (curated/) dans data/ sans relancer build.py,
    en gardant les logos déjà trouvés."""
    old = {m["id"]: m for m in json.loads((DATA / "manufacturers.json").read_text())}
    manufacturers = json.loads((CURATED / "manufacturers.json").read_text())
    for m in manufacturers:
        m["logo"] = old.get(m["id"], {}).get("logo")
    models = json.loads((CURATED / "aircraft.json").read_text())["models"]
    ids = {m["id"] for m in manufacturers}
    assert all(a["mfr"] in ids for a in models)
    for name, obj in (("manufacturers.json", manufacturers), ("aircraft.json", models)):
        (DATA / name).write_text(json.dumps(obj, ensure_ascii=False, separators=(",", ":")))


def main() -> None:
    sync_catalog()
    airports = json.loads((DATA / "airports.json").read_text())
    routes = json.loads((DATA / "routes.json").read_text())
    airlines = json.loads((DATA / "airlines.json").read_text())
    aircraft = {a["id"]: a for a in json.loads((CURATED / "aircraft.json").read_text())["models"]}
    colors = json.loads((CURATED / "airline_colors.json").read_text())["colors"]

    ap_by_icao = {a["icao"]: a for a in airports if a.get("icao")}
    ap = {a["iata"]: a for a in airports}
    al_by_icao = {a["icao"]: a for a in airlines if a.get("icao")}
    is_cargo_airline = {a["iata"]: (a["iata"] in CARGO_AIRLINES or bool(re.search(r"cargo|freight", a["name"], re.I)))
                        for a in airlines}

    # Lignes actuelles : (compagnie, départ, arrivée) -> (km, minutes)
    current = {}
    for a, b, km, minutes, sens, carriers in routes:
        for c in carriers:
            if sens in (0, 1):
                current[(c, a, b)] = (km, minutes)
            if sens in (0, 2):
                current[(c, b, a)] = (km, minutes)

    def to_model(icao_type: str, cargo: bool):
        m = ICAO_TYPES.get(icao_type)
        if m is None:
            return None
        if isinstance(m, tuple):
            return m[1] if cargo else m[0]
        return m

    # --- flottes réelles (immatriculations) -----------------------------------
    fleets = defaultdict(Counter)
    for path in (SDM / "aircraft" / "schema-01").rglob("*.csv"):
        if path.stat().st_size == 0:
            continue
        for r in read_sdm_csv(path):
            al = al_by_icao.get(r.get("AirlineCode") or "")
            if not al:
                continue
            m = to_model(r["ModelICAO"], is_cargo_airline[al["iata"]])
            if m:
                fleets[al["iata"]][m] += 1
    fleet_src = {k: "immatriculations" for k in fleets}
    # Poids de chaque modèle dans la flotte d'une compagnie, pour choisir l'avion d'un vol.
    weights = {c: Counter({m: n / sum(cnt.values()) for m, n in cnt.items()}) for c, cnt in fleets.items()}

    # Complément : équipements des lignes OpenFlights (2014) pour les compagnies sans flotte connue,
    # et équipement exact par ligne quand il existe.
    route_equip = {}
    of_path = CACHE / "openflights_routes.dat"
    if of_path.exists():
        of_fleet = defaultdict(Counter)
        for line in of_path.read_text(encoding="utf-8", errors="replace").splitlines():
            p = line.split(",")
            if len(p) < 9:
                continue
            c, src, dst, equip = p[0], p[2], p[4], p[8].split()
            cargo = is_cargo_airline.get(c, False)
            models = [to_model(IATA_EQUIP[e], cargo) for e in equip if e in IATA_EQUIP]
            models = [m for m in models if m]
            if not models:
                continue
            route_equip[(c, src, dst)] = models
            for m in models:
                of_fleet[c][m] += 1
        # Mélange : les immatriculations (récentes mais partielles) comptent pour 65 %, les
        # équipements de 2014 pour 35 %. Les types massivement retirés depuis (A380, 747,
        # A340) ne sont repris de 2014 que si la compagnie en a encore d'immatriculés.
        for c, cnt in of_fleet.items():
            reg = fleets.get(c, Counter())
            nreg = sum(reg.values())
            old = Counter({m: n for m, n in cnt.items() if m not in RETIRED or m in reg})
            nold = sum(old.values())
            if not nold:
                continue
            if nreg < 3:
                weights[c] = Counter({m: n / nold for m, n in old.items()})
                fleet_src[c] = "lignes OpenFlights"
                continue
            mix = Counter()
            for m, n in reg.items():
                mix[m] += 0.65 * n / nreg
            for m, n in old.items():
                mix[m] += 0.35 * n / nold
            weights[c] = mix
            fleet_src[c] = "immatriculations + OpenFlights"

    # --- vrais numéros de vol --------------------------------------------------
    numbers = defaultdict(list)  # (compagnie, départ, arrivée) -> [numéros]
    for path in (SDM / "routes" / "schema-01").rglob("*.csv"):
        if path.stat().st_size == 0:
            continue
        for r in read_sdm_csv(path):
            al = al_by_icao.get(r["AirlineCode"])
            if not al:
                continue
            codes = r["AirportCodes"].split("-")
            legs = []
            for x in codes:
                a = ap_by_icao.get(x) or ap.get(x)
                legs.append(a["iata"] if a else None)
            for i in range(len(legs) - 1):
                key = (al["iata"], legs[i], legs[i + 1])
                if legs[i] and legs[i + 1] and key in current:
                    numbers[key].append(r["Number"])

    def pick_model(c: str, a: str, b: str, km: float, n_daily: int, salt: str):
        cargo = is_cargo_airline.get(c, False)
        rwy = min(ap[a].get("runwayM") or 9999, ap[b].get("runwayM") or 9999)
        cands = route_equip.get((c, a, b)) or route_equip.get((c, b, a))
        fleet = weights.get(c)
        pool = Counter()
        if fleet:
            pool = Counter(fleet)
            if cands:  # l'équipement connu sur cette ligne (2014) indique la bonne catégorie
                cats = {aircraft[m]["category"] for m in cands}
                same = Counter({m: w for m, w in fleet.items() if aircraft[m]["category"] in cats})
                if same:
                    pool = same
        elif cands:
            pool = Counter(m for m in cands if m not in RETIRED)
        ok = {}
        for m, n in pool.items():
            ac = aircraft[m]
            if ac["rangeKm"] < km * 1.05 or (ac["runwayM"] > rwy * 1.15):
                continue
            ideal = CATEGORY_KM[ac["category"]]
            fit = math.exp(-abs(math.log(max(km, 150) / ideal)) * 0.9)
            ok[m] = n * fit
        if not ok:  # flotte inconnue ou inadaptée : choix générique par distance
            if cargo:
                base = ["atr72-600f"] if km < 900 else ["b737-800bcf"] if km < 3000 else ["b767-300f"] if km < 6000 else ["b777f"]
            elif km < 600 and rwy < 1800:
                base = ["atr72-600", "dhc8-400"]
            elif km < 1200 and n_daily >= 4:
                base = ["e190", "crj900", "a220-300"]
            elif km < 5500:
                base = ["a320ceo", "b737-800", "a320neo", "b737-8", "a321neo"]
            elif km < 11000:
                base = ["b787-9", "a330-300", "b777-300er", "a350-900"]
            else:
                base = ["a350-900", "b777-300er", "b787-9"]
            ok = {m: 1.0 for m in base if aircraft[m]["rangeKm"] >= km}
            if not ok:
                ok = {"a350-1000": 1.0}
        total = sum(ok.values())
        r = (h(salt) % 10_000) / 10_000 * total
        for m, w in sorted(ok.items()):
            r -= w
            if r <= 0:
                return m
        return max(ok, key=ok.get)

    # --- vols de chaque jour ---------------------------------------------------
    # La base des numéros de vol cumule plusieurs saisons (Ryanair y a 10 fois plus de
    # numéros que de vols quotidiens) : elle donne les vrais numéros et le poids de chaque
    # compagnie sur une ligne, mais pas la fréquence. La fréquence d'une ligne vient d'un
    # modèle de gravité (trafic des deux aéroports, distance), recalé pour que le total
    # mondial corresponde aux ~100 000 vols commerciaux par jour (IATA).
    def route_daily(a: str, b: str, km: float) -> float:
        pa, pb = ap[a]["pax"] or 1e5, ap[b]["pax"] or 1e5
        g = math.sqrt(pa * pb) / 1e6
        # Les long-courriers sont bien moins fréquents (~10 % des vols dans le monde).
        dist = 0.6 if km < 250 else 1.0 if km < 1500 else 0.8 if km < 3500 else 0.3 if km < 7000 else 0.22
        return g ** 0.9 * dist

    hub_of = {al["iata"]: al.get("hub") for al in airlines}
    by_pair = defaultdict(list)
    for (c, a, b) in current:
        if a in ap and b in ap:
            by_pair[(a, b)].append(c)
    raw = {}
    for (a, b), carriers in by_pair.items():
        km = current[(carriers[0], a, b)][0]
        total = route_daily(a, b, km)
        # Poids d'une compagnie : ses numéros de vol connus, et bien plus si c'est sa base
        # (Air France à Paris-CDG pèse plus qu'une compagnie étrangère sur la même ligne).
        w = {}
        for c in carriers:
            base = 3.0 if hub_of.get(c) in (a, b) else 1.0
            w[c] = (0.6 + math.log1p(len(set(numbers.get((c, a, b), []))))) * base
        sw = sum(w.values())
        for c in carriers:
            raw[(c, a, b)] = total * w[c] / sw
    scale = TARGET_PER_DAY / sum(raw.values())

    flights = defaultdict(list)  # compagnie -> [[numéro, départ, arrivée, modèle, jours?], ...]
    n_real = n_est = 0
    week = 0.0
    for key, f in sorted(raw.items()):
        c, a, b = key
        km = current[key][0]
        f = min(MAX_PER_DAY if km < 3500 else 3, f * scale)
        daily = int(f)
        frac = f - daily
        # Vols quotidiens, plus éventuellement un vol assuré certains jours de la semaine
        # (masque de 7 bits, lundi = bit 0).
        slots = [127] * daily
        ndays = round(frac * 7)
        if ndays:
            start = h(c, a, b, "jours") % 7
            mask = 0
            for i in range(ndays):
                mask |= 1 << ((start + i * 7 // ndays) % 7)
            slots.append(mask)
        # Numéros purement numériques d'abord (ex. 1234 plutôt que l'indicatif radio 44AZ).
        real = sorted(set(numbers.get(key, [])), key=lambda n: (not n.isdigit(), h(c, n)))
        for i, mask in enumerate(slots):
            if i < len(real):
                n = real[i]
                n_real += 1
            else:
                n = str(100 + h(c, a, b, i) % 8900)
                n_est += 1
            model = pick_model(c, a, b, km, len(slots), f"{c}{n}{a}{b}")
            row = [n, a, b, model]
            if mask != 127:
                row.append(mask)
            flights[c].append(row)
            week += bin(mask).count("1")

    # Couleurs : livrée réelle si connue, sinon teinte stable calculée depuis le code.
    def auto_color(code: str) -> str:
        hue = h(code, "couleur") % 360
        s, l = 0.65, 0.55
        cc = (1 - abs(2 * l - 1)) * s
        x = cc * (1 - abs((hue / 60) % 2 - 1))
        r, g, b = [(cc, x, 0), (x, cc, 0), (0, cc, x), (0, x, cc), (x, 0, cc), (cc, 0, x)][hue // 60]
        m = l - cc / 2
        return "#%02x%02x%02x" % tuple(round((v + m) * 255) for v in (r, g, b))

    out_airlines = {}
    for al in airlines:
        c = al["iata"]
        if c not in flights:
            continue
        fleet = fleets.get(c, Counter())
        out_airlines[c] = {
            "color": colors.get(c) or auto_color(c),
            "cargo": is_cargo_airline[c],
            "fleet": dict(fleet.most_common()),
            "flights": flights[c],
        }

    out = {
        "generated": __import__("datetime").date.today().isoformat(),
        "source": "Standing Data (Virtual Radar Server, CC0) + OpenFlights (ODbL) + data/routes.json",
        "flightsPerDay": round(week / 7),
        "realNumbers": n_real,
        "estimatedNumbers": n_est,
        "airlines": out_airlines,
    }
    (DATA / "traffic.json").write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":")))
    print(f"vols/jour : {round(week / 7)} ; numéros de vol réels : {n_real}, inventés : {n_est}")
    print(f"compagnies : {len(out_airlines)}, flottes connues : {sum(1 for c in out_airlines if out_airlines[c]['fleet'])}")
    print("sources des flottes :", Counter(fleet_src.get(c) for c in out_airlines))
    used = Counter(f[3] for v in flights.values() for f in v)
    print("modèles les plus utilisés :", used.most_common(25))


if __name__ == "__main__":
    main()
