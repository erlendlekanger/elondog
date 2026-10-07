"""Builds models/tvhead.glb ("Jack") with Blender, no UI needed.

Run with Blender:        blender -b -P tools/build_model.py
or with the bpy module:  python tools/build_model.py

Jack is a man in a light-grey, fitted rib-knit turtleneck with a square, beige
retro computer monitor for a head. Black "ear" discs sit on the sides of the
monitor and thin cables run from them down onto his chest (the cables are
simulated on the website between the anchor empties exported here).

The bones the website drives are torso -> neck1 -> neck2 -> head. The turtleneck
and the sliver of neck skin are skinned to them so they bend smoothly when the
head turns. Ambient occlusion is baked into vertex colours with Cycles.
The screen uses a material named "Screen" that the website replaces with its CRT.

Environment variables:
  TVHEAD_BRAND  text on the monitor's chin (default JACK)
  TVHEAD_KNIT   sweater colour as sRGB hex (default #d3d4d7, light grey)
  TVHEAD_SKIN   skin tone as sRGB hex (default #c99a80)
"""
import math
import os
import urllib.request
import zipfile

import bpy  # must come before bmesh/mathutils when running as a module
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
# Realistic male base mesh from Blender Studio's "Human Base Meshes" bundle
# (Blender Foundation, CC-BY 4.0). Downloaded once into tools/.cache.
BASEMESH_URL = 'https://download.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip'
CACHE = os.path.join(HERE, '.cache')
BASEMESH_BLEND = os.path.join(CACHE, 'human-base-meshes-bundle-v1.4.1', 'human_base_meshes_bundle.blend')
BODY_OBJECT = 'GEO-body_male_realistic'

# The base mesh is in metres; these landmarks place it in the scene.
BODY_NECK_BASE = 1.38   # height of the neck base (jugular notch) in metres
BODY_CHIN = 1.445       # where the jaw starts; everything above is replaced by the monitor
TURTLE_TOP_M = 1.50     # top of the turtleneck (metres)
TUBE_RX, TUBE_RY, TUBE_CY = 0.08, 0.073, -0.022   # turtleneck tube (metres)
BODY_SCALE = 5.8        # metres -> scene units (keeps Lisa-like head/shoulder ratio)
BODY_BOTTOM = 1.05      # bust is cut here (metres)
SHOULDER = (0.19, 1.36)  # (x, z) of the shoulder joint in metres
ELBOW = (0.30, 1.09)     # (x, z) of the elbow
ARM_CUT = 0.13           # distance down the upper arm where the bust is cut
OUT = os.path.join(HERE, '..', 'models', 'tvhead.glb')
BRAND = os.environ.get('TVHEAD_BRAND', 'JACK')
AO_SAMPLES = int(os.environ.get('TVHEAD_AO_SAMPLES', '48'))


def srgb_hex(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in c)


KNIT = srgb_hex(os.environ.get('TVHEAD_KNIT', '#d3d4d7'))
SKIN = srgb_hex(os.environ.get('TVHEAD_SKIN', '#c99a80'))

