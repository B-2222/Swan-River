# Build game world data for the Swan River jet ski game from OpenStreetMap.
# Outputs into OUT dir: terrain.png (R,G = height dm+500, B = sdf*2+128), cover.png (class ids),
# landcover.jpg (colour texture), world.json (bridges, piers, roads, buildings, POIs, spots)
import sys, os, re, json, math, pickle, base64, random
import numpy as np, shapely
from shapely.geometry import Point, LineString, Polygon, MultiPolygon, box
from PIL import Image, ImageDraw, ImageFilter
from scipy.ndimage import gaussian_filter, distance_transform_edt, zoom
sys.path.insert(0, 'tools')
from proj import *

OUT = sys.argv[1]
os.makedirs(OUT, exist_ok=True)
rng = np.random.default_rng(7)
d = pickle.load(open('osm_raw.pkl', 'rb'))
sdf = np.load('sdf.npy')                      # + land, - water (all water bodies)
reach = pickle.load(open('reach_xz.pkl', 'rb'))  # navigable river + ocean polygon (metres)
shapely.prepare(reach)

def xz(lon, lat): return to_xz(lon, lat)
def gxz(g): return geom_xz(g)
gx = X0 + (np.arange(NX) + 0.5) * CELL
gz = Z0 + (np.arange(NZ) + 0.5) * CELL
GX, GZ = np.meshgrid(gx, gz)

# ---------------------------------------------------------------- reach mask / distance
def raster_polys(geom, ss=1, value=255, size=None):
    img = Image.new('L', (NX * ss, NZ * ss), 0)
    dr = ImageDraw.Draw(img)
    def px(c): return [((x - X0) / CELL * ss, (z - Z0) / CELL * ss) for x, z in c]
    for p in getattr(geom, 'geoms', [geom]):
        if p.geom_type != 'Polygon' or p.is_empty: continue
        dr.polygon(px(p.exterior.coords), fill=value)
        for r in p.interiors: dr.polygon(px(r.coords), fill=0)
    a = np.asarray(img, dtype=np.float32)
    if ss > 1: a = a.reshape(NZ, ss, NX, ss).mean(axis=(1, 3))
    return a / 255.0

reach_mask = raster_polys(reach, 2) > 0.5
dist_reach = distance_transform_edt(~reach_mask) * CELL   # metres from navigable water (0 inside)
print('reach raster done')

def sample(arr, x, z):
    i = np.clip(((np.asarray(z) - Z0) / CELL - 0.5).astype(int), 0, NZ - 1)
    j = np.clip(((np.asarray(x) - X0) / CELL - 0.5).astype(int), 0, NX - 1)
    return arr[i, j]

# ---------------------------------------------------------------- land cover polygons
def kv(t, *pairs):
    return any(t.get(k) == v for k, v in pairs)

C_URBAN, C_WATER, C_SAND, C_PARK, C_BUSH, C_INDUS, C_ROAD, C_GOLF, C_COMM, C_WET, C_PARK_LOT, C_PITCH, C_ROCK = range(13)
cover_polys = {c: [] for c in range(13)}
kings_park = None
for rec in d['landuse']:
    if len(rec) != 4: continue
    oid, fromway, g, t = rec
    if not hasattr(g, 'geoms') and g.geom_type not in ('Polygon',): continue
    gg = gxz(g)
    if kv(t, ('natural', 'beach'), ('natural', 'sand')): c = C_SAND
    elif kv(t, ('leisure', 'golf_course')): c = C_GOLF
    elif kv(t, ('leisure', 'pitch'), ('leisure', 'stadium')): c = C_PITCH
    elif kv(t, ('natural', 'wood'), ('landuse', 'forest'), ('natural', 'scrub'), ('natural', 'heath'), ('leisure', 'nature_reserve')): c = C_BUSH
    elif kv(t, ('leisure', 'park'), ('landuse', 'grass'), ('landuse', 'recreation_ground'), ('natural', 'grassland'), ('landuse', 'meadow'), ('leisure', 'garden'), ('landuse', 'cemetery')): c = C_PARK
    elif kv(t, ('landuse', 'industrial'), ('landuse', 'port'), ('landuse', 'railway'), ('landuse', 'construction')): c = C_INDUS
    elif kv(t, ('landuse', 'commercial'), ('landuse', 'retail'), ('amenity', 'university'), ('amenity', 'school')): c = C_COMM
    elif kv(t, ('natural', 'wetland')): c = C_WET
    elif kv(t, ('amenity', 'parking')): c = C_PARK_LOT
    elif kv(t, ('natural', 'bare_rock')): c = C_ROCK
    else: continue
    area = gg.area
    cover_polys[c].append((area, gg))
    if t.get('name') == 'Kings Park' and t.get('leisure') == 'park':
        kings_park = gg if kings_park is None or gg.area > kings_park.area else kings_park
print('kings park area km2', kings_park.area / 1e6 if kings_park else None)

# ---------------------------------------------------------------- elevation model
def gauss(lon, lat, h, r):
    x, z = xz(lon, lat)
    return h * np.exp(-((GX - x) ** 2 + (GZ - z) ** 2) / (2 * (r * 0.6) ** 2))

