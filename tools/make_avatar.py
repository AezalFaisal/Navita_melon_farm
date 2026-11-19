"""Builds the "Melon Explorer" avatar: stylised chibi character with a Mixamo-compatible skeleton,
facial shape keys (expressions) and baked animation clips (Idle, Walk, Run, Pick, Wave, Cheer).
Run:  blender -b --python tools/make_avatar.py -- out.glb [preview_dir]
Character faces -Y (Blender) = +Z (glTF/three.js). Height about 1.45 m including the hat.
"""
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix, Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
OUT = argv[0]
PREVIEW = argv[1] if len(argv) > 1 else None
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 24
V = Vector
def log(*a): print('[AV]', *a, flush=True)

# ============================================================ materials
def mat(name, color, rough=0.55, metal=0.0, emit=None, emit_s=0.0, alpha=1.0, image=None):
    m = bpy.data.materials.new(name); m.use_nodes = True
    p = next(n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    if emit:
        p.inputs['Emission Color'].default_value = (*emit, 1); p.inputs['Emission Strength'].default_value = emit_s
    if alpha < 1:
        p.inputs['Alpha'].default_value = alpha; m.blend_method = 'BLEND'
    if image:
        tn = m.node_tree.nodes.new('ShaderNodeTexImage'); tn.image = image
        m.node_tree.links.new(tn.outputs['Color'], p.inputs['Base Color'])
    return m

# melon netting texture (tileable): lime base with a creamy reticulated net
def make_net_texture(path, size=512):
    P = 64
    y, x = np.mgrid[0:size, 0:size].astype(np.float32)
    rng = np.random.default_rng(7)
    def wob(seed, k):
        r = np.random.default_rng(seed); a = np.zeros((size, size), np.float32)
        for _ in range(k):
            fx, fy = r.integers(1, 5), r.integers(1, 5); ph = r.uniform(0, 6.28, 2)
            a += np.sin(2 * math.pi * fx * x / size + ph[0]) * np.sin(2 * math.pi * fy * y / size + ph[1])
        return a / k
    wx, wy = wob(1, 5) * 9, wob(2, 5) * 9
    u = (x + wx + y + wy); v = (x + wx - y - wy)
    d1 = np.abs(np.sin(math.pi * u / P)); d2 = np.abs(np.sin(math.pi * v / P))
    line = np.minimum(d1, d2)
    net = np.clip(1.0 - line / 0.16, 0, 1) ** 1.3
    noise = (wob(3, 9) * 0.5 + 0.5)
    base = np.array([0.62, 0.78, 0.30]) + noise[..., None] * np.array([0.05, 0.05, 0.03])
    cream = np.array([0.93, 0.96, 0.66])
    img = base * (1 - net[..., None]) + cream * net[..., None]
    rgba = np.dstack([img, np.ones((size, size))]).astype(np.float32)
    im = bpy.data.images.new('MelonNet', size, size)
    im.pixels = rgba.ravel()
    im.filepath_raw = path; im.file_format = 'PNG'; im.save()
    return bpy.data.images.load(path)

tex_path = os.path.join(os.path.dirname(OUT), 'melon_net.png')
net_img = make_net_texture(tex_path)

M = {}
M['skin'] = mat('Skin', (0.95, 0.56, 0.38), 0.7)
M['hair'] = mat('Hair', (0.075, 0.04, 0.025), 0.6)
M['hat'] = mat('MelonHat', (1, 1, 1), 0.55, image=net_img)
M['leaf'] = mat('Leaf', (0.16, 0.55, 0.07), 0.5)
M['vest'] = mat('Vest', (0.10, 0.20, 0.045), 0.6)
M['shirt'] = mat('Shirt', (0.85, 0.82, 0.70), 0.7)
M['lime'] = mat('Lime', (0.42, 0.80, 0.07), 0.45, emit=(0.4, 0.9, 0.1), emit_s=0.35)
M['pants'] = mat('Pants', (0.05, 0.045, 0.04), 0.75)
M['glove'] = mat('Glove', (0.025, 0.025, 0.025), 0.6)
M['shoe'] = mat('ShoeWhite', (0.80, 0.80, 0.77), 0.5)
M['sole'] = mat('ShoeSole', (0.10, 0.45, 0.09), 0.5)
M['frame'] = mat('GoggleFrame', (0.04, 0.22, 0.24), 0.35, metal=0.3)
M['lens'] = mat('GoggleLens', (0.55, 0.95, 1.0), 0.03, alpha=0.07)
M['belt'] = mat('Belt', (0.07, 0.045, 0.03), 0.6)
M['olive'] = mat('Olive', (0.075, 0.12, 0.04), 0.65)
M['badge'] = mat('BadgeWhite', (0.9, 0.95, 0.85), 0.4, emit=(0.8, 1, 0.7), emit_s=0.25)
F = {}  # face materials
F['white'] = mat('EyeWhite', (0.92, 0.94, 0.97), 0.3)
F['iris'] = mat('EyeIris', (0.05, 0.50, 0.56), 0.25, emit=(0.1, 0.8, 0.85), emit_s=0.25)
F['pupil'] = mat('EyePupil', (0.012, 0.02, 0.04), 0.3)
F['hl'] = mat('EyeHighlight', (1, 1, 1), 0.2, emit=(1, 1, 1), emit_s=1.0)
F['dark'] = mat('BrowLash', (0.045, 0.025, 0.018), 0.6)
F['mouth'] = mat('Mouth', (0.30, 0.035, 0.045), 0.5)
F['tongue'] = mat('Tongue', (0.85, 0.22, 0.27), 0.5)
F['blush'] = mat('Blush', (0.95, 0.38, 0.32), 0.8)

# ============================================================ skeleton (Mixamo names, character faces -Y)
arm_data = bpy.data.armatures.new('Armature')
arm_obj = bpy.data.objects.new('Armature', arm_data)
scene.collection.objects.link(arm_obj)
bpy.context.view_layer.objects.active = arm_obj
arm_obj.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
EB = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = EB.new(name); b.head = V(head); b.tail = V(tail)
    if parent: b.parent = EB[parent]
    return b
bone('Hips', (0, 0, 0.50), (0, 0, 0.56))
bone('Spine', (0, 0, 0.56), (0, 0, 0.66), 'Hips')
bone('Spine1', (0, 0, 0.66), (0, 0, 0.77), 'Spine')
bone('Spine2', (0, 0, 0.77), (0, 0, 0.88), 'Spine1')
bone('Neck', (0, 0, 0.88), (0, 0, 0.95), 'Spine2')
bone('Head', (0, 0, 0.95), (0, 0, 1.45), 'Neck')
for side, sx in (('Left', 1), ('Right', -1)):
    bone(f'{side}Shoulder', (0.05 * sx, 0, 0.82), (0.15 * sx, 0, 0.80), 'Spine2')
    bone(f'{side}Arm', (0.15 * sx, 0, 0.80), (0.15 * sx, 0, 0.60), f'{side}Shoulder')
    bone(f'{side}ForeArm', (0.15 * sx, 0, 0.60), (0.15 * sx, 0, 0.44), f'{side}Arm')
    bone(f'{side}Hand', (0.15 * sx, 0, 0.44), (0.15 * sx, 0, 0.34), f'{side}ForeArm')
    bone(f'{side}UpLeg', (0.09 * sx, 0, 0.50), (0.09 * sx, 0, 0.28), 'Hips')
    bone(f'{side}Leg', (0.09 * sx, 0, 0.28), (0.09 * sx, 0, 0.075), f'{side}UpLeg')
    bone(f'{side}Foot', (0.09 * sx, 0, 0.075), (0.09 * sx, -0.10, 0.035), f'{side}Leg')
    bone(f'{side}ToeBase', (0.09 * sx, -0.10, 0.035), (0.09 * sx, -0.17, 0.035), f'{side}Foot')
bpy.ops.object.mode_set(mode='OBJECT')
BONES = [b.name for b in arm_data.bones]
log('bones', len(BONES))

# ============================================================ animation clips (computed BEFORE meshes exist: fast)
pbs = arm_obj.pose.bones
for pb in pbs: pb.rotation_mode = 'QUATERNION'
ORDER = []
def _collect(b):
    ORDER.append(pbs[b.name])
    for c in b.children: _collect(c)
_collect(arm_data.bones['Hips'])

AXX, AXY, AXZ = V((1, 0, 0)), V((0, 1, 0)), V((0, 0, 1))
def qx(a): return Quaternion(AXX, a)
def qy(a): return Quaternion(AXY, a)
def qz(a): return Quaternion(AXZ, a)
def qm(*qs):
    r = Quaternion()
    for q in qs: r = r @ q
    return r
def smooth(t): t = min(1, max(0, t)); return t * t * (3 - 2 * t)

def make_action(name, nframes, fn):
    data = {pb.name: [] for pb in ORDER}
    hips_loc = []
    prev = {}
    for i in range(nframes + 1):
        D = fn(i / nframes)
        for pb in ORDER:
            if pb.parent:
                inh = pb.parent.matrix @ (pb.parent.bone.matrix_local.inverted() @ pb.bone.matrix_local)
            else:
                inh = pb.bone.matrix_local.copy()
            Mx = inh
            d = D.get(pb.name)
            if d is not None:
                h = inh.translation.copy()
                Mx = Matrix.Translation(h) @ d.to_matrix().to_4x4() @ Matrix.Translation(-h) @ inh
            if pb.name == 'Hips' and 'Hips_loc' in D:
                Mx = Matrix.Translation(D['Hips_loc']) @ Mx
            pb.matrix = Mx
            bpy.context.view_layer.update()
            q = pb.rotation_quaternion.copy()
            if pb.name in prev and q.dot(prev[pb.name]) < 0: q.negate()
            prev[pb.name] = q
            data[pb.name].append(q)
            if pb.name == 'Hips': hips_loc.append(pb.location.copy())
    act = bpy.data.actions.new(name); act.use_fake_user = True
    for pb in ORDER:
        for idx in range(4):
            fc = act.fcurves.new(f'pose.bones["{pb.name}"].rotation_quaternion', index=idx, action_group=pb.name)
            fc.keyframe_points.add(nframes + 1)
            flat = []
            for i, q in enumerate(data[pb.name]): flat += [1 + i, q[idx]]
            fc.keyframe_points.foreach_set('co', flat); fc.update()
    for idx in range(3):
        fc = act.fcurves.new('pose.bones["Hips"].location', index=idx, action_group='Hips')
        fc.keyframe_points.add(nframes + 1)
        flat = []
        for i, l in enumerate(hips_loc): flat += [1 + i, l[idx]]
        fc.keyframe_points.foreach_set('co', flat); fc.update()
    log('action', name, nframes + 1, 'keys')
    return act

def locomotion(hip, knee, arm, elbow, lean, bob, twist):
    def fn(t):
        ph = 2 * math.pi * t
        D = {}
        for side, off in (('Left', 0), ('Right', math.pi)):
            th = ph + off
            fwd = hip * math.sin(th); flex = knee * max(0, math.cos(th + 0.4))
            D[side + 'UpLeg'] = qx(-fwd); D[side + 'Leg'] = qx(flex); D[side + 'Foot'] = qx((fwd - flex) * 0.8)
        aL = -arm * math.sin(ph); aR = arm * math.sin(ph)
        D['LeftArm'] = qx(-aL); D['RightArm'] = qx(-aR)
        D['LeftForeArm'] = qx(-(elbow + 0.25 * max(0, aL))); D['RightForeArm'] = qx(-(elbow + 0.25 * max(0, aR)))
        tw = twist * math.sin(ph)
        D['Hips'] = qm(qz(-tw), qx(lean * 0.3)); D['Spine'] = qm(qz(tw), qx(lean * 0.4)); D['Spine1'] = qx(lean * 0.3); D['Head'] = qx(-lean * 0.5)
        D['Hips_loc'] = V((0, 0, bob * math.cos(2 * ph)))
        return D
    return fn

def idle(t):
    ph = 2 * math.pi * t
    return {'Spine1': qx(0.014 * math.sin(ph)), 'Head': qm(qy(0.05 * math.sin(ph)), qx(0.02 * math.sin(2 * ph))),
            'LeftArm': qx(0.025 * math.sin(ph)), 'RightArm': qx(-0.025 * math.sin(ph)),
            'LeftForeArm': qx(-0.08), 'RightForeArm': qx(-0.08), 'Hips_loc': V((0, 0, 0.004 * math.sin(2 * ph)))}

def pick(t):
    b = smooth(t / 0.3) if t < 0.3 else 1 if t < 0.62 else smooth(1 - (t - 0.62) / 0.38)
    return {'LeftUpLeg': qx(-0.95 * b), 'RightUpLeg': qx(-0.95 * b), 'LeftLeg': qx(1.5 * b), 'RightLeg': qx(1.5 * b),
            'LeftFoot': qx(0.55 * b), 'RightFoot': qx(0.55 * b), 'Hips': qx(0.12 * b), 'Spine': qx(0.30 * b), 'Spine1': qx(0.35 * b),
            'Head': qx(-0.25 * b), 'LeftArm': qx(-0.7 * b), 'RightArm': qx(-0.9 * b), 'RightForeArm': qx(-0.25 * b),
            'Hips_loc': V((0, 0, -0.20 * b))}

def wave(t):
    ph = 2 * math.pi * t
    return {'RightArm': qy(2.35 + 0.05 * math.sin(ph)), 'RightForeArm': qy(0.55 * math.sin(2 * ph)), 'Head': qz(0.10 * math.sin(ph)),
            'Spine1': qz(0.03 * math.sin(ph)), 'LeftArm': qx(0.03), 'Hips_loc': V((0, 0, 0.004 * math.sin(2 * ph)))}

def cheer(t):
    ph = 2 * math.pi * t; b = abs(math.sin(ph))
    return {'RightArm': qy(2.7 + 0.1 * math.sin(2 * ph)), 'LeftArm': qy(-(2.7 + 0.1 * math.sin(2 * ph))),
            'LeftUpLeg': qx(-0.15 * b), 'RightUpLeg': qx(-0.15 * b), 'LeftLeg': qx(0.3 * b), 'RightLeg': qx(0.3 * b),
            'Head': qx(-0.10 + 0.05 * math.sin(ph)), 'Hips_loc': V((0, 0, 0.05 * b))}

make_action('Idle', 48, idle)
make_action('Walk', 24, locomotion(hip=0.45, knee=0.65, arm=0.35, elbow=0.14, lean=0.0, bob=0.012, twist=0.10))
make_action('Run', 16, locomotion(hip=0.85, knee=1.30, arm=0.80, elbow=1.15, lean=0.22, bob=0.035, twist=0.13))
make_action('Pick', 62, pick)
make_action('Wave', 40, wave)
make_action('Cheer', 32, cheer)
for pb in ORDER:                      # back to the rest pose before skinning
    pb.rotation_quaternion = Quaternion(); pb.location = V()
bpy.context.view_layer.update()

# ============================================================ mesh builder
GROUPS = {n: i for i, n in enumerate(BONES)}
class Builder:
    def __init__(self, name, mats):
        self.name = name; self.mats = mats
        self.bm = bmesh.new(); self.dl = self.bm.verts.layers.deform.verify(); self.uv = self.bm.loops.layers.uv.verify()
    def _finish_prim(self, verts, mat_i, weights, smooth=True):
        faces = {f for v in verts for f in v.link_faces}
        for f in faces: f.material_index = mat_i; f.smooth = smooth
        for v in verts: self._w(v, weights)
    def _w(self, v, weights):
        w = weights(v.co) if callable(weights) else {weights: 1.0}
        tot = sum(w.values()) or 1.0
        for name, val in w.items(): v[self.dl][GROUPS[name]] = val / tot
    def sphere(self, c, r, mi, weights, seg=(14, 8)):
        rx, ry, rz = r if isinstance(r, (tuple, list)) else (r, r, r)
        mtx = Matrix.Translation(V(c)) @ Matrix.Diagonal((rx, ry, rz, 1))
        ret = bmesh.ops.create_uvsphere(self.bm, u_segments=seg[0], v_segments=seg[1], radius=1.0, matrix=mtx, calc_uvs=False)
        self._finish_prim(ret['verts'], mi, weights)
    def tube(self, p0, p1, r0, r1, mi, weights, seg=12, ex=1.0, ey=1.0):
        p0, p1 = V(p0), V(p1); d = p1 - p0; L = d.length
        rot = V((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
        mtx = Matrix.Translation((p0 + p1) / 2) @ rot
        ret = bmesh.ops.create_cone(self.bm, cap_ends=True, cap_tris=False, segments=seg, radius1=r0, radius2=r1, depth=L, matrix=mtx, calc_uvs=False)
        self._finish_prim(ret['verts'], mi, weights)
    def lathe(self, profile, mi, weights, seg=16, cap=True):
        """profile: [(z, rx, ry, cy)] bottom->top; builds an elliptical tube"""
        bm = self.bm; rings = []
        for (z, rx, ry, cy) in profile:
            rings.append([bm.verts.new((rx * math.cos(2 * math.pi * k / seg), cy + ry * math.sin(2 * math.pi * k / seg), z)) for k in range(seg)])
        faces = []
        for a in range(len(rings) - 1):
            for k in range(seg):
                faces.append(bm.faces.new((rings[a][k], rings[a][(k + 1) % seg], rings[a + 1][(k + 1) % seg], rings[a + 1][k])))
        if cap:
            for ring, up in ((rings[0], False), (rings[-1], True)):
                faces.append(bm.faces.new(ring if up else ring[::-1]))
        verts = [v for r in rings for v in r]
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._finish_prim(verts, mi, weights)
    def torus(self, c, R, r, mi, weights, scale=(1, 1, 1), rot=None, seg=(28, 8)):
        bm = self.bm; verts = []; grid = []
        mtx = Matrix.Translation(V(c)) @ (rot.to_4x4() if rot else Matrix.Identity(4)) @ Matrix.Diagonal((*scale, 1))
        for i in range(seg[0]):
            a = 2 * math.pi * i / seg[0]; row = []
            for j in range(seg[1]):
                b = 2 * math.pi * j / seg[1]
                p = V(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b)))
                v = bm.verts.new(mtx @ p); row.append(v); verts.append(v)
            grid.append(row)
        faces = []
        for i in range(seg[0]):
            for j in range(seg[1]):
                faces.append(bm.faces.new((grid[i][j], grid[(i + 1) % seg[0]][j], grid[(i + 1) % seg[0]][(j + 1) % seg[1]], grid[i][(j + 1) % seg[1]])))
        bmesh.ops.recalc_face_normals(bm, faces=faces)
        self._finish_prim(verts, mi, weights)
    def surface(self, fn, nu, nv, mi, weights, closed_u=False, uvfn=None, flip=False):
        bm = self.bm; verts = []; grid = []
        for i in range(nu + 1):
            row = []
            for j in range(nv + 1):
                v = bm.verts.new(fn(i / nu, j / nv)); row.append(v); verts.append(v)
            grid.append(row)
        faces = []
        for i in range(nu):
            for j in range(nv):
                quad = (grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1])
                try: f = bm.faces.new(quad[::-1] if flip else quad)
                except ValueError: continue
                faces.append(f)
                if uvfn:
                    for lp, (ui, vj) in zip(f.loops, ([(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)][::-1] if flip else [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)])):
                        lp[self.uv].uv = uvfn(ui / nu, vj / nv)
        self._finish_prim(verts, mi, weights)
    def build(self, extra_modifier=True):
        me = bpy.data.meshes.new(self.name); self.bm.to_mesh(me); self.bm.free()
        for m in self.mats: me.materials.append(m)
        ob = bpy.data.objects.new(self.name, me); scene.collection.objects.link(ob)
        for b in BONES: ob.vertex_groups.new(name=b)
        ob.parent = arm_obj
        md = ob.modifiers.new('Armature', 'ARMATURE'); md.object = arm_obj
        return ob

