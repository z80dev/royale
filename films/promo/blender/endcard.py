"""LAUNCHPAD ROYALE end card: the ten launchpad badges slam onto a wet neon floor.

Builds the whole shot procedurally from an empty file (no .blend; fixed seeds) and
leaves it ready to render with EEVEE. See README.md for the render/encode commands.

    Blender -b --factory-startup -P endcard.py -a                  # all 390 frames
    Blender -b --factory-startup -P endcard.py -f 60,99 -- --preview

Timeline (60 fps, 120 BPM; Blender frame N = clip frame N, t = N / 60):
    0–95     dark wet floor waiting; a faint mint sheen glides across it, left → right
    96–164   badge i slams at round(96 + 7.5·i) (16th notes from 1.6 s), left → right
    164      last slam (bankr) also sends a wide shared pulse along the floor
    168–389  slow push-in + slight crane down; rim lights breathe
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

# ── options ────────────────────────────────────────────────────────────────
ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = "--preview" in ARGS          # half resolution, fewer samples
OUT_DIR = "/tmp/end-slabs-frames"
for i, a in enumerate(ARGS):
    if a == "--out" and i + 1 < len(ARGS):
        OUT_DIR = ARGS[i + 1]

FPS = 60
FRAMES = 390
SEED = 1337
BADGE_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                          "..", "..", "..", "public", "badges"))

# ── colour ─────────────────────────────────────────────────────────────────


def srgb(hex_str, a=1.0):
    h = hex_str.lstrip("#")
    out = []
    for k in range(3):
        c = int(h[2 * k:2 * k + 2], 16) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, a)


# roster order, left → right, with each launchpad's brand primary
ROSTER = [("doppler", "#0FAE85"), ("uniswap", "#FF007A"), ("pons", "#C9CED6"),
          ("long", "#DDF5E3"), ("jpeg", "#A8BFFF"), ("fomo", "#606AF7"),
          ("pump", "#5FD18B"), ("clanker", "#8A63D2"), ("zora", "#4281D3"),
          ("bankr", "#FF613D")]
INK = srgb("#1f2126")
COOL = srgb("#dfe6ff")
MINT = srgb("#19e3a7")
PERI = srgb("#a8bfff")
MAGENTA = srgb("#c03cff")
TEAL = srgb("#19e0d0")
CITY = [srgb(c) for _, c in ROSTER] + [MAGENTA, TEAL, MAGENTA, TEAL]

# ── geometry / timing ──────────────────────────────────────────────────────
W = 1.0                                 # badge side (m)
D = 0.12 * W                            # depth: 12 % of the width
RADIUS = 0.219 * W                      # corner radius, measured from the badge PNG alpha
PITCH = 1.27 * W                        # centre-to-centre spacing along the row
ARC_R = 45.0                            # gentle arc bowing toward the camera
ZC = W / 2 - 0.004                      # rest height of a badge centre
SLAMS = [math.floor(96 + 7.5 * i + 0.5) for i in range(len(ROSTER))]
LAST = SLAMS[-1]
FALL_T = 16                             # frames from the fall start to the slam
FALL_H = 14.0                           # metres above rest at the fall start
PUSH_START = 168                        # t = 2.8 s

SHEEN = 0.11                            # peak mint sheen emission on the far floor

LENS = 70.0
ROW_ROW = 800                           # badge centres land on this image row (of 1080)

# ── helpers ────────────────────────────────────────────────────────────────


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mesh_obj(name, bm, mats=()):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m)
    return link(bpy.data.objects.new(name, me))


def new_mat(name):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    return m, nt, nt.nodes.new("ShaderNodeOutputMaterial")


def emission_mat(name, color, strength):
    m, nt, out = new_mat(name)
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Color"].default_value = color
    em.inputs["Strength"].default_value = strength
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m, em


def key_value(socket, frame, value):
    socket.default_value = value
    socket.keyframe_insert("default_value", frame=frame)


def key_energy(light_ob, frame, value):
    light_ob.data.energy = value
    light_ob.data.keyframe_insert("energy", frame=frame)


def smoothstep(e0, e1, x):
    t = min(max((x - e0) / (e1 - e0), 0.0), 1.0)
    return t * t * (3 - 2 * t)


def ease_in_out(x):
    x = min(max(x, 0.0), 1.0)
    return 0.5 - 0.5 * math.cos(math.pi * x)


def breathe(f, phase):
    """Slow rim-light breathing: ±1 over a 4 s (2-bar) cycle."""
    return math.sin(2 * math.pi * f / (4 * FPS) + phase)


def slot_pos(i):
    th = (i - (len(ROSTER) - 1) / 2) * PITCH / ARC_R
    return Vector((ARC_R * math.sin(th), -ARC_R * (1 - math.cos(th)), 0.0)), th


# ── materials ──────────────────────────────────────────────────────────────


def lacquer_mat():
    m, nt, out = new_mat("lacquer")
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = INK
    b.inputs["Roughness"].default_value = 0.32
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.035
    b.inputs["Coat IOR"].default_value = 1.55
    nt.links.new(b.outputs[0], out.inputs["Surface"])
    return m


def badge_mat(name):
    """Printed glossy tile: the badge image carries its own light (emission) so the
    logo reads true-colour regardless of the lighting; a clear coat on top picks up
    the softbox and neon reflections."""
    m, nt, out = new_mat("badge_" + name)
    N, L = nt.nodes, nt.links
    tex = N.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(os.path.join(BADGE_DIR, name + ".png"))
    tex.interpolation = "Cubic"
    tex.extension = "EXTEND"
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Roughness"].default_value = 0.45
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Coat Roughness"].default_value = 0.03
    b.inputs["Emission Strength"].default_value = 1.08
    dim = N.new("ShaderNodeMix")
    dim.data_type = "RGBA"
    dim.blend_type = "MULTIPLY"
    dim.inputs["Factor"].default_value = 1.0
    dim.inputs["B"].default_value = (0.25, 0.25, 0.25, 1)
    L.new(tex.outputs["Color"], dim.inputs["A"])
    L.new(dim.outputs["Result"], b.inputs["Base Color"])
    L.new(tex.outputs["Color"], b.inputs["Emission Color"])
    L.new(b.outputs[0], out.inputs["Surface"])
    return m


def floor_mat():
    """Wet asphalt: puddles are mirror-like, the rest a blurry sheen. A mint sheen band
    (keyed 'sheen_pos' / 'sheen_gain' value nodes) glides across the far floor; it is
    part of the floor shader, so there is no emitter to show up in the puddles."""
    m, nt, out = new_mat("floor")
    N, L = nt.nodes, nt.links
    tc = N.new("ShaderNodeTexCoord")
    b = N.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (0.0035, 0.0038, 0.0048, 1)
    b.inputs["Specular IOR Level"].default_value = 0.45
    nz = N.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 0.22
    nz.inputs["Detail"].default_value = 6
    nz.inputs["Roughness"].default_value = 0.6
    L.new(tc.outputs["Object"], nz.inputs["Vector"])
    ramp = N.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.44
    ramp.color_ramp.elements[0].color = (0.06, 0.06, 0.06, 1)
    ramp.color_ramp.elements[1].position = 0.58
    ramp.color_ramp.elements[1].color = (0.38, 0.38, 0.38, 1)
    L.new(nz.outputs["Fac"], ramp.inputs["Fac"])
    L.new(ramp.outputs["Color"], b.inputs["Roughness"])
    grain = N.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 60
    grain.inputs["Detail"].default_value = 4
    L.new(tc.outputs["Object"], grain.inputs["Vector"])
    bump = N.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.08
    L.new(grain.outputs["Fac"], bump.inputs["Height"])
    L.new(bump.outputs["Normal"], b.inputs["Normal"])

    def op(kind, a, bval):
        n = N.new("ShaderNodeMath")
        n.operation = kind
        for sock, v in zip(n.inputs, (a, bval)):
            if isinstance(v, bpy.types.NodeSocket):
                L.new(v, sock)
            else:
                sock.default_value = v
        return n.outputs[0]

    pos = N.new("ShaderNodeValue")
    pos.name = pos.label = "sheen_pos"
    gain = N.new("ShaderNodeValue")
    gain.name = gain.label = "sheen_gain"
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Object"], sep.inputs[0])

    def ramp_y(y0, y1, v0, v1):
        n = N.new("ShaderNodeMapRange")
        n.clamp = True
        n.inputs["From Min"].default_value = y0
        n.inputs["From Max"].default_value = y1
        n.inputs["To Min"].default_value = v0
        n.inputs["To Max"].default_value = v1
        L.new(sep.outputs["Y"], n.inputs["Value"])
        return n.outputs["Result"]

    # only the far floor behind the row, i.e. a strip just under the horizon
    graze = op("MULTIPLY", ramp_y(12.0, 45.0, 0.0, 1.0), ramp_y(55.0, 150.0, 1.0, 0.0))
    # soft band in horizontal view angle (≈ x / distance from the camera line)
    ang = op("DIVIDE", sep.outputs["X"], op("MAXIMUM", op("ADD", sep.outputs["Y"], 40.0), 1.0))
    d = op("DIVIDE", op("SUBTRACT", ang, pos.outputs[0]), 0.07)
    band = op("EXPONENT", op("MULTIPLY", op("MULTIPLY", d, d), -1.0), 0.0)
    # puddles catch it more than the dry asphalt
    wet = N.new("ShaderNodeMapRange")
    wet.inputs["From Min"].default_value = 0.44
    wet.inputs["From Max"].default_value = 0.58
    wet.inputs["To Min"].default_value = 1.0
    wet.inputs["To Max"].default_value = 0.15
    L.new(nz.outputs["Fac"], wet.inputs["Value"])
    sheen = op("MULTIPLY", op("MULTIPLY", graze, band), op("MULTIPLY", wet.outputs["Result"],
                                                             gain.outputs[0]))
    b.inputs["Emission Color"].default_value = MINT
    L.new(sheen, b.inputs["Emission Strength"])
    L.new(b.outputs[0], out.inputs["Surface"])
    return m, pos.outputs[0], gain.outputs[0]


def attr_emission_mat(name, attr, strength):
    m, nt, out = new_mat(name)
    at = nt.nodes.new("ShaderNodeAttribute")
    at.attribute_name = attr
    em = nt.nodes.new("ShaderNodeEmission")
    em.inputs["Strength"].default_value = strength
    nt.links.new(at.outputs["Color"], em.inputs["Color"])
    nt.links.new(em.outputs[0], out.inputs["Surface"])
    return m, em


# ── scene pieces ───────────────────────────────────────────────────────────


def rounded_outline(size, radius, seg=14):
    """Rounded-square outline in the XZ plane, counter-clockwise seen from −Y."""
    h = size / 2 - radius
    pts = []
    for cx, cz, a0 in ((h, -h, -90), (h, h, 0), (-h, h, 90), (-h, -h, 180)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg)
            pts.append((cx + radius * math.cos(a), cz + radius * math.sin(a)))
    return pts


def build_badge(name, badge_m, body_m):
    """Rounded-square slab; the front face (and front bevel) carries the badge image,
    UV-mapped planar so the artwork sits exactly on the rounded silhouette."""
    bm = bmesh.new()
    outline = rounded_outline(W, RADIUS)
    front = [bm.verts.new((x, -D / 2, z)) for x, z in outline]
    back = [bm.verts.new((x, D / 2, z)) for x, z in outline]
    bm.faces.new(front)
    bm.faces.new(back)
    n = len(outline)
    rim_edges = []
    for k in range(n):
        f = bm.faces.new((front[k], front[(k + 1) % n], back[(k + 1) % n], back[k]))
        f.smooth = True
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.edges.ensure_lookup_table()
    for e in bm.edges:
        ys = {round(v.co.y, 5) for v in e.verts}
        if len(ys) == 1:                     # front/back perimeter edges
            rim_edges.append(e)
    bev = bmesh.ops.bevel(bm, geom=rim_edges, offset=0.018, segments=5, profile=0.5,
                          affect="EDGES", clamp_overlap=True)
    for f in bev["faces"]:
        f.smooth = True
    bm.normal_update()
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        f.material_index = 0 if f.normal.y < -0.5 else 1
        for lp in f.loops:
            lp[uv].uv = (lp.vert.co.x / W + 0.5, lp.vert.co.z / W + 0.5)
    return mesh_obj("badge_" + name, bm, (badge_m, body_m))


def build_backplate(name, mat):
    """Emissive rounded plate just behind a badge: a thin brand-coloured halo rim."""
    bm = bmesh.new()
    vs = [bm.verts.new((x, 0, z)) for x, z in rounded_outline(W * 1.07, RADIUS * 1.07)]
    bm.faces.new(vs[::-1])
    return mesh_obj("rim_" + name, bm, (mat,))


def build_floor(mat):
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=1200)
    return mesh_obj("floor", bm, (mat,))


def build_torus(name, major, minor, mat, seg=128, rings=10):
    bm = bmesh.new()
    verts = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        row = []
        for j in range(rings):
            b = 2 * math.pi * j / rings
            r = major + minor * math.cos(b)
            row.append(bm.verts.new((r * math.cos(a), r * math.sin(a), minor * math.sin(b))))
        verts.append(row)
    for i in range(seg):
        for j in range(rings):
            f = bm.faces.new((verts[i][j], verts[(i + 1) % seg][j],
                              verts[(i + 1) % seg][(j + 1) % rings], verts[i][(j + 1) % rings]))
            f.smooth = True
    return mesh_obj(name, bm, (mat,))


def build_city():
    """Far, dim neon skyline: dark towers with coloured window specks and a low band
    of street-light bokeh. Deterministic."""
    body = bmesh.new()
    glow = bmesh.new()
    gcol = glow.loops.layers.color.new("col")

    def box(bm, c, sx, sy, sz, color=None):
        vs = bmesh.ops.create_cube(bm, size=1.0)["verts"]
        bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=vs)
        bmesh.ops.translate(bm, vec=c, verts=vs)
        if color is not None:
            for f in {f for v in vs for f in v.link_faces}:
                for lp in f.loops:
                    lp[gcol] = color

    def ball(c, r, color):
        vs = bmesh.ops.create_icosphere(glow, subdivisions=1, radius=r)["verts"]
        bmesh.ops.translate(glow, vec=c, verts=vs)
        for f in {f for v in vs for f in v.link_faces}:
            for lp in f.loops:
                lp[gcol] = color

    rng = random.Random(SEED + 1)
    for _ in range(80):
        y = rng.uniform(160, 520)
        x = rng.uniform(-0.5, 0.5) * y
        h = rng.uniform(8, 34) * (0.7 + y / 520)
        wdt = rng.uniform(8, 22)
        dep = rng.uniform(8, 16)
        box(body, (x, y, h / 2), wdt, dep, h)
        col = rng.choice(CITY)
        k = rng.uniform(0.3, 0.8)
        c = (col[0] * k, col[1] * k, col[2] * k, 1)
        front = y - dep / 2 - 0.2
        for _w in range(rng.randint(3, 10)):             # window specks, low on the tower
            wc = rng.choice([c, (0.9, 0.72, 0.5, 1), (0.6, 0.72, 1.0, 1)])
            ball((x + rng.uniform(-wdt / 2, wdt / 2), front - 0.1, rng.uniform(1.5, h * 0.6)),
                 rng.uniform(0.5, 0.9), wc)
    for _ in range(220):                                 # street-level bokeh band
        y = rng.uniform(55, 260)
        x = rng.uniform(-0.55, 0.55) * y
        col = rng.choice([(1.0, 0.55, 0.25, 1), MAGENTA, TEAL, PERI, (1, 0.9, 0.8, 1)] + CITY)
        ball((x, y, rng.uniform(0.4, 3.5)), rng.uniform(0.18, 0.4), col)

    tower_m, nt, out = new_mat("tower")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = (0.003, 0.003, 0.005, 1)
    bsdf.inputs["Roughness"].default_value = 0.5
    nt.links.new(bsdf.outputs[0], out.inputs["Surface"])
    mesh_obj("city_towers", body, (tower_m,))
    glow_m, _ = attr_emission_mat("city_glow", "col", 0.8)
    mesh_obj("city_lights", glow, (glow_m,))


# ── geometry-node sparks ───────────────────────────────────────────────────


class G:
    """Tiny builder for geometry-node math."""

    def __init__(self, ng):
        self.N, self.L = ng.nodes, ng.links

    def _in(self, sock, val):
        if isinstance(val, bpy.types.NodeSocket):
            self.L.new(val, sock)
        else:
            sock.default_value = val

    def math(self, op, a, b=0.0):
        n = self.N.new("ShaderNodeMath")
        n.operation = op
        self._in(n.inputs[0], a)
        self._in(n.inputs[1], b)
        return n.outputs[0]

    def vmath(self, op, a, b=(0, 0, 0), out=0):
        n = self.N.new("ShaderNodeVectorMath")
        n.operation = op
        self._in(n.inputs[0], a)
        self._in(n.inputs["Scale"] if op == "SCALE" else n.inputs[1], b)
        return n.outputs[out]

    def attr(self, name, dtype):
        n = self.N.new("GeometryNodeInputNamedAttribute")
        n.data_type = dtype
        n.inputs["Name"].default_value = name
        return n.outputs["Attribute"]

    def xyz(self, x, y, z):
        n = self.N.new("ShaderNodeCombineXYZ")
        for k, v in enumerate((x, y, z)):
            self._in(n.inputs[k], v)
        return n.outputs[0]

    def sep(self, v):
        n = self.N.new("ShaderNodeSeparateXYZ")
        self._in(n.inputs[0], v)
        return n.outputs


def build_sparks(mat):
    """Ballistic sparks for every slam. Launch data (start frame, velocity, life,
    size, colour) lives in per-point attributes from a seeded RNG; motion is analytic
    in scene time, so any frame or motion-blur sub-frame renders the same in isolation."""
    rng = random.Random(SEED + 2)
    pos, vel, life, size, t0, col = [], [], [], [], [], []
    for i, (_, hexc) in enumerate(ROSTER):
        base, th = slot_pos(i)
        brand = srgb(hexc)
        last = i == len(ROSTER) - 1
        for _ in range(70 if last else 44):
            a = rng.uniform(0, 2 * math.pi)
            side = rng.uniform(-W / 2, W / 2)
            pos.append((base.x + side * math.cos(th), base.y - side * math.sin(th) - 0.12, 0.03))
            elev = math.radians(rng.uniform(10, 65))
            spd = rng.uniform(2.0, 6.5) * (1.3 if last else 1.0)
            dy = math.sin(a) * (0.6 if math.sin(a) > 0 else 1.0)
            vel.append((spd * math.cos(elev) * math.cos(a), spd * math.cos(elev) * dy,
                        spd * math.sin(elev)))
            life.append(rng.uniform(0.3, 0.9))
            size.append(rng.uniform(0.006, 0.014))
            t0.append(SLAMS[i] / FPS + rng.uniform(0, 0.03))
            hot = rng.random() < 0.35                    # some white-hot, the rest brand
            col.append((1.0, 0.95, 0.9, 1) if hot else brand)
    me = bpy.data.meshes.new("sparks_pts")
    me.from_pydata(pos, [], [])
    for aname, data, dtype in (("vel", vel, "FLOAT_VECTOR"), ("life", life, "FLOAT"),
                               ("size", size, "FLOAT"), ("t0", t0, "FLOAT"),
                               ("col", col, "FLOAT_COLOR")):
        at = me.attributes.new(aname, dtype, "POINT")
        if dtype == "FLOAT":
            at.data.foreach_set("value", data)
        elif dtype == "FLOAT_COLOR":
            at.data.foreach_set("color", [c for v in data for c in v])
        else:
            at.data.foreach_set("vector", [c for v in data for c in v])
    ob = link(bpy.data.objects.new("sparks", me))

    ng = bpy.data.node_groups.new("sparks_gn", "GeometryNodeTree")
    ng.interface.new_socket("Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    ng.interface.new_socket("Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    g = G(ng)
    gin = g.N.new("NodeGroupInput")
    gout = g.N.new("NodeGroupOutput")
    time = g.N.new("GeometryNodeInputSceneTime")
    grav = 9.8

    t = g.math("DIVIDE", time.outputs["Frame"], FPS)
    start = g.attr("t0", "FLOAT")
    tau = g.math("MAXIMUM", g.math("SUBTRACT", t, start), 0.0)
    alive = g.math("GREATER_THAN", t, start)
    v0 = g.attr("vel", "FLOAT_VECTOR")
    posn = g.N.new("GeometryNodeInputPosition").outputs[0]
    # p = p0 + v0·τ − ½gτ²ẑ, clamped to the floor
    p = g.vmath("ADD", posn, g.vmath("SCALE", v0, tau))
    p = g.vmath("ADD", p, g.xyz(0, 0, g.math("MULTIPLY", g.math("MULTIPLY", tau, tau), -0.5 * grav)))
    ps = g.sep(p)
    p = g.xyz(ps[0], ps[1], g.math("MAXIMUM", ps[2], 0.008))
    setp = g.N.new("GeometryNodeSetPosition")
    g.L.new(gin.outputs[0], setp.inputs["Geometry"])
    g.L.new(p, setp.inputs["Position"])

    fade = g.math("MAXIMUM", g.math("SUBTRACT", 1.0,
                                    g.math("DIVIDE", tau, g.attr("life", "FLOAT"))), 0.0)
    scale = g.math("MULTIPLY", g.math("MULTIPLY", fade, alive), g.attr("size", "FLOAT"))
    vnow = g.vmath("ADD", v0, g.xyz(0, 0, g.math("MULTIPLY", tau, -grav)))
    stretch = g.math("ADD", 1.0, g.math("MULTIPLY", g.vmath("LENGTH", vnow, out=1), 0.9))
    align = g.N.new("FunctionNodeAlignRotationToVector")
    align.axis = "Z"
    g.L.new(vnow, align.inputs["Vector"])

    inst = g.N.new("GeometryNodeInstanceOnPoints")
    g.L.new(setp.outputs[0], inst.inputs["Points"])
    g.L.new(align.outputs[0], inst.inputs["Rotation"])
    g.L.new(g.xyz(scale, scale, g.math("MULTIPLY", scale, stretch)), inst.inputs["Scale"])
    shape = g.N.new("GeometryNodeMeshIcoSphere")
    shape.inputs["Radius"].default_value = 1.0
    shape.inputs["Subdivisions"].default_value = 1
    g.L.new(shape.outputs["Mesh"], inst.inputs["Instance"])
    real = g.N.new("GeometryNodeRealizeInstances")
    g.L.new(inst.outputs[0], real.inputs[0])
    sm = g.N.new("GeometryNodeSetMaterial")
    sm.inputs["Material"].default_value = mat
    g.L.new(real.outputs[0], sm.inputs["Geometry"])
    g.L.new(sm.outputs[0], gout.inputs[0])
    ob.modifiers.new("sparks", "NODES").node_group = ng
    return ob


# ── lights ─────────────────────────────────────────────────────────────────


def light(name, kind, loc, energy, color, size=1.0, size_y=None, target=None, spot=None,
          only=None):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = color[:3]
    if kind == "AREA":
        ld.shape = "RECTANGLE"
        ld.size = size
        ld.size_y = size if size_y is None else size_y
    else:
        ld.shadow_soft_size = size
    if kind == "SPOT" and spot:
        ld.spot_size = math.radians(spot)
        ld.spot_blend = 0.7
    ob = link(bpy.data.objects.new(name, ld))
    ob.location = loc
    if target is not None:
        ob.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    if only is not None:                    # light linking: light only these receivers
        ob.light_linking.receiver_collection = only
    return ob


# ── world ──────────────────────────────────────────────────────────────────


def build_world():
    w = bpy.data.worlds.new("night")
    bpy.context.scene.world = w
    nt = w.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    N, L = nt.nodes, nt.links
    out = N.new("ShaderNodeOutputWorld")
    tc = N.new("ShaderNodeTexCoord")
    sep = N.new("ShaderNodeSeparateXYZ")
    L.new(tc.outputs["Generated"], sep.inputs[0])
    ramp = N.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.interpolation = "EASE"
    cr.elements[0].position = 0.0
    cr.elements[0].color = (0.009, 0.0022, 0.015, 1)    # magenta city glow at the horizon
    cr.elements[1].position = 0.22
    cr.elements[1].color = (0.0012, 0.0016, 0.0030, 1)  # near black overhead
    cr.elements.new(0.06).color = (0.0035, 0.0016, 0.0075, 1)
    L.new(sep.outputs["Z"], ramp.inputs["Fac"])
    bg = N.new("ShaderNodeBackground")
    L.new(ramp.outputs["Color"], bg.inputs["Color"])
    L.new(bg.outputs[0], out.inputs["Surface"])
    vol = N.new("ShaderNodeVolumePrincipled")          # haze: light beams, the city sinks away
    vol.inputs["Density"].default_value = 0.0025
    vol.inputs["Color"].default_value = (0.7, 0.65, 1.0, 1)
    vol.inputs["Anisotropy"].default_value = 0.4
    L.new(vol.outputs[0], out.inputs["Volume"])


# ── camera ─────────────────────────────────────────────────────────────────


def cam_state(f):
    """(distance, height, lateral drift) for frame f: near-static until 2.8 s, then a
    slow push-in and crane down to the end frame."""
    pre = f / PUSH_START
    dist0, h0 = 38.5 - 0.5 * min(pre, 1.0), 3.5
    x = ease_in_out((f - PUSH_START) / (FRAMES - 1 - PUSH_START)) if f > PUSH_START else 0.0
    return dist0 + (34.0 - dist0) * x, h0 + (2.85 - h0) * x, -0.35 * (1 - min(f / (FRAMES - 1), 1))


def jolt(f):
    """Summed camera kicks, one per slam, growing toward the last one."""
    jz = jp = jr = 0.0
    for i, s in enumerate(SLAMS):
        k = f - s
        if k < 0:
            continue
        amp = (0.25 + 0.75 * i / (len(SLAMS) - 1)) * (1.5 if s == LAST else 1.0)
        env = amp * math.exp(-k / 5.0)
        jz += -0.035 * env * math.cos(k * 1.8)
        jp += math.radians(0.12) * env * math.sin(k * 2.2 + 0.4)
        jr += math.radians(0.08) * env * math.sin(k * 1.4 + 1.1)
    return jz, jp, jr


def build_camera():
    cd = bpy.data.cameras.new("cam")
    cd.lens = LENS
    cd.sensor_fit = "HORIZONTAL"
    cd.sensor_width = 36.0
    cd.clip_start = 0.5
    cd.clip_end = 2000.0
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = 0.4
    cd.dof.aperture_blades = 7
    cd.dof.aperture_rotation = math.radians(12)
    cam = link(bpy.data.objects.new("cam", cd))
    bpy.context.scene.camera = cam
    px_per_rad = LENS / 36.0 * 1920.0
    for f in range(-2, FRAMES + 3):
        dist, h, dx = cam_state(f)
        jz, jp, jr = jolt(f)
        cam.location = (dx, -dist, h + jz)
        cam.rotation_euler = (math.radians(90) + jp, jr, 0)
        # level camera + lens shift: verticals stay straight, badge row stays on ROW_ROW
        below = (h - ZC) / dist * px_per_rad
        cd.shift_y = (below - (ROW_ROW - 540)) / 1920.0
        cd.dof.focus_distance = dist
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
        cd.keyframe_insert("shift_y", frame=f)
        cd.dof.keyframe_insert("focus_distance", frame=f)


# ── compositor ─────────────────────────────────────────────────────────────


def build_compositor(scene):
    ng = bpy.data.node_groups.new("post", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = ng
    N, L = ng.nodes, ng.links
    rl = N.new("CompositorNodeRLayers")
    rl.scene = scene
    bloom = N.new("CompositorNodeGlare")
    bloom.inputs["Type"].default_value = "Bloom"
    bloom.inputs["Quality"].default_value = "High"
    bloom.inputs["Threshold"].default_value = 1.4
    bloom.inputs["Strength"].default_value = 0.5
    bloom.inputs["Size"].default_value = 0.7
    L.new(rl.outputs["Image"], bloom.inputs["Image"])
    lens = N.new("CompositorNodeLensdist")
    lens.inputs["Dispersion"].default_value = 0.008
    L.new(bloom.outputs[0], lens.inputs["Image"])
    # black lift: a small offset ahead of the PBR Neutral toe (calibrated by measuring
    # rendered PNGs) puts pure black at ≈ #04060a, the game footage's black
    lift = N.new("ShaderNodeMix")
    lift.data_type = "RGBA"
    lift.blend_type = "ADD"
    lift.inputs["Factor"].default_value = 1.0
    a_in, b_in = (s for s in lift.inputs if s.type == "RGBA")
    b_in.default_value = (0.0088, 0.0093, 0.0100, 1.0)
    L.new(lens.outputs[0], a_in)
    out_col = next(s for s in lift.outputs if s.type == "RGBA")
    L.new(out_col, N.new("NodeGroupOutput").inputs[0])


# ── assemble ───────────────────────────────────────────────────────────────


def main():
    reset()
    scene = bpy.context.scene
    scene.frame_start = 0
    scene.frame_end = FRAMES - 1
    scene.render.fps = FPS
    scene.render.fps_base = 1.0

    lacquer = lacquer_mat()
    build_world()
    floor_m, sheen_pos, sheen_gain = floor_mat()
    build_floor(floor_m)
    hero = bpy.data.collections.new("badge_receivers")   # light-linking target

    badges, unders, rim_ems = [], [], []
    for i, (name, hexc) in enumerate(ROSTER):
        brand = srgb(hexc)
        badge = build_badge(name, badge_mat(name), lacquer)
        hero.objects.link(badge)
        rim_m, rim_em = emission_mat("rim_" + name, brand, 0.0)
        rim = build_backplate(name, rim_m)
        rim.parent = badge
        rim.location = (0, D / 2 + 0.012, 0)
        under = light("under_" + name, "POINT", (0, 0, 0), 0.0, brand, size=0.15)
        under.data.volume_factor = 0.3
        under.parent = badge
        under.location = (0, D / 2 + 0.3, -W / 2 + 0.12)
        badges.append(badge)
        rim_ems.append(rim_em)
        unders.append(under)

    ring_mats = []
    rings = []
    for i, (name, hexc) in enumerate(ROSTER):
        m, em = emission_mat("ring_" + name, srgb(hexc), 0.0)
        r = build_torus("ring_" + name, 1.0, 0.02, m, seg=96, rings=8)
        r.location = slot_pos(i)[0] + Vector((0, 0, 0.012))
        ring_mats.append(em)
        rings.append(r)
    pulse_m, pulse_em = emission_mat("pulse", COOL, 0.0)
    pulse = build_torus("pulse_ring", 1.0, 0.03, pulse_m, seg=192, rings=8)
    pulse.location = (0, -0.2, 0.012)
    spark_m, _ = attr_emission_mat("spark", "col", 18.0)
    build_sparks(spark_m)
    flashes = [light("flash_" + n, "POINT", slot_pos(i)[0] + Vector((0, -0.7, 0.15)), 0.0,
                     srgb(c), size=0.4) for i, (n, c) in enumerate(ROSTER)]
    for fl in flashes:
        fl.data.use_shadow = False
        fl.data.volume_factor = 0.25

    build_city()

    # product lighting on the badges (linked: no hot spots on the wet floor)
    light("key", "AREA", (-6.0, -14.0, 7.0), 900, (0.94, 0.96, 1.0, 1), size=6.0, size_y=3.0,
          target=(0, 0, ZC), only=hero)
    strip = light("strip", "AREA", (0, -10.0, 1.75), 45, (0.92, 0.94, 1.0, 1), size=0.5,
                  size_y=5.0, target=(0, 0, ZC), only=hero)
    rim_l = light("rim_l", "AREA", (-9.0, 3.0, 2.2), 900, PERI, size=2.0, size_y=5.0,
                  target=(-3.0, -1.0, ZC), only=hero)
    rim_r = light("rim_r", "AREA", (9.0, 3.0, 1.8), 900, MAGENTA, size=2.0, size_y=5.0,
                  target=(3.0, -1.0, ZC), only=hero)
    for ob in (rim_l, rim_r):
        ob.data.volume_factor = 0.0         # they sit in frame edge-on: no glowing slabs of haze
    for name, loc, energy, col in (("spill_magenta", (-26.0, 16.0, 4.0), 2200, MAGENTA),
                                   ("spill_teal", (26.0, 12.0, 3.0), 1800, TEAL)):
        light(name, "AREA", loc, energy, col, size=10.0, target=(0, 0, 1)).data.volume_factor = 0.0

    build_camera()

    # ── animation ──────────────────────────────────────────────────────────
    rng = random.Random(SEED + 3)
    tumble = [(rng.uniform(-14, 14), rng.uniform(-10, 10), rng.uniform(-18, 18))
              for _ in ROSTER]
    for f in range(-2, FRAMES + 3):
        for i, badge in enumerate(badges):
            base, th = slot_pos(i)
            k = f - SLAMS[i]
            if k <= 0:
                u = -k / FALL_T                           # 0 at the slam, 1 at fall start
                spin = min(u, 1.6) ** 1.4
                badge.location = base + Vector((0, 0.4 * u, ZC + FALL_H * u * u))
                tx, ty, tz = (math.radians(a) * spin for a in tumble[i])
                badge.rotation_euler = (tx, ty, -th + tz)
            else:
                shudder = 0.008 * math.exp(-k / 3.0) * math.cos(k * 2.6)
                badge.location = base + Vector((0, 0, ZC - shudder))
                badge.rotation_euler = (0, 0, -th)
            badge.keyframe_insert("location", frame=f)
            badge.keyframe_insert("rotation_euler", frame=f)

            # slam FX: ring, floor flash, rim/underglow flare, then the breathing hold
            ring = rings[i]
            last = SLAMS[i] == LAST
            if k < 0:
                rr, re, fl = 0.4, 0.0, 0.0
            else:
                rr = 0.55 + 3.2 * (1 - math.exp(-k / 12.0))
                re = 9.0 * math.exp(-k / 11.0)
                fl = math.exp(-k / 4.0)
            ring.scale = (rr, rr, 0.4)
            ring.keyframe_insert("scale", frame=f)
            ring.hide_render = not 0 <= k <= 70          # dark torus would shadow the floor
            ring.keyframe_insert("hide_render", frame=f)
            key_value(ring_mats[i].inputs["Strength"], f, re)
            key_energy(flashes[i], f, 300.0 * fl * (1.6 if last else 1.0))
            glow_on = 0.0 if k < -FALL_T else 1.0
            flare = math.exp(-k / 8.0) if k >= 0 else 0.0
            shared = math.exp(-(f - LAST) / 10.0) if f >= LAST else 0.0
            b = 1.0 + 0.18 * breathe(f, i * 0.63)
            key_value(rim_ems[i].inputs["Strength"], f, glow_on * (1.2 * b + 6.0 * flare + 4.0 * shared))
            key_energy(unders[i], f, glow_on * (14.0 * b + 30.0 * flare + 25.0 * shared))

        # shared pulse on the last slam
        k = f - LAST
        pr = 0.6 + 26.0 * (1 - math.exp(-k / 22.0)) if k >= 0 else 0.5
        pulse.scale = (pr, pr, 0.4)
        pulse.keyframe_insert("scale", frame=f)
        pulse.hide_render = not 0 <= k <= 45
        pulse.keyframe_insert("hide_render", frame=f)
        key_value(pulse_em.inputs["Strength"], f, 12.0 * math.exp(-k / 8.0) if k >= 0 else 0.0)

        # breathing rims, strip softbox glides with the push
        key_energy(rim_l, f, 900.0 * (1.0 + 0.15 * breathe(f, 0.0)))
        key_energy(rim_r, f, 900.0 * (1.0 + 0.15 * breathe(f, math.pi)))
        strip.location = (-6.0 + 12.0 * ease_in_out(f / (FRAMES - 1)), -10.0, 1.75)
        strip.keyframe_insert("location", frame=f)

        # mint sheen: left → right across the far wet floor, gone once the row is down
        key_value(sheen_pos, f, -0.36 + 0.72 * ease_in_out(f / 150.0))
        key_value(sheen_gain, f, SHEEN * smoothstep(0, 36, f) * (1 - smoothstep(96, 150, f)))

    # ── render settings ───────────────────────────────────────────────────
    r = scene.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x, r.resolution_y = 1920, 1080
    r.resolution_percentage = 50 if PREVIEW else 100
    r.use_motion_blur = True
    r.motion_blur_shutter = 0.5
    r.dither_intensity = 1.0
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGB"
    r.image_settings.color_depth = "8"
    r.filepath = os.path.join(OUT_DIR, "####")

    e = scene.eevee
    e.taa_render_samples = 24 if PREVIEW else 96
    e.use_raytracing = True
    e.ray_tracing_method = "SCREEN"
    e.ray_tracing_options.resolution_scale = "1"
    e.ray_tracing_options.trace_max_roughness = 0.6
    e.use_fast_gi = True
    e.use_shadows = True
    e.shadow_ray_count = 2
    e.shadow_pool_size = "1024"
    e.light_threshold = 0.001           # wide light influence: no culling edges in the haze
    e.shadow_step_count = 8
    e.volumetric_start = 0.5
    e.volumetric_end = 500.0
    e.volumetric_tile_size = "8" if PREVIEW else "4"
    e.volumetric_samples = 96
    e.volumetric_sample_distribution = 0.9
    e.use_volumetric_shadows = True
    e.volumetric_shadow_samples = 32
    e.bokeh_max_size = 160
    e.bokeh_threshold = 0.6
    e.use_bokeh_jittered = True
    e.motion_blur_steps = 2
    e.use_overscan = True
    e.overscan_size = 3.0

    vs = scene.view_settings
    # Khronos PBR Neutral: filmic highlight roll-off like AgX, but base colours come
    # through unchanged, so the badges read as their true logo colours (AgX pushed
    # uniswap pink ~40/255 toward grey).
    vs.view_transform = "Khronos PBR Neutral"
    vs.look = "None"

    build_compositor(scene)
    scene.frame_set(LAST)


main()
