import sys,pickle, shapely
sys.path.insert(0,'tools')
from proj import *
from shapely.geometry import Point
water = pickle.load(open('water_xz.pkl','rb'))
mx,mz = to_xz(115.82,-32.0)   # Melville Water
comps = list(water.geoms)
main = [c for c in comps if c.contains(Point(mx,mz))][0]
print('main comp area km2', main.area/1e6, 'of', water.area/1e6)
pickle.dump(main, open('reach_xz.pkl','wb'))
