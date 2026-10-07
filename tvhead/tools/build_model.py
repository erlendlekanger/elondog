"""Builds models/tvhead.glb with Blender (no UI needed).

Run with Blender:   blender -b -P tools/build_model.py
or with the bpy module:   python tools/build_model.py

What it makes: a knit-sweater bust with soft folds, a ribbed turtleneck, a
segmented neck and a retro CRT television head, rigged with the bones the
website looks for (torso -> neck1 -> neck2 -> head). Ambient occlusion is baked
into vertex colours with Cycles so creases and contact shadows look real.
The TV screen uses a material named "Screen", which the website replaces with
its animated face shader.
"""
import math
import os
import sys

import bpy  # must come before bmesh/mathutils when running as a module
import bmesh
import numpy as np
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'models', 'tvhead.glb')
BRAND = os.environ.get('TVHEAD_BRAND', 'TV/HEAD')
ACCENT = (1.0, 0.04, 0.016)  # linear RGB of #ff3a22
AO_SAMPLES = int(os.environ.get('TVHEAD_AO_SAMPLES', '48'))

# Layout (Blender: x right, y back, z up; the character faces -y).
NECK1_Z, NECK2_Z, HEAD_Z = 0.4, 0.7, 0.88
TV_W, TV_D, TV_H = 1.66, 0.62, 1.24
TV_Z = HEAD_Z + TV_H / 2 + 0.06
SCREEN_W, SCREEN_H, SCREEN_X = 1.02, 0.8, -0.2


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


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


def add_image_map(mat, image, kind):
    """Plug an image into Base Color ('color') or Normal ('normal')."""
    nt = mat.node_tree
    p = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = image
    if kind == 'normal':
        image.colorspace_settings.name = 'Non-Color'
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = 0.9
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


def sphere(name, r, segs=32, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=r)
    return mesh_obj(name, bm)


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
    m.harden_normals = False
    return bake_modifiers(obj)


def rods_between(name, a, b, r):
    a, b = Vector(a), Vector(b)
    obj = cylinder(name, r, r * 0.7, (b - a).length, 12)
    obj.matrix_world = Matrix.Translation((a + b) / 2) @ (b - a).to_track_quat('Z', 'Y').to_matrix().to_4x4()
    return obj


# ---------------------------------------------------------------------------
# textures
# ---------------------------------------------------------------------------
def knit_normal():
    s = 256
    u, v = np.meshgrid(np.arange(s) / s, np.arange(s) / s)
    rib = np.abs(np.sin(u * np.pi * 8))
    stitch = np.abs(np.sin((v * 16 + (np.floor(u * 8) % 2) * 0.5) * np.pi))
    rng = np.random.default_rng(3)
    fuzz = rng.random((s, s)) * 0.08
    return np_image('knit_normal', normal_from_height(rib * 0.7 + stitch * rib * 0.35 + fuzz, 2.2))


def grille_maps():
    s, n = 256, 14
    u, v = np.meshgrid(np.arange(s) / s, np.arange(s) / s)
    d = np.hypot((u * n) % 1 - 0.5, (v * n) % 1 - 0.5)
    hgt = np.clip((d - 0.28) / 0.08, 0, 1)
    col = np.where(d < 0.3, 0.002, 0.08)[..., None].repeat(3, axis=2)
    return np_image('grille_color', col), np_image('grille_normal', normal_from_height(hgt, 6.0))