def chain(joints, v, hw=0.03):
    n = len(joints); i = 0
    for k in range(n):
        if v >= joints[k][0]: i = k
    res = {joints[i][1]: 1.0}
    if i + 1 < n:
        d = joints[i + 1][0] - v
        if d < hw:
            t = 0.5 * (1 - d / hw); res[joints[i + 1][1]] = t; res[joints[i][1]] = 1 - t
    if i > 0:
        d = v - joints[i][0]
        if d < hw:
            t = 0.5 * (1 - d / hw); res[joints[i - 1][1]] = res.get(joints[i - 1][1], 0) + t; res[joints[i][1]] = res[joints[i][1]] - t
    return res

TORSO = [(0, 'Hips'), (0.54, 'Spine'), (0.66, 'Spine1'), (0.77, 'Spine2'), (0.90, 'Neck')]
def torso_w(co): return chain(TORSO, co.z, 0.04)
def arm_w(side):
    J = [(-0.95, f'{side}Shoulder'), (-0.80, f'{side}Arm'), (-0.60, f'{side}ForeArm'), (-0.44, f'{side}Hand')]
    return lambda co: chain(J, -co.z, 0.03)
def leg_w(side):
    J = [(-0.60, 'Hips'), (-0.50, f'{side}UpLeg'), (-0.28, f'{side}Leg'), (-0.075, f'{side}Foot')]
    return lambda co: chain(J, -co.z, 0.035)
