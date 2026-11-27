"""Bygger et forenklet kommunekort (SVG-stier) til hjemmesiden.

Kilde: kommunegrænser som GeoJSON fra
https://github.com/magnuslarsen/geoJSON-Danish-municipalities (lau_1 = kommunekode).
Bornholm flyttes ind i en boks øverst til højre. Kræver shapely.

Brug: python scripts/byg_kort.py kommuner.geojson site/data/kort.json
"""
import json, math, sys
from shapely.geometry import shape, Polygon, MultiPolygon
from shapely.ops import unary_union
from shapely import affinity
g = json.load(open(sys.argv[1]))
by = {}
for f in g['features']:
    k = f['properties']['lau_1']
    if not k or k == '411':  # Christiansø er ikke en kommune
        continue
    by.setdefault(k.zfill(3), []).append(shape(f['geometry']))
lat0 = 56.0
def proj(geom):
    return affinity.scale(geom, xfact=math.cos(math.radians(lat0)), yfact=-1, origin=(0, 0))
out = {}
geoms = {k: proj(unary_union(v)) for k, v in by.items()}
# Bornholm (400) flyttes ind i en indsat boks øverst til højre
born = geoms.get('400')
rest = unary_union([v for k, v in geoms.items() if k != '400'])
minx, miny, maxx, maxy = rest.bounds
if born is not None:
    bminx, bminy, bmaxx, bmaxy = born.bounds
    geoms['400'] = affinity.translate(born, xoff=(maxx - (bmaxx - bminx)) - bminx - 0.02, yoff=(miny + 0.05) - bminy)
allb = unary_union(list(geoms.values())).bounds
W = 1000.0
s = W / (allb[2] - allb[0])
H = (allb[3] - allb[1]) * s
tol = 0.0025
for k, geo in geoms.items():
    geo = geo.simplify(tol, preserve_topology=True)
    polys = [geo] if isinstance(geo, Polygon) else list(geo.geoms)
    parts = []
    for p in polys:
        if p.area * s * s < 6:  # dropper bittesmå øer
            continue
        ring = p.exterior.coords
        pts = ["%.1f,%.1f" % ((x - allb[0]) * s, (y - allb[1]) * s) for x, y, *_ in ring]
        parts.append("M" + "L".join(pts[:-1]) + "Z")
    if not parts:  # behold mindst den største
        p = max(polys, key=lambda q: q.area)
        pts = ["%.1f,%.1f" % ((x - allb[0]) * s, (y - allb[1]) * s) for x, y, *_ in p.exterior.coords]
        parts = ["M" + "L".join(pts[:-1]) + "Z"]
    out[k] = "".join(parts)
bx = None
if born is not None:
    b = geoms['400'].bounds
    bx = [round((b[0] - allb[0]) * s - 8, 1), round((b[1] - allb[1]) * s - 8, 1), round((b[2] - b[0]) * s + 16, 1), round((b[3] - b[1]) * s + 16, 1)]
json.dump({"viewBox": [0, 0, round(W), round(H)], "bornholmBoks": bx, "stier": out}, open(sys.argv[2], 'w'), separators=(',', ':'))
print(len(out), round(H), sum(len(v) for v in out.values()))