# ---------------------------------------------------------------------------
# build
# ---------------------------------------------------------------------------
def build_sweater(mats):
    # Torso: elliptical lathe.
    profile = [(0.9, -2.8), (0.95, -1.8), (1.0, -0.9), (1.0, -0.45), (0.97, -0.22), (0.86, -0.06),
               (0.62, 0.08), (0.42, 0.17), (0.3, 0.22), (0.15, 0.25), (0.0, 0.26)]
    bm = bmesh.new()
    n = 96
    rings = []
    for r, z in profile:
        rings.append([bm.verts.new((max(r, 1e-3) * 1.22 * math.cos(2 * math.pi * i / n), max(r, 1e-3) * 0.6 * math.sin(2 * math.pi * i / n), z)) for i in range(n)])
    for a, b in zip(rings, rings[1:]):
        for i in range(n):
            bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
    bm.faces.new(list(reversed(rings[0])))
    torso = mesh_obj('torso_shape', bm)

    parts = [torso]
    for side in (-1, 1):
        sh = sphere(f'shoulder{side}', 0.42, 48, 24)
        sh.scale = (1.0, 0.9, 0.92)
        sh.location = (side * 1.02, 0, -0.42)
        arm = cylinder(f'arm{side}', 0.36, 0.4, 2.6, 48)
        arm.location = (side * 1.08, 0, -1.72)
        arm.rotation_euler = (0, -side * 0.06, 0)
        parts += [sh, arm]

    # Union everything into one watertight surface.
    for p in parts:
        bpy.context.view_layer.objects.active = p
    with bpy.context.temp_override(active_object=torso, selected_editable_objects=parts, selected_objects=parts):
        bpy.ops.object.join()
    obj = torso
    obj.name = 'Sweater'
    rm = obj.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = 0.028
    sm = obj.modifiers.new('smooth', 'SMOOTH')
    sm.factor = 0.8
    sm.iterations = 14
    # Soft fabric lumps and folds.
    tex = bpy.data.textures.new('folds', 'CLOUDS')
    tex.noise_scale = 0.42
    tex.noise_depth = 2
    dp = obj.modifiers.new('folds', 'DISPLACE')
    dp.texture = tex
    dp.strength = 0.03
    dp.mid_level = 0.5
    tex2 = bpy.data.textures.new('creases', 'WOOD')
    tex2.wood_type = 'BANDNOISE'
    tex2.noise_scale = 0.3
    tex2.turbulence = 6
    dp2 = obj.modifiers.new('creases', 'DISPLACE')
    dp2.texture = tex2
    dp2.strength = 0.012
    dp2.direction = 'NORMAL'
    obj = bake_modifiers(obj)

    # Cut off the bottom (out of frame) and anything inside the collar.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -2.55], context='VERTS')
    # Cylindrical knit UVs: vertical ribs.
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        us = [math.atan2(l.vert.co.y, l.vert.co.x) / (2 * math.pi) + 0.5 for l in f.loops]
        if max(us) - min(us) > 0.5:  # face crossing the seam
            us = [x + 1 if x < 0.5 else x for x in us]
        for l, x in zip(f.loops, us):
            l[uv].uv = (x * 40, l.vert.co.z * 6)
    bm.to_mesh(obj.data)
    bm.free()
    smooth(obj)
    return assign(obj, mats['sweater'])


def build_collar(mats):
    bm = bmesh.new()
    segs, rows, h = 144, 10, 0.34
    grid = []
    for j in range(rows + 1):
        t = j / rows
        z = 0.25 + t * h
        r = 0.37 + (0.31 - 0.37) * t
        row = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            k = 1 + 0.014 * math.sin(a * 48) + 0.04 * (0.17 - abs(t * h - h / 2))
            row.append(bm.verts.new((r * k * math.cos(a), r * k * 0.82 * math.sin(a), z)))
        grid.append(row)
    for a, b in zip(grid, grid[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    obj = mesh_obj('Collar', bm)
    so = obj.modifiers.new('thick', 'SOLIDIFY')
    so.thickness = 0.035
    so.offset = -1
    sub = obj.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    obj = bake_modifiers(obj)
    # Rolled edge at the top of the collar.
    bm = bmesh.new()
    R, r, nu, nv = 0.315, 0.035, 144, 16
    ring = [[bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a) * 0.82, 0.59 + r * math.sin(b)))
             for b in (2 * math.pi * j / nv for j in range(nv))] for a in (2 * math.pi * i / nu for i in range(nu))]
    for i in range(nu):
        for j in range(nv):
            bm.faces.new((ring[i][j], ring[(i + 1) % nu][j], ring[(i + 1) % nu][(j + 1) % nv], ring[i][(j + 1) % nv]))
    lip = smooth(mesh_obj('CollarLip', bm))
    with bpy.context.temp_override(active_object=obj, selected_editable_objects=[obj, lip], selected_objects=[obj, lip]):
        bpy.ops.object.join()
    smooth(obj)
    return assign(obj, mats['collar'])