def shoe_w(side):
    J = [(-0.28, f'{side}Leg'), (-0.085, f'{side}Foot')]
    return lambda co: chain(J, -co.z, 0.02)

# ============================================================ body
body_mats = [M['skin'], M['hair'], M['hat'], M['leaf'], M['vest'], M['shirt'], M['lime'], M['pants'], M['glove'], M['shoe'], M['sole'],
             M['frame'], M['lens'], M['belt'], M['olive'], M['badge']]
MI = {k: i for i, k in enumerate(['skin', 'hair', 'hat', 'leaf', 'vest', 'shirt', 'lime', 'pants', 'glove', 'shoe', 'sole', 'frame', 'lens', 'belt', 'olive', 'badge'])}
B = Builder('Body', body_mats)
HC = V((0, 0, 1.08)); HR = (0.245, 0.235, 0.235)

# --- head, neck, ears
B.sphere(HC, HR, MI['skin'], 'Head', seg=(56, 32))
B.tube((0, 0, 0.84), (0, 0, 0.96), 0.060, 0.058, MI['skin'], lambda co: chain([(0, 'Neck'), (0.95, 'Head')], co.z, 0.02), seg=12)
for sx in (1, -1): B.sphere((0.238 * sx, 0.012, 1.065), (0.03, 0.02, 0.04), MI['skin'], 'Head', seg=(10, 6))
# --- hair: back/side volume + tufts under the hat brim
def hair_pt(u, v):
    psi = math.radians(58) + u * (2 * math.pi - 2 * math.radians(58)); th = math.radians(28) + v * math.radians(88)
    return V((0.256 * math.sin(th) * math.sin(psi), 0.014 - 0.246 * math.sin(th) * math.cos(psi), 1.08 + 0.246 * math.cos(th)))
