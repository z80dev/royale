"""Transparent LAUNCHPAD ROYALE title; Blender 5.2 / EEVEE.

Blender -b --factory-startup -P title.py -a
Blender -b --factory-startup -P title.py -f 4,33,90,210,348 -- --preview

Frame N is clip time N / 60. See README.md for VP9 alpha encoding.
"""
import math
import os
import sys

import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PREVIEW = "--preview" in ARGS
OUT_DIR = "/tmp/title-logo-frames"
for i, arg in enumerate(ARGS):
    if arg == "--out" and i + 1 < len(ARGS):
        OUT_DIR = ARGS[i + 1]
FONT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "fonts", "Unbounded-Black.ttf")
FPS, FRAMES = 60, 390


def srgb(h):
    values = [int(h.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return (*(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in values), 1)


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def smooth(x):
    x = max(0, min(1, x))
    return x * x * (3 - 2 * x)


def material(name, color, metal, rough, emission=0):
    mat = bpy.data.materials.new(name)
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = srgb(color)
    bsdf.inputs["Metallic"].default_value = metal
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Coat Weight"].default_value = 1
    bsdf.inputs["Coat Roughness"].default_value = 0.09
    bsdf.inputs["Emission Color"].default_value = srgb(color)
    bsdf.inputs["Emission Strength"].default_value = emission
    return mat, bsdf


def chrome_material():
    mat, bsdf = material("polished_chrome", "#f2f7ff", 1.0, 0.08)
    n, l = mat.node_tree.nodes, mat.node_tree.links
    coord = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    l.new(coord.outputs["Generated"], sep.inputs[0])
    phase = n.new("ShaderNodeMath")
    phase.operation = "MULTIPLY"
    phase.inputs[1].default_value = math.pi
    l.new(sep.outputs["Y"], phase.inputs[0])
    crown = n.new("ShaderNodeMath")
    crown.operation = "SINE"
    l.new(phase.outputs[0], crown.inputs[0])
    bump = n.new("ShaderNodeBump")
    bump.inputs["Distance"].default_value = 0.025
    bump.inputs["Strength"].default_value = 1
    l.new(crown.outputs[0], bump.inputs["Height"])
    l.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    l.new(bump.outputs["Normal"], bsdf.inputs["Coat Normal"])
    return mat


def neon_material():
    mat, bsdf = material("mint_neon_core", "#19e3a7", 0.3, 0.06, 1)
    n, l = mat.node_tree.nodes, mat.node_tree.links
    coord = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    l.new(coord.outputs["Generated"], sep.inputs[0])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "EASE"
    ramp.color_ramp.elements[0].color = srgb("#0fae85")
    ramp.color_ramp.elements[1].color = srgb("#0fae85")
    ramp.color_ramp.elements.new(0.25).color = srgb("#12d99a")
    ramp.color_ramp.elements.new(0.50).color = srgb("#19f7af")
    ramp.color_ramp.elements.new(0.75).color = srgb("#12d99a")
    l.new(sep.outputs["Y"], ramp.inputs[0])
    l.new(ramp.outputs[0], bsdf.inputs["Emission Color"])
    # Emission carries the colour; a dark metallic base keeps white studio
    # reflections from washing the neon into pastel.
    bsdf.inputs["Base Color"].default_value = srgb("#023c2d")
    bsdf.inputs["Coat Weight"].default_value = 0.22
    return mat, bsdf


def text(name, body, font, mat, scale=1, core=False):
    curve = bpy.data.curves.new(name, "FONT")
    curve.body, curve.font = body, font
    curve.size = scale
    curve.resolution_u = 10
    curve.extrude = 0.002 if core else 0.055 * scale
    curve.bevel_depth = 0.009 if core else 0.013 * scale
    curve.bevel_resolution = 3
    curve.offset = -0.021 * scale if core else 0
    curve.materials.append(mat)
    return link(bpy.data.objects.new(name, curve))


def word(body, font, shell, scale, baseline, core=None):
    # Prefix measurements retain the font's advances/kerning, rather than spacing
    # individually centred glyphs by their visible bounding boxes.
    measure = text("measure", body, font, shell, scale)
    bpy.context.view_layer.update()
    left = min(v[0] for v in measure.bound_box)
    right = max(v[0] for v in measure.bound_box)
    centre = (left + right) / 2
    letters = []
    for i, char in enumerate(body):
        measure.data.body = body[:i + 1]
        bpy.context.view_layer.update()
        end = max(v[0] for v in measure.bound_box)
        ob = text(body + "_" + str(i), char, font, shell, scale)
        bpy.context.view_layer.update()
        x = end - max(v[0] for v in ob.bound_box) - centre
        pivot = link(bpy.data.objects.new(ob.name + "_motion", None))
        ob.parent = pivot
        ob.location = (0, 0, 0)
        if core:
            face = text(ob.name + "_neon", char, font, core, scale, True)
            face.parent = pivot
            face.location.z = 0.075 * scale
        letters.append((pivot, Vector((x, baseline, 0))))
    bpy.data.objects.remove(measure, do_unlink=True)
    return letters, right - left


def area(name, pos, power, color, width, height, target=(0, 0, 0)):
    data = bpy.data.lights.new(name, "AREA")
    data.energy, data.color = power, srgb(color)[:3]
    data.shape, data.size, data.size_y = "RECTANGLE", width, height
    ob = link(bpy.data.objects.new(name, data))
    ob.location = pos
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat("-Z", "Y").to_euler()
    return ob


def world(scene):
    w = bpy.data.worlds.new("hidden_chrome_studio")
    scene.world = w
    n, l = w.node_tree.nodes, w.node_tree.links
    n.clear()
    coord = n.new("ShaderNodeTexCoord")
    sep = n.new("ShaderNodeSeparateXYZ")
    l.new(coord.outputs["Normal"], sep.inputs[0])
    remap = n.new("ShaderNodeMapRange")
    # HDR studio horizon reflected across subtly crowned chrome faces:
    # cool white sky, near-black horizon, and hot coloured floor strips.
    remap.inputs["From Min"].default_value = -0.70
    remap.inputs["From Max"].default_value = 0.70
    l.new(sep.outputs["Y"], remap.inputs["Value"])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.interpolation = "LINEAR"
    stops = [(0.0, (1.8, 2.1, 2.5, 1)), (0.36, (0.65, 0.85, 1.1, 1)),
             (0.46, (0.004, 0.008, 0.012, 1)), (0.62, (0.002, 0.004, 0.008, 1)),
             (0.73, (0.70, 0.13, 0.28, 1)), (0.77, (0.03, 0.006, 0.014, 1)),
             (0.90, (0.015, 0.35, 0.22, 1)), (1.0, (1.8, 1.1, 1.25, 1))]
    ramp.color_ramp.elements.remove(ramp.color_ramp.elements[1])
    ramp.color_ramp.elements[0].color = stops[0][1]
    for pos, color in stops[1:]:
        ramp.color_ramp.elements.new(pos).color = color
    l.new(remap.outputs[0], ramp.inputs[0])
    bg = n.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = 1.0
    l.new(ramp.outputs[0], bg.inputs["Color"])
    l.new(bg.outputs[0], n.new("ShaderNodeOutputWorld").inputs["Surface"])


def compositor(scene):
    ng = bpy.data.node_groups.new("transparent_title_post", "CompositorNodeTree")
    ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    scene.compositing_node_group = ng
    n, l = ng.nodes, ng.links
    rl = n.new("CompositorNodeRLayers")
    rl.scene = scene
    # Work premultiplied inside the compositor; Blender's PNG writer converts to
    # straight RGBA. Lift only covered pixels, never the transparent background.
    straight = n.new("CompositorNodePremulKey")
    straight.inputs["Type"].default_value = "To Straight"
    l.new(rl.outputs["Image"], straight.inputs[0])
    lift = n.new("ShaderNodeMix")
    lift.data_type, lift.blend_type = "RGBA", "ADD"
    lift.inputs["Factor"].default_value = 1
    a, b = (s for s in lift.inputs if s.type == "RGBA")
    b.default_value = (0.0088, 0.0093, 0.0100, 0)
    l.new(straight.outputs[0], a)
    restore = n.new("CompositorNodeSetAlpha")
    restore.inputs["Type"].default_value = "Replace Alpha"
    l.new(next(s for s in lift.outputs if s.type == "RGBA"), restore.inputs["Image"])
    l.new(rl.outputs["Alpha"], restore.inputs["Alpha"])
    premul = n.new("CompositorNodePremulKey")
    premul.inputs["Type"].default_value = "To Premultiplied"
    l.new(restore.outputs[0], premul.inputs[0])
    dilate = n.new("CompositorNodeDilateErode")
    dilate.inputs["Size"].default_value = 5 if PREVIEW else 10
    l.new(rl.outputs["Alpha"], dilate.inputs["Mask"])
    blur = n.new("CompositorNodeBlur")
    blur.inputs["Type"].default_value = "Gaussian"
    blur.inputs["Size"].default_value = (12, 12) if PREVIEW else (24, 24)
    l.new(dilate.outputs[0], blur.inputs["Image"])
    gain = n.new("ShaderNodeMath")
    gain.operation = "MULTIPLY"
    gain.inputs[1].default_value = 0.45
    l.new(blur.outputs[0], gain.inputs[0])
    shadow = n.new("CompositorNodeSetAlpha")
    shadow.inputs["Type"].default_value = "Replace Alpha"
    shadow.inputs["Image"].default_value = (0, 0, 0, 1)
    l.new(gain.outputs[0], shadow.inputs["Alpha"])
    over = n.new("CompositorNodeAlphaOver")
    l.new(shadow.outputs[0], over.inputs["Background"])
    l.new(premul.outputs[0], over.inputs["Foreground"])
    l.new(over.outputs[0], n.new("NodeGroupOutput").inputs[0])


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.edit.keyframe_new_interpolation_type = "LINEAR"
    scene = bpy.context.scene
    scene.frame_start, scene.frame_end = 0, FRAMES - 1
    scene.render.fps = FPS
    font = bpy.data.fonts.load(FONT)
    pearl = chrome_material()
    shell, _ = material("mint_gloss_shell", "#044b36", 0.92, 0.08)
    neon, neon_bsdf = neon_material()
    top, width = word("LAUNCHPAD", font, pearl, 1, 0.30)
    bottom, _ = word("ROYALE", font, shell, 1.42, -0.60, neon)
    world(scene)
    area("chrome_sky_softbox", (-2, 4, 6), 220, "#eff8ff", 7, 1)
    area("magenta_rim", (-6, 1, 1), 650, "#fa49af", 0.6, 5)
    area("teal_rim", (6, -1, 0.8), 850, "#19e3a7", 0.6, 4)
    area("mint_back_rim", (0, 4, -1), 1800, "#19e3a7", 8, 0.3)
    glint = area("diagonal_glint_bar", (-9, 0, 4), 0, "#eaffff", 0.10, 5)
    camera = link(bpy.data.objects.new("camera", bpy.data.cameras.new("camera")))
    scene.camera = camera
    camera.data.lens = 45
    camera.data.sensor_fit = "HORIZONTAL"
    distance = width / (1440 / 1920) * 45 / 36
    # Block centred just above image centre; the kicker band y=760–820 is clear.
    target = Vector((0.10, 0.01, 0))
    for f in range(-2, FRAMES + 3):
        push = smooth((f - 48) / (336 - 48))
        yaw = math.radians(9 + 0.4 * push)
        d = distance * (1 - 0.012 * push)
        camera.location = (d * math.sin(yaw), 0.06 + 0.045 * push, d * math.cos(yaw))
        # This title uses Y-up (text lies in XY), not Blender's usual Z-up.
        camera.rotation_euler = (-math.atan2(camera.location.y - target.y, d),
                                 math.atan2(camera.location.x - target.x, camera.location.z), 0)
        camera.keyframe_insert("location", frame=f)
        camera.keyframe_insert("rotation_euler", frame=f)
        for line, start, direction in [(top, 0, -1), (bottom, 30, 1)]:
            age = f - start
            if age < 0:
                z, slide, scale = distance * 1.1, direction * 3, 1
            elif age < 7:
                remain = (1 - age / 7) ** 3
                z, slide, scale = distance * 0.74 * remain, direction * 2 * remain, 1
            else:
                settle = math.exp(-(age - 7) / 4) * math.sin((age - 7) * 0.65)
                z, slide, scale = -0.12 * settle, 0, 1 + 0.012 * settle
            for i, (ob, rest) in enumerate(line):
                out = smooth((f - 336 - (i % 3)) / 20)
                # Whole glyphs break formation, rotating and flying past the lens.
                ob.location = rest + Vector((slide + (rest.x * 0.7 + direction) * out,
                                              direction * (0.7 + (i % 3) * 0.3) * out,
                                              z + distance * 1.5 * out))
                ob.scale = (scale,) * 3
                ob.rotation_euler = (direction * out * 0.9, (i % 3 - 1) * out, direction * out * 0.35)
                ob.keyframe_insert("location", frame=f)
                ob.keyframe_insert("scale", frame=f)
                ob.keyframe_insert("rotation_euler", frame=f)
        flicker = {30: 0.08, 31: 1.3, 33: 0.15, 35: 1.15, 37: 0.35, 39: 1.3, 41: 0.65, 44: 1.1, 48: 1.0}
        value = 0 if f < 30 else 1.0
        for key, gain in flicker.items():
            if key <= f < 48:
                value = gain
        neon_bsdf.inputs["Emission Strength"].default_value = value
        neon_bsdf.inputs["Emission Strength"].keyframe_insert("default_value", frame=f)
        sweep = max(0, min(1, (f - 60) / 60))
        glint.location.x = -9 + 18 * sweep
        glint.rotation_euler = (0, math.atan2(glint.location.x * 0.35, 4), 0)
        glint.rotation_euler.rotate_axis("Z", math.radians(-28))
        glint.keyframe_insert("rotation_euler", frame=f)
        glint.data.energy = 650 * smooth((f - 60) / 6) * (1 - smooth((f - 114) / 6))
        glint.keyframe_insert("location", frame=f)
        glint.data.keyframe_insert("energy", frame=f)
    r = scene.render
    r.engine = "BLENDER_EEVEE"
    r.resolution_x, r.resolution_y = 1920, 1080
    r.resolution_percentage = 50 if PREVIEW else 100
    r.film_transparent = True
    r.use_motion_blur = True
    r.motion_blur_shutter = 0.5
    r.image_settings.file_format = "PNG"
    r.image_settings.color_mode = "RGBA"
    r.image_settings.color_depth = "8"
    r.filepath = os.path.join(OUT_DIR, "####")
    e = scene.eevee
    e.taa_render_samples = 16 if PREVIEW else 96
    e.use_raytracing = True
    e.ray_tracing_method = "SCREEN"
    e.ray_tracing_options.resolution_scale = "2"
    e.use_shadows = True
    e.motion_blur_steps = 2 if PREVIEW else 4
    scene.view_settings.view_transform = "Khronos PBR Neutral"
    scene.view_settings.look = "None"
    compositor(scene)
    scene.frame_set(90)


main()
