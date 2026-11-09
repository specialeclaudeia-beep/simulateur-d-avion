"""Coupe proprement les pays qui traversent l'antiméridien (Russie, Fidji).

Dans public/geo/countries.geojson, certains contours sautent de +180° à −180°.
Sur le globe, MapLibre trace alors ces segments « par l'autre côté » de la
Terre : d'où des cercles étranges autour du pôle quand on sélectionne la Russie.
Ce script rend chaque contour continu puis le découpe à 180° en deux polygones.

Usage : python3 scripts/data/fix_antimeridian.py
"""
import json
from pathlib import Path

PATH = Path(__file__).resolve().parents[2] / "public/geo/countries.geojson"


def unwrap(ring):
    out = [list(ring[0])]
    for x, y in ring[1:]:
        px = out[-1][0]
        while x - px > 180:
            x -= 360
        while x - px < -180:
            x += 360
        out.append([x, y])
    return out


def clip(ring, keep_left, cut):
    """Sutherland-Hodgman sur la droite x = cut (garde x <= cut ou x >= cut)."""
    inside = (lambda p: p[0] <= cut) if keep_left else (lambda p: p[0] >= cut)
    out = []
    n = len(ring)
    for i in range(n):
        a, b = ring[i], ring[(i + 1) % n]
        ia, ib = inside(a), inside(b)
        if ia:
            out.append(a)
        if ia != ib:
            t = (cut - a[0]) / (b[0] - a[0])
            out.append([cut, a[1] + t * (b[1] - a[1])])
    if out and out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def fix_polygon(poly):
    """Renvoie une liste de polygones (le contour extérieur seul est découpé)."""
    outer = poly[0]
    # Les polygones à trou (le contour de l'Antarctique autour du pôle) restent tels quels.
    if len(poly) > 1:
        return [poly]
    if not any(abs(a[0] - b[0]) > 180 for a, b in zip(outer, outer[1:])):
        return [poly]
    ring = unwrap(outer[:-1] if outer[0] == outer[-1] else outer)
    xs = [p[0] for p in ring]
    parts = []
    # Parties à ramener dans [−180, 180] : on découpe aux multiples de 180 rencontrés.
    for lo in range(int((min(xs) + 180) // 360) * 360 - 180, int(max(xs)) + 1, 360):
        piece = clip(ring, False, lo)
        piece = piece and clip(piece[:-1], True, lo + 360)
        if piece:
            shift = -(lo + 180)
            parts.append([[[round(x + shift, 4), y] for x, y in piece]])
    return parts


def main():
    data = json.loads(PATH.read_text())
    changed = []
    for f in data["features"]:
        g = f["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        fixed = [p for poly in polys for p in fix_polygon(poly)]
        if len(fixed) != len(polys) or fixed != polys:
            changed.append(f["properties"].get("iso"))
            f["geometry"] = {"type": "MultiPolygon", "coordinates": fixed}
    PATH.write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":")))
    print("corrigés :", changed)


if __name__ == "__main__":
    main()
