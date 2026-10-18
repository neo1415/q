"""Generate a compact world outline module from world-atlas countries-110m.

Data: world-atlas@2.0.2 (ISC), Natural Earth 1:110m (public domain);
alpha-2 <-> numeric from i18n-iso-countries@7.14.0 codes.json (MIT).
Equirectangular: x = (lon + 180) * K, y = (TOP - lat) * K.
"""
import json
import sys

atlas_path, codes_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
topo = json.load(open(atlas_path))
codes = json.load(open(codes_path))
num_to_a2 = {row[2]: row[0] for row in codes}

K = 2.0
TOP = 84.0
BOTTOM = -58.0
tr = topo["transform"]
sx, sy = tr["scale"]
tx, ty = tr["translate"]

arcs = []
for arc in topo["arcs"]:
    x = y = 0
    pts = []
    for dx, dy in arc:
        x += dx
        y += dy
        pts.append((x * sx + tx, y * sy + ty))
    arcs.append(pts)


def ring(indices):
    pts = []
    for i in indices:
        a = arcs[i] if i >= 0 else list(reversed(arcs[~i]))
        if pts:
            a = a[1:]
        pts.extend(a)
    return pts


def proj(lon, lat):
    lat = max(min(lat, TOP), BOTTOM)
    return ((lon + 180) * K, (TOP - lat) * K)


def path_of(rings):
    out = []
    for r in rings:
        last = None
        seg = []
        for lon, lat in r:
            p = proj(lon, lat)
            q = (round(p[0]), round(p[1]))
            if q != last:
                seg.append(q)
                last = q
        if len(seg) < 3:
            continue
        d = "M%d %d" % seg[0] + "".join(
            "l%d %d" % (b[0] - a[0], b[1] - a[1]) for a, b in zip(seg, seg[1:])
        ) + "z"
        out.append(d)
    return "".join(out)


def area_centroid(r):
    a = cx = cy = 0.0
    pts = [proj(*p) for p in r]
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-9:
        return 0.0, pts[0]
    return abs(a / 2), (cx / (3 * a), cy / (3 * a))


paths, centres, names = {}, {}, {}
for g in topo["objects"]["countries"]["geometries"]:
    a2 = num_to_a2.get(str(g.get("id", "")).zfill(3))
    if a2 is None or a2 == "AQ":
        continue
    if g["type"] == "Polygon":
        polys = [g["arcs"]]
    elif g["type"] == "MultiPolygon":
        polys = g["arcs"]
    else:
        continue
    rings = [ring(r) for poly in polys for r in poly]
    d = path_of(rings)
    if not d:
        continue
    paths[a2] = d
    # The centre of the largest outer ring: where a marker sits.
    best = max((area_centroid(ring(poly[0])) for poly in polys), key=lambda t: t[0])
    centres[a2] = [round(best[1][0]), round(best[1][1])]
    names[a2] = g.get("properties", {}).get("name", a2)

width = int(360 * K)
height = int((TOP - BOTTOM) * K)
with open(out_path, "w") as f:
    f.write("/**\n")
    f.write(" * World outlines for the MAP block (RECOVERY-2026-10 E4). GENERATED; do not edit.\n")
    f.write(" * Source: world-atlas@2.0.2 countries-110m (ISC), from Natural Earth\n")
    f.write(" * 1:110m (public domain); ISO alpha-2 codes from i18n-iso-countries\n")
    f.write(" * (MIT). Equirectangular, %d x %d, latitudes %d to %d.\n" % (width, height, TOP, BOTTOM))
    f.write(" * Loaded lazily, only when a map is drawn.\n */\n")
    f.write("export const WORLD_WIDTH = %d;\n" % width)
    f.write("export const WORLD_HEIGHT = %d;\n" % height)
    f.write("export const COUNTRY_PATHS: Readonly<Record<string, string>> = %s;\n" % json.dumps(paths, separators=(",", ":"), sort_keys=True))
    f.write("export const COUNTRY_CENTRES: Readonly<Record<string, readonly [number, number]>> = %s;\n" % json.dumps(centres, separators=(",", ":"), sort_keys=True))
print(len(paths), "countries")
