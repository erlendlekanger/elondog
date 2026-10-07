"""FOMOCARD hero video: dark stone vault, ceiling light panel, aluminium plinth,
glossy navy metal card on an acrylic stand, slow dolly-in.

Run:  python scene.py --out /path/frames/ [--res 1280 800] [--frames 1 240]
      [--samples 48] [--still FRAME]
Needs `pip install bpy` (Blender as a Python module).
"""
import argparse
import math
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
CARD_PNG = os.path.join(HERE, "..", "fomocard_front.png")

ap = argparse.ArgumentParser()
ap.add_argument("--out", required=True)
ap.add_argument("--res", nargs=2, type=int, default=[1280, 800])
ap.add_argument("--frames", nargs=2, type=int, default=[1, 240])
ap.add_argument("--samples", type=int, default=48)
ap.add_argument("--still", type=int, default=None)
ap.add_argument("--fps", type=int, default=24)
args = ap.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- helpers
def node_mat(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    return m, nt, bsdf


def rounded_rect(w, h, r, seg=12):
    pts = []
    corners = [(w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90),
               (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)]
    for cx, cy, a0 in corners:
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


def mesh_obj(name, verts, faces, uvs=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs:
        uv = me.uv_layers.new()
        for poly in me.polygons:
            for li in poly.loop_indices:
                uv.data[li].uv = uvs[me.loops[li].vertex_index]
    me.update()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    return ob


def box(name, size, loc, mat, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    ob = bpy.context.active_object
    ob.name = name
    ob.scale = size
    bpy.ops.object.transform_apply(scale=True)
    if bevel:
        mod = ob.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 4
    ob.data.materials.append(mat)
    for p in ob.data.polygons:
        p.use_smooth = True
    return ob


# ---------------------------------------------------------------- materials
# black volcanic stone
stone, nt, b = node_mat("stone")
b.inputs["Base Color"].default_value = (0.012, 0.012, 0.013, 1)
b.inputs["Roughness"].default_value = 0.72
noise = nt.nodes.new("ShaderNodeTexNoise")
noise.inputs["Scale"].default_value = 3.0
noise.inputs["Detail"].default_value = 15.0
noise.inputs["Roughness"].default_value = 0.65
vor = nt.nodes.new("ShaderNodeTexVoronoi")
vor.inputs["Scale"].default_value = 7.0
mix = nt.nodes.new("ShaderNodeMath")
mix.operation = "ADD"
nt.links.new(noise.outputs["Fac"], mix.inputs[0])
nt.links.new(vor.outputs["Distance"], mix.inputs[1])
bump = nt.nodes.new("ShaderNodeBump")
bump.inputs["Strength"].default_value = 0.9
bump.inputs["Distance"].default_value = 0.08
nt.links.new(mix.outputs[0], bump.inputs["Height"])
nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
ramp = nt.nodes.new("ShaderNodeValToRGB")
ramp.color_ramp.elements[0].color = (0.006, 0.006, 0.007, 1)
ramp.color_ramp.elements[1].color = (0.03, 0.03, 0.033, 1)
nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])

# polished dark floor
floor_m, nt, b = node_mat("floor")
b.inputs["Base Color"].default_value = (0.008, 0.008, 0.009, 1)
b.inputs["Roughness"].default_value = 0.35

# brushed aluminium plinth
alu, nt, b = node_mat("alu")
b.inputs["Base Color"].default_value = (0.45, 0.46, 0.48, 1)
b.inputs["Metallic"].default_value = 1.0
b.inputs["Roughness"].default_value = 0.34
b.inputs["Anisotropic"].default_value = 0.6

# clear acrylic
acr, nt, b = node_mat("acrylic")
b.inputs["Base Color"].default_value = (0.95, 0.97, 1.0, 1)
b.inputs["Roughness"].default_value = 0.02
b.inputs["Transmission Weight"].default_value = 1.0
b.inputs["IOR"].default_value = 1.49

# card body: navy metal
body, nt, b = node_mat("card_body")
b.inputs["Base Color"].default_value = (0.03, 0.06, 0.16, 1)
b.inputs["Metallic"].default_value = 0.9
b.inputs["Roughness"].default_value = 0.22

# card front: artwork + glossy coat
front, nt, b = node_mat("card_front")
tex = nt.nodes.new("ShaderNodeTexImage")
tex.image = bpy.data.images.load(CARD_PNG)
tex.interpolation = "Cubic"
nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
# silver artwork (bright pixels) reads as polished metal, navy as satin lacquer
sep = nt.nodes.new("ShaderNodeRGBToBW")
nt.links.new(tex.outputs["Color"], sep.inputs["Color"])
mr = nt.nodes.new("ShaderNodeMapRange")
mr.inputs["From Min"].default_value = 0.08
mr.inputs["From Max"].default_value = 0.45
mr.inputs["To Min"].default_value = 0.75
mr.inputs["To Max"].default_value = 0.25
nt.links.new(sep.outputs["Val"], mr.inputs["Value"])
nt.links.new(mr.outputs["Result"], b.inputs["Metallic"])
rr = nt.nodes.new("ShaderNodeMapRange")
rr.inputs["From Min"].default_value = 0.08
rr.inputs["From Max"].default_value = 0.45
rr.inputs["To Min"].default_value = 0.24
rr.inputs["To Max"].default_value = 0.30
nt.links.new(sep.outputs["Val"], rr.inputs["Value"])
nt.links.new(rr.outputs["Result"], b.inputs["Roughness"])
b.inputs["Coat Weight"].default_value = 1.0
b.inputs["Coat Roughness"].default_value = 0.03
nt.links.new(tex.outputs["Alpha"], b.inputs["Alpha"])

emit_m, nt, b = node_mat("panel")
nt.nodes.remove(b)
em = nt.nodes.new("ShaderNodeEmission")
em.inputs["Strength"].default_value = 12.0
em.inputs["Color"].default_value = (1.0, 0.98, 0.95, 1)
nt.links.new(em.outputs[0], nt.nodes["Material Output"].inputs["Surface"])

# ---------------------------------------------------------------- room
box("floor", (14, 14, 0.1), (0, 0, -0.05), floor_m)
box("back", (14, 0.4, 7), (0, 4.2, 3.5), stone)
box("left", (0.4, 14, 7), (-4.0, 0, 3.5), stone)
box("right", (0.4, 14, 7), (4.0, 0, 3.5), stone)
box("ceiling", (14, 14, 0.2), (0, 0, 5.0), stone)
# glowing ceiling panel (seen in the wide shot) + its light
box("panel", (2.6, 1.6, 0.02), (0, 0.4, 4.89), emit_m)
bpy.ops.object.light_add(type="AREA", location=(0, 0.4, 4.85))
L = bpy.context.active_object
L.data.shape = "RECTANGLE"
L.data.size, L.data.size_y = 2.6, 1.6
L.data.energy = 700
L.data.spread = math.radians(55)

# grazing light that brings out the stone texture on the back wall
bpy.ops.object.light_add(type="AREA", location=(0, 3.6, 4.6))
G = bpy.context.active_object
G.data.shape = "RECTANGLE"
G.data.size, G.data.size_y = 6.0, 0.2
G.data.energy = 120
G.rotation_euler = (math.radians(-25), 0, 0)

# plinth and acrylic stand
box("plinth", (1.7, 1.1, 0.42), (0, 0, 0.21), alu, bevel=0.01)
box("plinth_top", (1.62, 1.02, 0.01), (0, 0, 0.425), alu)
box("stand", (0.42, 0.10, 0.05), (0, 0, 0.455), acr, bevel=0.004)

# ---------------------------------------------------------------- card
W, H, R, T = 0.856, 0.540, 0.034, 0.010
pts = rounded_rect(W, H, R)
n = len(pts)
verts = [(x, y, 0) for x, y in pts] + [(x, y, -T) for x, y in pts]
faces = [list(range(n)), list(range(2 * n - 1, n - 1, -1))]
faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
card_body = mesh_obj("card_body", verts, faces)
card_body.data.materials.append(body)
fverts = [(x, y, 0.0004) for x, y in pts]
fuvs = [((x + W / 2) / W, (y + H / 2) / H) for x, y in pts]
card_front = mesh_obj("card_front", fverts, [list(range(n))], fuvs)
card_front.data.materials.append(front)
for ob in (card_body, card_front):
    ob.parent = None
    ob.rotation_euler = (math.radians(90), 0, 0)
    ob.location = (0, 0.005, 0.43 + H / 2 + 0.03)

# a slow 12 degree turn of the card while the camera arrives
for ob in (card_body, card_front):
    ob.rotation_euler[2] = math.radians(-14)
    ob.keyframe_insert("rotation_euler", frame=1)
    ob.rotation_euler[2] = math.radians(0)
    ob.keyframe_insert("rotation_euler", frame=150)

# sweeping light strip that slides a highlight across the card face
bpy.ops.object.light_add(type="AREA", location=(-2.2, -2.0, 1.6))
S = bpy.context.active_object
S.data.shape = "RECTANGLE"
S.data.size, S.data.size_y = 0.15, 2.5
S.data.energy = 140
S.rotation_euler = (math.radians(90), 0, math.radians(-35))
S.keyframe_insert("location", frame=1)
S.location = (2.4, -2.0, 1.6)
S.keyframe_insert("location", frame=240)
# soft key from the front so the artwork reads
bpy.ops.object.light_add(type="AREA", location=(0.4, -3.0, 1.4))
K = bpy.context.active_object
K.data.size = 2.0
K.data.energy = 60
K.rotation_euler = (math.radians(80), 0, 0)
K.visible_glossy = False

# ---------------------------------------------------------------- camera
bpy.ops.object.camera_add()
cam = bpy.context.active_object
scene.camera = cam
target = bpy.data.objects.new("target", None)
scene.collection.objects.link(target)
target.location = (0, 0, 0.75)
con = cam.constraints.new("TRACK_TO")
con.target = target
con.track_axis = "TRACK_NEGATIVE_Z"
con.up_axis = "UP_Y"
cam.data.dof.use_dof = True
cam.data.dof.focus_object = card_front
cam.data.dof.aperture_fstop = 4.0

keys = [(1, (0.0, -7.0, 1.7), 2.6, 22), (90, (0.0, -5.2, 1.5), 0.9, 30),
        (240, (0.12, -2.45, 0.92), 0.73, 50)]
for f, loc, tz, lens in keys:
    cam.location = loc
    cam.data.lens = lens
    target.location.z = tz
    cam.keyframe_insert("location", frame=f)
    cam.data.keyframe_insert("lens", frame=f)
    target.keyframe_insert("location", frame=f)

# keyframes default to auto-clamped Bezier, which already eases in and out

# ---------------------------------------------------------------- render
world = bpy.data.worlds.new("w")
world.color = (0, 0, 0)
scene.world = world
scene.render.engine = "CYCLES"
scene.cycles.device = "CPU"
scene.cycles.samples = args.samples
scene.cycles.use_denoising = True
scene.cycles.max_bounces = 5
scene.render.use_persistent_data = True
scene.cycles.transmission_bounces = 8
scene.view_settings.view_transform = "AgX"
scene.view_settings.look = "AgX - Punchy"
scene.render.resolution_x, scene.render.resolution_y = args.res
scene.render.fps = args.fps
scene.render.image_settings.file_format = "PNG"
scene.frame_start, scene.frame_end = args.frames
os.makedirs(args.out, exist_ok=True)

if args.still is not None:
    scene.frame_set(args.still)
    scene.render.filepath = os.path.join(args.out, f"still_{args.still:04d}.png")
    bpy.ops.render.render(write_still=True)
else:
    scene.render.filepath = os.path.join(args.out, "f_")
    bpy.ops.render.render(animation=True)