base = np.full((NZ, NX), 7.0, np.float32)
HILLS = [  # lon, lat, height(m), radius(m)  -- approximate real landforms
    (115.7585, -32.0145, 38, 600),   # Buckland Hill, Mosman Park
    (115.7595, -32.0505, 26, 450),   # Monument Hill, Fremantle
    (115.7535, -32.0550, 14, 300),   # Fremantle Prison rise
    (115.7562, -32.0410, 20, 260),   # Cantonment Hill, East Fremantle
    (115.7650, -32.0350, 16, 600),   # East Fremantle ridge
    (115.7520, -32.0260, 14, 450),   # North Fremantle ridge (Rocky Bay cliffs)
    (115.7900, -32.0270, 20, 900),   # Bicton ridge
    (115.8050, -32.0300, 14, 900),   # Attadale
    (115.8625, -32.0320, 13, 300),   # Mount Henry
    (115.8480, -32.0250, 14, 700),   # Mount Pleasant ridge
    (115.8420, -32.0080, 10, 500),   # Point Heathcote / Applecross
    (115.7950, -31.9880, 16, 1000),  # Dalkeith plateau
    (115.7720, -31.9960, 16, 700),   # Peppermint Grove
    (115.7800, -31.9780, 20, 1100),  # Claremont
    (115.7600, -31.9900, 22, 900),   # Cottesloe dunes / ridge
    (115.8100, -31.9750, 18, 1000),  # Crawley / UWA rise
    (115.8300, -31.9450, 24, 1700),  # West Perth / Subiaco
    (115.8600, -31.9450, 10, 900),   # Perth CBD north rise
    (115.8750, -31.9300, 22, 1600),  # Mount Lawley
    (115.8950, -31.9750, 14, 1300),  # Victoria Park ridge
    (115.8800, -32.0300, 8, 1500),   # Shelley/Rossmoyne
    (115.7420, -32.0560, 9, 110),    # Arthur Head (Round House)
    (115.7765, -32.0252, 15, 520),   # Blackwall Reach clifftop (Bicton)
    (115.7560, -32.0232, 10, 330),   # Rocky Bay north clifftop
    (115.7735, -32.0128, 12, 480),   # Chidley Point / Mosman Park bushland
]
for h in HILLS: base += gauss(*h)
if kings_park is not None:
    kp = raster_polys(kings_park, 2)
    kp = gaussian_filter(kp, 2.2)
    base = base * (1 - kp) + kp * 58.0
# gentle noise
noise = gaussian_filter(rng.standard_normal((NZ, NX)).astype(np.float32), 6) * 18
base += noise
base = gaussian_filter(base, 1.0)

CLIFFS = [  # lon, lat, radius, max slope near shore, flat strip width
    (115.7760, -32.0225, 750, 1.6, 4),   # Blackwall Reach limestone cliffs (Bicton side)
    (115.7570, -32.0245, 550, 1.2, 5),   # Rocky Bay cliffs
    (115.7720, -32.0120, 650, 0.9, 6),   # Chidley Point / Mosman Park
    (115.7780, -31.9960, 900, 0.7, 8),   # Peppermint Grove / Freshwater Bay
    (115.8420, -32.0030, 320, 0.9, 6),   # Point Heathcote
    (115.8610, -32.0310, 300, 0.7, 6),   # Mount Henry
    (115.8380, -31.9650, 1300, 1.3, 40), # Kings Park scarp above Mounts Bay Road
    (115.7420, -32.0565, 140, 1.4, 3),   # Arthur Head
]
slope = np.full((NZ, NX), 0.10, np.float32)
flatw = np.full((NZ, NX), 14.0, np.float32)
for lon, lat, r, s, fw in CLIFFS:
    x, z = xz(lon, lat)
    w = np.clip(1 - np.sqrt((GX - x) ** 2 + (GZ - z) ** 2) / r, 0, 1) ** 0.7
    slope = slope * (1 - w) + s * w
    flatw = flatw * (1 - w) + fw * w

# quay walls: port, commercial and car park frontages are vertical walls, not beaches
quay = np.zeros((NZ, NX), np.float32)
qimg = Image.new('L', (NX, NZ), 0); qd = ImageDraw.Draw(qimg)
for c in (C_INDUS, C_COMM, C_PARK_LOT):
    for area, g in cover_polys[c]:
        for p in getattr(g, 'geoms', [g]):
            if p.geom_type == 'Polygon':
                qd.polygon([((x - X0) / CELL, (z - Z0) / CELL) for x, z in p.exterior.coords], fill=255)