B.surface(hair_pt, 32, 10, MI['hair'], 'Head', flip=True)
for sx in (1, -1):
    B.sphere((0.205 * sx, -0.115, 1.10), (0.05, 0.045, 0.085), MI['hair'], 'Head', seg=(16, 10))       # side locks
for x in (-0.10, 0.0, 0.10):
    B.sphere((x, -0.208, 1.2), (0.045, 0.028, 0.022), MI['hair'], 'Head', seg=(12, 8))               # fringe tufts
# --- melon hat (dome + brim) with netting UVs
RIMA = math.radians(96)
def dome(u, v):
    phi = u * 2 * math.pi; th = v * RIMA
    return V((0.285 * math.sin(th) * math.cos(phi), 0.012 + 0.285 * math.sin(th) * math.sin(phi), 1.22 + 0.235 * math.cos(th)))
B.surface(dome, 32, 12, MI['hat'], 'Head', uvfn=lambda u, v: (u * 2.0, v * 0.5), flip=True)
def brim_top(u, v):
    phi = u * 2 * math.pi; r = 0.283 + v * 0.115; z = 1.196 - v * 0.035
    return V((r * math.cos(phi), 0.012 + r * math.sin(phi), z))
B.surface(brim_top, 32, 4, MI['hat'], 'Head', uvfn=lambda u, v: (u * 2.0, 0.5 + v * 0.3), flip=True)
def brim_bot(u, v):
    phi = u * 2 * math.pi; r = 0.283 + v * 0.115; z = 1.196 - v * 0.035 - 0.012
    return V((r * math.cos(phi), 0.012 + r * math.sin(phi), z))
