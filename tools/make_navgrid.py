import bpy, sys, json, base64, struct
from mathutils import Vector
from mathutils.bvhtree import BVHTree

out = sys.argv[sys.argv.index('--') + 1]
nm = bpy.data.objects['NavMesh']
me = nm.data
verts = [nm.matrix_world @ v.co for v in me.vertices]
tris = [tuple(p.vertices) for p in me.polygons]
bvh = BVHTree.FromPolygons(verts, tris)
X0, Y0, NX, NY, CELL = 25.0, 0.0, 231, 237, 1.0
flags = bytearray(NX * NY)
zcm = [0] * (NX * NY)
n = 0
D = Vector((0, 0, -1))
for j in range(NY):
    for i in range(NX):
        h = bvh.ray_cast(Vector((X0 + (i + .5) * CELL, Y0 + (j + .5) * CELL, 80)), D)
        if h[0] is not None:
            k = j * NX + i
            flags[k] = 1
            zcm[k] = int(round((h[0].z - 0.02) * 100))
            n += 1
# rooms with open (dashed glass) sides that the NavMesh treated as solid: (x0, y0, x1, y1, floor height) in Blender metres
OPEN_ROOMS = [
    (134, 125, 154, 147, 0.42),                    # Melon Information 3 (east wing)
    (53, 54, 80, 90, 0.30),                        # greenhouse (controlled shed) floor
    (80, 66, 82, 70, 0.30),                        # greenhouse door on the east side
]
for xa, ya, xb, yb, zf in OPEN_ROOMS:
    for y in range(ya, yb + 1):
        for x in range(xa, xb + 1):
            k = (y - int(Y0)) * NX + (x - int(X0))
            if not flags[k]:
                n += 1
            flags[k] = 1
            zcm[k] = int(round((zf - 0.02) * 100))
data = dict(x0=X0, y0=Y0, nx=NX, ny=NY, cell=CELL,
            note='Blender coords: cell (i,j) covers x=x0+i..x0+i+1, y=y0+j..y0+j+1. three.js world: X=x, Z=-y.',
            flags=base64.b64encode(bytes(flags)).decode(),
            zcm=base64.b64encode(struct.pack('<%dh' % len(zcm), *zcm)).decode())
json.dump(data, open(out, 'w'))
print('[NAV] walkable cells', n)
