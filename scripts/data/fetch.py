#!/usr/bin/env python3
"""Télécharge les sources ouvertes brutes dans scripts/data/.cache/.

Usage : python3 scripts/data/fetch.py [--force]

Rien n'est committé depuis le cache : seul build.py produit les fichiers de data/.
"""
import json
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

CACHE = Path(__file__).resolve().parent / ".cache"
UA = "simulateur-compagnie-aerienne-data/1.0 (jeu personnel, non commercial)"

SPARQL = "https://query.wikidata.org/sparql"

# Trafic passagers annuel (propriété P3872 « patronage ») des aéroports ayant un code IATA.
Q_PAX = """
SELECT ?iata ?pax ?date WHERE {
  ?a wdt:P238 ?iata ; p:P3872 ?st .
  ?st ps:P3872 ?pax .
  OPTIONAL { ?st pq:P585 ?date }
}
"""

# Nom français des pays (code ISO 3166-1 alpha-2).
Q_COUNTRIES = """
SELECT ?iso ?fr ?en WHERE {
  ?c wdt:P297 ?iso .
  OPTIONAL { ?c rdfs:label ?fr FILTER(LANG(?fr) = "fr") }
  OPTIONAL { ?c rdfs:label ?en FILTER(LANG(?en) = "en") }
}
"""

# Logos des compagnies aériennes (code IATA P229, logo P154, dissolution P576).
Q_AIRLINE_LOGOS = """
SELECT ?iata ?a ?logo ?dissolved WHERE {
  ?a wdt:P229 ?iata ; wdt:P154 ?logo .
  OPTIONAL { ?a wdt:P576 ?dissolved }
}
"""

# Logos des constructeurs, par identifiant Wikidata (voir curated/manufacturers.json).
def q_manufacturer_logos(qids):
    values = " ".join(f"wd:{q}" for q in qids)
    return f"SELECT ?m ?logo WHERE {{ VALUES ?m {{ {values} }} ?m wdt:P154 ?logo . }}"


SOURCES = {
    # OurAirports : domaine public.
    "airports.csv": "https://davidmegginson.github.io/ourairports-data/airports.csv",
    "runways.csv": "https://davidmegginson.github.io/ourairports-data/runways.csv",
    "countries.csv": "https://davidmegginson.github.io/ourairports-data/countries.csv",
    # Lignes régulières actuelles, mises à jour chaque semaine.
    "airline_routes.json": "https://raw.githubusercontent.com/Jonty/airline-route-data/main/airline_routes.json",
    # OpenFlights (ODbL) : pays, code OACI et indicatif des compagnies.
    "airlines.dat": "https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat",
    # Wikipédia : classements ACI des plus grands aéroports, fiscalité par pays.
    "busiest_airports.html": "https://en.wikipedia.org/wiki/List_of_busiest_airports_by_passenger_traffic",
    "tax_rates.html": "https://en.wikipedia.org/wiki/List_of_countries_by_tax_rates",
    # Classements régionaux (complètent le top mondial pour les aéroports moyens).
    "busiest_europe.html": "https://en.wikipedia.org/wiki/List_of_the_busiest_airports_in_Europe",
    "busiest_asia.html": "https://en.wikipedia.org/wiki/List_of_busiest_airports_in_Asia",
    "busiest_africa.html": "https://en.wikipedia.org/wiki/List_of_the_busiest_airports_in_Africa",
    "busiest_latam.html": "https://en.wikipedia.org/wiki/List_of_the_busiest_airports_in_Latin_America",
    "busiest_china.html": "https://en.wikipedia.org/wiki/List_of_the_busiest_airports_in_China",
    "busiest_india.html": "https://en.wikipedia.org/wiki/List_of_busiest_airports_in_India",
    # Banque mondiale : population et PIB par habitant.
    "wb_population.json": "https://api.worldbank.org/v2/country/all/indicator/SP.POP.TOTL?format=json&per_page=20000&mrnev=1",
    "wb_gdp_per_capita.json": "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.PCAP.CD?format=json&per_page=20000&mrnev=1",
}


def get(url, accept=None):
    headers = {"User-Agent": UA}
    if accept:
        headers["Accept"] = accept
    last = None
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=300) as r:
                return r.read()
        except Exception as e:  # réseau capricieux : on réessaie
            last = e
            # Wikidata limite parfois à 1 requête par minute (HTTP 429).
            time.sleep(65 if getattr(e, "code", None) == 429 else 2 ** (attempt + 1))
    raise RuntimeError(f"échec du téléchargement {url}: {last}")


def sparql(query):
    url = SPARQL + "?" + urllib.parse.urlencode({"query": query})
    return get(url, accept="text/csv")


def save(name, content, force):
    path = CACHE / name
    path.write_bytes(content)
    print(f"  {name}: {len(content) / 1e6:.1f} Mo")


def main():
    force = "--force" in sys.argv
    CACHE.mkdir(exist_ok=True)
    jobs = dict(SOURCES)
    curated = json.loads((Path(__file__).parent / "curated" / "manufacturers.json").read_text())
    qids = [m["wikidata"] for m in curated if m.get("wikidata")]
    sparql_jobs = {
        "wd_airport_pax.csv": Q_PAX,
        "wd_countries.csv": Q_COUNTRIES,
        "wd_airline_logos.csv": Q_AIRLINE_LOGOS,
        "wd_manufacturer_logos.csv": q_manufacturer_logos(qids),
    }
    for name, url in jobs.items():
        if (CACHE / name).exists() and not force:
            print(f"  {name}: déjà en cache")
            continue
        save(name, get(url), force)
        if "wikipedia.org" in url:
            time.sleep(2)
    for name, q in sparql_jobs.items():
        if (CACHE / name).exists() and not force:
            print(f"  {name}: déjà en cache")
            continue
        save(name, sparql(q), force)
        time.sleep(5)  # politesse envers le service de requêtes Wikidata


if __name__ == "__main__":
    main()