B.surface(brim_bot, 32, 4, MI['hat'], 'Head', uvfn=lambda u, v: (u * 2.0, 0.5 + v * 0.3))
B.torus((0, 0.012, 1.1865), 0.398, 0.0075, MI['hat'], 'Head', seg=(32, 6))                       # brim edge roll
# sprout on top of the hat
B.tube((0, 0.0, 1.445), (0.01, 0.0, 1.52), 0.012, 0.009, MI['leaf'], 'Head', seg=8)
for sx in (1, -1):
    B.sphere((0.055 * sx, 0.0, 1.535), (0.065, 0.03, 0.022), MI['leaf'], 'Head', seg=(10, 6))
# --- goggles
B.torus((0, 0.0, 1.048), 0.254, 0.0105, MI['frame'], 'Head', scale=(1, 0.96, 1), seg=(48, 8))     # head strap
for sx in (1, -1):
    B.torus((0.097 * sx, -0.238, 1.045), 0.066, 0.011, MI['frame'], 'Head', scale=(1, 1, 1.06),
            rot=Quaternion(AXX, math.pi / 2).to_matrix(), seg=(24, 8))                            # frame ring (axis = Y)
    B.sphere((0.097 * sx, -0.246, 1.045), (0.062, 0.014, 0.070), MI['lens'], 'Head', seg=(20, 10))  # transparent lens
B.tube((-0.03, -0.244, 1.05), (0.03, -0.244, 1.05), 0.009, 0.009, MI['frame'], 'Head', seg=8)    # bridge
for sx in (1, -1): B.tube((0.162 * sx, -0.208, 1.048), (0.245 * sx, -0.07, 1.048), 0.013, 0.013, MI['frame'], 'Head', seg=8)

# --- torso: shirt, vest, hood collar, belt, badge, pouches, backpack
B.lathe([(0.50, 0.108, 0.095, 0), (0.56, 0.106, 0.092, 0), (0.66, 0.108, 0.094, 0), (0.77, 0.118, 0.098, 0), (0.86, 0.100, 0.085, 0)], MI['shirt'], torso_w, seg=18)
B.lathe([(0.575, 0.116, 0.102, 0), (0.66, 0.117, 0.100, 0), (0.77, 0.126, 0.104, 0), (0.845, 0.112, 0.094, 0)], MI['vest'], torso_w, seg=18, cap=False)
B.torus((0, 0, 0.865), 0.088, 0.030, MI['olive'], torso_w, scale=(1, 0.92, 0.8), seg=(24, 8))        # hood collar
B.torus((0, 0, 0.575), 0.114, 0.014, MI['belt'], torso_w, scale=(1, 0.93, 1), seg=(24, 6))
B.tube((0, -0.108, 0.575), (0, -0.126, 0.575), 0.030, 0.030, MI['lime'], torso_w, seg=14)           # melon badge
B.tube((0, -0.124, 0.575), (0, -0.131, 0.575), 0.018, 0.018, MI['badge'], torso_w, seg=14)
for sx in (1, -1):
    B.sphere((0.098 * sx, -0.075, 0.545), (0.032, 0.026, 0.04), MI['olive'], torso_w, seg=(10, 6))   # belt pouches
