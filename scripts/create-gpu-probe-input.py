#!/usr/bin/env python3
"""Render an original conference-chair image for the first GPU probe."""

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def material(name, color, metallic=0.0, roughness=0.5):
    value = bpy.data.materials.new(name)
    value.diffuse_color = (*color, 1.0)
    value.metallic = metallic
    value.roughness = roughness
    return value


def rounded_box(name, location, scale, value, bevel=0.08):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    modifier = obj.modifiers.new("Soft edges", "BEVEL")
    modifier.width = bevel
    modifier.segments = 4
    obj.data.materials.append(value)
    return obj


def cylinder(name, start, end, radius, value):
    start = Vector(start)
    end = Vector(end)
    delta = end - start
    bpy.ops.mesh.primitive_cylinder_add(vertices=32, radius=radius, depth=delta.length, location=(start + end) / 2)
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = delta.to_track_quat("Z", "Y")
    obj.data.materials.append(value)
    return obj


def point_camera(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    upholstery = material("Muted sage textile", (0.25, 0.34, 0.30), roughness=0.78)
    graphite = material("Matte graphite", (0.055, 0.065, 0.064), metallic=0.72, roughness=0.26)
    oak = material("Warm oak", (0.46, 0.24, 0.10), roughness=0.48)

    rounded_box("Seat", (0, 0, 1.08), (0.62, 0.58, 0.11), upholstery, 0.12)
    back = rounded_box("Back", (0, 0.47, 1.78), (0.61, 0.12, 0.64), upholstery, 0.16)
    back.rotation_euler.x = math.radians(-8)
    rounded_box("Seat underside", (0, 0, 0.94), (0.55, 0.50, 0.045), oak, 0.035)

    for x in (-0.48, 0.48):
        for y in (-0.42, 0.38):
            cylinder(f"Leg {x} {y}", (x, y, 0.93), (x * 1.12, y * 1.12, 0.08), 0.035, graphite)
    for x in (-0.72, 0.72):
        cylinder(f"Arm post {x}", (x, 0.04, 1.02), (x, 0.12, 1.48), 0.032, graphite)
        rounded_box(f"Arm pad {x}", (x, 0.02, 1.51), (0.075, 0.38, 0.055), oak, 0.04)

    bpy.ops.object.light_add(type="AREA", location=(4.5, -4.5, 6.0))
    bpy.context.object.data.energy = 900
    bpy.context.object.data.shape = "DISK"
    bpy.context.object.data.size = 5.0
    point_camera(bpy.context.object, (0, 0, 1.1))
    bpy.ops.object.light_add(type="AREA", location=(-3.0, -1.0, 3.5))
    bpy.context.object.data.energy = 450
    bpy.context.object.data.size = 3.0
    point_camera(bpy.context.object, (0, 0, 1.2))

    bpy.ops.object.camera_add(location=(3.4, -5.1, 2.9))
    camera = bpy.context.object
    camera.data.lens = 58
    point_camera(camera, (0, 0.05, 1.15))
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.film_transparent = True
    scene.render.filepath = str(output)
    scene.render.image_settings.color_depth = "8"
    scene.view_settings.look = "AgX - Medium High Contrast"
    bpy.ops.render.render(write_still=True)

    raw = output.read_bytes()
    print(json.dumps({
        "status": "probe-input-rendered",
        "output": str(output),
        "byteLength": len(raw),
        "sha256": hashlib.sha256(raw).hexdigest(),
        "origin": "deterministic-project-authored-blender-render",
    }, sort_keys=True))


if __name__ == "__main__":
    main()
