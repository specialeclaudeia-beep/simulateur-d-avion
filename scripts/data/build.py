#!/usr/bin/env python3
"""Construit les fichiers JSON du jeu (dossier data/) à partir du cache de fetch.py.

Usage :
  python3 scripts/data/fetch.py      # télécharge les sources (une fois)
  python3 scripts/data/build.py      # génère data/*.json

Dépendances : Python 3.10+, pandas et lxml (uniquement pour lire les tableaux Wikipédia).
Toutes les règles de calcul (classement, taille, prix des hubs) sont dans ce fichier
et documentées dans data/README.md.
"""
import csv
import datetime as dt
import json
import math
import re
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
CACHE = HERE / ".cache"
CURATED = HERE / "curated"
OUT = HERE.parent.parent / "data"

LOGO_FALLBACK = "https://pics.avs.io/200/80/{iata}.png"


def dump(name, obj):
    path = OUT / name
    text = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    path.write_text(text + "\n", encoding="utf-8")
    print(f"  data/{name}: {len(text) / 1e3:.0f} Ko")


def read_csv(name):
    with open(CACHE / name, newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def num(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- pays de base
def load_country_names():
    """Code ISO -> {fr, en, continent} (OurAirports + libellés français Wikidata)."""
    countries = {}
    for r in read_csv("countries.csv"):
        countries[r["code"]] = {"en": r["name"], "continent": r["continent"], "fr": None}
    by_iso = defaultdict(list)
    for r in read_csv("wd_countries.csv"):
        by_iso[r["iso"]].append(r)
    for iso, c in countries.items():
        rows = by_iso.get(iso, [])
        exact = [r for r in rows if r["en"] == c["en"] and r["fr"]]
        anyfr = [r for r in rows if r["fr"]]
        pick = (exact or anyfr or [None])[0]
        c["fr"] = pick["fr"] if pick else c["en"]
    return countries


# ------------------------------------------------------------- trafic passagers
def wikipedia_busiest():
    """Classement ACI (Wikipédia) : IATA -> (passagers, année). Prend la dernière année publiée."""
    import pandas as pd

    html = (CACHE / "busiest_airports.html").read_text(encoding="utf-8")
    years = [int(y) for y in re.findall(r'<h2 id="(\d{4})_statistics"', html)]
    tables = pd.read_html(CACHE / "busiest_airports.html")
    tables = [t for t in tables if "Total passengers" in t.columns and "Code (IATA/ICAO)" in t.columns]
    result = {}
    for year, t in zip(years, tables):  # du plus récent au plus ancien
        for _, row in t.iterrows():
            code = str(row["Code (IATA/ICAO)"]).split("/")[0].strip()
            m = re.search(r"\d{1,3}(?:,\d{3})+", str(row["Total passengers"]))
            if year >= 2023 and len(code) == 3 and m and code not in result:
                result[code] = (int(m.group(0).replace(",", "")), year)
    return result


# Classements régionaux Wikipédia : (fichier, n° de tableau, année, colonne code IATA ou None,
# début du nom de la colonne passagers). Sans colonne IATA, on rapproche par nom d'aéroport
# dans le même pays. Les chiffres des États-Unis (FAA) comptent les embarquements seuls :
# on ne les utilise pas, Wikidata couvre déjà bien ce pays.
REGIONAL = [
    ("busiest_asia.html", 0, 2025, "Code (IATA)", "Total passengers"),
    ("busiest_africa.html", 3, 2025, "IATA", "Total Passengers 2025"),
    ("busiest_china.html", 0, 2025, "IATA/ICAO", "Passengers"),
    ("busiest_india.html", 1, 2025, "IATA Code", "Passengers 2025"),
    ("busiest_europe.html", 0, 2025, None, "Passengers 2025"),
    ("busiest_latam.html", 1, 2025, None, "Passengers"),
]


def parse_pax(cell):
    text = re.sub(r"\[.*?\]", "", str(cell))
    text = re.sub(r"\.0$", "", text.strip())
    digits = re.sub(r"[^\d]", "", text)
    return int(digits) if digits else None


def norm_name(text):
    import unicodedata

    text = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    text = re.sub(r"\b(international|intl|airport|aeroport|aeropuerto|aeroporto|flughafen|regional)\b", " ", text)
    return " ".join(re.sub(r"[^a-z0-9 ]", " ", text).split())


def wikipedia_regional(candidates_by_country, country_iso):
    """IATA -> (passagers, année) depuis les classements régionaux."""
    import difflib

    import pandas as pd

    out, unmatched = {}, []
    for fname, idx, year, code_col, pax_prefix in REGIONAL:
        t = pd.read_html(CACHE / fname)[idx]
        t.columns = [" ".join(dict.fromkeys(map(str, c))) if isinstance(c, tuple) else str(c) for c in t.columns]
        pax_col = next(c for c in t.columns if c.startswith(pax_prefix))
        for _, row in t.iterrows():
            pax = parse_pax(row[pax_col])
            if not pax or pax < 100_000:
                continue
            if code_col:
                code = str(row[code_col]).split("/")[0].strip()
            else:
                iso = country_iso(str(row["Country"]).strip())
                target = norm_name(row["Airport"])
                best, score = None, 0.0
                for code_, names_ in candidates_by_country.get(iso, []):
                    for n in names_:
                        r = difflib.SequenceMatcher(None, target, n).ratio()
                        tt, nt = set(target.split()), set(n.split())
                        if tt and nt and (tt <= nt or nt <= tt):
                            r = max(r, 0.9)
                        if r > score:
                            best, score = code_, r
                code = best if score >= 0.8 else None
                if not code:
                    unmatched.append(f"{row['Airport']} ({row['Country']})")
                    continue
            if len(code) == 3 and code not in out:
                out[code] = (pax, year)
    if unmatched:
        print(f"  (classements régionaux) {len(unmatched)} aéroports non rapprochés : {', '.join(unmatched[:15])}...")
    return out


def wikidata_pax():
    """IATA -> (passagers, année) depuis Wikidata.

    Règle : la plus récente année >= 2023 ; sinon 2019 (avant Covid) ; sinon la plus
    récente année >= 2010. Si plusieurs valeurs pour une même année, on garde la plus grande.
    """
    per = defaultdict(dict)
    for r in read_csv("wd_airport_pax.csv"):
        pax, date = num(r["pax"]), r["date"]
        if not pax or pax <= 0 or not date:
            continue
        year = int(date[:4])
        code = r["iata"].strip().upper()
        per[code][year] = max(per[code].get(year, 0), pax)
    out = {}
    for code, years in per.items():
        recent = [y for y in years if y >= 2023]
        if recent:
            y = max(recent)
        elif 2019 in years:
            y = 2019
        else:
            ok = [y for y in years if y >= 2010]
            if not ok:
                continue
            y = max(ok)
        out[code] = (int(years[y]), y)
    return out


# --------------------------------------------------------------------- fiscalité
TAX_ALIASES = {
    "United States": "US", "United Kingdom": "GB", "Russia": "RU", "South Korea": "KR",
    "North Korea": "KP", "Czech Republic": "CZ", "Ivory Coast": "CI", "Côte d'Ivoire": "CI",
    "Democratic Republic of the Congo": "CD", "Republic of the Congo": "CG", "Iran": "IR",
    "Syria": "SY", "Laos": "LA", "Vietnam": "VN", "Taiwan": "TW", "Moldova": "MD",
    "Tanzania": "TZ", "Bolivia": "BO", "Venezuela": "VE", "Brunei": "BN", "Macau": "MO",
    "Hong Kong": "HK", "Palestine": "PS", "East Timor": "TL", "Timor-Leste": "TL",
    "Cape Verde": "CV", "Eswatini": "SZ", "Swaziland": "SZ", "Micronesia": "FM",
    "North Macedonia": "MK", "Bahamas": "BS", "Gambia": "GM", "Netherlands": "NL",
    "Philippines": "PH", "Sint Maarten": "SX", "Curaçao": "CW", "Kosovo": "XK",
    "Turkey": "TR", "Türkiye": "TR", "Saint Kitts and Nevis": "KN", "Saint Lucia": "LC",
    "Saint Vincent and the Grenadines": "VC", "São Tomé and Príncipe": "ST",
    "Sao Tome and Principe": "ST", "Myanmar": "MM", "Burma": "MM", "Vatican City": "VA",
    "United States Virgin Islands": "VI", "British Virgin Islands": "VG",
    "Falkland Islands": "FK", "DR Congo": "CD", "Congo": "CG", "Eswatini (Swaziland)": "SZ",
    "Federated States of Micronesia": "FM", "Pitcairn Islands": "PN", "Svalbard": "SJ", "Isle of Man": "IM", "Guernsey": "GG", "Jersey": "JE",
}


# Territoires sans ligne propre dans le tableau Wikipédia : on reprend la fiscalité du pays de rattachement.
TAX_PARENT = {"RE": "FR", "GP": "FR", "MQ": "FR", "YT": "FR", "GF": "FR", "PF": "FR", "NC": "FR",
              "GU": "US", "MP": "US", "BQ": "NL", "CC": "AU", "CX": "AU", "SH": "GB"}

# Noms français plus courants que le libellé Wikidata.
NAME_FR = {"CN": "Chine"}


def parse_rate(cell):
    """'19–26%[9]' -> 26.0 ; '35% (residents) 15% (...)' -> 35.0."""
    text = re.sub(r"\[.*?\]", "", str(cell))
    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:%\s*)?(?:[–\-]\s*(\d+(?:\.\d+)?))?\s*%", text)
    if not m:
        return None
    return float(m.group(2) or m.group(1))


def tax_rates(names):
    import pandas as pd

    tables = pd.read_html(CACHE / "tax_rates.html")
    table = next(t for t in tables if t.shape[0] > 100)
    table.columns = [" ".join(dict.fromkeys(c)) if isinstance(c, tuple) else c for c in table.columns]
    name_col = table.columns[0]
    corp_col = next(c for c in table.columns if c.startswith("Corporate"))
    vat_col = next(c for c in table.columns if c.startswith("VAT"))
    lookup = {v["en"]: k for k, v in names.items()}
    out, missing = {}, []
    for _, row in table.iterrows():
        name = re.sub(r"\[.*?\]", "", str(row[name_col])).strip()
        iso = TAX_ALIASES.get(name) or lookup.get(name)
        if not iso:
            missing.append(name)
            continue
        out[iso] = {"corporateTax": parse_rate(row[corp_col]), "vat": parse_rate(row[vat_col])}
    if missing:
        print(f"  (fiscalité) pays Wikipédia non reconnus : {', '.join(missing)}")
    return out


def world_bank(name):
    data = json.loads((CACHE / name).read_text())[1]
    return {r["country"]["id"]: (r["value"], int(r["date"])) for r in data if r["value"] is not None}


# ------------------------------------------------------------------- aéroports
def ourairports_index():
    by_iata = {}
    for r in read_csv("airports.csv"):
        if r["iata_code"]:
            # en cas de doublon, on garde l'aéroport ouvert avec vols réguliers
            prev = by_iata.get(r["iata_code"])
            score = (r["type"] != "closed", r["scheduled_service"] == "yes")
            if not prev or score > prev[0]:
                by_iata[r["iata_code"]] = (score, r)
    runways = defaultdict(list)
    for r in read_csv("runways.csv"):
        if r["closed"] == "1":
            continue
        length = num(r["length_ft"])
        if length:
            runways[r["airport_ref"]].append(length * 0.3048)
    return {k: v[1] for k, v in by_iata.items()}, runways


TIERS = [  # (seuil passagers/an, niveau, libellé)
    (30_000_000, 5, "méga-hub"),
    (10_000_000, 4, "hub international"),
    (3_000_000, 3, "grand aéroport"),
    (500_000, 2, "aéroport régional"),
    (0, 1, "aéroport local"),
]


def tier_of(pax):
    for threshold, level, _ in TIERS:
        if pax >= threshold:
            return level
    return 1


def country_factor(gdp_pc):
    """Coefficient de prix selon la richesse du pays : 0,6 (pays pauvre) à 1,6 (pays riche)."""
    if not gdp_pc:
        return 1.0
    return max(0.6, min(1.6, (gdp_pc / 12000) ** 0.25))


def round_price(x):
    step = 100_000 if x < 10_000_000 else 1_000_000 if x < 1_000_000_000 else 10_000_000
    return int(round(x / step) * step)


def hub_price(pax, gdp_pc):
    """Prix d'achat d'un hub en USD : 2 M$ + 3,5 $ par passager annuel, ajusté selon le pays."""
    return round_price((2_000_000 + 3.5 * pax) * country_factor(gdp_pc))


def main():
    OUT.mkdir(exist_ok=True)
    names = load_country_names()
    routes_raw = json.loads((CACHE / "airline_routes.json").read_text())
    oa, runways = ourairports_index()
    wiki = wikipedia_busiest()
    wd = wikidata_pax()
    gdp = world_bank("wb_gdp_per_capita.json")
    pop = world_bank("wb_population.json")

    # --- lignes : paires non orientées --------------------------------------
    pairs = {}
    route_count = defaultdict(int)
    activity = defaultdict(int)  # nb de couples (ligne, compagnie) au départ : proxy du trafic
    for origin, ap in routes_raw.items():
        for r in ap["routes"]:
            dest = r["iata"]
            if dest not in routes_raw:
                continue
            carriers = sorted({c["iata"] for c in r["carriers"] if c.get("iata")})
            route_count[origin] += 1
            activity[origin] += max(1, len(carriers))
            a, b = sorted((origin, dest))
            p = pairs.setdefault((a, b), {"km": r["km"], "min": r["min"], "fwd": False, "back": False, "carriers": set()})
            if origin == a:
                p["fwd"] = True
                p["km"], p["min"] = r["km"], r["min"]
            else:
                p["back"] = True
            p["carriers"].update(carriers)

    # --- trafic : réel si connu, sinon estimé -------------------------------
    lookup_iso = {v["en"]: k for k, v in names.items()}

    def country_iso(name):
        return TAX_ALIASES.get(name) or lookup_iso.get(name)

    candidates = defaultdict(list)
    for code, ap in routes_raw.items():
        o = oa.get(code)
        cand = {norm_name(ap["name"])}
        if o:
            cand.add(norm_name(o["name"]))
        candidates[ap["country_code"]].append((code, [c for c in cand if c]))
    regional = wikipedia_regional(candidates, country_iso)

    known = {}
    for code in routes_raw:
        if code in wiki:
            known[code] = (*wiki[code], "aci")
        elif code in regional:
            known[code] = (*regional[code], "wikipedia")
        elif code in wd:
            known[code] = (*wd[code], "wikidata")
    # régression log(pax) = a + b*log(activité) sur les aéroports aux chiffres fiables
    xs, ys = [], []
    for code, (pax, year, src) in known.items():
        if activity[code] > 0 and year >= 2019:
            xs.append(math.log(activity[code]))
            ys.append(math.log(pax))
    n = len(xs)
    mx, my = sum(xs) / n, sum(ys) / n
    b = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
    a = my - b * mx
    print(f"  modèle d'estimation du trafic : pax ≈ {math.exp(a):.0f} × activité^{b:.2f} (n={n})")

    def estimate(code):
        return int(math.exp(a + b * math.log(max(1, activity[code]))))

    airports = []
    rejected = 0
    for code, ap in routes_raw.items():
        est = estimate(code)
        if code in known:
            pax, year, src = known[code]
            # garde-fou : un code IATA partagé avec un ancien aéroport donne des chiffres absurdes
            if src == "wikidata" and (pax > est * 25 or pax < est / 25):
                pax, year, src = est, None, "estimation"
                rejected += 1
        else:
            pax, year, src = est, None, "estimation"
        o = oa.get(code)
        lat = num(ap.get("latitude")) or (num(o["latitude_deg"]) if o else None)
        lon = num(ap.get("longitude")) or (num(o["longitude_deg"]) if o else None)
        if lat is None or lon is None:
            print(f"  aéroport {code} ignoré : pas de coordonnées")
            continue
        rw = sorted(runways.get(o["id"], []), reverse=True) if o else []
        country = ap["country_code"]
        gdp_pc = gdp.get(country, (None,))[0]
        airports.append({
            "iata": code,
            "icao": ap.get("icao") or (o["icao_code"] if o else None) or None,
            "name": ap["name"],
            "city": ap.get("city_name") or (o["municipality"] if o else None),
            "country": country,
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "elev": ap.get("elevation"),
            "tz": ap.get("timezone"),
            "type": o["type"].replace("_airport", "") if o else None,
            "runways": len(rw),
            "runwayM": int(rw[0]) if rw else None,
            "pax": pax,
            "paxYear": year,
            "paxSrc": src,
            "routes": route_count[code],
            "tier": tier_of(pax),
            "gates": max(2, round(pax / 600_000)),
            "price": hub_price(pax, gdp_pc),
            "wiki": (o["wikipedia_link"] or None) if o else None,
        })
    if rejected:
        print(f"  {rejected} chiffres Wikidata incohérents remplacés par une estimation")

    airports.sort(key=lambda x: -x["pax"])
    rank_in_country = defaultdict(int)
    for i, ap in enumerate(airports, 1):
        ap["rank"] = i
        rank_in_country[ap["country"]] += 1
        ap["rankCountry"] = rank_in_country[ap["country"]]

    # --- compagnies ---------------------------------------------------------
    of = {}
    with open(CACHE / "airlines.dat", encoding="utf-8") as f:
        for row in csv.reader(f):
            if len(row) < 8:
                continue
            _, name, alias, iata, icao, callsign, ctry, active = row[:8]
            iata = iata.strip()
            if len(iata) == 2 and (iata not in of or (active == "Y" and of[iata][6] != "Y")):
                of[iata] = row
    country_by_name = {v["en"]: k for k, v in names.items()}
    logos = {}
    for r in read_csv("wd_airline_logos.csv"):
        alive = not r["dissolved"]
        if r["iata"] not in logos or (alive and not logos[r["iata"]][1]):
            logos[r["iata"]] = (r["logo"].replace("http://", "https://"), alive)
    carrier_names = {}
    carrier_airports = defaultdict(lambda: defaultdict(int))
    for origin, ap in routes_raw.items():
        for r in ap["routes"]:
            for c in r["carriers"]:
                if c.get("iata"):
                    carrier_names.setdefault(c["iata"], c["name"])
                    carrier_airports[c["iata"]][origin] += 1
    airlines = []
    for code, name in sorted(carrier_names.items()):
        row = of.get(code)
        by_ap = carrier_airports[code]
        hub = max(by_ap, key=by_ap.get)
        logo = logos.get(code)
        airlines.append({
            "iata": code,
            "name": name,
            "icao": (row[4] if row and row[4] not in ("\\N", "", "N/A") else None),
            "callsign": (row[5] if row and row[5] not in ("\\N", "") else None),
            "country": (country_by_name.get(row[6]) if row else None) or routes_raw[hub]["country_code"],
            "hub": hub,
            "routes": sum(by_ap.values()),
            "logo": logo[0] if logo and logo[1] else None,
        })

    # --- lignes compactes ---------------------------------------------------
    routes = []
    for (a_, b_), p in sorted(pairs.items()):
        direction = 0 if p["fwd"] and p["back"] else (1 if p["fwd"] else 2)
        routes.append([a_, b_, p["km"], p["min"], direction, sorted(p["carriers"])])

    # --- pays ---------------------------------------------------------------
    taxes = tax_rates(names)
    by_country = defaultdict(list)
    for ap in airports:
        by_country[ap["country"]].append(ap)
    countries = []
    for iso, c in sorted(names.items()):
        aps = by_country.get(iso, [])
        t = taxes.get(iso) or taxes.get(TAX_PARENT.get(iso), {})
        countries.append({
            "code": iso,
            "name": NAME_FR.get(iso, c["fr"]),
            "nameEn": c["en"],
            "continent": c["continent"],
            "corporateTax": t.get("corporateTax"),
            "vat": t.get("vat"),
            "population": pop.get(iso, (None,))[0],
            "gdpPerCapita": round(gdp[iso][0]) if iso in gdp else None,
            "airports": len(aps),
            "hubs": sum(1 for ap in aps if ap["tier"] >= 3),
            "pax": sum(ap["pax"] for ap in aps),
            "topAirport": aps[0]["iata"] if aps else None,
        })

    # --- constructeurs et avions ---------------------------------------------
    mfr_logos = {}
    for r in read_csv("wd_manufacturer_logos.csv"):
        q = r["m"].rsplit("/", 1)[-1]
        mfr_logos.setdefault(q, r["logo"].replace("http://", "https://"))
    manufacturers = json.loads((CURATED / "manufacturers.json").read_text())
    for m in manufacturers:
        m["logo"] = mfr_logos.get(m["wikidata"])
    aircraft = json.loads((CURATED / "aircraft.json").read_text())["models"]
    mfr_ids = {m["id"] for m in manufacturers}
    for ac in aircraft:
        assert ac["mfr"] in mfr_ids, ac["id"]
    ids = [ac["id"] for ac in aircraft]
    assert len(ids) == len(set(ids)), "identifiants d'avion en double"

    dump("airports.json", airports)
    dump("routes.json", routes)
    dump("airlines.json", airlines)
    dump("countries.json", countries)
    dump("manufacturers.json", manufacturers)
    dump("aircraft.json", aircraft)
    src_count = defaultdict(int)
    for ap in airports:
        src_count[ap["paxSrc"]] += 1
    dump("meta.json", {
        "generated": dt.date.today().isoformat(),
        "counts": {
            "airports": len(airports), "routes": len(routes), "airlines": len(airlines),
            "countries": len(countries), "manufacturers": len(manufacturers), "aircraft": len(aircraft),
        },
        "paxSources": dict(src_count),
        "paxEstimateModel": {"a": round(a, 4), "b": round(b, 4), "formula": "pax = exp(a + b*ln(activité))"},
        "tiers": [{"min": t, "level": lvl, "label": lbl} for t, lvl, lbl in TIERS],
        "hubPrice": "arrondi((2 000 000 + 3,5 × passagers) × clamp((PIB par hab / 12 000)^0,25 ; 0,6 ; 1,6)) USD",
        "logoFallback": LOGO_FALLBACK,
    })


if __name__ == "__main__":
    main()