B.sphere((0, 0.125, 0.71), (0.085, 0.045, 0.105), MI['olive'], torso_w, seg=(14, 8))                 # backpack
B.sphere((0, 0.158, 0.74), (0.05, 0.012, 0.025), MI['lime'], torso_w, seg=(10, 6))
for sx in (1, -1): B.tube((0.07 * sx, 0.0, 0.84), (0.075 * sx, -0.085, 0.76), 0.013, 0.013, MI['olive'], torso_w, seg=8)  # straps

# --- pants / legs / shoes
B.lathe([(0.43, 0.118, 0.104, 0), (0.50, 0.122, 0.106, 0), (0.55, 0.112, 0.098, 0)], MI['pants'], torso_w, seg=18)
for side, sx in (('Left', 1), ('Right', -1)):
    lw = leg_w(side); sw = shoe_w(side)
    B.tube((0.09 * sx, 0, 0.50), (0.09 * sx, 0, 0.28), 0.066, 0.060, MI['pants'], lw, seg=14)
    B.tube((0.09 * sx, 0, 0.28), (0.09 * sx, 0, 0.165), 0.060, 0.068, MI['pants'], lw, seg=14)
    B.tube((0.09 * sx, 0, 0.165), (0.09 * sx, 0, 0.10), 0.042, 0.040, MI['shirt'], lw, seg=12)       # sock band
    B.sphere((0.09 * sx, -0.045, 0.058), (0.062, 0.108, 0.050), MI['shoe'], sw, seg=(14, 8))         # sneaker
    B.sphere((0.09 * sx, -0.048, 0.017), (0.066, 0.115, 0.016), MI['sole'], sw, seg=(14, 6))         # sole
    B.sphere((0.09 * sx, -0.125, 0.052), (0.040, 0.035, 0.030), MI['lime'], sw, seg=(10, 6))         # toe cap
    B.tube((0.052 * sx, -0.035, 0.092), (0.128 * sx, -0.035, 0.092), 0.012, 0.012, MI['lime'], sw, seg=8)  # velcro strap
# --- arms
for side, sx in (('Left', 1), ('Right', -1)):
    aw = arm_w(side)
    B.sphere((0.155 * sx, 0, 0.83), (0.062, 0.058, 0.055), MI['olive'], aw, seg=(12, 8))             # shoulder pad
    B.tube((0.155 * sx, 0, 0.82), (0.158 * sx, 0, 0.675), 0.054, 0.047, MI['shirt'], aw, seg=12)    # short sleeve
    B.tube((0.158 * sx, 0, 0.675), (0.155 * sx, 0, 0.60), 0.038, 0.036, MI['skin'], aw, seg=12)
    B.tube((0.155 * sx, 0, 0.60), (0.152 * sx, 0, 0.47), 0.036, 0.032, MI['skin'], aw, seg=12)
    B.tube((0.154 * sx, 0, 0.565), (0.153 * sx, 0, 0.525), 0.042, 0.042, MI['lime'], aw, seg=12)    # armband
    B.sphere((0.152 * sx, 0, 0.40), (0.049, 0.043, 0.056), MI['glove'], aw, seg=(12, 8))             # fingerless glove
    B.tube((0.152 * sx, 0, 0.47), (0.152 * sx, 0, 0.445), 0.040, 0.040, MI['lime'], aw, seg=12)      # glove cuff
    B.sphere((0.152 * sx - 0.03 * sx * -1 * 0, -0.038, 0.40), (0.02, 0.02, 0.03), MI['glove'], aw, seg=(8, 6))  # thumb
body = B.build()
log('body verts', len(body.data.vertices))

# ============================================================ face with shape keys
FACE_MATS = [F['white'], F['iris'], F['pupil'], F['hl'], F['dark'], F['mouth'], F['tongue'], F['blush']]
FM = {k: i for i, k in enumerate(['white', 'iris', 'pupil', 'hl', 'dark', 'mouth', 'tongue', 'blush'])}
def surf(x, zrel, layer):
    u = x / HR[0]; v = zrel / HR[2]
    w = math.sqrt(max(0.0, 1 - u * u - v * v))
    return V((x, -HR[1] * w - 0.0035 - layer * 0.0023, HC.z + zrel))

NEUTRAL = dict(eo={1: 1.0, -1: 1.0}, arc={1: 0.0, -1: 0.0}, arc_curve=1.0, size=1.0, pup=1.0, browY=0.0, tilt=0.0,
               blush=0.45, mw=1.0, smile=0.55, open=0.0, lookx=0.0, lookz=0.0)
def P_with(**kw):
    P = {k: (dict(v) if isinstance(v, dict) else v) for k, v in NEUTRAL.items()}
    for k, v in kw.items(): P[k] = v
    return P

