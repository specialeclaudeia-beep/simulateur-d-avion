#!/usr/bin/env python3
"""Télécharge les données de trafic réel (vols et flottes) dans scripts/data/.cache/sdm/.

Source : base « Standing Data » de Virtual Radar Server (CC0), alimentée par les
radios ADS-B des passionnés : https://github.com/vradarserver/standing-data

- routes/   : un indicatif de vol (ex. AFR1234) -> aéroports desservis. Sert à connaître
              les vrais numéros de vol de chaque compagnie et combien de vols différents
              elle assure sur chaque ligne.
- aircraft/ : chaque avion immatriculé, son type OACI et la compagnie qui l'exploite. Sert
              à connaître la vraie flotte de chaque compagnie.

Usage : python3 scripts/data/fetch_traffic.py [--force]
(à lancer après fetch.py et build.py, car il lit data/airlines.json)
"""
import json
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CACHE = ROOT / ".cache" / "sdm"
DATA = ROOT.parent.parent / "data"
BASE = "https://raw.githubusercontent.com/vradarserver/standing-data/main"
UA = "simulateur-compagnie-aerienne-data/1.0 (jeu personnel, non commercial)"
FORCE = "--force" in sys.argv


def get(path: str) -> bytes | None:
    """Télécharge un fichier du dépôt ; None s'il n'existe pas."""
    for attempt in range(5):
        try:
            req = urllib.request.Request(f"{BASE}/{path}", headers={"User-Agent": UA})
            with urllib.request.urlopen(req, timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    raise RuntimeError(f"échec du téléchargement : {path}")


def fetch_to(path: str) -> bool:
    out = CACHE / path
    if out.exists() and not FORCE:
        return out.stat().st_size > 0
    body = get(path)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(body or b"")
    return body is not None


def fetch_routes(icao: str) -> int:
    first = icao[0]
    if fetch_to(f"routes/schema-01/{first}/{icao}-all.csv"):
        return 1
    # Plus de 10 000 indicatifs : un fichier par premier chiffre du numéro de vol.
    return sum(fetch_to(f"routes/schema-01/{first}/{icao}-{d}.csv") for d in range(10))


def main() -> None:
    airlines = json.loads((DATA / "airlines.json").read_text())
    icaos = sorted({a["icao"] for a in airlines if a.get("icao")})
    fetch_to("airlines/schema-01/airlines.csv")

    # Équipements par ligne d'OpenFlights (2014, ODbL) : complète les flottes inconnues.
    of = CACHE.parent / "openflights_routes.dat"
    if not of.exists() or FORCE:
        req = urllib.request.Request(
            "https://raw.githubusercontent.com/jpatokal/openflights/master/data/routes.dat", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=120) as r:
            of.write_bytes(r.read())

    with ThreadPoolExecutor(max_workers=8) as ex:
        n = sum(ex.map(fetch_routes, icaos))
    print(f"routes : {n} fichiers pour {len(icaos)} compagnies")

    hexes = [f"{a:X}{b:X}{c:X}" for a in range(16) for b in range(16) for c in range(16)]
    paths = [f"aircraft/schema-01/{h[0]}/{h[:2]}/{h}.csv" for h in hexes]
    with ThreadPoolExecutor(max_workers=8) as ex:
        n = sum(ex.map(fetch_to, paths))
    print(f"avions : {n} fichiers sur {len(paths)}")


if __name__ == "__main__":
    main()
