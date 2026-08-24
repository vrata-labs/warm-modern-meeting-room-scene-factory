#!/usr/bin/env python3

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path


EXPECTED_BLENDER_VERSION = "4.5.12 LTS"
EXPECTED_BLENDER_BUILD_HASH = "84afd5f785f7"
EXPECTED_BLENDER_BINARY_SHA256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
EXPECTED_SPECIFICATION_SHA256 = "189556b9da4ecf9f318049d0ad8e5ac67b1216057221aa5e49ecb3d88dc59cc5"
EXPECTED_SCENE_RAW_SHA256 = "903c363326056fade3e6a55da35404912e5c40dfd021b9e261deb158bce8eee4"
COLLECTION_NAME = "WMMR_ARCHITECTURE"
REPOSITORY_ROOT = Path(__file__).resolve().parent.parent
FIXTURE_PATH = REPOSITORY_ROOT / "tests/fixtures/stage3/scene-spec.valid.json"


def fail(code):
    raise RuntimeError(code)


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def finite_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def rounded(value):
    return round(float(value), 9)


def box(name, width, height, depth, x, y, z):
    values = [width, height, depth, x, y, z]
    if not all(finite_number(value) for value in values) or min(width, height, depth) <= 0:
        fail(f"room_shell_box_invalid:{name}")
    return {
        "name": name,
        "geometry": "box",
        "dimensionsM": {"widthM": rounded(width), "heightM": rounded(height), "depthM": rounded(depth)},
        "centerM": {"x": rounded(x), "y": rounded(y), "z": rounded(z)},
        "vertexCount": 8,
        "faceCount": 6,
    }


def build_shell_plan(scene):
    if not isinstance(scene, dict):
        fail("room_shell_scene_invalid")
    room = scene.get("room")
    if not isinstance(room, dict):
        fail("room_shell_room_invalid")
    required = ["widthM", "depthM", "heightM", "wallThicknessM", "floorY", "ceilingY"]
    if not all(finite_number(room.get(key)) for key in required):
        fail("room_shell_dimensions_invalid")
    width = room["widthM"]
    depth = room["depthM"]
    height = room["heightM"]
    thickness = room["wallThicknessM"]
    floor_y = room["floorY"]
    ceiling_y = room["ceilingY"]
    if min(width, depth, height, thickness) <= 0 or depth <= thickness or abs(ceiling_y - floor_y - height) > 1e-9:
        fail("room_shell_dimensions_invalid")

    shell_width = width + thickness
    shell_depth = depth + thickness
    wall_center_y = floor_y + height / 2
    objects = [
        box("shell.ceiling", shell_width, thickness, shell_depth, 0, ceiling_y + thickness / 2, 0),
        box("shell.floor", shell_width, thickness, shell_depth, 0, floor_y - thickness / 2, 0),
        {
            "name": "shell.walls",
            "geometry": "rectangular-wall-ring",
            "dimensionsM": {"widthM": rounded(shell_width), "heightM": rounded(height), "depthM": rounded(shell_depth)},
            "interiorDimensionsM": {"widthM": rounded(width - thickness), "depthM": rounded(depth - thickness)},
            "wallThicknessM": rounded(thickness),
            "centerM": {"x": 0.0, "y": rounded(wall_center_y), "z": 0.0},
            "wallSegments": ["east", "north", "south", "west"],
            "vertexCount": 16,
            "faceCount": 16,
        },
    ]
    return {
        "collectionName": COLLECTION_NAME,
        "joinStrategy": "welded-rectangular-ring",
        "coordinateMapping": "contract-x-to-blender-x,contract-y-to-blender-z,contract-z-to-blender-y",
        "objectCount": len(objects),
        "meshCount": len(objects),
        "vertexCount": sum(value["vertexCount"] for value in objects),
        "faceCount": sum(value["faceCount"] for value in objects),
        "objects": objects,
    }