def build_neck(mats):
    objs = {'neck1': [], 'neck2': []}
    core = cylinder('NeckCore', 0.1, 0.1, HEAD_Z - NECK1_Z + 0.06, 32)
    core.location.z = (NECK1_Z + HEAD_Z) / 2
    objs['neck1'].append(smooth(assign(core, mats['rubber']), 40))
    rings = [(NECK1_Z + 0.05, 'neck1'), (NECK1_Z + 0.15, 'neck1'), (NECK1_Z + 0.25, 'neck1'),
             (NECK2_Z + 0.045, 'neck2'), (NECK2_Z + 0.135, 'neck2')]
    for i, (z, bone) in enumerate(rings):
        ring = cylinder(f'NeckRing{i}', 0.155, 0.155, 0.045, 48)
        ring.location.z = z
        ring = bevel(ring, 0.01, 3)
        objs[bone].append(smooth(assign(ring, mats['brushed'] if i % 2 else mats['dark']), 40))
    return objs


def build_tv(mats):
    parts = []
    cz = TV_Z
    front_y = -TV_D / 2

    shell = box('TVShell', TV_W, TV_D, TV_H)
    shell.location = (0, 0, cz)
    shell = bevel(shell, 0.1, 6)
    parts.append(smooth(assign(shell, mats['shell']), 35))

    back = box('TVBack', TV_W * 0.9, 0.66, TV_H * 0.88)
    bm = bmesh.new()
    bm.from_mesh(back.data)
    for v in bm.verts:
        if v.co.y > 0:
            v.co.x *= 0.58
            v.co.z = v.co.z * 0.62 + 0.04
    bm.to_mesh(back.data)
    bm.free()
    back.location = (0, TV_D / 2 + 0.3, cz)
    back = bevel(back, 0.035, 3)
    parts.append(smooth(assign(back, mats['shell']), 35))

    top_front = TV_H * 0.88 / 2
    slope = (top_front - (top_front * 0.62 + 0.04)) / 0.66
    for i in range(7):
        dz = 0.1 + i * 0.07
        slot = box(f'Vent{i}', 0.5, 0.025, 0.012)
        slot.location = (0, TV_D / 2 - 0.03 + dz, cz + top_front - dz * slope + 0.004)
        slot.rotation_euler = (math.atan(slope), 0, 0)
        parts.append(assign(slot, mats['dark']))

    bezel = poly_curve('Bezel', [rounded_rect(1.18, 0.98, 0.12), rounded_rect(SCREEN_W - 0.02, SCREEN_H - 0.02, 0.1)], extrude=0.0125, bevel=0.014)
    bezel.rotation_euler = (math.pi / 2, 0, 0)
    bezel.location = (SCREEN_X, front_y - 0.012, cz + 0.02)
    bezel = bake_modifiers(bezel)
    parts.append(smooth(assign(bezel, mats['dark']), 40))

    # Curved CRT screen (UVs 0..1 for the face shader) and its glass.
    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')  # create_grid only fills UVs if a layer exists
    bmesh.ops.create_grid(bm, x_segments=48, y_segments=36, size=0.5, calc_uvs=True)
    for v in bm.verts:
        nx, ny = v.co.x * 2, v.co.y * 2
        v.co.x *= SCREEN_W + 0.04
        v.co.y *= SCREEN_H + 0.04
        v.co.z = 0.04 * (1 - 0.5 * (nx * nx + ny * ny))
    screen = mesh_obj('Screen', bm)
    screen.rotation_euler = (math.pi / 2, 0, 0)
    screen.location = (SCREEN_X, front_y + 0.005, cz + 0.02)
    screen = bake_modifiers(screen)
    parts.append(smooth(assign(screen, mats['screen'])))
    glass = screen.copy()
    glass.data = screen.data.copy()
    glass.name = 'ScreenGlass'
    glass.location.y -= 0.004
    link(glass)
    parts.append(assign(glass, mats['glass']))

    px = 0.6
    for i, z in enumerate((0.27, 0.02)):
        knob = cylinder(f'Knob{i}', 0.09, 0.085, 0.07, 72)
        bm = bmesh.new()
        bm.from_mesh(knob.data)
        for v in bm.verts:
            r = math.hypot(v.co.x, v.co.y)
            if r > 0.06 and math.sin(math.atan2(v.co.y, v.co.x) * 36) > 0:
                v.co.x *= 1.035
                v.co.y *= 1.035
        bm.to_mesh(knob.data)
        bm.free()
        knob.rotation_euler = (math.pi / 2, 0, 0)
        knob.location = (px, front_y - 0.035, cz + z)
        parts.append(smooth(assign(knob, mats['dark']), 30))
        cap = cylinder(f'KnobCap{i}', 0.06, 0.055, 0.02, 48)
        cap.rotation_euler = (math.pi / 2, 0, 0)
        cap.location = (px, front_y - 0.075, cz + z)
        parts.append(smooth(assign(cap, mats['chrome']), 30))
        tick = box(f'KnobTick{i}', 0.01, 0.01, 0.05)
        tick.location = (px, front_y - 0.086, cz + z + 0.025)
        tick.rotation_euler = (0, 0.7 if i else -0.4, 0)
        parts.append(assign(tick, mats['dark']))

    bm = bmesh.new()
    bm.loops.layers.uv.new('UVMap')  # create_grid only fills UVs if a layer exists
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5, calc_uvs=True)
    bmesh.ops.scale(bm, vec=(0.28, 0.3, 1), verts=bm.verts)
    grille = mesh_obj('Grille', bm)
    grille.rotation_euler = (math.pi / 2, 0, 0)
    grille.location = (px, front_y - 0.004, cz - 0.31)
    parts.append(assign(grille, mats['grille']))
    frame = poly_curve('GrilleFrame', [rounded_rect(0.3, 0.32, 0.015, 4), rounded_rect(0.28, 0.3, 0.01, 4)], extrude=0.004, bevel=0.002)
    frame.rotation_euler = (math.pi / 2, 0, 0)
    frame.location = (px, front_y - 0.004, cz - 0.31)
    parts.append(assign(bake_modifiers(frame), mats['dark']))

    led = sphere('LED', 0.014, 16, 8)
    led.location = (px + 0.1, front_y - 0.005, cz - 0.52)
    parts.append(smooth(assign(led, mats['led'])))

    # Chrome brand badge under the screen.
    cu = bpy.data.curves.new('BadgeText', 'FONT')
    cu.body = BRAND
    cu.align_x = 'CENTER'
    cu.align_y = 'CENTER'
    cu.size = 0.055
    cu.extrude = 0.003
    txt = link(bpy.data.objects.new('Badge', cu))
    txt.rotation_euler = (math.pi / 2, 0, 0)
    txt.location = (SCREEN_X, front_y - 0.04, cz + 0.02 - 0.44)
    parts.append(assign(bake_modifiers(txt), mats['chrome']))

    mount = cylinder('Mount', 0.24, 0.2, 0.08, 48)
    mount.location.z = cz - TV_H / 2 - 0.02
    parts.append(smooth(assign(bevel(mount, 0.01, 2), mats['dark']), 40))

    # Antennas: pivot empties (animated by the site) with rods as children.
    antennas = []
    for side, label in ((-1, 'L'), (1, 'R')):
        pivot = link(bpy.data.objects.new(f'antenna_{label}', None))
        pivot.location = (side * 0.12, 0.2, cz + TV_H / 2 + 0.02)
        bpy.context.view_layer.update()  # so children are parented to its real transform
        base = sphere(f'AntennaBase{label}', 0.06, 32, 16)
        bm = bmesh.new()
        bm.from_mesh(base.data)
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.001], context='VERTS')
        bm.to_mesh(base.data)
        bm.free()
        base.location = pivot.location
        d = Vector((side * math.sin(0.62), math.sin(0.2), math.cos(0.62))).normalized()
        rod = rods_between(f'AntennaRod{label}', pivot.location, pivot.location + d * 0.85, 0.012)
        tip = sphere(f'AntennaTip{label}', 0.022, 16, 8)
        tip.location = pivot.location + d * 0.85
        for o, m in ((base, mats['dark']), (rod, mats['antenna']), (tip, mats['antenna'])):
            smooth(assign(o, m))
            mw = o.matrix_world.copy()
            o.parent = pivot
            o.matrix_world = mw
        antennas.append(pivot)

    light = link(bpy.data.objects.new('ScreenLight', None))
    light.location = (SCREEN_X, front_y - 0.45, cz - TV_H / 2 - 0.15)
    return parts, antennas, light