class Face:
    """fixed topology; coords(P) gives the 3D position of every vertex for an expression P"""
    def __init__(self):
        self.parts = []     # (name, mat, n_verts, kind)
        self.faces = []     # (vertex indices, material)
        self.n = 0
        for s in (1, -1):
            self._fan(('sclera', s), 'white', 20); self._fan(('iris', s), 'iris', 20); self._fan(('pupil', s), 'pupil', 20)
            self._fan(('hl1', s), 'hl', 10); self._fan(('hl2', s), 'hl', 8)
            self._strip(('arc', s), 'dark', 9); self._strip(('brow', s), 'dark', 7); self._fan(('blush', s), 'blush', 14)
        self._strip(('mouth', 0), 'mouth', 11); self._fan(('tongue', 0), 'tongue', 12)
    def _fan(self, key, m, n):
        base = self.n; self.parts.append((key, 'fan', n, base))
        for i in range(n): self.faces.append(((base, base + 1 + i, base + 1 + (i + 1) % n), FM[m]))
        self.n += n + 1
    def _strip(self, key, m, n):
        base = self.n; self.parts.append((key, 'strip', n, base))
        for i in range(n - 1): self.faces.append(((base + i, base + i + 1, base + n + i + 1, base + n + i), FM[m]))
        self.n += 2 * n
    def coords(self, P):
        out = [None] * self.n
        for (key, kind, n, base) in self.parts:
            name, s = key
            if name in ('sclera', 'iris', 'pupil', 'hl1', 'hl2'):
                eo = max(0.0, P['eo'][s]); ar = P['arc'][s]
                eo_eff = eo * (1 - ar)
                ecx, ecz = s * 0.097, -0.033
                sz = P['size']
                if name == 'sclera': cx, cz, a, b, layer = ecx, ecz, 0.056 * sz, 0.068 * sz * eo_eff, 1
                elif name == 'iris': cx, cz, a, b, layer = ecx + P['lookx'], ecz + P['lookz'] * eo_eff, 0.047 * sz, 0.060 * sz * eo_eff, 2
                elif name == 'pupil': cx, cz, a, b, layer = ecx + P['lookx'], ecz + P['lookz'] * eo_eff, 0.026 * sz * P['pup'], 0.034 * sz * P['pup'] * eo_eff, 3
                elif name == 'hl1': cx, cz, a, b, layer = ecx - 0.016 + P['lookx'], ecz + 0.026 * eo_eff, 0.014, 0.016 * eo_eff, 4
                else: cx, cz, a, b, layer = ecx + 0.016 + P['lookx'], ecz - 0.026 * eo_eff, 0.008, 0.009 * eo_eff, 4
                out[base] = surf(cx, cz, layer)
                for i in range(n):
                    t = 2 * math.pi * i / n
                    out[base + 1 + i] = surf(cx + a * math.cos(t), cz + b * math.sin(t), layer)
            elif name == 'blush':
                k = max(0.001, P['blush']); cx, cz = s * 0.152, -0.085
                out[base] = surf(cx, cz, 0.5)
                for i in range(n):
                    t = 2 * math.pi * i / n
                    out[base + 1 + i] = surf(cx + 0.034 * k * math.cos(t), cz + 0.018 * k * math.sin(t), 0.5)
            elif name == 'arc':
                ar = P['arc'][s]; ecx, ecz = s * 0.097, -0.033; cv = P['arc_curve']
                for i in range(n):
                    tt = -1 + 2 * i / (n - 1)
                    x = ecx + 0.054 * tt; z = ecz + 0.004 + cv * 0.030 * (1 - tt * tt)
                    th = 0.0065 * ar
                    xc, zc = ecx, ecz
                    px, pz = xc + (x - xc) * ar, zc + (z - zc) * ar
                    out[base + i] = surf(px, pz + th, 2.5); out[base + n + i] = surf(px, pz - th, 2.5)
            elif name == 'brow':
                ecx = s * 0.097; zc = 0.064 + P['browY']
                for i in range(n):
                    tt = -1 + 2 * i / (n - 1)
                    x = ecx + 0.046 * tt; z = zc + 0.007 * (1 - tt * tt) - P['tilt'] * 0.020 * tt * s
                    out[base + i] = surf(x, z + 0.0055, 1.5); out[base + n + i] = surf(x, z - 0.0055, 1.5)
            elif name == 'mouth':
                zm = -0.138; hw = 0.034 * P['mw']; sm = P['smile']; op = P['open']
                for i in range(n):
                    tt = -1 + 2 * i / (n - 1); x = hw * tt
                    zt = zm + sm * 0.017 * tt * tt
                    zb = zt - (0.0055 + op * 0.060 * (max(0.0, 1 - tt * tt) ** 0.8))
                    out[base + i] = surf(x, zt, 1.5); out[base + n + i] = surf(x, zb, 1.5)
            elif name == 'tongue':
                tt = max(0.0, min(1.0, (P['open'] - 0.35) / 0.65)); hw = 0.034 * P['mw']
                zb0 = -0.138 - (0.0055 + P['open'] * 0.060)
                cz = zb0 + 0.012 * tt + 0.004; cx = 0.0
                out[base] = surf(cx, cz, 2.2)
                for i in range(n):
                    t = 2 * math.pi * i / n
                    out[base + 1 + i] = surf(cx + 0.021 * tt * (hw / 0.034) * math.cos(t), cz + 0.012 * tt * math.sin(t), 2.2)
        return out

face = Face()
bm = bmesh.new(); dl = bm.verts.layers.deform.verify()
neutral = face.coords(P_with())
fverts = [bm.verts.new(c) for c in neutral]
for (idx, m) in face.faces:
    try:
        f = bm.faces.new([fverts[i] for i in idx]); f.material_index = m; f.smooth = True
    except ValueError: pass
for v in bm.verts: v[dl][GROUPS['Head']] = 1.0
fme = bpy.data.meshes.new('Face'); bm.to_mesh(fme); bm.free()
for m in FACE_MATS: fme.materials.append(m)
face_obj = bpy.data.objects.new('Face', fme); scene.collection.objects.link(face_obj)
for b in BONES: face_obj.vertex_groups.new(name=b)
face_obj.parent = arm_obj
md = face_obj.modifiers.new('Armature', 'ARMATURE'); md.object = arm_obj

