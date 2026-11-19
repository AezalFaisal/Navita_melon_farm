"""Export the farm as FBX with embedded textures (for sharing).
Run on a COPY of the .blend:  blender -b copy.blend --python tools/export_fbx.py -- out.fbx
What FBX can and cannot carry:
  - plain colours and UV-mapped image textures are kept
  - roof "image x tint" is baked into a new image so the colour is kept
  - procedural shaders (marble, brick, bark ...) cannot be stored in FBX: they become a flat colour
"""
import bpy, sys, os, time, collections

out = sys.argv[sys.argv.index('--') + 1]
t0 = time.time()
def log(*a): print('[FBX]', *a, flush=True)

# ------------------------------------------------------------------ 1. realise trees (geometry nodes) and text
bpy.ops.object.select_all(action='DESELECT')
for o in bpy.data.objects:
    if o.name.startswith('Sprig_'):
        o.hide_set(False) if False else None
SK = set(os.environ.get('SKIP', '').split(','))
gn = [] if 'real' in SK else [o for o in bpy.data.objects if o.type == 'MESH' and any(m.type == 'NODES' for m in o.modifiers)]
txt = [] if 'text' in SK else [o for o in bpy.data.objects if o.type == 'FONT']
log('geometry-node objects', len(gn), 'text objects', len(txt))
# text -> real mesh objects first, using a fresh evaluation (no operators: they can crash in background mode)
for o in txt:
    me = bpy.data.meshes.new_from_object(o.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    if me is None or len(me.polygons) == 0: continue
    nm = o.name
    new = bpy.data.objects.new(nm + '_mesh', me)
    new.matrix_world = o.matrix_world.copy()
    for c in o.users_collection: c.objects.link(new)
    bpy.data.objects.remove(o)
    new.name = nm
bpy.context.view_layer.update()
log('text converted')
dg = bpy.context.evaluated_depsgraph_get()
before = {}
for o in gn:
    # build a real mesh containing the node output AND its instances (leaves)
    import bmesh
    e = o.evaluated_get(dg)
    bm = bmesh.new()
    me0 = bpy.data.meshes.new_from_object(e)
    bm.from_mesh(me0)
    # materials of the realised mesh: trunk uses the Bark material, leaf instances use their own
    inv = o.matrix_world.inverted()
    mats = [s.material for s in o.material_slots] or list(me0.materials)
    slot_of = {}
    for m in me0.materials:
        pass
    leaf_mats = {}
    for oi in dg.object_instances:
        if oi.is_instance and oi.parent and oi.parent.name == o.name:
            sm = oi.object.data
            lm = sm.materials[0] if sm.materials else None
            if lm not in leaf_mats:
                leaf_mats[lm] = len(me0.materials) + len(leaf_mats)
            M = inv @ oi.matrix_world
            vs = [bm.verts.new(M @ v.co) for v in sm.vertices]
            for p in sm.polygons:
                try:
                    f = bm.faces.new([vs[i] for i in p.vertices]); f.material_index = leaf_mats[lm]
                except ValueError:
                    pass
    me = bpy.data.meshes.new(o.name + '_real')
    bm.to_mesh(me); bm.free()
    for m in me0.materials: me.materials.append(m)
    for lm in leaf_mats: me.materials.append(lm)
    bpy.data.meshes.remove(me0)
    # leave the original (geometry-nodes) object untouched; add a plain mesh copy and export that instead
    nm = o.name
    new = bpy.data.objects.new(nm + '_real', me)
    new.matrix_world = o.matrix_world.copy()
    for c in o.users_collection: c.objects.link(new)
    o.name = 'SRC_' + nm; new.name = nm
    before[nm] = len(me.polygons)
log('trees realised; faces per tree (first 3):', list(before.values())[:3], 'total', sum(before.values()))
del dg                                   # never reuse a stale evaluation after changing the scene
bpy.context.view_layer.update()

# ------------------------------------------------------------------ 2. materials
def srgb2lin(c): return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def lin2srgb(c): return c * 12.92 if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055
_imgavg = {}
def ev(sock, depth=0):
    if depth > 12: return (0.5, 0.5, 0.5)
    if not sock.is_linked:
        dv = sock.default_value
        try: return tuple(dv[:3]) if len(dv) >= 3 else (dv, dv, dv)
        except TypeError: return (dv, dv, dv)
    n = sock.links[0].from_node; t = n.type
    if t == 'VALTORGB': return tuple(n.color_ramp.evaluate(0.5)[:3])
    if t == 'RGB': return tuple(n.outputs[0].default_value[:3])
    if t == 'TEX_IMAGE':
        im = n.image
        if im is None: return (0.5, 0.5, 0.5)
        if im.name not in _imgavg:
            px = list(im.pixels[:]); k = max(1, len(px) // 4)
            _imgavg[im.name] = tuple(sum(px[c::4]) / k for c in range(3))     # pixels are already linear
        return _imgavg[im.name]
    if t in ('MIX', 'MIX_RGB'):
        ins = list(n.inputs)
        if t == 'MIX_RGB': f, a, b = ins[0], ins[1], ins[2]
        else:
            f = ins[0]; a = next(i for i in ins if i.name == 'A' and i.type == 'RGBA'); b = next(i for i in ins if i.name == 'B' and i.type == 'RGBA')
        fv = 0.5 if f.is_linked else f.default_value
        ca, cb = ev(a, depth + 1), ev(b, depth + 1)
        return tuple(ca[k] * (1 - fv) + cb[k] * fv for k in range(3))
    if t == 'TEX_BRICK':
        c1 = n.inputs['Color1'].default_value; c2 = n.inputs['Color2'].default_value
        return tuple(c1[k] * 0.5 + c2[k] * 0.5 for k in range(3))
    if t in ('HUE_SAT', 'BRIGHTCONTRAST', 'GAMMA', 'INVERT'):
        for i in n.inputs:
            if i.type == 'RGBA': return ev(i, depth + 1)
    return (0.5, 0.5, 0.5)

report = collections.OrderedDict()
# FBX only understands "Principled BSDF -> Material Output". Materials that go through a Mix Shader (the leaf shaders)
# are re-linked straight to their Principled BSDF, otherwise the exporter writes a default grey material.
rewired = []
for m in bpy.data.materials:
    if not (m.use_nodes and m.node_tree) or m.users == 0: continue
    outn = next((n for n in m.node_tree.nodes if n.type == 'OUTPUT_MATERIAL' and n.is_active_output), None)
    pb = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if outn and pb:
        surf = outn.inputs['Surface']
        if not surf.is_linked or surf.links[0].from_node is not pb:
            m.node_tree.links.new(pb.outputs['BSDF'], surf); rewired.append(m.name)
log('re-linked to Principled:', rewired)
texdir = os.path.join(os.path.dirname(out), 'textures'); os.makedirs(texdir, exist_ok=True)
for m in ([] if 'mat' in SK else bpy.data.materials):
    if not (m.use_nodes and m.node_tree) or m.users == 0: continue
    p = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if p is None: continue
    bc = p.inputs['Base Color']
    if not bc.is_linked: continue
    # what feeds the colour?
    stack = [bc.links[0].from_node]; seen = set(); has_img = False; nonuv = False; mix = None; img_node = None
    while stack:
        x = stack.pop()
        if x in seen: continue
        seen.add(x)
        if x.type == 'TEX_IMAGE': has_img = True; img_node = x
        if x.type == 'MIX' and mix is None: mix = x
        for i in x.inputs:
            if i.is_linked:
                lk = i.links[0]
                if lk.from_node.type == 'TEX_COORD' and lk.from_socket.name != 'UV': nonuv = True
                stack.append(lk.from_node)
    direct_img = bc.links[0].from_node.type == 'TEX_IMAGE'
    if has_img and not nonuv and direct_img:
        report[m.name] = 'kept (image texture)'; continue
    if has_img and not nonuv and mix is not None and mix.blend_type == 'MULTIPLY':
        # bake  image x tint  into a new image and plug it straight into Base Color
        src = img_node.image
        tint = None
        for i in mix.inputs:
            if i.type == 'RGBA' and not i.is_linked: tint = tuple(i.default_value[:3])
        w, h = src.size; px = list(src.pixels[:])
        newpx = [0.0] * len(px)
        # Image.pixels are already scene-linear, and so is the tint colour: a plain per-channel multiply = the node's result
        for k in range(0, len(px), 4):
            for c in range(3):
                newpx[k + c] = min(1.0, max(0.0, px[k + c] * tint[c]))
            newpx[k + 3] = 1.0
        log('bake', m.name, 'tint', tint, 'src mean %.3f' % (sum(px) / len(px)), 'result mean %.3f' % (sum(newpx) / len(newpx)))
        im = bpy.data.images.new(m.name + '_baked', w, h)
        im.pixels = newpx                                             # (new images are sRGB by default)
        tex_path = os.path.join(texdir, m.name + '_baked.png')       # a real file on disk so the FBX can embed it
        im.filepath_raw = tex_path; im.file_format = 'PNG'; im.save()
        chk = list(im.pixels[:]); log('  saved', os.path.basename(tex_path), 'mean %.3f' % (sum(chk) / len(chk)))
        im.source = 'FILE'; im.filepath = tex_path; im.reload()
        img_node.image = im
        m.node_tree.links.new(img_node.outputs['Color'], bc)
        report[m.name] = 'baked tint into texture'
        continue
    col = ev(bc)
    LEAF = {'Leaf_TallShadeTree': (0.11, 0.22, 0.05), 'Leaf_RainTree': (0.10, 0.24, 0.05), 'Leaf_MangoTree': (0.05, 0.17, 0.04), 'Leaf_HedgeShrub': (0.10, 0.22, 0.05)}
    if m.name in LEAF: col = LEAF[m.name]          # these shaders colour each leaf at random: use their typical green
    for lk in list(bc.links): m.node_tree.links.remove(lk)
    bc.default_value = (*col, 1)
    report[m.name] = 'FLATTENED to colour (%.2f, %.2f, %.2f)' % col
for k, v in report.items(): log('material', k, '->', v)

# ------------------------------------------------------------------ 3. export
bad = 0
for me in bpy.data.meshes:
    if me.users and me.validate(verbose=False, clean_customdata=True): bad += 1
log('meshes repaired:', bad)
log('selecting')
for o in bpy.context.view_layer.objects: o.select_set(False)
skip = os.environ.get('FBX_SKIP_TREES') == '1'
cand = sorted([o for o in bpy.context.view_layer.objects if o.type == 'MESH' and not o.name.startswith(('SRC_', 'Sprig_'))
               and not (skip and o.name.startswith(('TallShadeTree_', 'RainTree_', 'MangoTree_', 'HedgeShrub_')))], key=lambda o: o.name)
rng = os.environ.get('FBX_RANGE')                       # debugging aid: "start,end"
if rng:
    a, b = map(int, rng.split(',')); cand = cand[a:b]
for o in cand: o.select_set(True)
log('exporting', sum(1 for o in bpy.context.view_layer.objects if o.select_get()), 'objects')
bpy.context.view_layer.update()
os.makedirs(os.path.dirname(out), exist_ok=True)
embed = os.environ.get('FBX_EMBED', '1') == '1'
bpy.ops.export_scene.fbx(filepath=out, use_selection=True, object_types={'MESH'}, use_mesh_modifiers=False,
                         path_mode='COPY' if embed else 'AUTO', embed_textures=embed, apply_unit_scale=True, apply_scale_options='FBX_SCALE_ALL',
                         axis_forward='-Z', axis_up='Y', mesh_smooth_type='FACE', bake_anim=False, add_leaf_bones=False)
log('written', out, round(os.path.getsize(out) / 1e6, 1), 'MB in', round(time.time() - t0), 's')
with open(os.path.splitext(out)[0] + '_materials.txt', 'w') as f:
    f.write('Materials that FBX cannot store exactly (see the .blend for the originals):\n\n')
    for k, v in report.items(): f.write('%s: %s\n' % (k, v))

