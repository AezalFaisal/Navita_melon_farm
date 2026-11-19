import bpy, bmesh, os, sys, time, collections

t0 = time.time()
OUT = sys.argv[sys.argv.index('--') + 1]
TREES = ('TallShadeTree_', 'RainTree_', 'MangoTree_', 'HedgeShrub_')


def log(*a):
    print('[EXP]', *a, flush=True)


_imgavg = {}
# ---------- colour evaluator for procedural materials ----------
def ev(sock, depth=0):
    if depth > 12:
        return (0.5, 0.5, 0.5)
    if not sock.is_linked:
        dv = sock.default_value
        try:
            return tuple(dv[:3]) if len(dv) >= 3 else (dv, dv, dv)
        except TypeError:
            return (dv, dv, dv)
    n = sock.links[0].from_node
    t = n.type
    if t == 'VALTORGB':
        return tuple(n.color_ramp.evaluate(0.5)[:3])
    if t == 'RGB':
        return tuple(n.outputs[0].default_value[:3])
    if t == 'TEX_IMAGE':
        im = n.image
        if im is None:
            return (0.5, 0.5, 0.5)
        if im.name not in _imgavg:
            px = list(im.pixels[:])
            k = max(1, len(px) // 4)
            _imgavg[im.name] = tuple(sum(px[c::4]) / k for c in range(3))
        return _imgavg[im.name]
    if t in ('MIX', 'MIX_RGB'):
        ins = list(n.inputs)
        if t == 'MIX_RGB':
            f, a, b = ins[0], ins[1], ins[2]
        else:
            f = ins[0]
            a = next(i for i in ins if i.name == 'A' and i.type == 'RGBA')
            b = next(i for i in ins if i.name == 'B' and i.type == 'RGBA')
        fv = 0.5 if f.is_linked else f.default_value
        ca, cb = ev(a, depth + 1), ev(b, depth + 1)
        return tuple(ca[k] * (1 - fv) + cb[k] * fv for k in range(3))
    if t == 'TEX_BRICK':
        c1 = n.inputs['Color1'].default_value
        c2 = n.inputs['Color2'].default_value
        return tuple(c1[k] * 0.5 + c2[k] * 0.5 for k in range(3))
    if t in ('HUE_SAT', 'BRIGHTCONTRAST', 'GAMMA', 'INVERT'):
        for i in n.inputs:
            if i.type == 'RGBA':
                return ev(i, depth + 1)
    return (0.5, 0.5, 0.5)


flat = {}


def flat_mat(m):
    if m is None:
        return None
    if m.name in flat:
        return flat[m.name]
    if not (m.use_nodes and m.node_tree):
        flat[m.name] = m
        return m
    p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if p is None:
        flat[m.name] = m
        return m
    bc = p.inputs['Base Color']
    has_img = False
    nonuv = False
    if bc.is_linked:
        stack = [bc.links[0].from_node]
        seen = set()
        while stack:
            x = stack.pop()
            if x in seen:
                continue
            seen.add(x)
            if x.type == 'TEX_IMAGE':
                has_img = True
            for i in x.inputs:
                if i.is_linked:
                    lk = i.links[0]
                    if lk.from_node.type == 'TEX_COORD' and lk.from_socket.name != 'UV':
                        nonuv = True
                    stack.append(lk.from_node)
    if (has_img and not nonuv) or not bc.is_linked:
        flat[m.name] = m
        return m
    col = ev(bc)
    nm = bpy.data.materials.new('EXP_' + m.name)
    nm.use_nodes = True
    q = next(n for n in nm.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    q.inputs['Base Color'].default_value = (*col, 1)
    for k in ('Metallic', 'Roughness', 'Alpha', 'IOR', 'Transmission Weight', 'Emission Strength'):
        if k in p.inputs and k in q.inputs:
            try:
                q.inputs[k].default_value = p.inputs[k].default_value
            except Exception:
                pass
    if 'Emission Color' in p.inputs and not p.inputs['Emission Color'].is_linked:
        q.inputs['Emission Color'].default_value = p.inputs['Emission Color'].default_value
    nm.use_backface_culling = False
    flat[m.name] = nm
    log('flattened', m.name, tuple(round(c, 2) for c in col))
    return nm


scene = bpy.context.scene
dg = bpy.context.evaluated_depsgraph_get()
leafmat = {sp: bpy.data.materials['Leaf_Web_' + sp] for sp in ('TallShadeTree', 'RainTree', 'MangoTree', 'HedgeShrub')}

# ---------- bake meshes (modifiers applied), flatten materials ----------
baked = []   # (name, mesh, matrix)
for o in scene.objects:
    if o.type not in ('MESH', 'FONT'):
        continue
    if o.name.startswith(TREES) or o.name.startswith('Sprig_') or o.name == 'NavMesh' or o.name.startswith(('LABEL_', 'POI_')):
        continue
    if o.hide_render or o.hide_get():
        continue
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
    if me is None or len(me.polygons) == 0:
        if me:
            bpy.data.meshes.remove(me)
        continue
    slots = [s.material for s in o.material_slots]
    if not slots:
        slots = list(me.materials)
    mats = [flat_mat(m) for m in slots]
    while len(me.materials) < len(mats):
        me.materials.append(None)
    for i, m in enumerate(mats):
        me.materials[i] = m   # in-place swap keeps per-face material_index
    me.transform(o.matrix_world)
    baked.append((o.name, me))
log('baked', len(baked), round(time.time() - t0, 1))

# ---------- merge by material signature (bmesh) ----------
groups = collections.defaultdict(list)
for name, me in baked:
    groups[tuple(m.name if m else '' for m in me.materials)].append((name, me))
col = bpy.data.collections.new('EXP_OUT')
scene.collection.children.link(col)
faces_before = sum(len(me.polygons) for _, me in baked)
out_objs = []
for gi, (sig, lst) in enumerate(groups.items()):
    if len(lst) == 1:
        name, me = lst[0]
        ob = bpy.data.objects.new('EXP_' + name, me)
    else:
        bm = bmesh.new()
        for _, me in lst:
            bm.from_mesh(me)
        newme = bpy.data.meshes.new('EXP_merged_%03d' % gi)
        bm.to_mesh(newme)
        bm.free()
        for m in sig:
            newme.materials.append(bpy.data.materials[m] if m in bpy.data.materials else None)
        ob = bpy.data.objects.new('EXP_merged_%03d' % gi, newme)
        # sanity: face count
        if len(newme.polygons) != sum(len(me.polygons) for _, me in lst):
            log('WARN merge mismatch', gi, len(newme.polygons), sum(len(me.polygons) for _, me in lst))
    col.objects.link(ob)
    out_objs.append(ob)
faces_after = sum(len(o.data.polygons) for o in out_objs)
log('groups', len(groups), 'faces', faces_before, '->', faces_after, round(time.time() - t0, 1))

# ---------- trees: shared proxy meshes ----------
proxy = {}
for sp in leafmat:
    me = bpy.data.meshes['WEB_' + sp].copy()
    me.name = 'EXP_proxy_' + sp
    bark = flat_mat(bpy.data.materials['Bark_' + sp])
    while len(me.materials) < 2:
        me.materials.append(None)
    me.materials[0] = bark
    me.materials[1] = leafmat[sp]
    proxy[sp] = me
nt = 0
for o in scene.objects:
    for sp in proxy:
        if o.name.startswith(sp + '_') and o.type == 'MESH':
            ob = bpy.data.objects.new('EXP_' + o.name, proxy[sp])
            ob.matrix_world = o.matrix_world.copy()
            col.objects.link(ob)
            out_objs.append(ob)
            nt += 1
log('trees', nt)

# ---------- hide everything else, export only EXP_OUT ----------
bpy.context.view_layer.update()
for o in bpy.context.view_layer.objects:
    o.select_set(False)
for o in out_objs:
    o.select_set(True)
bpy.context.view_layer.objects.active = out_objs[0]
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=False,
                          export_yup=True, export_image_format='JPEG', export_jpeg_quality=85,
                          export_lights=False, export_cameras=False, export_extras=False)
log('GLB MB', round(os.path.getsize(OUT) / 1e6, 2), 'total s', round(time.time() - t0, 1))