def build_cables(mats):
    tv_bottom = TV_Z - TV_H / 2 + 0.02
    specs = [
        ((-0.42, 0.1, tv_bottom), (-0.26, 0.06, 0.5), 0.032, mats['cable'], -1),
        ((-0.3, 0.22, tv_bottom), (-0.18, 0.17, 0.5), 0.022, mats['cable_accent'], -1),
        ((0.4, 0.18, tv_bottom), (0.25, 0.1, 0.5), 0.028, mats['cable'], 1),
    ]
    cables = []
    for i, (a, b, r, mat, out) in enumerate(specs):
        cu = bpy.data.curves.new(f'Cable{i}', 'CURVE')
        cu.dimensions = '3D'
        cu.bevel_depth = r
        cu.bevel_resolution = 3
        cu.resolution_u = 24
        sp = cu.splines.new('BEZIER')
        sp.bezier_points.add(1)
        p0, p1 = sp.bezier_points
        p0.co, p1.co = a, b
        p0.handle_right = Vector(a) + Vector((out * 0.1, -0.03, -0.28))
        p0.handle_left = Vector(a) * 2 - p0.handle_right
        p1.handle_left = Vector(b) + Vector((out * 0.12, -0.02, 0.3))
        p1.handle_right = Vector(b) * 2 - p1.handle_left
        obj = bake_modifiers(link(bpy.data.objects.new(f'Cable{i}', cu)))
        cables.append(smooth(assign(obj, mat)))
    return cables, tv_bottom


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
        # Lift the blacks so AO reads as soft contact shadow, not dirt.
        data = np.empty(len(attr.data) * 4, dtype=np.float32)
        attr.data.foreach_get('color', data)
        data = data.reshape(-1, 4)
        data[:, :3] = 0.32 + 0.68 * data[:, :3]
        attr.data.foreach_set('color', data.ravel())
        print(f'  baked AO: {obj.name} ({len(me.vertices)} verts)')