def opening_center(opening, room):
    wall = opening["wall"]
    if wall == "south":
        return -room["widthM"] / 2 + opening["offsetM"] + opening["widthM"] / 2
    if wall == "north":
        return room["widthM"] / 2 - opening["offsetM"] - opening["widthM"] / 2
    if wall == "east":
        return -room["depthM"] / 2 + opening["offsetM"] + opening["widthM"] / 2
    if wall == "west":
        return room["depthM"] / 2 - opening["offsetM"] - opening["widthM"] / 2
    fail(f"room_opening_wall_invalid:{opening.get('id', 'unknown')}")


def wall_box(name, wall, along_size, height, normal_depth, along_center, center_y, room):
    if wall == "north":
        return box(name, along_size, height, normal_depth, along_center, center_y, room["depthM"] / 2)
    if wall == "south":
        return box(name, along_size, height, normal_depth, along_center, center_y, -room["depthM"] / 2)
    if wall == "east":
        return box(name, normal_depth, height, along_size, room["widthM"] / 2, center_y, along_center)
    if wall == "west":
        return box(name, normal_depth, height, along_size, -room["widthM"] / 2, center_y, along_center)
    fail(f"room_opening_wall_invalid:{name}")


def interior_trim_box(name, wall, along_size, height, normal_depth, along_center, center_y, room):
    thickness = room["wallThicknessM"]
    if wall == "north":
        return box(name, along_size, height, normal_depth, along_center, center_y, room["depthM"] / 2 - thickness / 2 - normal_depth / 2)
    if wall == "south":
        return box(name, along_size, height, normal_depth, along_center, center_y, -room["depthM"] / 2 + thickness / 2 + normal_depth / 2)
    if wall == "east":
        return box(name, normal_depth, height, along_size, room["widthM"] / 2 - thickness / 2 - normal_depth / 2, center_y, along_center)
    if wall == "west":
        return box(name, normal_depth, height, along_size, -room["widthM"] / 2 + thickness / 2 + normal_depth / 2, center_y, along_center)
    fail(f"room_opening_wall_invalid:{name}")


def boxes_overlap(left, right):
    axes = (("x", "widthM"), ("y", "heightM"), ("z", "depthM"))
    return all(
        min(
            left["centerM"][coordinate] + left["dimensionsM"][dimension] / 2,
            right["centerM"][coordinate] + right["dimensionsM"][dimension] / 2,
        ) - max(
            left["centerM"][coordinate] - left["dimensionsM"][dimension] / 2,
            right["centerM"][coordinate] - right["dimensionsM"][dimension] / 2,
        ) > 1e-6
        for coordinate, dimension in axes
    )