quay = gaussian_filter(np.asarray(qimg, np.float32) / 255.0, 1.0)
slope = slope * (1 - quay) + 1.6 * quay
flatw = flatw * (1 - quay) + 0.5 * quay
land_cap = 0.35 + np.minimum(sdf, flatw) * 0.09 + np.maximum(sdf - flatw, 0) * slope
h_land = np.minimum(base, land_cap)
h_land = np.maximum(h_land, 0.55 + np.clip(sdf, 0, 6) * 0.08)
h_land = np.where((quay > 0.4) & (sdf > 1.0), np.maximum(h_land, 2.6), h_land)
# water depth: deeper away from shore; the ocean gets deeper still
ocean_mask = np.zeros_like(reach_mask)
ocean_poly = gxz(pickle.load(open('water.pkl', 'rb'))['ocean'])
ocean_mask = raster_polys(ocean_poly, 1) > 0.5
maxd = np.where(ocean_mask, 14.0 + np.clip(-(GX - xz(115.73, -32.0)[0]) / 600, 0, 14), 5.5)
# Blackwall Reach deep channel (one of the deepest parts of the river)
bx, bz = xz(115.775, -32.019)
maxd += 12 * np.exp(-((GX - bx) ** 2 + (GZ - bz) ** 2) / (2 * 450 ** 2))
h_water = -(0.4 + np.minimum(-sdf * 0.07, maxd))
height = np.where(sdf > 0, h_land, h_water).astype(np.float32)
print('height range', height.min(), height.max())

# ---------------------------------------------------------------- cover raster (class ids)
SS = 2
cov_img = Image.new('L', (NX * SS, NZ * SS), C_URBAN)
cd = ImageDraw.Draw(cov_img)
def pxs(c, ss): return [((x - X0) / CELL * ss, (z - Z0) / CELL * ss) for x, z in c]
order = [C_INDUS, C_COMM, C_PARK_LOT, C_PARK, C_GOLF, C_PITCH, C_BUSH, C_WET, C_ROCK, C_SAND]
for c in order:
    for area, g in sorted(cover_polys[c], key=lambda a: -a[0]):
        for p in getattr(g, 'geoms', [g]):
            if p.geom_type != 'Polygon': continue
            cd.polygon(pxs(p.exterior.coords, SS), fill=c)
            for r in p.interiors: cd.polygon(pxs(r.coords, SS), fill=C_URBAN)
cov = np.asarray(cov_img.resize((NX, NZ), Image.NEAREST)).copy()
cov[sdf < 0] = C_WATER
print('cover done')

# ---------------------------------------------------------------- roads (used for texture + cars)
ROAD_W = {'motorway': 22, 'trunk': 18, 'primary': 15, 'secondary': 12, 'tertiary': 10, 'motorway_link': 8, 'trunk_link': 8,
          'primary_link': 8, 'secondary_link': 7, 'tertiary_link': 7, 'residential': 7, 'unclassified': 7, 'living_street': 6,
          'service': 4.5, 'pedestrian': 5, 'footway': 2.2, 'cycleway': 2.5, 'path': 2}
roads_xz = []
for wid, nodes, t in d['roads']:
    hw = t.get('highway')
    c = np.array([xz(x, y) for x, y in nodes])
    roads_xz.append((wid, hw, c, t))
print('roads', len(roads_xz))
C_OCEAN, C_BLD = 13, 14
cfull = Image.fromarray(cov.astype(np.uint8))
cfd = ImageDraw.Draw(cfull)
def cp(c): return [((x - X0) / CELL, (z - Z0) / CELL) for x, z in c]
for oid, fw, g, t in d['buildings']:
    gg = gxz(g)
    for p in getattr(gg, 'geoms', [gg]):
        if p.geom_type == 'Polygon' and p.area > 30: cfd.polygon(cp(p.exterior.coords), fill=C_BLD)
for wid, hw, c, t in roads_xz:
    if hw in ('motorway','trunk','primary','secondary','tertiary','residential','unclassified','motorway_link','trunk_link','primary_link','service'):
        cfd.line(cp(c), fill=C_ROAD, width=1)
cfa = np.asarray(cfull).copy()
cfa[sdf < 0] = C_WATER
cfa[(sdf < 0) & ocean_mask] = C_OCEAN
cfa[(sdf < 0) & ~reach_mask & ~ocean_mask] = 15  # lake / pond (not navigable)
Image.fromarray(cfa.astype(np.uint8)).save(os.path.join(OUT, 'cover.png'), optimize=True)

# ---------------------------------------------------------------- colour texture
TS = 2  # texture pixels per grid cell (7.5 m/px)
TW, TH = NX * TS, NZ * TS
col = np.zeros((NZ, NX, 3), np.float32)
PAL = {C_URBAN: (164, 160, 128), C_WATER: (0, 0, 0), C_SAND: (226, 210, 166), C_PARK: (112, 150, 70), C_BUSH: (78, 102, 52),
       C_INDUS: (150, 146, 138), C_ROAD: (80, 80, 82), C_GOLF: (98, 160, 66), C_COMM: (160, 156, 148), C_WET: (98, 118, 80),
       C_PARK_LOT: (120, 120, 118), C_PITCH: (104, 158, 70), C_ROCK: (190, 176, 140)}
