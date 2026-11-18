LON0, LAT0 = 115.80, -32.00
KX, KZ = 94492.0, 110887.0
def to_xz(lon, lat): return ((lon-LON0)*KX, (LAT0-lat)*KZ)
CELL = 15.0
X0, Z0 = -13230.0, -14415.0   # grid origin (north-west corner), meters
NX, NZ = 1960, 1998
def geom_xz(g):
    import shapely
    return shapely.transform(g, lambda c: __import__('numpy').column_stack(((c[:,0]-LON0)*KX, (LAT0-c[:,1])*KZ)))
