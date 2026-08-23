#!/usr/bin/env python3
"""Validate a generated PLY, export GLB, and render a review preview."""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def point_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", type=Path, required=True)
    parser.add_argument("--glb", type=Path, required=True)
    parser.add_argument("--preview", type=Path, required=True)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else None)
    source = args.input.resolve(strict=True)
    glb = args.glb.resolve()
    preview = args.preview.resolve()
    glb.parent.mkdir(parents=True, exist_ok=True)
    preview.parent.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.wm.ply_import(filepath=str(source))
    mesh_object = bpy.context.object
    mesh_object.name = "WMMR AI probe chair seed 42"
    mesh = mesh_object.data
    if len(mesh.vertices) == 0 or len(mesh.polygons) == 0:
        raise RuntimeError("empty_mesh")
    if any(len(polygon.vertices) != 3 for polygon in mesh.polygons):
        raise RuntimeError("non_triangle_face")
    for polygon in mesh.polygons:
        polygon.use_smooth = True

    material = bpy.data.materials.new("Generated vertex color")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    shader = nodes.get("Principled BSDF")
    color_name = next(iter(mesh.color_attributes), None)
    if color_name is not None:
        attribute = nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = color_name.name
        links.new(attribute.outputs["Color"], shader.inputs["Base Color"])
    shader.inputs["Roughness"].default_value = 0.58
    mesh.materials.append(material)

    bpy.context.view_layer.objects.active = mesh_object
    mesh_object.select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(glb), export_format="GLB", use_selection=True)

    center = mesh_object.location + Vector(mesh_object.dimensions) * 0.0
    bpy.ops.mesh.primitive_plane_add(size=8, location=(0, 0, mesh_object.bound_box[0][2] - 0.015))
    floor = bpy.context.object
    floor_material = bpy.data.materials.new("Review floor")
    floor_material.diffuse_color = (0.12, 0.13, 0.14, 1)
    floor_material.roughness = 0.85
    floor.data.materials.append(floor_material)

    bpy.ops.object.light_add(type="AREA", location=(3.0, -3.5, 4.0))
    bpy.context.object.data.energy = 700
    bpy.context.object.data.size = 4.0
    point_at(bpy.context.object, center)
    bpy.ops.object.light_add(type="AREA", location=(-2.5, -1.0, 2.5))
    bpy.context.object.data.energy = 350
    bpy.context.object.data.size = 3.0
    point_at(bpy.context.object, center)
    bpy.ops.object.camera_add(location=(1.7, -2.4, 1.25))
    camera = bpy.context.object
    camera.data.lens = 62
    point_at(camera, center)

    scene = bpy.context.scene
    scene.camera = camera
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(preview)
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world = bpy.data.worlds.new("Review world")
    scene.world.color = (0.035, 0.04, 0.045)
    bpy.ops.render.render(write_still=True)

    raw_glb = glb.read_bytes()
    raw_preview = preview.read_bytes()
    print(json.dumps({
        "status": "probe-output-prepared",
        "vertexCount": len(mesh.vertices),
        "triangleCount": len(mesh.polygons),
        "dimensions": list(mesh_object.dimensions),
        "glb": {"byteLength": len(raw_glb), "sha256": hashlib.sha256(raw_glb).hexdigest()},
        "preview": {"byteLength": len(raw_preview), "sha256": hashlib.sha256(raw_preview).hexdigest()},
    }, sort_keys=True))


if __name__ == "__main__":
    main()