cov2 = np.asarray(cov_img).copy()
cov2[np.kron(sdf < 0, np.ones((SS, SS), bool))[:cov2.shape[0], :cov2.shape[1]]] = C_WATER
img = np.zeros(cov2.shape + (3,), np.float32)
for c, rgb in PAL.items(): img[cov2 == c] = rgb
# underwater sea bed colour: sand in shallows to deep green-blue
hz = np.kron(height, np.ones((SS, SS), np.float32))
wet = cov2 == C_WATER
dep = np.clip(-hz / 6.0, 0, 1)[..., None]
seabed = (1 - dep) * np.array([206, 190, 140]) + dep * np.array([60, 88, 80])
img = np.where(wet[..., None], seabed, img)
# urban texture speckle (houses/gardens) for suburbs
spk = rng.random(img.shape[:2])
urb = (cov2 == C_URBAN)
img[urb] = img[urb] * (0.85 + 0.3 * spk[urb])[:, None]
bush = (cov2 == C_BUSH)
img[bush] = img[bush] * (0.75 + 0.45 * spk[bush])[:, None]
tex = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8))
dr = ImageDraw.Draw(tex)
def tp(c): return [((x - X0) / CELL * TS, (z - Z0) / CELL * TS) for x, z in c]
# beach & sand edges along water (natural strips): draw buildings footprints (roof colours)
ROOFS = [(160, 82, 60), (88, 90, 96), (120, 128, 138), (186, 170, 140), (140, 70, 52), (200, 200, 196)]
for oid, fw, g, t in d['buildings']:
    gg = gxz(g)
    for p in getattr(gg, 'geoms', [gg]):
        if p.geom_type != 'Polygon': continue
        cc = ROOFS[oid % len(ROOFS)] if p.area < 500 else (150, 150, 150)
        dr.polygon(tp(p.exterior.coords), fill=cc)
# roads on top
for wid, hw, c, t in sorted(roads_xz, key=lambda r: ROAD_W.get(r[1], 3)):
    w = ROAD_W.get(hw, 3) / CELL * TS
    if hw in ('footway', 'cycleway', 'path'):
        dr.line(tp(c), fill=(196, 186, 160), width=max(1, int(round(w))))
    else:
        dr.line(tp(c), fill=(72, 72, 76) if hw in ('motorway', 'trunk', 'primary') else (92, 92, 94), width=max(1, int(round(w))))
for wid, nodes, t in d['rail']:
    c = [xz(x, y) for x, y in nodes]
    dr.line(tp(c), fill=(110, 96, 84), width=2)