def build_rig():
    arm = bpy.data.armatures.new('Armature')
    rig = link(bpy.data.objects.new('Armature', arm))
    bpy.context.view_layer.objects.active = rig
    rig.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bones = {}
    for name, head, tail, parent in (
        ('torso', (0, 0, -0.6), (0, 0, NECK1_Z), None),
        ('neck1', (0, 0, NECK1_Z), (0, 0, NECK2_Z), 'torso'),
        ('neck2', (0, 0, NECK2_Z), (0, 0, HEAD_Z), 'neck1'),
        ('head', (0, 0, HEAD_Z), (0, 0, TV_Z), 'neck2'),
    ):
        b = arm.edit_bones.new(name)
        b.head, b.tail, b.roll = head, tail, 0
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


def skin_cable(obj, rig, z_low, z_high):
    for name in ('torso', 'head'):
        obj.vertex_groups.new(name=name)
    gt, gh = obj.vertex_groups['torso'], obj.vertex_groups['head']
    for v in obj.data.vertices:
        z = (obj.matrix_world @ v.co).z
        t = min(max((z - z_low) / (z_high - z_low), 0), 1)
        w = t * t * (3 - 2 * t)
        gt.add([v.index], 1 - w, 'REPLACE')
        gh.add([v.index], w, 'REPLACE')
    mod = obj.modifiers.new('Armature', 'ARMATURE')
    mod.object = rig
    mw = obj.matrix_world.copy()
    obj.parent = rig
    obj.matrix_world = mw