# Layout (Blender: x right, y back, z up; Jack faces -y).
NECK1_Z, NECK2_Z, HEAD_Z = 0.0, 0.38, 0.76
TURTLE_TOP = (TURTLE_TOP_M - BODY_NECK_BASE) * BODY_SCALE   # top edge of the turtleneck
TV_BOTTOM = (1.522 - BODY_NECK_BASE) * BODY_SCALE
TV_W, TV_H, TV_D = 1.6, 1.62, 1.5
TV_Z = TV_BOTTOM + TV_H / 2   # centre of the monitor
FRONT_D = 0.42                # depth of the front block
TV_FRONT = -TV_D / 2          # y of the front face
SCREEN_W, SCREEN_H, SCREEN_Z = 1.14, 1.04, 0.13   # SCREEN_Z relative to TV_Z
NECK_RX, NECK_RY = TUBE_RX * BODY_SCALE, TUBE_RY * BODY_SCALE  # turtleneck tube radii (scene)
EAR_R = 0.17
EAR_Y = TV_FRONT + 0.3


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def ss(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def bake_modifiers(obj):
    """Apply all modifiers (or convert a curve/text) into plain mesh data."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    new = bpy.data.objects.new(obj.name, me)
    new.matrix_world = obj.matrix_world.copy()
    link(new)
    name = obj.name
    bpy.data.objects.remove(obj)
    new.name = name
    new.data.name = name
    return new


def smooth(obj, angle=None):
    for p in obj.data.polygons:
        p.use_smooth = True
    if angle is not None:
        with bpy.context.temp_override(object=obj, active_object=obj, selected_objects=[obj], selected_editable_objects=[obj]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    return obj


def material(name, color=(0.8, 0.8, 0.8), rough=0.5, metal=0.0, **kw):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes['Principled BSDF']
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough
    p.inputs['Metallic'].default_value = metal
    for key, value in kw.items():
        sock = {
            'sheen': 'Sheen Weight', 'sheen_tint': 'Sheen Tint', 'sheen_rough': 'Sheen Roughness',
            'coat': 'Coat Weight', 'coat_rough': 'Coat Roughness', 'alpha': 'Alpha',
            'emission': 'Emission Color', 'emission_strength': 'Emission Strength',
        }[key]
        p.inputs[sock].default_value = (*value, 1) if isinstance(value, tuple) else value
    if kw.get('alpha', 1) < 1:
        mat.surface_render_method = 'BLENDED'
    return mat


def add_image_map(mat, image, kind, strength=0.9):
    """Plug an image into Base Color ('color') or Normal ('normal')."""
    nt = mat.node_tree
    p = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    if kind == 'normal':
        image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = strength
        nt.links.new(tex.outputs['Color'], nm.inputs['Color'])
        nt.links.new(nm.outputs['Normal'], p.inputs['Normal'])
    else:
        nt.links.new(tex.outputs['Color'], p.inputs['Base Color'])


def np_image(name, rgb):
    h, w, _ = rgb.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.concatenate([rgb, np.ones((h, w, 1))], axis=2).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def normal_from_height(hgt, strength):
    dx = np.roll(hgt, -1, axis=1) - np.roll(hgt, 1, axis=1)
    dy = np.roll(hgt, -1, axis=0) - np.roll(hgt, 1, axis=0)
    n = np.stack([-dx * strength, -dy * strength, np.ones_like(hgt)], axis=2)
    n /= np.linalg.norm(n, axis=2, keepdims=True)
    return n * 0.5 + 0.5


def assign(obj, mat):
    obj.data.materials.clear()
    obj.data.materials.append(mat)
    return obj


def rounded_rect(w, h, r, n=10):
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def poly_curve(name, loops, extrude=0.0, bevel=0.0):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '2D'
    cu.fill_mode = 'BOTH'
    cu.extrude = extrude
    cu.bevel_depth = bevel
    cu.bevel_resolution = 4
    for loop in loops:
        sp = cu.splines.new('POLY')
        sp.points.add(len(loop) - 1)
        for p, (x, y) in zip(sp.points, loop):
            p.co = (x, y, 0, 1)
        sp.use_cyclic_u = True
    return link(bpy.data.objects.new(name, cu))


def cylinder(name, r1, r2, depth, segs=48, cap=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, segments=segs, radius1=r1, radius2=r2, depth=depth)
    return mesh_obj(name, bm)


def ellipsoid(name, center, radii, segs=48, rings=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1)
    obj = mesh_obj(name, bm)
    obj.scale = radii
    obj.location = center
    return obj


def capsule(name, a, b, r):
    a, b = Vector(a), Vector(b)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=40, radius1=r, radius2=r, depth=(b - a).length)
    for end in (-1, 1):
        bmesh.ops.create_uvsphere(bm, u_segments=40, v_segments=20, radius=r,
                                  matrix=Matrix.Translation((0, 0, end * (b - a).length / 2)))
    obj = mesh_obj(name, bm)
    obj.matrix_world = Matrix.Translation((a + b) / 2) @ (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    return obj


def box(name, sx, sy, sz):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    return mesh_obj(name, bm)


def bevel(obj, width, segs=4):
    m = obj.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segs
    m.limit_method = 'ANGLE'
    return bake_modifiers(obj)


def torus(name, R, r, nu=96, nv=16, squash=1.0):
    bm = bmesh.new()
    ring = [[bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a) * squash, r * math.sin(b)))
             for b in (2 * math.pi * j / nv for j in range(nv))] for a in (2 * math.pi * i / nu for i in range(nu))]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((ring[i][j], ring[(i + 1) % nu][j], ring[(i + 1) % nu][(j + 1) % nv], ring[i][(j + 1) % nv]))
    return smooth(mesh_obj(name, bm))


def join(objs, name):
    with bpy.context.temp_override(active_object=objs[0], selected_editable_objects=objs, selected_objects=objs):
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]


def empty(name, loc, **extras):
    e = link(bpy.data.objects.new(name, None))
    e.location = loc
    for k, v in extras.items():
        e[k] = v
    return e


# ---------------------------------------------------------------------------
# textures
# ---------------------------------------------------------------------------
def _fft_noise(s, scale, rng):
    n = rng.standard_normal((s, s))
    fx = np.fft.fftfreq(s)[:, None]
    fy = np.fft.fftfreq(s)[None, :]
    out = np.real(np.fft.ifft2(np.fft.fft2(n) * np.exp(-(fx ** 2 + fy ** 2) * (s / scale) ** 2)))
    return (out - out.min()) / (out.max() - out.min())


def rib_knit_maps():
    """Fine 1x1 rib knit: deep vertical ribs with V-shaped stitches."""
    s = 512
    u, v = np.meshgrid(np.arange(s) / s, np.arange(s) / s)
    ribs, rows = 16, 40
    col = (u * ribs) % 1
    rib = np.sin(col * np.pi) ** 0.6
    row = (v * rows + (np.floor(u * ribs) % 2) * 0.5) % 1
    stitch = 1 - np.abs(row - 0.5) * 2
    vshape = np.abs(col - 0.5) * 2
    hgt = rib * (0.75 + 0.25 * np.clip(stitch - vshape * 0.5, 0, 1))
    rng = np.random.default_rng(3)
    hgt += _fft_noise(s, 140, rng) * 0.08
    normal = np_image('knit_normal', normal_from_height(hgt, 2.6))
    tone = 0.88 + 0.12 * rib + 0.04 * _fft_noise(s, 12, rng)
    color = np_image('knit_color', np.clip(np.array(KNIT)[None, None, :] * tone[..., None], 0, 1))
    return color, normal


def skin_maps(tone):
    s = 512
    rng = np.random.default_rng(7)
    pores = np.zeros((s, s))
    idx = rng.integers(0, s, size=(5200, 2))
    pores[idx[:, 0], idx[:, 1]] = rng.uniform(0.6, 1.0, 5200)
    fx = np.fft.fftfreq(s)[:, None]
    fy = np.fft.fftfreq(s)[None, :]
    pores = np.real(np.fft.ifft2(np.fft.fft2(pores) * np.exp(-(fx ** 2 + fy ** 2) * (s / 2.2) ** 2 * 6)))
    pores /= pores.max()
    hgt = 1 - pores * 0.8 + _fft_noise(s, 90, rng) * 0.25
    normal = np_image('skin_normal', normal_from_height(hgt, 3.0))
    col = np.array(tone)[None, None, :] * (0.94 + 0.12 * _fft_noise(s, 10, rng)[..., None])
    col[..., 0] *= 1 + 0.06 * _fft_noise(s, 24, rng)
    col *= 1 - pores[..., None] * 0.08
    return np_image('skin_color', np.clip(col, 0, 1)), normal


def plastic_normal():
    s = 256
    rng = np.random.default_rng(11)
    return np_image('plastic_normal', normal_from_height(_fft_noise(s, 60, rng) * 0.6 + _fft_noise(s, 160, rng) * 0.4, 0.8))


# ---------------------------------------------------------------------------
# body (realistic base mesh)
# ---------------------------------------------------------------------------
def load_body():
    """Append the realistic male base mesh with its sculpted detail, placed and
    scaled into scene units (neck base at the origin)."""
    if not os.path.exists(BASEMESH_BLEND):
        os.makedirs(CACHE, exist_ok=True)
        zpath = os.path.join(CACHE, 'hbm.zip')
        print('downloading human base meshes (~50 MB)...')
        urllib.request.urlretrieve(BASEMESH_URL, zpath)
        with zipfile.ZipFile(zpath) as z:
            z.extract('human-base-meshes-bundle-v1.4.1/human_base_meshes_bundle.blend', CACHE)
        os.remove(zpath)
    with bpy.data.libraries.load(BASEMESH_BLEND) as (src, dst):
        dst.objects = [BODY_OBJECT]
    body = link(dst.objects[0])
    body.location = (0, 0, 0)
    for m in body.modifiers:
        if m.type == 'MULTIRES':
            m.levels = m.render_levels = 2
    body.parent = None
    body = bake_modifiers(body)
    body.data.transform(Matrix.Translation((-body.matrix_world.translation.x, 0, 0)) @ body.matrix_world)
    body.matrix_world = Matrix()
    return body


def to_scene(v):
    """Metres (base mesh) -> scene units."""
    return Vector((v.x * BODY_SCALE, v.y * BODY_SCALE, (v.z - BODY_NECK_BASE) * BODY_SCALE))


def on_cut_arm(co):
    """True if a base-mesh point is past the cut on either upper arm."""
    sx, sz = SHOULDER
    ex, ez = ELBOW
    d = Vector((ex - sx, 0, ez - sz)).normalized()
    p = Vector((abs(co.x) - sx, 0, co.z - sz))
    return abs(co.x) > 0.15 and p.dot(d) > ARM_CUT


def fill_low_holes(bm, z_max):
    """Cap the open cuts (arms, bottom) so the bust reads as a clean cut."""
    edges = [e for e in bm.edges if e.is_boundary and max(v.co.z for v in e.verts) < z_max]
    bmesh.ops.holes_fill(bm, edges=edges, sides=0)


def build_knit(mats, body):
    """Fitted rib-knit turtleneck pulled over the real body."""
    obj = body.copy()
    obj.data = body.data.copy()
    obj.name = 'Knit'
    link(obj)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < BODY_BOTTOM or v.co.z > BODY_CHIN or on_cut_arm(v.co)], context='VERTS')
    bm.to_mesh(obj.data)
    bm.free()
    # Soften anatomy the way knit does, then sit the fabric on top.
    sm = obj.modifiers.new('soften', 'SMOOTH')
    sm.factor = 0.9
    sm.iterations = 10
    obj = bake_modifiers(obj)

    def tube_point(th, z, fold_amp=0.035, grow=1.0):
        # Irregular scrunch: wavy rings whose height and depth vary around the neck.
        wob = 1.4 * math.sin(th * 2 + 0.7) + 0.9 * math.sin(th * 3 + 2.1) + 0.5 * math.sin(th * 7)
        fold = (math.sin(z * 230 + wob) * 0.5 + 0.5) ** 3
        depth = 0.6 + 0.4 * math.sin(th * 1.3 + z * 40)
        k = (1 + fold_amp * fold * depth) * grow
        return Vector((TUBE_RX * k * math.cos(th), TUBE_CY + TUBE_RY * k * math.sin(th), z))

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.normal_update()
    for v in bm.verts:
        co = v.co.copy()
        v.co = co + v.normal * 0.007
        # Neck: blend the skin-tight surface into a soft knit tube.
        rad = math.hypot(co.x, co.y - TUBE_CY)
        w = ss(1.36, 1.42, co.z) * (1 - ss(0.1, 0.14, rad))
        if w > 0:
            t = tube_point(math.atan2(co.y - TUBE_CY, co.x), co.z)
            v.co.x = v.co.x * (1 - w) + t.x * w
            v.co.y = v.co.y * (1 - w) + t.y * w
    fill_low_holes(bm, 1.3)
    # Extend the tube up to the turtleneck's top edge.
    segs, rows = 144, 16
    z0 = BODY_CHIN - 0.006
    grid = []
    for j in range(rows + 1):
        z = z0 + (TURTLE_TOP_M - z0) * j / rows
        grid.append([bm.verts.new(tube_point(2 * math.pi * i / segs - math.pi, z, grow=1.012)) for i in range(segs)])
    for j in range(rows):
        for i in range(segs):
            i2 = (i + 1) % segs
            bm.faces.new((grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]))
    for v in bm.verts:
        v.co = to_scene(v.co)
    bm.normal_update()
    uv = bm.loops.layers.uv.new('KnitUV')
    for f in bm.faces:
        us = [math.atan2(l.vert.co.y, l.vert.co.x) / (2 * math.pi) + 0.5 for l in f.loops]
        if max(us) - min(us) > 0.5:
            us = [x + 1 if x < 0.5 else x for x in us]
        for l, x in zip(f.loops, us):
            l[uv].uv = (x * 22, l.vert.co.z * 2.8)
    bm.to_mesh(obj.data)
    bm.free()
    for layer in list(obj.data.uv_layers):
        if layer.name != 'KnitUV':
            obj.data.uv_layers.remove(layer)

    lip = torus('KnitLip', NECK_RX + 0.01, 0.034, 144, 16, NECK_RY / NECK_RX)
    lip.location = (0, TUBE_CY * BODY_SCALE, TURTLE_TOP - 0.01)
    bpy.context.view_layer.update()
    lip.data.transform(lip.matrix_world)
    lip.matrix_world = Matrix()
    luv = lip.data.uv_layers.new(name='KnitUV')
    for poly in lip.data.polygons:
        for li in poly.loop_indices:
            co = lip.data.vertices[lip.data.loops[li].vertex_index].co
            luv.data[li].uv = ((math.atan2(co.y, co.x) / (2 * math.pi) + 0.5) * 22, co.z * 2.8)
    obj = join([obj, lip], 'Knit')
    return smooth(assign(obj, mats['knit']))


def build_neck_skin(mats):
    """Neck and the underside of the jaw, visible between the turtleneck and the
    monitor. Cross-section matches the base mesh's neck (about 14 x 12 cm)."""
    segs, rows = 96, 30
    z0, z1 = TURTLE_TOP - 0.25, TV_BOTTOM + 0.05
    rx, ry, cy = 0.068 * BODY_SCALE, 0.06 * BODY_SCALE, -0.025 * BODY_SCALE
    bm = bmesh.new()
    uv = bm.loops.layers.uv.new('SkinUV')
    grid = []
    for j in range(rows + 1):
        z = z0 + (z1 - z0) * j / rows
        row = []
        for i in range(segs):
            th = 2 * math.pi * i / segs - math.pi
            d = (th + math.pi / 2 + math.pi) % (2 * math.pi) - math.pi   # angle from the front
            jaw = 0.32 * math.exp(-(d / 0.9) ** 2) * ss(TURTLE_TOP - 0.02, TV_BOTTOM, z)
            r = 1 + jaw
            row.append(bm.verts.new((rx * r * math.cos(th), cy + ry * r * math.sin(th), z)))
        grid.append(row)
    for j in range(rows):
        for i in range(segs):
            i2 = (i + 1) % segs
            f = bm.faces.new((grid[j][i], grid[j][i2], grid[j + 1][i2], grid[j + 1][i]))
            for l, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                l[uv].uv = (ii / segs * 4, (z0 + (z1 - z0) * jj / rows) * 4)
    return smooth(assign(mesh_obj('Skin', bm), mats['skin']))


# ---------------------------------------------------------------------------
# monitor
# ---------------------------------------------------------------------------
def build_monitor(mats):
    parts = []
    cz = TV_Z

    front = box('MonitorFront', TV_W, FRONT_D, TV_H)
    front.location = (0, TV_FRONT + FRONT_D / 2, cz)
    parts.append(smooth(assign(bevel(front, 0.075, 6), mats['beige']), 35))

    rear_d = TV_D - FRONT_D + 0.04
    rear = box('MonitorRear', TV_W * 0.95, rear_d, TV_H * 0.95)
    bm = bmesh.new()
    bm.from_mesh(rear.data)
    for v in bm.verts:
        if v.co.y > 0:
            v.co.x *= 0.76
            v.co.z = v.co.z * 0.74 + 0.04
    bm.to_mesh(rear.data)
    bm.free()
    rear.location = (0, TV_FRONT + FRONT_D - 0.04 + rear_d / 2, cz)
    parts.append(smooth(assign(bevel(rear, 0.05, 4), mats['beige']), 35))

    # Vent slots on both sides of the tapered rear.
    taper = math.atan(((TV_W * 0.95) / 2 * 0.24) / rear_d)
    for s in (-1, 1):
        for k in range(9):
            y = TV_FRONT + FRONT_D + 0.25 + 0.06
            slot = box(f'Vent{s}_{k}', 0.02, 0.62, 0.024)
            frac = 0.45
            x = s * ((TV_W * 0.95) / 2 * (1 - 0.24 * frac) - 0.004)
            slot.location = (x, TV_FRONT + FRONT_D - 0.04 + rear_d * frac, cz - 0.36 + k * 0.09)
            slot.rotation_euler = (0, 0, -s * taper)
            parts.append(assign(slot, mats['dark']))

    # Black bezel with the screen recessed in it.
    bezel = poly_curve('Bezel', [rounded_rect(SCREEN_W + 0.18, SCREEN_H + 0.18, 0.09), rounded_rect(SCREEN_W - 0.02, SCREEN_H - 0.02, 0.07)], extrude=0.012, bevel=0.012)
    bezel.rotation_euler = (math.pi / 2, 0, 0)
    bezel.location = (0, TV_FRONT - 0.008, cz + SCREEN_Z)
    parts.append(smooth(assign(bake_modifiers(bezel), mats['dark']), 40))

    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')  # create_grid only fills UVs if a layer exists
    bmesh.ops.create_grid(bm, x_segments=48, y_segments=44, size=0.5, calc_uvs=True)
    for v in bm.verts:
        nx, ny = v.co.x * 2, v.co.y * 2
        v.co.x *= SCREEN_W + 0.04
        v.co.y *= SCREEN_H + 0.04
        v.co.z = 0.025 * (1 - 0.5 * (nx * nx + ny * ny))
    screen = mesh_obj('Screen', bm)
    screen.rotation_euler = (math.pi / 2, 0, 0)
    screen.location = (0, TV_FRONT - 0.004, cz + SCREEN_Z)
    screen = bake_modifiers(screen)
    parts.append(smooth(assign(screen, mats['screen'])))
    glass = screen.copy()
    glass.data = screen.data.copy()
    glass.name = 'ScreenGlass'
    glass.location.y -= 0.004
    link(glass)
    parts.append(assign(glass, mats['glass']))

    # Chin: brand, a disk slot and a tiny power light.
    cu = bpy.data.curves.new('BrandText', 'FONT')
    cu.body = BRAND
    cu.align_x = 'LEFT'
    cu.align_y = 'CENTER'
    cu.size = 0.07
    cu.extrude = 0.003
    txt = link(bpy.data.objects.new('Brand', cu))
    txt.rotation_euler = (math.pi / 2, 0, 0)
    txt.location = (-TV_W / 2 + 0.16, TV_FRONT - 0.002, cz - TV_H / 2 + 0.16)
    parts.append(assign(bake_modifiers(txt), mats['dark']))
    slot = box('DiskSlot', 0.44, 0.03, 0.03)
    slot.location = (0.38, TV_FRONT, cz - TV_H / 2 + 0.16)
    parts.append(assign(bevel(slot, 0.008, 2), mats['dark']))
    led = cylinder('LED', 0.012, 0.012, 0.01, 16)
    led.rotation_euler = (math.pi / 2, 0, 0)
    led.location = (0.68, TV_FRONT - 0.004, cz - TV_H / 2 + 0.16)
    parts.append(assign(led, mats['led']))

    # Base plate under the monitor.
    plate = poly_curve('Base', [rounded_rect(1.2, 1.0, 0.12)], extrude=0.025, bevel=0.01)
    plate.location = (0, -0.05, TV_BOTTOM + 0.01)
    parts.append(smooth(assign(bake_modifiers(plate), mats['dark']), 40))

    # Black "ear" discs on both sides; the cables come out of them.
    for s in (-1, 1):
        x = s * (TV_W / 2 + 0.035)
        disc = cylinder(f'Ear{s}', EAR_R, EAR_R * 0.92, 0.07, 64)
        disc.rotation_euler = (0, math.pi / 2, 0)
        disc.location = (x, EAR_Y, cz)
        parts.append(smooth(assign(bevel(disc, 0.015, 3), mats['rubber']), 40))
        ring = torus(f'EarRing{s}', EAR_R * 0.7, 0.01, 64, 10)
        ring.rotation_euler = (0, math.pi / 2, 0)
        ring.location = (x + s * 0.036, EAR_Y, cz)
        parts.append(assign(ring, mats['chrome']))

    light = empty('ScreenLight', (0, TV_FRONT - 0.5, cz - 0.7))
    return parts, light


# ---------------------------------------------------------------------------
# cables, colliders
# ---------------------------------------------------------------------------
def surface_point(obj, origin, direction):
    hit, loc, normal, _ = obj.ray_cast(Vector(origin), Vector(direction))
    if not hit:
        raise RuntimeError(f'no surface hit from {origin}')
    return loc, normal


def build_cable_anchors(knit):
    """Start/end points for the simulated cables. *_a = at the monitor,
    *_b = on the sweater (absent for cables whose end hangs free)."""
    cz = TV_Z
    ex = TV_W / 2 + 0.06
    specs = [
        # start (x, y, z), end: ('front', x, z) | ('top', x, y) | ('free', length), radius, bone for end
        ((-ex, EAR_Y - 0.05, cz - 0.15), ('front', -0.55, -0.6), 0.012, 1.55),
        ((-ex, EAR_Y + 0.03, cz - 0.16), ('free', 1.25), 0.011, 0),
        ((-ex, EAR_Y + 0.08, cz - 0.13), ('top', -1.0, -0.05), 0.012, 1.45),
        ((ex, EAR_Y - 0.03, cz - 0.15), ('front', 0.62, -0.85), 0.012, 1.5),
        ((ex, EAR_Y + 0.06, cz - 0.15), ('free', 1.0), 0.011, 0),
        ((-0.24, TV_FRONT + 0.36, TV_BOTTOM), ('lip', -0.3), 0.008, 1.6),
        ((0.22, TV_FRONT + 0.38, TV_BOTTOM), ('lip', 0.28), 0.008, 1.7),
    ]
    head, torso, neck = [], [], []
    for i, (start, end, radius, slack) in enumerate(specs):
        a = Vector(start)
        out = Vector((math.copysign(1, a.x) * 0.3, 0, -1)).normalized() if abs(a.x) > 0.5 else Vector((0, 0, -1))
        head.append(empty(f'c{i}_a', a, radius=radius, slack=slack, length=end[1] if end[0] == 'free' else 0))
        head.append(empty(f'c{i}_a2', a + out * 0.07))
        if end[0] == 'free':
            continue
        if end[0] == 'front':
            loc, n = surface_point(knit, (end[1], -3, end[2]), (0, 1, 0))
        elif end[0] == 'top':
            loc, n = surface_point(knit, (end[1], end[2], 3), (0, 0, -1))
        else:  # 'lip': top edge of the turtleneck
            th = math.atan2(-NECK_RY, end[1])
            loc = Vector((end[1], TUBE_CY * BODY_SCALE - math.sqrt(max(NECK_RX ** 2 - end[1] ** 2, 0)) * NECK_RY / NECK_RX, TURTLE_TOP + 0.01))
            n = Vector((0, -0.3, 1)).normalized()
        b = loc + n * radius
        target = neck if end[0] == 'lip' else torso
        target.append(empty(f'c{i}_b', b))
        target.append(empty(f'c{i}_b2', b + n * 0.05))
    return head, torso, neck


def build_colliders():
    """Spheres the cables rest on (radius in the 'r' custom property)."""
    torso = [empty('col_chest', (0, 0.42, -1.05), r=1.05)]
    for s in (-1, 1):
        torso += [
            empty(f'col_pec{s}', (s * 0.5, 0.35, -0.85), r=0.98),
            empty(f'col_shoulder{s}', (s * 1.0, 0.08, -0.62), r=0.5),
            empty(f'col_trap{s}', (s * 0.55, 0.12, -0.42), r=0.42),
        ]
    cy = TUBE_CY * BODY_SCALE
    neck1 = [empty('col_neck1', (0, cy, 0.1), r=NECK_RX + 0.03), empty('col_neck2', (0, cy, 0.35), r=NECK_RX + 0.03)]
    neck2 = [empty('col_neck3', (0, cy, 0.6), r=NECK_RX + 0.02), empty('col_neck4', (0, cy, 0.85), r=NECK_RX)]
    return torso, neck1, neck2


# ---------------------------------------------------------------------------
# rig, bake, export
# ---------------------------------------------------------------------------
def bake_ao(objs):
    scn = bpy.context.scene
    scn.render.engine = 'CYCLES'
    scn.cycles.samples = AO_SAMPLES
    scn.cycles.device = 'CPU'
    scn.render.bake.target = 'VERTEX_COLORS'
    for obj in objs:
        me = obj.data
        attr = me.color_attributes.new('AO', 'BYTE_COLOR', 'POINT')
        me.color_attributes.active_color = attr
        for o in bpy.context.view_layer.objects:
            o.select_set(False)
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.bake(type='AO')
        data = np.empty(len(attr.data) * 4, dtype=np.float32)
        attr.data.foreach_get('color', data)
        data = data.reshape(-1, 4)
        data[:, :3] = 0.3 + 0.7 * data[:, :3]
        attr.data.foreach_set('color', data.ravel())
        print(f'  baked AO: {obj.name} ({len(me.vertices)} verts)')


def build_rig():
    arm = bpy.data.armatures.new('Armature')
    rig = link(bpy.data.objects.new('Armature', arm))
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bones = {}
    for name, h, t, parent in (
        ('torso', (0, 0, -2.2), (0, 0, NECK1_Z), None),
        ('neck1', (0, 0, NECK1_Z), (0, 0, NECK2_Z), 'torso'),
        ('neck2', (0, 0, NECK2_Z), (0, 0, HEAD_Z), 'neck1'),
        ('head', (0, 0, HEAD_Z), (0, 0, TV_Z), 'neck2'),
    ):
        b = arm.edit_bones.new(name)
        b.head, b.tail, b.roll = h, t, 0
        if parent:
            b.parent = bones[parent]
            b.use_connect = True
        bones[name] = b
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def parent_to_bone(obj, rig, bone):
    bpy.context.view_layer.update()
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.parent_type = 'BONE'
    obj.parent_bone = bone
    bpy.context.view_layer.update()
    obj.matrix_world = mw


def skin(obj, rig, weights):
    groups = {n: obj.vertex_groups.new(name=n) for n in ('torso', 'neck1', 'neck2', 'head')}
    for v in obj.data.vertices:
        for name, w in weights(v.co).items():
            if w > 1e-4:
                groups[name].add([v.index], w, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = mw


def knit_weights(co):
    rad = math.hypot(co.x, co.y)
    a = ss(-0.25, 0.1, co.z) * (1 - ss(0.55, 0.85, rad))
    b = ss(NECK2_Z - 0.12, NECK2_Z + 0.12, co.z)
    return {'torso': 1 - a, 'neck1': a * (1 - b), 'neck2': a * b}


def skin_weights(co):
    a = ss(NECK2_Z - 0.1, NECK2_Z + 0.08, co.z)
    c = ss(HEAD_Z - 0.08, HEAD_Z + 0.04, co.z)
    return {'neck1': 1 - a, 'neck2': a * (1 - c), 'head': a * c}


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {
        'knit': material('Knit', KNIT, 0.92, sheen=0.8, sheen_tint=(0.9, 0.9, 0.92), sheen_rough=0.45),
        'skin': material('Skin', SKIN, 0.46, sheen=0.7, sheen_tint=(0.75, 0.32, 0.25), sheen_rough=0.35, coat=0.08, coat_rough=0.4),
        'beige': material('Beige', srgb_hex('#e3dccb'), 0.5, coat=0.25, coat_rough=0.4),
        'dark': material('DarkPlastic', srgb_hex('#121214'), 0.4, coat=0.3, coat_rough=0.3),
        'rubber': material('Rubber', srgb_hex('#0c0c0d'), 0.62),
        'chrome': material('Chrome', (0.9, 0.9, 0.9), 0.18, 1.0),
        'glass': material('Glass', (0, 0, 0), 0.12, coat=1.0, coat_rough=0.1, alpha=0.18),
        'screen': material('Screen', (0, 0, 0), 0.5),
        'led': material('LED', (0.1, 1.0, 0.25), 0.3, emission=(0.1, 1.0, 0.25), emission_strength=5.0),
    }
    kc, kn = rib_knit_maps()
    add_image_map(mats['knit'], kc, 'color')
    add_image_map(mats['knit'], kn, 'normal', 1.0)
    sc, sn = skin_maps(SKIN)
    add_image_map(mats['skin'], sc, 'color')
    add_image_map(mats['skin'], sn, 'normal', 0.5)
    add_image_map(mats['beige'], plastic_normal(), 'normal', 0.15)

    print('building body...')
    body = load_body()
    knit = build_knit(mats, body)
    skin_obj = build_neck_skin(mats)
    bpy.data.objects.remove(body)
    print('building monitor...')
    monitor, light = build_monitor(mats)
    bpy.context.view_layer.update()
    c_head, c_torso, c_neck = build_cable_anchors(knit)
    col_torso, col_neck1, col_neck2 = build_colliders()

    print('baking ambient occlusion...')
    bake_ao([knit, skin_obj] + [o for o in monitor if o.name in ('MonitorFront', 'MonitorRear')])

    print('rigging...')
    rig = build_rig()
    for o in monitor + [light] + c_head:
        parent_to_bone(o, rig, 'head')
    for o in c_torso + col_torso:
        parent_to_bone(o, rig, 'torso')
    for o in col_neck1:
        parent_to_bone(o, rig, 'neck1')
    for o in c_neck + col_neck2:
        parent_to_bone(o, rig, 'neck2')
    skin(knit, rig, knit_weights)
    skin(skin_obj, rig, skin_weights)
    root = link(bpy.data.objects.new('Jack', None))
    rig.parent = root

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=os.path.abspath(OUT),
        export_format='GLB',
        export_apply=True,
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_vertex_color='ACTIVE',
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=7,
        export_image_format='WEBP',
        export_extras=True,
    )
    print('wrote', os.path.abspath(OUT), os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
