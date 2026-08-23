#!/usr/bin/env python3
"""Render an original dimensioned window-and-trim assembly for a GPU probe."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


OUTER_WIDTH_M = 2.6
OUTER_HEIGHT_M = 2.2
ASSEMBLY_DEPTH_M = 0.32
SILL_DEPTH_M = 0.46


def material(name, color, metallic=0.0, roughness=0.5):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.metallic = metallic
    value.roughness = roughness
    return value


def rounded_box(name, location, scale, value, bevel=0.025):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("Construction edge", "BEVEL")
    modifier.width = bevel
    modifier.segments = 3
    obj.data.materials.append(value)
    return obj


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    graphite = material("Matte graphite frame", (0.045, 0.055, 0.055), metallic=0.68, roughness=0.24)
    oak = material("Warm oak trim", (0.47, 0.25, 0.105), roughness=0.46)
    plaster = material("Light mineral reveal", (0.73, 0.70, 0.64), roughness=0.84)
    glass = material("Daylight glazing", (0.24, 0.43, 0.53), metallic=0.05, roughness=0.12)

    center_z = OUTER_HEIGHT_M / 2
    half_width = OUTER_WIDTH_M / 2
    half_height = OUTER_HEIGHT_M / 2

    # Deep reveal surfaces make the assembly read as architectural rather than a flat grid.
    rounded_box("Reveal top", (0, 0.13, OUTER_HEIGHT_M + 0.08), (1.48, 0.18, 0.09), plaster, 0.03)
    rounded_box("Reveal left", (-1.39, 0.13, center_z), (0.09, 0.18, 1.18), plaster, 0.03)
    rounded_box("Reveal right", (1.39, 0.13, center_z), (0.09, 0.18, 1.18), plaster, 0.03)

    rounded_box("Outer frame top", (0, 0, OUTER_HEIGHT_M - 0.06), (half_width, 0.08, 0.06), graphite)
    rounded_box("Outer frame bottom", (0, 0, 0.06), (half_width, 0.08, 0.06), graphite)
    rounded_box("Outer frame left", (-half_width + 0.06, 0, center_z), (0.06, 0.08, half_height), graphite)
    rounded_box("Outer frame right", (half_width - 0.06, 0, center_z), (0.06, 0.08, half_height), graphite)

    for index, x in enumerate((-0.43, 0.43), start=1):
        rounded_box(f"Structural mullion {index}", (x, -0.015, center_z), (0.045, 0.095, 1.04), graphite, 0.018)

    pane_centers = (-0.86, 0.0, 0.86)
    for index, x in enumerate(pane_centers, start=1):
        rounded_box(f"Glazing pane {index}", (x, 0.075, center_z), (0.365, 0.018, 0.965), glass, 0.012)

    rounded_box("Oak trim top", (0, -0.13, OUTER_HEIGHT_M + 0.17), (1.52, 0.075, 0.075), oak, 0.035)
    rounded_box("Oak trim left", (-1.47, -0.13, center_z), (0.075, 0.075, 1.17), oak, 0.035)
    rounded_box("Oak trim right", (1.47, -0.13, center_z), (0.075, 0.075, 1.17), oak, 0.035)
    rounded_box("Oak sill", (0, -0.22, -0.01), (1.52, SILL_DEPTH_M / 2, 0.075), oak, 0.04)

    bpy.ops.object.light_add(type="AREA", location=(4.5, -4.5, 5.5))
    bpy.context.object.data.energy = 1050
    bpy.context.object.data.shape = "RECTANGLE"
    bpy.context.object.data.size = 5.0
    point_at(bpy.context.object, (0, 0, center_z))
    bpy.ops.object.light_add(type="AREA", location=(-3.5, -1.5, 3.2))
    bpy.context.object.data.energy = 500
    bpy.context.object.data.size = 3.0
    point_at(bpy.context.object, (0, 0, center_z))

    bpy.ops.object.camera_add(location=(3.7, -6.4, 3.15))
    camera = bpy.context.object
    camera.data.lens = 62
    point_at(camera, (0, 0, center_z))

    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.filepath = str(output)
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)

    raw = output.read_bytes()
    print(json.dumps({
        "status": "window-trim-probe-input-rendered",
        "output": str(output),
        "byteLength": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "origin": "deterministic-project-authored-blender-window-trim-render",
        "functionalDimensionsMeters": {
            "outerWidth": OUTER_WIDTH_M,
            "outerHeight": OUTER_HEIGHT_M,
            "assemblyDepth": ASSEMBLY_DEPTH_M,
            "sillDepth": SILL_DEPTH_M,
            "paneCount": 3,
        },
    }, sort_keys=True))


if __name__ == "__main__":
    main()
