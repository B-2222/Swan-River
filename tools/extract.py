# Extract features from the Perth OSM extract into a pickle of shapely geometries.
import osmium, pickle, sys
from shapely.geometry import Polygon, MultiPolygon, LineString, Point
from shapely import wkb
W,S,E,N = 115.66,-32.14,115.97,-31.87
fab = osmium.geom.WKBFactory()
out = {'water':[], 'coast':[], 'bridges':[], 'piers':[], 'breakwater':[], 'buildings':[], 'roads':[], 'rail':[], 'landuse':[], 'pois':[], 'manmade_bridge':[], 'marina':[], 'slipway':[]}
def inb(lon,lat): return W<=lon<=E and S<=lat<=N
ROADS = {'motorway','trunk','primary','secondary','tertiary','motorway_link','trunk_link','primary_link','residential','unclassified','service','footway','cycleway','path','pedestrian','living_street','secondary_link','tertiary_link'}
LU = {('leisure','park'),('leisure','golf_course'),('leisure','pitch'),('leisure','nature_reserve'),('landuse','grass'),('landuse','recreation_ground'),('natural','wood'),('natural','scrub'),('natural','heath'),('natural','grassland'),('natural','beach'),('natural','sand'),('landuse','forest'),('landuse','residential'),('landuse','industrial'),('landuse','commercial'),('landuse','retail'),('landuse','railway'),('natural','wetland'),('landuse','port'),('amenity','parking'),('leisure','stadium'),('landuse','cemetery'),('amenity','university'),('amenity','school'),('landuse','construction'),('natural','bare_rock'),('natural','cliff'),('landuse','meadow'),('leisure','garden')}
class H(osmium.SimpleHandler):
    def way(self, w):
        t = w.tags
        try:
            nodes = [(n.lon,n.lat) for n in w.nodes]
        except osmium.InvalidLocationError:
            return
        if not any(inb(x,y) for x,y in nodes): return
        tg = dict(t)
        if t.get('natural')=='coastline': out['coast'].append((w.id,nodes,tg)); return
        if 'bridge' in t and t.get('bridge')!='no' and ('highway' in t or 'railway' in t):
            out['bridges'].append((w.id,nodes,tg))
        if t.get('man_made') in ('pier',): out['piers'].append((w.id,nodes,tg))
        if t.get('man_made') in ('breakwater','groyne') : out['breakwater'].append((w.id,nodes,tg))
        if t.get('highway') in ROADS and t.get('area')!='yes': out['roads'].append((w.id,nodes,tg))
        if t.get('railway') in ('rail','light_rail') : out['rail'].append((w.id,nodes,tg))
        if t.get('natural')=='cliff': out['landuse'].append((w.id,nodes,tg))
        if t.get('waterway') in ('river','canal','stream','dam','weir') : out['water'].append(('line',w.id,nodes,tg))
    def area(self, a):
        t = a.tags; tg = dict(t)
        is_water = t.get('natural')=='water' or t.get('waterway')=='riverbank' or t.get('landuse') in ('reservoir','basin') or t.get('water') is not None and t.get('natural')=='water'
        b = 'building' in t and t.get('building')!='no'
        mmb = t.get('man_made')=='bridge'
        lu = any((k,t.get(k)) in LU for k in ('leisure','landuse','natural','amenity'))
        pier = t.get('man_made') in ('pier','breakwater','groyne')
        marina = t.get('leisure')=='marina'
        if not (is_water or b or mmb or lu or pier or marina): return
        try:
            g = wkb.loads(fab.create_multipolygon(a), hex=True)
        except Exception as e:
            return
        mn = g.bounds
        if mn[2]<W or mn[0]>E or mn[3]<S or mn[1]>N: return
        rec = (a.orig_id(), a.from_way(), g, tg)
        if is_water: out['water'].append(('area',)+rec)
        if b: out['buildings'].append(rec)
        if mmb: out['manmade_bridge'].append(rec)
        if lu: out['landuse'].append(rec)
        if pier: out['piers'].append(('area',)+rec)
        if marina: out['marina'].append(rec)
    def node(self, n):
        t = n.tags
        if len(t)==0: return
        if not inb(n.location.lon, n.location.lat): return
        keys = ('man_made','leisure','tourism','amenity','place','natural','historic','seamark:type','highway')
        tg = dict(t)
        if t.get('man_made') in ('lighthouse','crane','tower','mast','flagpole','beacon') or t.get('leisure') in ('slipway','marina','beach_resort','swimming_area') or t.get('tourism') in ('attraction','viewpoint','museum') or t.get('place') in ('suburb','neighbourhood','locality','island','islet') or 'seamark:type' in t or t.get('natural') in ('beach','peak','cape','bay','tree') and t.get('natural')!='tree' or t.get('amenity') in ('ferry_terminal','boat_rental','cafe','restaurant') or t.get('historic'):
            out['pois'].append((n.id, n.location.lon, n.location.lat, tg))
h = H()
h.apply_file(sys.argv[1], locations=True, idx='flex_mem')
pickle.dump(out, open(sys.argv[2],'wb'))
for k,v in out.items(): print(k, len(v))