def build_opening_plan(scene):
    room = scene["room"]
    profiles = {profile["id"]: profile for profile in scene["profiles"]}
    openings = []
    cuts = []
    objects = []
    details_by_wall = {}
    for detail in scene["architecturalDetails"]:
        details_by_wall.setdefault(detail["wall"], []).append(detail)

    for opening in scene["openings"]:
        identifier = opening["id"]
        wall = opening["wall"]
        center = opening_center(opening, room)
        bottom = room["floorY"] + opening["sillM"]
        top = bottom + opening["heightM"]
        profile = profiles[opening["profileId"]]
        frame_width = profile["widthM"]
        frame_depth = profile["depthM"]
        cut_height = opening["heightM"] + (0.02 if opening["kind"] == "door" else 0)
        cut_center_y = bottom + opening["heightM"] / 2 - (0.01 if opening["kind"] == "door" else 0)
        cut = wall_box(
            f"opening.cut.{identifier}",
            wall,
            opening["widthM"],
            cut_height,
            room["wallThicknessM"] + 0.04,
            center,
            cut_center_y,
            room,
        )
        cut["openingId"] = identifier
        cuts.append(cut)

        frame_names = []
        for side, along, center_y in (
            ("left", center - opening["widthM"] / 2 + frame_width / 2, bottom + opening["heightM"] / 2),
            ("right", center + opening["widthM"] / 2 - frame_width / 2, bottom + opening["heightM"] / 2),
        ):
            name = f"opening.{identifier}.frame.{side}"
            objects.append(wall_box(name, wall, frame_width, opening["heightM"], frame_depth, along, center_y, room))
            frame_names.append(name)
        head_name = f"opening.{identifier}.frame.head"
        objects.append(wall_box(head_name, wall, opening["widthM"] - 2 * frame_width, frame_width, frame_depth, center, top - frame_width / 2, room))
        frame_names.append(head_name)
        if opening["kind"] == "window":
            bottom_name = f"opening.{identifier}.frame.bottom"
            objects.append(wall_box(bottom_name, wall, opening["widthM"] - 2 * frame_width, frame_width, frame_depth, center, bottom + frame_width / 2, room))
            frame_names.append(bottom_name)

        reveal_names = []
        sill_names = []
        for detail in details_by_wall.get(wall, []):
            detail_profile = profiles[detail["profileId"]]
            if detail["kind"] == "reveal" and opening["kind"] == "window":
                trim_width = detail_profile["widthM"]
                trim_depth = detail_profile["depthM"]
                for side, along, center_y, along_size, height in (
                    ("left", center - opening["widthM"] / 2 - trim_width / 2, bottom + opening["heightM"] / 2, trim_width, opening["heightM"]),
                    ("right", center + opening["widthM"] / 2 + trim_width / 2, bottom + opening["heightM"] / 2, trim_width, opening["heightM"]),
                    ("head", center, top + trim_width / 2, opening["widthM"], trim_width),
                ):
                    name = f"opening.{identifier}.reveal.{side}"
                    objects.append(interior_trim_box(name, wall, along_size, height, trim_depth, along, center_y, room))
                    reveal_names.append(name)
            if detail["kind"] == "sill" and opening["kind"] == "window":
                name = f"opening.{identifier}.sill"
                objects.append(interior_trim_box(
                    name,
                    wall,
                    opening["widthM"] + 2 * detail_profile["widthM"],
                    detail_profile["depthM"],
                    detail_profile["widthM"],
                    center,
                    bottom - detail_profile["depthM"] / 2,
                    room,
                ))
                sill_names.append(name)

        openings.append({
            "id": identifier,
            "kind": opening["kind"],
            "wall": wall,
            "centerAlongM": rounded(center),
            "bottomM": rounded(bottom),
            "topM": rounded(top),
            "widthM": rounded(opening["widthM"]),
            "heightM": rounded(opening["heightM"]),
            "profileId": opening["profileId"],
            "clearWidthM": rounded(opening["widthM"] - 2 * frame_width),
            "clearHeightM": rounded(opening["heightM"] - frame_width * (2 if opening["kind"] == "window" else 1)),
            "clearBottomM": rounded(bottom + (frame_width if opening["kind"] == "window" else 0)),
            "clearTopM": rounded(top - frame_width),
            "frameObjectNames": sorted(frame_names),
            "revealObjectNames": sorted(reveal_names),
            "sillObjectNames": sorted(sill_names),
        })

    objects.sort(key=lambda value: value["name"])
    cuts.sort(key=lambda value: value["name"])
    overlap_pairs = [
        (objects[left]["name"], objects[right]["name"])
        for left in range(len(objects))
        for right in range(left + 1, len(objects))
        if boxes_overlap(objects[left], objects[right])
    ]
    if overlap_pairs:
        fail(f"room_opening_detail_overlap:{overlap_pairs[0][0]}:{overlap_pairs[0][1]}")
    return {
        "openingCount": len(openings),
        "cutCount": len(cuts),
        "frameObjectCount": sum(len(value["frameObjectNames"]) for value in openings),
        "revealObjectCount": sum(len(value["revealObjectNames"]) for value in openings),
        "sillObjectCount": sum(len(value["sillObjectNames"]) for value in openings),
        "overlapPairCount": 0,
        "openings": openings,
        "cuts": cuts,
        "objects": objects,
    }


def cube_geometry(dimensions):
    half_x = dimensions["widthM"] / 2
    half_y = dimensions["depthM"] / 2
    half_z = dimensions["heightM"] / 2
    vertices = [
        (-half_x, -half_y, -half_z),
        (half_x, -half_y, -half_z),
        (half_x, half_y, -half_z),
        (-half_x, half_y, -half_z),
        (-half_x, -half_y, half_z),
        (half_x, -half_y, half_z),
        (half_x, half_y, half_z),
        (-half_x, half_y, half_z),
    ]
    faces = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    return vertices, faces