def main():
    reset()
    lin = lambda h: tuple(((int(h[i:i + 2], 16) / 255) / 12.92) if int(h[i:i + 2], 16) / 255 <= 0.04045 else (((int(h[i:i + 2], 16) / 255 + 0.055) / 1.055) ** 2.4) for i in (1, 3, 5))
    mats = {
        'sweater': material('Sweater', lin('#1d1e22'), 0.92, sheen=1.0, sheen_tint=(0.15, 0.16, 0.19), sheen_rough=0.55),
        'collar': material('Collar', lin('#1d1e22'), 0.9, sheen=1.0, sheen_tint=(0.15, 0.16, 0.19), sheen_rough=0.5),
        'shell': material('Shell', lin('#d9d2c3'), 0.48, coat=0.35, coat_rough=0.35),
        'dark': material('DarkPlastic', lin('#0f0f11'), 0.38, coat=0.4, coat_rough=0.3),
        'rubber': material('Rubber', lin('#0b0b0c'), 0.7),
        'chrome': material('Chrome', (1, 1, 1), 0.14, 1.0),
        'antenna': material('Antenna', lin('#b8b8bc'), 0.28, 1.0),
        'brushed': material('Brushed', lin('#6c6e74'), 0.38, 1.0),
        'glass': material('Glass', (0, 0, 0), 0.16, coat=1.0, coat_rough=0.18, alpha=0.2),
        'screen': material('Screen', (0, 0, 0), 0.5),
        'led': material('LED', ACCENT, 0.3, emission=ACCENT, emission_strength=6.0),
        'cable': material('Cable', lin('#0d0d0e'), 0.35, coat=0.6, coat_rough=0.2),
        'cable_accent': material('CableAccent', tuple(c * 0.55 for c in ACCENT), 0.35, coat=0.6, coat_rough=0.2),
        'grille': material('Grille', (0.05, 0.05, 0.05), 0.6, 0.3),
    }
    add_image_map(mats['sweater'], knit_normal(), 'normal')
    gc, gn = grille_maps()
    add_image_map(mats['grille'], gc, 'color')
    add_image_map(mats['grille'], gn, 'normal')

    print('building sweater...')
    sweater = build_sweater(mats)
    collar = build_collar(mats)
    neck = build_neck(mats)
    print('building tv...')
    tv_parts, antennas, light = build_tv(mats)
    cables, tv_bottom = build_cables(mats)

    print('baking ambient occlusion...')
    shell = [o for o in tv_parts if o.name in ('TVShell', 'TVBack')]
    bake_ao([sweater, collar, *shell, neck['neck1'][0]])

    print('rigging...')
    rig = build_rig()
    for o in (sweater, collar):
        parent_to_bone(o, rig, 'torso')
    for bone, objs in neck.items():
        for o in objs:
            parent_to_bone(o, rig, bone)
    for o in tv_parts + antennas + [light]:
        parent_to_bone(o, rig, 'head')
    for c in cables:
        skin_cable(c, rig, 0.55, tv_bottom - 0.05)

    root = link(bpy.data.objects.new('TVHead', None))
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
    )
    print('wrote', os.path.abspath(OUT), os.path.getsize(OUT) // 1024, 'KB')


if __name__ == '__main__':
    main()