tex = tex.filter(ImageFilter.SMOOTH)
tex.save(os.path.join(OUT, 'landcover.jpg'), quality=82, optimize=True)
# small map for the minimap / big map
mm = tex.resize((TW // 2, TH // 2), Image.LANCZOS)
mm_a = np.asarray(mm).astype(np.float32)
wmask = np.asarray(Image.fromarray((sdf < 0).astype(np.uint8) * 255).resize((TW // 2, TH // 2), Image.BILINEAR)).astype(np.float32)[..., None] / 255
mm_a = mm_a * (1 - wmask) + wmask * np.array([38, 110, 170])
Image.fromarray(mm_a.astype(np.uint8)).save(os.path.join(OUT, 'minimap.jpg'), quality=80, optimize=True)
print('textures done')

# ---------------------------------------------------------------- terrain.png
enc = np.clip(np.round((height + 50.0) * 10.0), 0, 65535).astype(np.uint16)
sdfe = np.clip(np.round(sdf * 2 + 128), 0, 255).astype(np.uint8)
rgb = np.stack([(enc >> 8).astype(np.uint8), (enc & 255).astype(np.uint8), sdfe], axis=-1)
Image.fromarray(rgb, 'RGB').save(os.path.join(OUT, 'terrain.png'), optimize=True)
print('terrain.png done')

# ---------------------------------------------------------------- world.json
world = {'proj': {'lon0': LON0, 'lat0': LAT0, 'kx': KX, 'kz': KZ}, 'grid': {'x0': X0, 'z0': Z0, 'cell': CELL, 'nx': NX, 'nz': NZ},
         'texture': {'w': TW, 'h': TH}}

def r1(v): return round(float(v), 1)

# bridges ---------------------------------------------------------
from shapely.ops import linemerge
BRIDGE_H = {  # deck top height above water (m) for known bridges (approximate)
    'Narrows Bridge': 10.5, 'Causeway': 5.5, 'Matagarup Bridge': 9.0, 'Windan Bridge': 9.0, 'Goongoonup Bridge': 7.5,
    'Fremantle Traffic Bridge': 5.0, 'Walyalup Bridge': 6.5, 'Stirling Bridge': 9.5, 'Fremantle Rail Bridge': 5.5,
    'Canning Bridge': 5.0, 'Mount Henry Bridge': 11.0, 'Elizabeth Quay Bridge': 7.5, 'Boorloo Bridge': 6.5,
    'Shelley Bridge': 5.5, 'Riverton Bridge': 5.0, 'Garratt Road Bridge': 6.0, 'Redcliffe Bridge': 8.0,
}
SPAN = {'Narrows Bridge': 55, 'Causeway': 16, 'Matagarup Bridge': 0, 'Windan Bridge': 42, 'Goongoonup Bridge': 30,
        'Fremantle Traffic Bridge': 11, 'Walyalup Bridge': 30, 'Stirling Bridge': 38, 'Fremantle Rail Bridge': 14,
        'Canning Bridge': 12, 'Mount Henry Bridge': 45, 'Elizabeth Quay Bridge': 0, 'Boorloo Bridge': 40}
NEAR_NAMES = [  # identify bridges by OSM location (OSM names most of them after the road they carry)
    (115.8469, -31.9633, 300, 'Narrows Bridge'), (115.8580, -32.0342, 450, 'Mount Henry Bridge'), (115.8533, -32.0110, 200, 'Canning Bridge'),
    (115.7595, -32.0394, 300, 'Stirling Bridge'), (115.7545, -32.0413, 180, 'Walyalup Bridge'), (115.7538, -32.0414, 120, 'Fremantle Rail Bridge'),
    (115.8830, -31.9476, 260, 'Windan Bridge'), (115.8838, -31.9653, 300, 'Causeway'), (115.8854, -31.9545, 260, 'Matagarup Bridge'),
    (115.8559, -31.9592, 90, 'Elizabeth Quay Bridge'), (115.9017, -32.0236, 200, 'Shelley Bridge'), (115.9011, -32.0277, 120, 'Riverton Bridge')]
ROADNAME = {'Stirling Highway': 'Stirling Bridge', 'Graham Farmer Freeway': 'Windan Bridge', 'Graham Farmer Freeway PSP': 'Windan Bridge',
            'Armadale Line': 'Goongoonup Bridge', 'Leach Highway': 'Shelley Bridge', 'Fremantle Line': 'Fremantle Rail Bridge'}
def ident(t, line):
    nm = t.get('bridge:name') or ''
    if nm: 
        for key in BRIDGE_H:
            if key.lower() in nm.lower(): return key
        return nm
    nm = t.get('name') or ''
    if nm in ROADNAME: return ROADNAME[nm]
    for key in BRIDGE_H:
        if key.lower() in nm.lower(): return key
    cx, cz = line.interpolate(0.5, normalized=True).coords[0]
    best = None
    for lon, lat, r, key in NEAR_NAMES:
        x, z = xz(lon, lat); dd = math.hypot(cx - x, cz - z)
        if dd < r and (best is None or dd < best[0]): best = (dd, key)
    if best:
        k = best[1]
        if k == 'Walyalup Bridge' and 'railway' in t: k = 'Fremantle Rail Bridge'
        if k == 'Fremantle Rail Bridge' and 'railway' not in t: k = 'Walyalup Bridge'
        if k: return k
    return nm or 'bridge'
groups = {}
for wid, nodes, t in d['bridges']:
    kind = t.get('highway') or t.get('railway')
    if kind in ('miniature', 'construction', 'proposed', 'abandoned', 'disused', 'platform'): continue
    c = [xz(x, y) for x, y in nodes]
    ls = LineString(c)
    if not ls.intersects(reach.buffer(4)): continue
    nm = ident(t, ls)
    lanes = int(re.sub(r'[^0-9]', '', t.get('lanes', '0') or '0') or 0)
    if 'railway' in t: w = 5.0
    elif kind in ('footway', 'cycleway', 'path', 'pedestrian', 'steps'): w = 3.6
    else: w = (lanes * 3.5 + 2.5) if lanes else ROAD_W.get(kind, 8) * 0.75
    try: w = float(t.get('width', w))
    except ValueError: pass
    key = (nm, kind, 'railway' in t, round(w, 1), t.get('oneway', 'no'))
    groups.setdefault(key, []).append(ls)
def hgrid(x, z): return float(sample(height, x, z))
bridges = []
for (nm, kind, rail, w, oneway), lines in groups.items():
    merged = linemerge(lines)
    for ln in getattr(merged, 'geoms', [merged]):
        c = np.asarray(ln.coords)
        L = ln.length
        if L < 6: continue
        H = BRIDGE_H.get(nm, 4.0 if kind in ('footway', 'cycleway', 'path', 'pedestrian') else 5.0)
        # densify for smooth profile
        n = max(2, int(L / 6) + 1)
        ss = np.linspace(0, L, n)
        P = np.array([ln.interpolate(v).coords[0] for v in ss])
        hA = max(hgrid(*P[0]), 0.8); hB = max(hgrid(*P[-1]), 0.8)
        arch = nm in ('Elizabeth Quay Bridge', 'Matagarup Bridge')
        ramp = L * 0.5 if arch else min(max(L * 0.28, 12), 110)
        def sm(v): v = np.clip(v, 0, 1); return v * v * (3 - 2 * v)
        bump = np.sin(np.pi * ss / L) ** 0.8 if arch else sm(ss / ramp) * sm((L - ss) / ramp)
        lin = hA + (hB - hA) * ss / L
        ground = np.array([hgrid(*p) for p in P])
        y = lin + np.maximum(H - lin, 0) * bump
        y = np.where(ground + 0.6 > y, np.minimum(ground + 0.6, np.maximum(y, H + 3)), y)
        piers = []
        span = SPAN.get(nm, 24 if not rail else 20)
        if span:
            for sv in np.arange(span * 0.5, L - 4, span):
                if sv < 5: continue
                p = ln.interpolate(sv).coords[0]; q = ln.interpolate(min(sv + 1, L)).coords[0]
                g = hgrid(*p); yy = float(np.interp(sv, ss, y))
                if yy - g > 2.5:
                    piers.append([r1(p[0]), r1(p[1]), round(math.atan2(q[1] - p[1], q[0] - p[0]), 3), r1(yy)])
        bridges.append({'name': nm, 'kind': kind, 'rail': rail, 'w': r1(w), 'h': H, 'oneway': oneway == 'yes',
                        'pts': [[r1(p[0]), r1(p[1]), round(float(yy), 2)] for p, yy in zip(P, y)], 'piers': piers})
world['bridges'] = bridges
print('bridges', len(bridges))

# piers / jetties / breakwaters ------------------------------------------
piers = []
for rec in d['piers']:
    if rec[0] == 'area':
        _, oid, fw, g, t = rec
        gg = gxz(g)
        if not gg.intersects(reach): continue
        for p in getattr(gg, 'geoms', [gg]):
            if p.geom_type != 'Polygon' or p.area < 4: continue
            p = p.simplify(0.4)
            if p.is_empty: continue
            piers.append({'poly': [[r1(a), r1(b)] for a, b in list(p.exterior.coords)[:-1]], 'name': t.get('name', ''),
                          'bw': t.get('man_made') in ('breakwater', 'groyne')})
    else:
        wid, nodes, t = rec
        c = np.array([xz(x, y) for x, y in nodes])
        if len(c) < 2: continue
        ls = LineString(c)
        if not ls.intersects(reach.buffer(3)): continue
        try: w = float(t.get('width', 3.0))
        except ValueError: w = 3.0
        piers.append({'line': [[r1(a), r1(b)] for a, b in c], 'w': r1(min(max(w, 1.5), 12)), 'name': t.get('name', '')})
for wid, nodes, t in d['breakwater']:
    c = np.array([xz(x, y) for x, y in nodes])
    if len(c) < 2: continue
    if not LineString(c).intersects(reach.buffer(10)): continue
    piers.append({'line': [[r1(a), r1(b)] for a, b in c], 'w': 7.0, 'name': t.get('name', ''), 'bw': True})
world['piers'] = piers
print('piers', len(piers))

# marinas and moorings -> moored boats ------------------------------------
boats = []
for oid, fw, g, t in d['marina']:
    gg = gxz(g).intersection(reach)
    if gg.is_empty: continue
    minx, minz, maxx, maxz = gg.bounds
    for x in np.arange(minx + 6, maxx, 9):
        for z in np.arange(minz + 6, maxz, 16):
            if gg.contains(Point(x, z)) and rng.random() < 0.55:
                boats.append([r1(x), r1(z), round(float(rng.choice([0, math.pi])) + rng.normal(0, 0.05), 2), int(rng.integers(0, 4))])
for p in d['pois']:
    if p[3].get('seamark:type') == 'mooring':
        x, z = xz(p[1], p[2])
        if reach.contains(Point(x, z)):
            boats.append([r1(x), r1(z), round(float(rng.uniform(0, 6.28)), 2), int(rng.integers(0, 4))])
# extra swing moorings in the classic mooring bays (Freshwater Bay, Mosman Bay, Matilda Bay, Pelican Pt, Como)
MOOR = [(115.7745, -32.0010, 260), (115.7740, -32.0060, 200), (115.7838, -31.9925, 300), (115.8280, -31.9830, 220),
        (115.8240, -31.9770, 160), (115.7630, -32.0290, 160), (115.8470, -32.0010, 180), (115.7560, -32.0420, 90)]
for lon, lat, r in MOOR:
    cx, cz = xz(lon, lat)
    for k in range(int(r / 8)):
        a = rng.uniform(0, 6.28); rr = r * math.sqrt(rng.random())
        x, z = cx + math.cos(a) * rr, cz + math.sin(a) * rr
        if sample(sdf, x, z) < -25:
            boats.append([r1(x), r1(z), round(float(rng.uniform(0, 6.28)), 2), int(rng.integers(0, 4))])
world['moored'] = boats
print('moored boats', len(boats))

# roads for traffic (near the water + routes over every road bridge) ---------------
TRAFFIC = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'residential', 'unclassified', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'}
def key(p): return (round(float(p[0]), 2), round(float(p[1]), 2))
ends = {}
road_list = []
for wid, hw, c, t in roads_xz:
    if hw not in TRAFFIC or len(c) < 2: continue
    i = len(road_list)
    road_list.append((hw, c, t))
    ends.setdefault(key(c[0]), []).append((i, 0))
    ends.setdefault(key(c[-1]), []).append((i, 1))
def extend(pt, came, name, hw, oneway_forward, budget):
    out = []
    used = set([came])
    cur = pt
    while budget > 0:
        cands = []
        for i, which in ends.get(key(cur), []):
            if i in used: continue
            rhw, rc, rt = road_list[i]
            ow = rt.get('oneway') == 'yes' or rhw in ('motorway', 'motorway_link')
            if ow and oneway_forward and which == 1: continue      # would drive against a one-way
            if ow and not oneway_forward and which == 0: continue
            score = (2 if rt.get('name', '') == name and name else 0) + (1 if rhw == hw else 0) + min(LineString(rc).length / 1000, 0.5)
            cands.append((score, i, which))
        if not cands: break
        cands.sort(reverse=True)
        _, i, which = cands[0]
        used.add(i)
        rc = road_list[i][1]
        seg = rc if which == 0 else rc[::-1]
        out.extend(seg[1:].tolist())
        budget -= LineString(seg).length
        cur = seg[-1]
    return out
traffic = []
for br in bridges:
    if br['rail'] or br['kind'] not in TRAFFIC: continue
    P = [p[:2] for p in br['pts']]
    ys = [p[2] for p in br['pts']]
    nm = ''
    fwd = extend(P[-1], -1, nm, br['kind'], True, 420)
    back = extend(P[0], -1, nm, br['kind'], False, 420)
    path = [[r1(x), r1(z), round(float(sample(height, x, z)) + 0.1, 2)] for x, z in back[::-1]]
    path += [[p[0], p[1], yy] for p, yy in zip(P, ys)]
    path += [[r1(x), r1(z), round(float(sample(height, x, z)) + 0.1, 2)] for x, z in fwd]
    sp = 25 if br['kind'] in ('motorway', 'trunk') else (17 if br['kind'] in ('primary', 'secondary') else 12)
    traffic.append({'pts': path, 'oneway': br['oneway'] or br['kind'] in ('motorway',), 'speed': sp, 'bridge': br['name'], 'lanes': 2 if br['w'] > 14 else 1})
# riverside roads: merge by name
byname = {}
for hw, c, t in road_list:
    dmin = sample(dist_reach, c[:, 0], c[:, 1]).min()
    lim = 220 if hw in ('motorway', 'trunk', 'primary', 'secondary') else 70
    if dmin > lim: continue
    if 'bridge' in t and t.get('bridge') != 'no': continue
    byname.setdefault((t.get('name', ''), hw, t.get('oneway') == 'yes'), []).append(LineString(c))
roads_out = []
for (nm, hw, ow), lines in byname.items():
    merged = linemerge(lines)
    for ln in getattr(merged, 'geoms', [merged]):
        if ln.length < 120: continue
        c = np.asarray(ln.simplify(1.0).coords)
        pts = [[r1(x), r1(z), round(float(sample(height, x, z)) + 0.1, 2)] for x, z in c]
        sp = 22 if hw in ('motorway', 'trunk') else (15 if hw in ('primary', 'secondary') else 11)
        traffic.append({'pts': pts, 'oneway': ow or hw == 'motorway', 'speed': sp, 'bridge': '', 'lanes': 1, 'name': nm})
world['traffic'] = traffic
print('traffic paths', len(traffic))
print('roads near water', len(roads_out))

rail_out = []
for wid, nodes, t in d['rail']:
    c = np.array([xz(x, y) for x, y in nodes])
    if len(c) < 2: continue
    if sample(dist_reach, c[:, 0], c[:, 1]).min() > 400: continue
    br = 'bridge' in t and t.get('bridge') != 'no'
    rail_out.append({'pts': [[r1(a), r1(b)] for a, b in c], 'name': t.get('name', ''), 'bridge': br})
world['rail'] = rail_out

# buildings -------------------------------------------------------------
def parse_h(t):
    for k in ('height', 'building:height'):
        v = t.get(k)
        if v:
            m = re.match(r'\s*([0-9.]+)', v)
            if m:
                try: return float(m.group(1))
                except ValueError: pass
    lv = t.get('building:levels')
    if lv:
        m = re.match(r'\s*([0-9.]+)', lv)
        if m:
            try: return float(m.group(1)) * 3.3 + 1.0
            except ValueError: pass
    return None
CBD = box(*xz(115.843, -31.962), *xz(115.885, -31.944)) if False else None
cbx0, cbz0 = xz(115.843, -31.944); cbx1, cbz1 = xz(115.886, -31.962)
bld_coords, bld_meta = [], []
nb = 0
for oid, fw, g, t in d['buildings']:
    gg = gxz(g)
    c = gg.centroid
    hh = parse_h(t)
    btype = t.get('building', 'yes')
    if btype in ('roof', 'carport', 'construction', 'ruins', 'no'):
        if btype != 'roof': continue
    dr_ = float(sample(dist_reach, c.x, c.y))
    in_cbd = cbx0 <= c.x <= cbx1 and cbz1 <= c.y <= cbz0
    tall = hh is not None and hh >= 28
    if not (dr_ < 420 or in_cbd or (tall and dr_ < 4000)): continue
    area = gg.area
    if hh is None:
        if btype in ('house', 'detached', 'semidetached_house', 'residential', 'bungalow', 'terrace'): hh = 6.0
        elif btype in ('apartments',): hh = 13.0
        elif btype in ('garage', 'garages', 'shed', 'hut', 'kiosk', 'toilets', 'carport'): hh = 3.0
        elif btype in ('roof',): hh = 4.0
        elif btype in ('boathouse',): hh = 5.0
        elif btype in ('commercial', 'retail', 'office'): hh = 10.0 if not in_cbd else 28.0
        elif btype in ('industrial', 'warehouse'): hh = 10.0
        elif btype in ('church', 'cathedral'): hh = 14.0
        elif btype in ('university', 'school', 'college', 'public', 'civic'): hh = 12.0
        elif btype in ('hotel',): hh = 22.0
        else: hh = 5.5 if area < 300 else (8.0 if area < 1500 else 11.0)
        if in_cbd and area > 600 and btype not in ('house', 'detached', 'garage', 'shed'): hh = max(hh, 24.0)
    style = 0
    if area < 450 and hh <= 7.5 and btype not in ('garage', 'shed', 'roof', 'garages', 'carport'): style = 1  # hip roof house
    if hh >= 45: style = 2  # tower (glass)
    if btype == 'roof': style = 3
    for p in getattr(gg, 'geoms', [gg]):
        if p.geom_type != 'Polygon' or p.area < 8: continue
        p = p.simplify(0.6, preserve_topology=False)
        if p.is_empty or p.geom_type != 'Polygon': continue
        ext = np.asarray(p.exterior.coords)[:-1]
        if len(ext) < 3 or len(ext) > 250: continue
        if not Polygon(ext).exterior.is_ccw: ext = ext[::-1]
        q = np.round(ext * 2).astype(np.int32)
        if np.abs(q).max() > 32000: continue
        bld_coords.append(q.astype(np.int16))
        colour = int(oid % 7)
        bld_meta.append((len(ext), int(min(hh, 400) * 10), style, colour))
        nb += 1
print('buildings kept', nb, 'verts', sum(len(c) for c in bld_coords))
coords = np.concatenate(bld_coords).astype('<i2').tobytes()
meta = np.array(bld_meta, dtype=np.uint16)
counts = meta[:, 0].astype(np.uint8).tobytes()
heights = meta[:, 1].astype('<u2').tobytes()
styles = (meta[:, 2] * 16 + meta[:, 3]).astype(np.uint8).tobytes()
world['buildings'] = {'n': nb, 'counts': base64.b64encode(counts).decode(), 'heights': base64.b64encode(heights).decode(),
                      'styles': base64.b64encode(styles).decode(), 'coords': base64.b64encode(coords).decode()}

# POIs --------------------------------------------------------------------------
pois = []
for p in d['pois']:
    t = p[3]
    x, z = xz(p[1], p[2])
    kind = t.get('man_made') or t.get('natural') or t.get('amenity') or t.get('place') or t.get('tourism') or t.get('historic') or t.get('leisure')
    nm = t.get('name', '')
    if kind in ('crane', 'lighthouse', 'beacon') or (nm and kind in ('bay', 'cape', 'beach', 'suburb', 'ferry_terminal', 'peak', 'marina')):
        pois.append({'k': kind, 'n': nm, 'x': r1(x), 'z': r1(z)})
world['pois'] = pois

# named buildings / landmarks (centroids) used for special models
LM = ['Crawley Edge Boatshed', 'The Bell Tower', 'South Mole Lighthouse', 'Round House', 'State War Memorial', 'DNA Tower',
      'Fremantle Water Police', 'Royal Perth Yacht Club', 'Western Australian Maritime Museum', 'Old Swan Brewery', 'Winthrop Hall',
      'Indiana Tea House', 'Crown Towers, Perth', 'Perth Convention & Exhibition Centre', 'B Shed', 'Fremantle Passenger Terminal',
      'Matilda Bay Restaurant', 'Mosmans Restaurant', 'Ferris Wheel']
lms = {}
for oid, fw, g, t in d['buildings']:
    nm = t.get('name', '')
    if nm in LM and nm not in lms:
        c = gxz(g).centroid
        lms[nm] = [r1(c.x), r1(c.y)]
for rec in d['landuse']:
    if len(rec) != 4: continue
    oid, fw, g, t = rec
    if t.get('leisure') == 'stadium' and 'Optus' in (t.get('name') or ''):
        c = gxz(g).centroid; lms['Optus Stadium'] = [r1(c.x), r1(c.y)]
world['landmarks'] = lms
print('landmarks', lms.keys())

# people spots along the shoreline (parks, beaches) --------------------------------
spots = []
bnd = reach.boundary
L = bnd.length
step = 22.0
for s in np.arange(0, L, step):
    p = bnd.interpolate(s)
    q = bnd.interpolate(min(s + 2, L))
    tx, tz = q.x - p.x, q.y - p.y
    ln = math.hypot(tx, tz) or 1
    nx_, nz_ = -tz / ln, tx / ln     # one of the normals; pick the one pointing to land
    for sgn in (1, -1):
        lx, lz = p.x + sgn * nx_ * 7, p.y + sgn * nz_ * 7
        if sample(sdf, lx, lz) > 2: break
    else:
        continue
    cv = int(sample(cov, lx, lz))
    if cv in (C_SAND, C_PARK, C_PITCH, C_GOLF):
        ang = math.atan2(-(sgn * nx_), -(sgn * nz_))
        spots.append([r1(lx), r1(lz), round(ang, 2), cv])
world['spots'] = spots
print('shore spots', len(spots))

# trees: sample positions from cover classes near water (client also scatters procedurally)
isl = []
isl_src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'islands_gshhs.json')
if os.path.exists(isl_src):
    for o in json.load(open(isl_src)):
        if o['n'] > 2000 or o['n'] < 40: continue
        c = Polygon(o['pts']).centroid
        isl.append({'name': 'Rottnest Island' if c.x < 115.6 else 'Garden Island',
                    'pts': [[r1(a), r1(b)] for a, b in (xz(x, y) for x, y in o['pts'])]})
world['islands'] = isl
json.dump(world, open(os.path.join(OUT, 'world.json'), 'w'), separators=(',', ':'))
print('world.json bytes', os.path.getsize(os.path.join(OUT, 'world.json')))