def wall_ring_geometry(record):
    outer_x = record["dimensionsM"]["widthM"] / 2
    outer_y = record["dimensionsM"]["depthM"] / 2
    inner_x = record["interiorDimensionsM"]["widthM"] / 2
    inner_y = record["interiorDimensionsM"]["depthM"] / 2
    half_z = record["dimensionsM"]["heightM"] / 2
    outer = [(-outer_x, -outer_y), (outer_x, -outer_y), (outer_x, outer_y), (-outer_x, outer_y)]
    inner = [(-inner_x, -inner_y), (inner_x, -inner_y), (inner_x, inner_y), (-inner_x, inner_y)]
    vertices = [(x, y, z) for z in (-half_z, half_z) for ring in (outer, inner) for x, y in ring]
    faces = []
    for index in range(4):
        following = (index + 1) % 4
        faces.append((index, following, 8 + following, 8 + index))
        faces.append((4 + following, 4 + index, 12 + index, 12 + following))
        faces.append((8 + index, 8 + following, 12 + following, 12 + index))
        faces.append((following, index, 4 + index, 4 + following))
    return vertices, faces


def geometry(record):
    if record["geometry"] == "box":
        return cube_geometry(record["dimensionsM"])
    if record["geometry"] == "rectangular-wall-ring":
        return wall_ring_geometry(record)
    fail(f"room_shell_geometry_invalid:{record['name']}")


def blender_identity(bpy):
    version = bpy.app.version_string
    build_hash = bpy.app.build_hash.decode("ascii") if isinstance(bpy.app.build_hash, bytes) else str(bpy.app.build_hash)
    binary_sha256 = sha256_bytes(Path(bpy.app.binary_path).read_bytes())
    if version != EXPECTED_BLENDER_VERSION or build_hash != EXPECTED_BLENDER_BUILD_HASH or binary_sha256 != EXPECTED_BLENDER_BINARY_SHA256:
        fail(f"blender_identity_invalid:{version}:{build_hash}:{binary_sha256}")
    return version, build_hash, binary_sha256


def verify_object(value, expected):
    if value is None or value.type != "MESH":
        fail(f"room_shell_object_missing:{expected['name']}")
    actual_dimensions = {
        "widthM": float(value.dimensions.x),
        "heightM": float(value.dimensions.z),
        "depthM": float(value.dimensions.y),
    }
    actual_center = {"x": float(value.location.x), "y": float(value.location.z), "z": float(value.location.y)}
    expected_vertices, expected_faces = geometry(expected)
    actual_vertices = [tuple(float(coordinate) for coordinate in vertex.co) for vertex in value.data.vertices]
    actual_faces = [tuple(polygon.vertices) for polygon in value.data.polygons]
    vertices_match = len(actual_vertices) == len(expected_vertices) and all(
        all(abs(actual - planned) <= 1e-6 for actual, planned in zip(observed, planned))
        for observed, planned in zip(actual_vertices, expected_vertices)
    )
    if any(abs(actual_dimensions[key] - expected["dimensionsM"][key]) > 1e-6 for key in actual_dimensions) \
            or any(abs(actual_center[key] - expected["centerM"][key]) > 1e-6 for key in actual_center) \
            or len(value.data.vertices) != expected["vertexCount"] \
            or len(value.data.polygons) != expected["faceCount"] \
            or not vertices_match \
            or actual_faces != expected_faces \
            or len(value.material_slots) != 0:
        fail(f"room_shell_object_invalid:{expected['name']}")
    report = {
        "name": value.name,
        "geometry": expected["geometry"],
        "dimensionsM": expected["dimensionsM"],
        "centerM": expected["centerM"],
        "vertexCount": len(value.data.vertices),
        "faceCount": len(value.data.polygons),
    }
    for key in ("interiorDimensionsM", "wallThicknessM", "wallSegments"):
        if key in expected:
            report[key] = expected[key]
    return report


