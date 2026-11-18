import pickle, math, json
import numpy as np
from shapely.geometry import box, LineString, Polygon, MultiPolygon
from shapely.ops import linemerge, split, unary_union
d=pickle.load(open('osm_raw.pkl','rb'))
W,S,E,N = 115.66,-32.14,115.97,-31.87
bb=box(W,S,E,N)
lines=[LineString(c[1]) for c in d['coast']]
m=linemerge(lines)
print(m.geom_type, [len(g.coords) for g in getattr(m,'geoms',[m])])
geoms = list(getattr(m,'geoms',[m]))
# main coast = longest; others are islets
main = max(geoms,key=lambda g:g.length)
cut = main.intersection(bb)
parts = split(bb, cut)
print('split parts', len(parts.geoms))
ocean = None
for p in parts.geoms:
    c=p.representative_point()
    print(p.area, c.x, c.y)
    if c.x < 115.72: ocean = p if ocean is None else ocean.union(p)
# islets (closed rings) are land within ocean
for g in geoms:
    if g is main: continue
    if g.is_ring: ocean = ocean.difference(Polygon(g.coords))
water_areas=[w[3] for w in d['water'] if w[0]=='area']
water = unary_union([ocean]+[w.buffer(0) for w in water_areas]).intersection(bb)
pickle.dump({'ocean':ocean,'water':water}, open('water.pkl','wb'))
print('water area deg2', water.area, 'ocean', ocean.area)
