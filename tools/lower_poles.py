"""Halve the height of the melon trellis poles / vines (melon farm) and the grow-poles in the controlled shed (greenhouse).

Run once on the WEB working copy (never on the user's original file):
  blender -b Navita_Melon_Form_WEB.blend --python tools/lower_poles.py
It saves the .blend in place. Melons / leaves keep their size (only their position moves down), poles / wires / stems are
shortened to half. Also moves a few place labels to their exact spots.
"""
import bpy, bmesh

K = 0.5            # height factor


def islands(bm):
    seen, out = set(), []
    for v in bm.verts:
        if v.index in seen:
            continue
        st, comp = [v], []
        seen.add(v.index)
        while st:
            a = st.pop(); comp.append(a)
            for e in a.link_edges:
                b = e.other_vert(a)
                if b.index not in seen:
                    seen.add(b.index); st.append(b)
        out.append(comp)
    return out


def ext(comp):
    xs = [v.co.x for v in comp]; ys = [v.co.y for v in comp]; zs = [v.co.z for v in comp]
    return min(zs), max(zs), max(max(xs) - min(xs), max(ys) - min(ys))


def run(o, rule):
    bm = bmesh.new(); bm.from_mesh(o.data)
    for comp in islands(bm):
        zmin, zmax, xy = ext(comp)
        mode = rule(zmin, zmax, xy, len(comp))
        if mode is None:
            continue
        kind, base = mode
        for v in comp:
            if kind == 'scale':
                v.co.z = base + (v.co.z - base) * K
            else:                                    # 'move': keep the size, shift like the anchor point would shift
                anchor = zmin if kind == 'move_bottom' else (zmin + zmax) / 2
                v.co.z += base + (anchor - base) * K - anchor
    bm.to_mesh(o.data); bm.free(); o.data.update()


def plant_rule(zmin, zmax, xy, n):
    if (zmax - zmin) > 0.9 or xy > 1.2 or xy < 0.2:      # pole, cross bar, thin stalks
        return ('scale', 0.0)
    if n >= 30:                                           # a melon
        return ('move_centre', 0.0)
    return ('move_bottom', 0.0)                           # leaf


def interior_rule(zmin, zmax, xy, n):
    if (zmax - zmin) > 1.0:                               # poles
        return ('scale', 0.25)
    if zmin > 1.0 and xy > 3.0:                           # rails / grow-lights along the poles
        return ('move_centre', 0.25)
    return None


cnt = 0
done = set()                      # many plants share ONE mesh: change each mesh only once (else it shrinks again and again)
for o in bpy.data.objects:
    if o.type != 'MESH' or o.data.name in done:
        continue
    done.add(o.data.name)
    if o.name.startswith('MelonPlant_') or o.name.startswith('GH_Plant_'):
        run(o, plant_rule); cnt += 1
    elif o.name.startswith('Trellis_'):
        run(o, lambda zmin, zmax, xy, n: ('scale', 0.0)); cnt += 1
    elif o.name == 'GH_Interior':
        run(o, interior_rule); cnt += 1
print('[LOWER] meshes changed', cnt)

# labels: exact spots
LABELS = {'LABEL_cafe': (60, 120), 'LABEL_drive_through': (203, 58), 'LABEL_drive_through_exit': (227, 80)}
for n, (x, y) in LABELS.items():
    o = bpy.data.objects.get(n)
    if o:
        o.location.x, o.location.y = x, y

bpy.ops.wm.save_mainfile()
print('[LOWER] saved')