def create_mesh_object(bpy, record, collection):
    vertices, faces = geometry(record)
    mesh = bpy.data.meshes.new(f"mesh.{record['name']}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    mesh.validate(verbose=False, clean_customdata=False)
    value = bpy.data.objects.new(record["name"], mesh)
    center = record["centerM"]
    value.location = (center["x"], center["z"], center["y"])
    value["wmmr_fixture_only"] = True
    collection.objects.link(value)
    return value


def apply_opening_cuts(bpy, wall, opening_plan, collection):
    for cut in opening_plan["cuts"]:
        cutter = create_mesh_object(bpy, cut, collection)
        modifier = wall.modifiers.new(name=f"cut.{cut['openingId']}", type="BOOLEAN")
        modifier.operation = "DIFFERENCE"
        modifier.solver = "EXACT"
        modifier.object = cutter
        bpy.context.view_layer.objects.active = wall
        wall.select_set(True)
        cutter.select_set(False)
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        cutter_mesh = cutter.data
        bpy.data.objects.remove(cutter, do_unlink=True)
        bpy.data.meshes.remove(cutter_mesh)
    wall.data.update(calc_edges=True)
    wall.data.validate(verbose=False, clean_customdata=False)


def wall_ray(opening, room, along, vertical):
    thickness = room["wallThicknessM"]
    wall = opening["wall"]
    if wall == "north":
        return (along, room["depthM"] / 2 + thickness, vertical), (0, -1, 0)
    if wall == "south":
        return (along, -room["depthM"] / 2 - thickness, vertical), (0, 1, 0)
    if wall == "east":
        return (room["widthM"] / 2 + thickness, along, vertical), (-1, 0, 0)
    return (-room["widthM"] / 2 - thickness, along, vertical), (1, 0, 0)


def ray_targets(values):
    from mathutils import Vector
    from mathutils.bvhtree import BVHTree

    targets = []
    for value in values:
        if value.type != "MESH":
            continue
        if any(abs(angle) > 1e-9 for angle in value.rotation_euler) or any(abs(scale - 1) > 1e-9 for scale in value.scale):
            fail(f"room_opening_ray_transform_invalid:{value.name}")
        vertices = [tuple(vertex.co) for vertex in value.data.vertices]
        polygons = [tuple(polygon.vertices) for polygon in value.data.polygons]
        targets.append((value.name, Vector(value.location), BVHTree.FromPolygons(vertices, polygons, all_triangles=False)))
    return targets


def ray_hit(targets, origin, direction, distance):
    from mathutils import Vector

    origin_vector = Vector(origin)
    direction_vector = Vector(direction)
    return any(tree.ray_cast(origin_vector - location, direction_vector, distance)[0] is not None for _, location, tree in targets)


def verify_cut_wall(value, expected, opening_plan, room, assembly_objects):
    if value is None or value.type != "MESH" or len(value.material_slots) != 0:
        fail("room_opening_wall_invalid")
    actual_dimensions = (float(value.dimensions.x), float(value.dimensions.z), float(value.dimensions.y))
    expected_dimensions = (expected["dimensionsM"]["widthM"], expected["dimensionsM"]["heightM"], expected["dimensionsM"]["depthM"])
    if any(abs(actual - planned) > 1e-6 for actual, planned in zip(actual_dimensions, expected_dimensions)):
        fail("room_opening_wall_bounds_invalid")
    incidence = {}
    for polygon in value.data.polygons:
        vertices = tuple(polygon.vertices)
        for index, start in enumerate(vertices):
            edge = tuple(sorted((start, vertices[(index + 1) % len(vertices)])))
            incidence[edge] = incidence.get(edge, 0) + 1
    non_manifold = sum(count != 2 for count in incidence.values())
    if non_manifold != 0:
        fail("room_opening_wall_non_manifold")

    wall_targets = ray_targets([value])
    assembly_targets = ray_targets(assembly_objects)
    distance = room["wallThicknessM"] * 4
    epsilon = 0.01
    for opening in opening_plan["openings"]:
        center_y = (opening["bottomM"] + opening["topM"]) / 2
        left = opening["centerAlongM"] - opening["widthM"] / 2
        right = opening["centerAlongM"] + opening["widthM"] / 2
        nominal_clear = [
            (opening["centerAlongM"], center_y),
            (left + epsilon, center_y),
            (right - epsilon, center_y),
            (opening["centerAlongM"], opening["bottomM"] + epsilon),
            (opening["centerAlongM"], opening["topM"] - epsilon),
        ]
        nominal_solid = [
            (left - epsilon, center_y),
            (right + epsilon, center_y),
            (opening["centerAlongM"], opening["topM"] + epsilon),
        ]
        if opening["kind"] == "window":
            nominal_solid.append((opening["centerAlongM"], opening["bottomM"] - epsilon))
        for along, vertical in nominal_clear:
            origin, direction = wall_ray(opening, room, along, vertical)
            if ray_hit(wall_targets, origin, direction, distance):
                fail(f"room_opening_nominal_cut_blocked:{opening['id']}")
        for along, vertical in nominal_solid:
            origin, direction = wall_ray(opening, room, along, vertical)
            if not ray_hit(wall_targets, origin, direction, distance):
                fail(f"room_opening_nominal_boundary_missing:{opening['id']}")

        clear_left = opening["centerAlongM"] - opening["clearWidthM"] / 2
        clear_right = opening["centerAlongM"] + opening["clearWidthM"] / 2
        clear_center_y = (opening["clearBottomM"] + opening["clearTopM"]) / 2
        assembly_clear = [
            (opening["centerAlongM"], clear_center_y),
            (clear_left + epsilon, clear_center_y),
            (clear_right - epsilon, clear_center_y),
            (opening["centerAlongM"], opening["clearBottomM"] + epsilon),
            (opening["centerAlongM"], opening["clearTopM"] - epsilon),
        ]
        assembly_solid = [
            (clear_left - epsilon, clear_center_y),
            (clear_right + epsilon, clear_center_y),
            (opening["centerAlongM"], opening["clearTopM"] + epsilon),
        ]
        if opening["kind"] == "window":
            assembly_solid.append((opening["centerAlongM"], opening["clearBottomM"] - epsilon))
        for along, vertical in assembly_clear:
            origin, direction = wall_ray(opening, room, along, vertical)
            if ray_hit(assembly_targets, origin, direction, distance):
                fail(f"room_opening_clear_aperture_blocked:{opening['id']}")
        for along, vertical in assembly_solid:
            origin, direction = wall_ray(opening, room, along, vertical)
            if not ray_hit(assembly_targets, origin, direction, distance):
                fail(f"room_opening_clear_boundary_missing:{opening['id']}")
    return {
        "name": value.name,
        "geometry": "rectangular-wall-ring-with-openings",
        "dimensionsM": expected["dimensionsM"],
        "centerM": expected["centerM"],
        "vertexCount": len(value.data.vertices),
        "faceCount": len(value.data.polygons),
        "edgeCount": len(value.data.edges),
        "manifoldEdgeCount": len(incidence),
        "nonManifoldEdgeCount": non_manifold,
    }


def inventory_report(bpy, objects):
    return {
        "objectCount": len(bpy.data.objects),
        "meshCount": len(bpy.data.meshes),
        "materialCount": len(bpy.data.materials),
        "cameraCount": len(bpy.data.cameras),
        "lightCount": len(bpy.data.lights),
        "vertexCount": sum(len(value.data.vertices) for value in bpy.data.objects if value.type == "MESH"),
        "faceCount": sum(len(value.data.polygons) for value in bpy.data.objects if value.type == "MESH"),
        "objects": objects,
    }


def apply_plan(plan, opening_plan, scene_specification, specification_sha256):
    try:
        import bpy
    except ImportError:
        fail("blender_python_required")

    version, build_hash, binary_sha256 = blender_identity(bpy)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "WMMR_SYNTHETIC_SHELL"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["wmmr_fixture_only"] = True
    scene["wmmr_specification_sha256"] = specification_sha256

    collection = bpy.data.collections.new(plan["collectionName"])
    scene.collection.children.link(collection)
    for record in plan["objects"]:
        create_mesh_object(bpy, record, collection)

    wall_record = next(record for record in plan["objects"] if record["name"] == "shell.walls")
    wall = bpy.data.objects.get("shell.walls")
    verify_object(wall, wall_record)
    apply_opening_cuts(bpy, wall, opening_plan, collection)
    for record in opening_plan["objects"]:
        create_mesh_object(bpy, record, collection)

    bpy.context.view_layer.update()
    shell_objects = [
        verify_object(bpy.data.objects.get(record["name"]), record)
        for record in plan["objects"]
        if record["name"] != "shell.walls"
    ]
    shell_objects.append(verify_cut_wall(wall, wall_record, opening_plan, scene_specification["room"], list(bpy.data.objects)))
    shell_objects.sort(key=lambda record: record["name"])
    opening_objects = [verify_object(bpy.data.objects.get(record["name"]), record) for record in opening_plan["objects"]]
    all_objects = sorted([*shell_objects, *opening_objects], key=lambda record: record["name"])
    expected_names = {record["name"] for record in all_objects}
    if set(bpy.data.objects.keys()) != expected_names or len(bpy.data.materials) != 0 or len(bpy.data.cameras) != 0 or len(bpy.data.lights) != 0:
        fail("room_opening_inventory_invalid")
    return bpy, version, build_hash, binary_sha256, shell_objects, opening_objects, inventory_report(bpy, all_objects)


def load_exact_fixture():
    raw = FIXTURE_PATH.read_bytes()
    if sha256_bytes(raw) != EXPECTED_SCENE_RAW_SHA256:
        fail("room_shell_fixture_sha256_mismatch")
    return json.loads(raw.decode("utf-8"))


def inspect_current_blend(report_path, specification_sha256):
    try:
        import bpy
    except ImportError:
        fail("blender_python_required")
    version, build_hash, binary_sha256 = blender_identity(bpy)
    scene_specification = load_exact_fixture()
    plan = build_shell_plan(scene_specification)
    opening_plan = build_opening_plan(scene_specification)
    expected_names = {record["name"] for record in [*plan["objects"], *opening_plan["objects"]]}
    if set(bpy.data.objects.keys()) != expected_names \
            or len(bpy.data.meshes) != len(expected_names) \
            or len(bpy.data.materials) != 0 \
            or len(bpy.data.cameras) != 0 \
            or len(bpy.data.lights) != 0 \
            or set(child.name for child in bpy.context.scene.collection.children) != {COLLECTION_NAME}:
        fail("room_shell_saved_inventory_invalid")
    collection = bpy.data.collections.get(COLLECTION_NAME)
    if collection is None or set(collection.objects.keys()) != expected_names:
        fail("room_shell_saved_collection_invalid")
    wall_record = next(record for record in plan["objects"] if record["name"] == "shell.walls")
    shell_objects = [
        verify_object(bpy.data.objects.get(record["name"]), record)
        for record in plan["objects"]
        if record["name"] != "shell.walls"
    ]
    shell_objects.append(verify_cut_wall(
        bpy.data.objects.get("shell.walls"),
        wall_record,
        opening_plan,
        scene_specification["room"],
        list(bpy.data.objects),
    ))
    opening_objects = [verify_object(bpy.data.objects.get(record["name"]), record) for record in opening_plan["objects"]]
    objects = sorted([*shell_objects, *opening_objects], key=lambda record: record["name"])
    if bpy.context.scene.get("wmmr_fixture_only") is not True \
            or bpy.context.scene.get("wmmr_specification_sha256") != specification_sha256:
        fail("room_shell_saved_metadata_invalid")
    report = {
        "schemaVersion": 1,
        "status": "stage3-synthetic-room-shell-openings-inspection-valid",
        "fixtureOnly": True,
        "specificationSha256": specification_sha256,
        "blender": {"version": version, "buildHash": build_hash, "binarySha256": binary_sha256},
        "inventory": inventory_report(bpy, objects),
    }
    write_report(report_path, report)
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


def outside_repository(path, label):
    resolved = path.resolve()
    try:
        resolved.relative_to(REPOSITORY_ROOT)
    except ValueError:
        return resolved
    fail(f"{label}_must_be_outside_repository")


def write_report(path, report):
    with path.open("x", encoding="ascii", newline="\n") as handle:
        json.dump(report, handle, ensure_ascii=True, indent=2, sort_keys=True)
        handle.write("\n")


def parse_args(argv):
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--scene-spec")
    parser.add_argument("--expected-specification-sha256", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--output-blend")
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--inspect-only", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    if args.expected_specification_sha256 != EXPECTED_SPECIFICATION_SHA256:
        fail("approved_candidate_compilation_not_implemented")
    report_path = outside_repository(Path(args.report), "room_shell_report")
    if report_path.exists():
        fail("room_shell_report_exists")

    if args.inspect_only:
        if args.scene_spec is not None or args.output_blend is not None or args.plan_only:
            fail("room_shell_inspection_arguments_invalid")
        inspect_current_blend(report_path, args.expected_specification_sha256)
        return
    if args.scene_spec is None:
        fail("room_shell_scene_missing")
    scene_path = Path(args.scene_spec).resolve(strict=True)
    raw = scene_path.read_bytes()
    if sha256_bytes(raw) != EXPECTED_SCENE_RAW_SHA256:
        fail("room_shell_fixture_sha256_mismatch")
    scene = json.loads(raw.decode("utf-8"))
    plan = build_shell_plan(scene)
    opening_plan = build_opening_plan(scene)

    boundaries = {
        "approvedCandidateSpecification": False,
        "byteIdenticalExportsVerified": False,
        "componentsCompiled": False,
        "materialsCompiled": False,
        "openingsCompiled": False,
        "sceneBinaryAddedToRepository": False,
    }
    base_report = {
        "schemaVersion": 1,
        "fixtureOnly": True,
        "sceneId": scene.get("sceneId"),
        "specificationSha256": args.expected_specification_sha256,
        "shell": plan,
        "openings": {**opening_plan, "compiled": False, "cutObjectsPersisted": False},
        "boundaries": boundaries,
    }

    if args.plan_only:
        if args.output_blend is not None:
            fail("room_shell_plan_only_arguments_invalid")
        report = {
            **base_report,
            "status": "stage3-synthetic-room-shell-openings-plan-valid",
            "execution": "plan-only",
            "blender": None,
            "outputBlend": None,
        }
        write_report(report_path, report)
        print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
        return

    if args.output_blend is None:
        fail("room_shell_blender_arguments_missing")
    output_path = outside_repository(Path(args.output_blend), "room_shell_output")
    if output_path.suffix != ".blend" or output_path.exists():
        fail("room_shell_output_invalid")
    bpy, version, build_hash, binary_sha256, shell_objects, opening_objects, inventory = apply_plan(
        plan,
        opening_plan,
        scene,
        args.expected_specification_sha256,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path), check_existing=False, compress=False, relative_remap=False)
    output_bytes = output_path.read_bytes()
    report = {
        **base_report,
        "status": "stage3-synthetic-room-shell-openings-compiled",
        "execution": "blender",
        "blender": {
            "version": version,
            "buildHash": build_hash,
            "binarySha256": binary_sha256,
        },
        "outputBlend": {
            "byteLength": len(output_bytes),
            "sha256": sha256_bytes(output_bytes),
        },
    }
    report["boundaries"] = {**boundaries, "openingsCompiled": True}
    report["shell"] = {
        **plan,
        "objectCount": len(shell_objects),
        "meshCount": len(shell_objects),
        "vertexCount": sum(record["vertexCount"] for record in shell_objects),
        "faceCount": sum(record["faceCount"] for record in shell_objects),
        "objects": shell_objects,
    }
    report["openings"] = {
        **opening_plan,
        "compiled": True,
        "cutObjectsPersisted": False,
        "objects": opening_objects,
    }
    report["inventory"] = inventory
    write_report(report_path, report)
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