def E(**kw): return P_with(**kw)
EXPR = {
    'Blink':     E(eo={1: 0.04, -1: 0.04}),
    'BlinkL':    E(eo={1: 0.04, -1: 1.0}),
    'BlinkR':    E(eo={1: 1.0, -1: 0.04}),
    'Happy':     E(eo={1: 0.0, -1: 0.0}, arc={1: 1.0, -1: 1.0}, smile=1.0, open=0.55, blush=1.0, browY=0.012),
    'Laugh':     E(eo={1: 0.0, -1: 0.0}, arc={1: 1.0, -1: 1.0}, smile=1.0, open=1.0, mw=1.3, blush=1.0, browY=0.022),
    'Wink':      E(eo={1: 1.0, -1: 0.0}, arc={1: 0.0, -1: 1.0}, smile=0.9, open=0.35, blush=0.8, browY=0.006),
    'Surprised': E(size=1.14, pup=0.62, browY=0.032, mw=0.45, smile=0.0, open=0.85, blush=0.2),
    'Sad':       E(tilt=1.0, browY=-0.004, eo={1: 0.82, -1: 0.82}, smile=-0.8, mw=0.8, lookz=-0.012, blush=0.1),
    'Angry':     E(tilt=-1.3, browY=-0.006, eo={1: 0.74, -1: 0.74}, smile=-0.55, mw=0.9, open=0.12, blush=0.0),
    'Relax':     E(eo={1: 0.0, -1: 0.0}, arc={1: 1.0, -1: 1.0}, arc_curve=-1.0, smile=0.7, blush=0.9),
    'Talk':      E(open=0.5, mw=0.8, smile=0.3),
}
face_obj.shape_key_add(name='Basis', from_mix=False)
for name, P in EXPR.items():
    kb = face_obj.shape_key_add(name=name, from_mix=False)
    co = face.coords(P)
    for i, c in enumerate(co): kb.data[i].co = c
    kb.value = 0.0
log('shape keys', list(EXPR))

# ============================================================ export
bpy.ops.object.select_all(action='DESELECT')
for o in (arm_obj, body, face_obj): o.select_set(True)
bpy.context.view_layer.objects.active = arm_obj
ad = arm_obj.animation_data_create()
for an in ('Idle', 'Walk', 'Run', 'Pick', 'Wave', 'Cheer'):          # one NLA track per clip -> one glTF animation per clip
    tr = ad.nla_tracks.new(); tr.name = an
    st = tr.strips.new(an, 1, bpy.data.actions[an]); st.name = an
ad.action = None
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_animations=True, export_animation_mode='NLA_TRACKS',
                          export_morph=True, export_skins=True, export_apply=False, export_force_sampling=True, export_cameras=False,
                          export_lights=False, export_yup=True, export_image_format='AUTO')
log('written', OUT, round(os.path.getsize(OUT) / 1e6, 2), 'MB')
for _im in bpy.data.images:          # pack textures into the .blend so it never shows pink "missing texture"
    if _im.source == 'FILE': _im.pack()
bpy.ops.wm.save_as_mainfile(filepath=os.path.splitext(OUT)[0] + '.blend', copy=True)

# ============================================================ optional preview renders
if PREVIEW:
    os.makedirs(PREVIEW, exist_ok=True)
    for tr in ad.nla_tracks: tr.mute = True
    w = bpy.data.worlds.new('W'); w.use_nodes = True; scene.world = w
    w.node_tree.nodes['Background'].inputs['Color'].default_value = (0.75, 0.88, 1.0, 1)
    sun = bpy.data.objects.new('S', bpy.data.lights.new('S', 'SUN')); sun.data.energy = 3.5
    sun.rotation_euler = (math.radians(55), 0, math.radians(-30)); scene.collection.objects.link(sun)
    scene.render.engine = 'CYCLES'; scene.cycles.device = 'CPU'; scene.cycles.samples = 24; scene.cycles.use_denoising = False
    def cam(loc, tgt, lens=50):
        c = bpy.data.cameras.new('c'); c.lens = lens
        o = bpy.data.objects.new('c', c); scene.collection.objects.link(o); o.location = loc
        o.rotation_euler = (V(tgt) - V(loc)).to_track_quat('-Z', 'Y').to_euler(); scene.camera = o; return o
    def shot(name, size=(700, 800)):
        scene.render.resolution_x, scene.render.resolution_y = size
        scene.render.filepath = os.path.join(PREVIEW, name + '.png'); bpy.ops.render.render(write_still=True)
    def set_expr(**vals):
        for k in face_obj.data.shape_keys.key_blocks: k.value = 0.0
        for k, v in vals.items(): face_obj.data.shape_keys.key_blocks[k].value = v
    c = cam((0.9, -2.8, 1.05), (0, 0, 0.72), 55)
    shot('a_front34')
    c.location = (0.0, -1.1, 1.08); c.rotation_euler = (V((0, 0, 1.06)) - V(c.location)).to_track_quat('-Z', 'Y').to_euler(); c.data.lens = 60
    for n, v in (('neutral', {}), ('happy', {'Happy': 1}), ('laugh', {'Laugh': 1}), ('wink', {'Wink': 1}), ('surprised', {'Surprised': 1}), ('angry', {'Angry': 1})):
        set_expr(**v); shot('f_' + n, (600, 600))
    set_expr()
    c.location = (3.0, -3.2, 1.0); c.rotation_euler = (V((0, 0, 0.7)) - V(c.location)).to_track_quat('-Z', 'Y').to_euler(); c.data.lens = 45
    for act, fr in (('Run', 5), ('Walk', 6), ('Pick', 22), ('Wave', 8)):
        arm_obj.animation_data.action = bpy.data.actions[act]; scene.frame_set(fr); shot('p_' + act.lower(), (600, 700))
log('done')


