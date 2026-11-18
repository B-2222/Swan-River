import sys, pickle, numpy as np, shapely, time
sys.path.insert(0,'tools')
from proj import *
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt
t0=time.time()
wp = pickle.load(open('water.pkl','rb'))
water = geom_xz(wp['water'])
SS=3
img = Image.new('L', (NX*SS, NZ*SS), 0)
dr = ImageDraw.Draw(img)
def px(c): return [((x-X0)/CELL*SS, (z-Z0)/CELL*SS) for x,z in c]
polys = list(getattr(water,'geoms',[water]))
for p in polys:
    dr.polygon(px(p.exterior.coords), fill=255)
for p in polys:
    for r in p.interiors: dr.polygon(px(r.coords), fill=0)
a = np.asarray(img, dtype=np.uint8).reshape(NZ,SS,NX,SS).mean(axis=(1,3))
mask = a > 127   # True = water (cell center majority)
print('mask', mask.mean(), time.time()-t0)
din = distance_transform_edt(mask)*CELL   # inside water distance to land
dout = distance_transform_edt(~mask)*CELL
sdf = np.where(mask, -din + CELL*0.5, dout - CELL*0.5).astype(np.float32)  # + = land
# exact refinement near shore
near = np.abs(sdf) < 60
iz, ix = np.nonzero(near)
pts = shapely.points(X0 + (ix+0.5)*CELL, Z0 + (iz+0.5)*CELL)
segs=[]
for p in polys:
    for r in [p.exterior]+list(p.interiors):
        c=np.asarray(r.coords)
        segs.append(shapely.linestrings(np.stack([c[:-1],c[1:]],axis=1)))
segs=np.concatenate(segs)
print('segments', len(segs), 'near pts', len(pts))
tree = shapely.STRtree(segs)
idx, dist = tree.query_nearest(pts, return_distance=True, all_matches=False)
dd = np.zeros(len(pts)); dd[idx[0]] = dist
inside = shapely.contains_xy(water, X0 + (ix+0.5)*CELL, Z0 + (iz+0.5)*CELL)
sdf[iz,ix] = np.where(inside, -dd, dd)
np.save('sdf.npy', sdf)
pickle.dump(water, open('water_xz.pkl','wb'))
print('done', time.time()-t0, sdf.min(), sdf.max())
