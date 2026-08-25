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
SYNTHETIC_INPUT_KIND = "synthetic-fixture"
CANDIDATE_ARCHITECTURE_INPUT_KIND = "approved-candidate-architecture"
CANDIDATE_COMPONENT_INPUT_KIND = "approved-candidate-components"
EXPECTED_SYNTHETIC_SPECIFICATION_SHA256 = "7835eb45004e91f29daf6ee6e6c4b7cb34ad081f4a90f234f38732f4daf92a91"
EXPECTED_SYNTHETIC_SCENE_RAW_SHA256 = "faef3aebe7278f72bf272411abdb0080792b4459ad7ca0097cca36e59498b748"
EXPECTED_CANDIDATE_SPECIFICATION_SHA256 = "29d76ca0feaefd4bf9cac9ebd25113c601e358c939778c4a0f43f3f94b58e0dd"
EXPECTED_CANDIDATE_SCENE_RAW_SHA256 = "875619d8513467417bbc89d50cd11b07fc363e8c4fbaeb8161394c8f2e885b76"
EXPECTED_COMPONENT_SPECIFICATION_SHA256 = "10106915ffabfdd4580b3866c3714f05f22bec9ce430a7bc62c7c4d2e1578644"
EXPECTED_COMPONENT_SCENE_RAW_SHA256 = "0afe14089767436df4f3d286ccacd4a1fcc46772dab071266034550bf94fcf8e"
EXPECTED_COMPONENT_CONSTRUCTION_SHA256 = "a28310aa7806fb05b8b08087a8b13de900498c3a12dbc6c3e0a5cc77ae7a3709"
EXPECTED_COMPONENT_CONSTRUCTION_RAW_SHA256 = "f32327442d015f4c89942bf752e959d6c0abc24613c72f32a8ba4c2b2b29d5d1"
COLLECTION_NAME = "WMMR_ARCHITECTURE"
COMPONENT_COLLECTION_NAME = "WMMR_APPROVED_CANDIDATE_COMPONENTS"
REPOSITORY_ROOT = Path(__file__).resolve().parent.parent


def fail(code):
    raise RuntimeError(code)


def sha256_bytes(value):
    return hashlib.sha256(value).hexdigest()


def canonical_sha256(value):
    encoded = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")
    return sha256_bytes(encoded)


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


def with_material(record, recipe_id, profile_id=None, detail_id=None):
    record["materialRecipeId"] = recipe_id
    if profile_id is not None:
        record["profileId"] = profile_id
    if detail_id is not None:
        record["detailId"] = detail_id
    return record


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
            objects.append(with_material(
                wall_box(name, wall, frame_width, opening["heightM"], frame_depth, along, center_y, room),
                profile["materialRecipeId"],
                opening["profileId"],
            ))
            frame_names.append(name)
        head_name = f"opening.{identifier}.frame.head"
        objects.append(with_material(
            wall_box(head_name, wall, opening["widthM"] - 2 * frame_width, frame_width, frame_depth, center, top - frame_width / 2, room),
            profile["materialRecipeId"],
            opening["profileId"],
        ))
        frame_names.append(head_name)
        if opening["kind"] == "window":
            bottom_name = f"opening.{identifier}.frame.bottom"
            objects.append(with_material(
                wall_box(bottom_name, wall, opening["widthM"] - 2 * frame_width, frame_width, frame_depth, center, bottom + frame_width / 2, room),
                profile["materialRecipeId"],
                opening["profileId"],
            ))
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
                    objects.append(with_material(
                        interior_trim_box(name, wall, along_size, height, trim_depth, along, center_y, room),
                        detail_profile["materialRecipeId"],
                        detail["profileId"],
                        detail["id"],
                    ))
                    reveal_names.append(name)
            if detail["kind"] == "sill" and opening["kind"] == "window":
                name = f"opening.{identifier}.sill"
                objects.append(with_material(
                    interior_trim_box(
                        name,
                        wall,
                        opening["widthM"] + 2 * detail_profile["widthM"],
                        detail_profile["depthM"],
                        detail_profile["widthM"],
                        center,
                        bottom - detail_profile["depthM"] / 2,
                        room,
                    ),
                    detail_profile["materialRecipeId"],
                    detail["profileId"],
                    detail["id"],
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


def subtract_intervals(start, end, cuts):
    segments = [(start, end)]
    for cut_start, cut_end in sorted(cuts):
        next_segments = []
        for segment_start, segment_end in segments:
            if cut_end <= segment_start or cut_start >= segment_end:
                next_segments.append((segment_start, segment_end))
                continue
            if cut_start > segment_start:
                next_segments.append((segment_start, cut_start))
            if cut_end < segment_end:
                next_segments.append((cut_end, segment_end))
        segments = next_segments
    return [(start_value, end_value) for start_value, end_value in segments if end_value - start_value > 1e-6]


def build_profile_plan(scene, opening_plan):
    room = scene["room"]
    profiles = {profile["id"]: profile for profile in scene["profiles"]}
    openings = {opening["id"]: opening for opening in opening_plan["openings"]}
    objects = []
    details = []
    for detail in scene["architecturalDetails"]:
        if detail["kind"] != "baseboard":
            continue
        profile = profiles[detail["profileId"]]
        wall = detail["wall"]
        length = room["widthM"] - room["wallThicknessM"] if wall in ("north", "south") \
            else room["depthM"] - room["wallThicknessM"] - 2 * profile["depthM"]
        cuts = []
        for opening in openings.values():
            if opening["wall"] == wall and opening["bottomM"] < room["floorY"] + profile["widthM"]:
                cuts.append((opening["centerAlongM"] - opening["widthM"] / 2, opening["centerAlongM"] + opening["widthM"] / 2))
        object_names = []
        for index, (start, end) in enumerate(subtract_intervals(-length / 2, length / 2, cuts), start=1):
            name = f"profile.{detail['id']}.segment-{index:02d}"
            record = interior_trim_box(
                name,
                wall,
                end - start,
                profile["widthM"],
                profile["depthM"],
                (start + end) / 2,
                room["floorY"] + profile["widthM"] / 2,
                room,
            )
            objects.append(with_material(record, profile["materialRecipeId"], detail["profileId"], detail["id"]))
            object_names.append(name)
        details.append({
            "id": detail["id"],
            "kind": detail["kind"],
            "wall": wall,
            "profileId": detail["profileId"],
            "materialRecipeId": profile["materialRecipeId"],
            "objectNames": object_names,
        })
    objects.sort(key=lambda value: value["name"])
    combined = [*opening_plan["objects"], *objects]
    overlap_pairs = [
        (combined[left]["name"], combined[right]["name"])
        for left in range(len(combined))
        for right in range(left + 1, len(combined))
        if boxes_overlap(combined[left], combined[right])
    ]
    if overlap_pairs:
        fail(f"room_profile_detail_overlap:{overlap_pairs[0][0]}:{overlap_pairs[0][1]}")
    return {
        "baseboardDetailCount": len(details),
        "baseboardObjectCount": len(objects),
        "overlapPairCount": 0,
        "details": details,
        "objects": objects,
    }


def build_material_plan(scene, opening_plan, profile_plan):
    recipes = {recipe["id"]: recipe for recipe in scene["materialRecipes"]}
    zones = {zone["surface"]: zone for zone in scene["materialZones"]}
    assignments = [
        {"objectName": "shell.floor", "zones": [zones["floor"]]},
        {"objectName": "shell.ceiling", "zones": [zones["ceiling"]]},
        {"objectName": "shell.walls", "zones": [zones[wall] for wall in ("east", "north", "south", "west")]},
    ]
    for record in [*opening_plan["objects"], *profile_plan["objects"]]:
        assignments.append({
            "objectName": record["name"],
            "zones": [{"id": f"profile-zone:{record['name']}", "surface": "profile", "recipeId": record["materialRecipeId"]}],
        })
    used_recipe_ids = sorted({zone["recipeId"] for assignment in assignments for zone in assignment["zones"]})
    return {
        "recipeCount": len(used_recipe_ids),
        "zoneCount": sum(len(assignment["zones"]) for assignment in assignments),
        "assignmentCount": len(assignments),
        "uvLayerName": "UVMap",
        "uvUnits": "meters-divided-by-textureScaleM",
        "textureImagesCompiled": False,
        "recipes": [recipes[identifier] for identifier in used_recipe_ids],
        "assignments": sorted(assignments, key=lambda value: value["objectName"]),
    }


def build_component_plan(scene, construction):
    families = {family["id"]: family for family in construction["families"]}
    overrides = {
        (override["componentId"], override["slot"]): override["materialRecipeId"]
        for override in construction["instanceMaterialOverrides"]
    }
    objects = []
    family_object_counts = {}
    for component in scene["components"]:
        family = families.get(component["family"])
        if family is None:
            fail(f"room_component_family_missing:{component['family']}")
        slots = {mapping["slot"]: mapping["materialRecipeId"] for mapping in family["defaultMaterials"]}
        component_yaw = component["transform"]["yaw"]
        if component_yaw not in (0, 3.141593):
            fail(f"room_component_yaw_invalid:{component['id']}")
        component_position = component["transform"]["position"]
        for part in family["parts"]:
            if part["geometry"] != "beveled-box" or part["localTransform"]["yaw"] != 0:
                fail(f"room_component_part_geometry_invalid:{component['id']}:{part['id']}")
            bevel = part["bevel"]
            if bevel["segments"] != 3 or bevel["clampOverlap"] is not True:
                fail(f"room_component_bevel_invalid:{component['id']}:{part['id']}")
            local = part["localTransform"]["position"]
            cosine = math.cos(component_yaw)
            sine = math.sin(component_yaw)
            center_x = component_position["x"] + cosine * local["x"] - sine * local["z"]
            center_z = component_position["z"] + sine * local["x"] + cosine * local["z"]
            center_y = component_position["y"] + local["y"]
            name = f"component.{component['id']}.{part['id']}"
            material_recipe_id = overrides.get(
                (component["id"], part["materialSlotId"]),
                slots.get(part["materialSlotId"]),
            )
            if material_recipe_id is None:
                fail(f"room_component_material_missing:{name}")
            record = box(
                name,
                part["dimensions"]["widthM"],
                part["dimensions"]["heightM"],
                part["dimensions"]["depthM"],
                center_x,
                center_y,
                center_z,
            )
            record.update({
                "geometry": "beveled-box",
                "componentId": component["id"],
                "familyId": component["family"],
                "partId": part["id"],
                "componentYaw": rounded(component_yaw),
                "worldYaw": rounded(component_yaw + part["localTransform"]["yaw"]),
                "bevel": {
                    "widthM": rounded(bevel["widthM"]),
                    "segments": bevel["segments"],
                    "clampOverlap": bevel["clampOverlap"],
                },
                "materialSlotId": part["materialSlotId"],
                "materialRecipeId": material_recipe_id,
                "vertexCount": 96,
                "edgeCount": 192,
                "faceCount": 98,
            })
            objects.append(record)
            family_object_counts[component["family"]] = family_object_counts.get(component["family"], 0) + 1
    objects.sort(key=lambda value: value["name"])
    names = [record["name"] for record in objects]
    if len(objects) != 38 or len(set(names)) != 38:
        fail("room_component_object_inventory_invalid")
    expected_counts = {
        "conference-table": 3,
        "task-chair": 32,
        "conference-av": 1,
        "pendant-luminaire": 2,
    }
    if family_object_counts != expected_counts:
        fail("room_component_family_inventory_invalid")
    return {
        "specified": True,
        "compiled": False,
        "componentCount": len(scene["components"]),
        "familyCount": len(families),
        "partObjectCount": len(objects),
        "overrideCount": len(overrides),
        "familyObjectCounts": dict(sorted(family_object_counts.items())),
        "objectNamePattern": "component.<componentId>.<partId>",
        "objects": objects,
    }


def with_component_materials(architecture_plan, component_plan, scene):
    recipes = {recipe["id"]: recipe for recipe in scene["materialRecipes"]}
    component_assignments = [{
        "objectName": record["name"],
        "zones": [{
            "id": f"component-zone:{record['name']}",
            "surface": f"component:{record['materialSlotId']}",
            "recipeId": record["materialRecipeId"],
        }],
    } for record in component_plan["objects"]]
    assignments = sorted([*architecture_plan["assignments"], *component_assignments], key=lambda value: value["objectName"])
    used_recipe_ids = sorted({zone["recipeId"] for assignment in assignments for zone in assignment["zones"]})
    if len(used_recipe_ids) != 5 or len(assignments) != 57:
        fail("room_component_material_inventory_invalid")
    return {
        **architecture_plan,
        "recipeCount": len(used_recipe_ids),
        "zoneCount": sum(len(assignment["zones"]) for assignment in assignments),
        "assignmentCount": len(assignments),
        "architectureRecipeCount": architecture_plan["recipeCount"],
        "architectureZoneCount": architecture_plan["zoneCount"],
        "architectureAssignmentCount": architecture_plan["assignmentCount"],
        "componentAssignmentCount": len(component_assignments),
        "componentOverrideCount": component_plan["overrideCount"],
        "recipes": [recipes[identifier] for identifier in used_recipe_ids],
        "assignments": assignments,
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
    if record["geometry"] in ("box", "beveled-box"):
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


def verify_object(value, expected, allow_materials=False):
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
            or (not allow_materials and len(value.material_slots) != 0):
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


def srgb_to_linear(channel):
    value = channel / 255
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def recipe_color(recipe):
    value = recipe["baseColorSrgb"]
    return tuple(srgb_to_linear(int(value[index:index + 2], 16)) for index in (1, 3, 5)) + (1.0,)


def create_materials(bpy, material_plan):
    materials = {}
    for recipe in material_plan["recipes"]:
        material = bpy.data.materials.new(f"material.{recipe['id']}")
        material.use_nodes = True
        color = recipe_color(recipe)
        material.diffuse_color = color
        material.metallic = recipe["metalness"]
        material.roughness = recipe["roughness"]
        material["wmmr_recipe_id"] = recipe["id"]
        material["wmmr_base_color_srgb"] = recipe["baseColorSrgb"]
        material["wmmr_texture_scale_m"] = recipe["textureScaleM"]
        material["wmmr_source_record_id"] = recipe["sourceRecordId"]
        principled = material.node_tree.nodes.get("Principled BSDF")
        if principled is None:
            fail(f"room_material_principled_missing:{recipe['id']}")
        principled.inputs["Base Color"].default_value = color
        principled.inputs["Metallic"].default_value = recipe["metalness"]
        principled.inputs["Roughness"].default_value = recipe["roughness"]
        materials[recipe["id"]] = material
    return materials


def wall_surface_for_polygon(value, polygon, room):
    center = polygon.center + value.location
    x_ratio = abs(center.x) / (room["widthM"] / 2 + room["wallThicknessM"] / 2)
    z_ratio = abs(center.y) / (room["depthM"] / 2 + room["wallThicknessM"] / 2)
    if x_ratio >= z_ratio:
        return "east" if center.x >= 0 else "west"
    return "north" if center.y >= 0 else "south"


def projected_uv(value, polygon, loop_index, scale):
    coordinate = value.data.vertices[value.data.loops[loop_index].vertex_index].co + value.location
    normal = polygon.normal
    if abs(normal.z) >= abs(normal.x) and abs(normal.z) >= abs(normal.y):
        u, v = coordinate.x, coordinate.y
    elif abs(normal.x) >= abs(normal.y):
        u, v = coordinate.y, coordinate.z
    else:
        u, v = coordinate.x, coordinate.z
    return u / scale, v / scale


def apply_uv_map(value, zone_indexes, zones, recipes, layer_name):
    uv_layer = value.data.uv_layers.new(name=layer_name)
    for polygon in value.data.polygons:
        recipe = recipes[zones[zone_indexes[polygon.index]]["recipeId"]]
        for loop_index in polygon.loop_indices:
            uv_layer.data[loop_index].uv = projected_uv(value, polygon, loop_index, recipe["textureScaleM"])


def apply_material_plan(bpy, material_plan, room):
    recipes = {recipe["id"]: recipe for recipe in material_plan["recipes"]}
    materials = create_materials(bpy, material_plan)
    for assignment in material_plan["assignments"]:
        value = bpy.data.objects.get(assignment["objectName"])
        if value is None or value.type != "MESH":
            fail(f"room_material_object_missing:{assignment['objectName']}")
        zones = assignment["zones"]
        recipe_ids = []
        for zone in zones:
            if zone["recipeId"] not in recipe_ids:
                recipe_ids.append(zone["recipeId"])
        for recipe_id in recipe_ids:
            value.data.materials.append(materials[recipe_id])
        zone_indexes = []
        for polygon in value.data.polygons:
            if value.name == "shell.walls":
                surface = wall_surface_for_polygon(value, polygon, room)
                zone_index = next((index for index, zone in enumerate(zones) if zone["surface"] == surface), None)
                if zone_index is None:
                    fail(f"room_material_wall_zone_missing:{surface}")
            else:
                zone_index = 0
            zone_indexes.append(zone_index)
            polygon.material_index = recipe_ids.index(zones[zone_index]["recipeId"])
        attribute = value.data.attributes.new(name="wmmr_zone_index", type="INT", domain="FACE")
        for index, zone_index in enumerate(zone_indexes):
            attribute.data[index].value = zone_index
        value["wmmr_material_zones_json"] = json.dumps(zones, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
        value["wmmr_uv_units"] = material_plan["uvUnits"]
        apply_uv_map(value, zone_indexes, zones, recipes, material_plan["uvLayerName"])


def verify_material_plan(bpy, material_plan, room, include_actual_evidence=False):
    recipes = {recipe["id"]: recipe for recipe in material_plan["recipes"]}
    expected_material_names = {f"material.{identifier}" for identifier in recipes}
    if set(bpy.data.materials.keys()) != expected_material_names or len(bpy.data.images) != 0 or len(bpy.data.textures) != 0:
        fail("room_material_inventory_invalid")
    material_evidence = []
    for recipe_id, recipe in recipes.items():
        material = bpy.data.materials.get(f"material.{recipe_id}")
        principled = material.node_tree.nodes.get("Principled BSDF") if material is not None and material.use_nodes else None
        if material is None or principled is None:
            fail(f"room_material_invalid:{recipe_id}")
        expected_color = recipe_color(recipe)
        actual_color = tuple(principled.inputs["Base Color"].default_value)
        output = material.node_tree.nodes.get("Material Output")
        linked = output is not None and any(
            link.from_node == principled and link.from_socket.name == "BSDF" and link.to_node == output and link.to_socket.name == "Surface"
            for link in material.node_tree.links
        )
        if any(abs(actual - expected) > 1e-6 for actual, expected in zip(actual_color, expected_color)) \
                or abs(principled.inputs["Metallic"].default_value - recipe["metalness"]) > 1e-6 \
                or abs(principled.inputs["Roughness"].default_value - recipe["roughness"]) > 1e-6 \
                or material.get("wmmr_recipe_id") != recipe["id"] \
                or material.get("wmmr_base_color_srgb") != recipe["baseColorSrgb"] \
                or material.get("wmmr_texture_scale_m") != recipe["textureScaleM"] \
                or material.get("wmmr_source_record_id") != recipe["sourceRecordId"] \
                or any(node.type == "TEX_IMAGE" for node in material.node_tree.nodes) \
                or not linked:
            fail(f"room_material_recipe_mismatch:{recipe_id}")
        material_evidence.append({
            "name": material.name,
            "recipeId": material.get("wmmr_recipe_id"),
            "baseColorSrgb": material.get("wmmr_base_color_srgb"),
            "baseColorLinear": [rounded(value) for value in actual_color],
            "textureScaleM": material.get("wmmr_texture_scale_m"),
            "sourceRecordId": material.get("wmmr_source_record_id"),
            "metalness": rounded(principled.inputs["Metallic"].default_value),
            "roughness": rounded(principled.inputs["Roughness"].default_value),
        })
    material_evidence.sort(key=lambda value: value["name"])
    reports = []
    for assignment in material_plan["assignments"]:
        value = bpy.data.objects.get(assignment["objectName"])
        zones = assignment["zones"]
        attribute = value.data.attributes.get("wmmr_zone_index") if value is not None else None
        uv_layer = value.data.uv_layers.get(material_plan["uvLayerName"]) if value is not None else None
        if value is None or attribute is None or attribute.domain != "FACE" or uv_layer is None \
                or len(attribute.data) != len(value.data.polygons) or len(uv_layer.data) != len(value.data.loops) \
                or value.get("wmmr_material_zones_json") != json.dumps(zones, ensure_ascii=True, sort_keys=True, separators=(",", ":")):
            fail(f"room_material_assignment_invalid:{assignment['objectName']}")
        indexes = [item.value for item in attribute.data]
        if any(index < 0 or index >= len(zones) for index in indexes) or set(indexes) != set(range(len(zones))):
            fail(f"room_material_zone_coverage_invalid:{assignment['objectName']}")
        for polygon in value.data.polygons:
            scale = recipes[zones[indexes[polygon.index]]["recipeId"]]["textureScaleM"]
            uv_tolerance = 1e-4 if scale < 0.01 else 1e-5
            for loop_index in polygon.loop_indices:
                actual_uv = tuple(uv_layer.data[loop_index].uv)
                expected_uv = projected_uv(value, polygon, loop_index, scale)
                if any(not finite_number(coordinate) for coordinate in actual_uv) \
                        or any(abs(actual - expected) > uv_tolerance for actual, expected in zip(actual_uv, expected_uv)):
                    fail(f"room_material_uv_invalid:{assignment['objectName']}")
        recipe_ids = []
        for zone in zones:
            if zone["recipeId"] not in recipe_ids:
                recipe_ids.append(zone["recipeId"])
        actual_slot_names = [slot.material.name for slot in value.material_slots]
        if actual_slot_names != [f"material.{identifier}" for identifier in recipe_ids]:
            fail(f"room_material_slots_invalid:{assignment['objectName']}")
        material_slots = []
        for index, slot in enumerate(value.material_slots):
            material = slot.material
            principled = material.node_tree.nodes.get("Principled BSDF") if material is not None and material.use_nodes else None
            if material is None or principled is None:
                fail(f"room_material_slots_invalid:{assignment['objectName']}")
            material_slots.append({
                "index": index,
                "name": material.name,
                "recipeId": material.get("wmmr_recipe_id"),
                "baseColorSrgb": material.get("wmmr_base_color_srgb"),
                "textureScaleM": material.get("wmmr_texture_scale_m"),
                "sourceRecordId": material.get("wmmr_source_record_id"),
                "metalness": rounded(principled.inputs["Metallic"].default_value),
                "roughness": rounded(principled.inputs["Roughness"].default_value),
            })
        report = {
            "objectName": assignment["objectName"],
            "zoneIds": [zone["id"] for zone in zones],
            "recipeIds": recipe_ids,
            "faceZoneCounts": [indexes.count(index) for index in range(len(zones))],
            "uvLoopCount": len(uv_layer.data),
        }
        if include_actual_evidence:
            report["materialSlots"] = material_slots
        reports.append(report)
    report = {
        **material_plan,
        "compiled": True,
        "imageCount": len(bpy.data.images),
        "textureCount": len(bpy.data.textures),
        "textureNodeCount": sum(node.type == "TEX_IMAGE" for material in bpy.data.materials for node in material.node_tree.nodes),
        "assignments": reports,
    }
    if include_actual_evidence:
        report["materialEvidence"] = material_evidence
    return report


def create_mesh_object(bpy, record, collection, fixture_only):
    vertices, faces = geometry(record)
    mesh = bpy.data.meshes.new(f"mesh.{record['name']}")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    mesh.validate(verbose=False, clean_customdata=False)
    value = bpy.data.objects.new(record["name"], mesh)
    center = record["centerM"]
    value.location = (center["x"], center["z"], center["y"])
    value["wmmr_fixture_only"] = fixture_only
    collection.objects.link(value)
    return value


def component_mesh_digest(value):
    return canonical_sha256({
        "vertices": [
            [rounded(coordinate) for coordinate in vertex.co]
            for vertex in value.data.vertices
        ],
        "faces": [list(polygon.vertices) for polygon in value.data.polygons],
    })


def verify_component_object(value, expected, allow_materials=False):
    if value is None or value.type != "MESH":
        fail(f"room_component_object_missing:{expected['name']}")
    actual_dimensions = {
        "widthM": float(value.dimensions.x),
        "heightM": float(value.dimensions.z),
        "depthM": float(value.dimensions.y),
    }
    actual_center = {"x": float(value.location.x), "y": float(value.location.z), "z": float(value.location.y)}
    expected_materials = [f"material.{expected['materialRecipeId']}"] if allow_materials else []
    if any(abs(actual_dimensions[key] - expected["dimensionsM"][key]) > 1e-6 for key in actual_dimensions) \
            or any(abs(actual_center[key] - expected["centerM"][key]) > 1e-6 for key in actual_center) \
            or len(value.data.vertices) != expected["vertexCount"] \
            or len(value.data.edges) != expected["edgeCount"] \
            or len(value.data.polygons) != expected["faceCount"] \
            or len(value.modifiers) != 0 \
            or value.parent is not None \
            or any(abs(angle) > 1e-9 for angle in value.rotation_euler) \
            or any(abs(scale - 1) > 1e-9 for scale in value.scale) \
            or [slot.material.name for slot in value.material_slots] != expected_materials \
            or value.get("wmmr_bevel_applied") is not True \
            or value.get("wmmr_bevel_width_m") != expected["bevel"]["widthM"] \
            or value.get("wmmr_bevel_segments") != expected["bevel"]["segments"] \
            or value.get("wmmr_bevel_clamp_overlap") is not expected["bevel"]["clampOverlap"] \
            or value.get("wmmr_component_id") != expected["componentId"] \
            or value.get("wmmr_family_id") != expected["familyId"] \
            or value.get("wmmr_part_id") != expected["partId"] \
            or value.get("wmmr_material_slot_id") != expected["materialSlotId"] \
            or value.get("wmmr_material_recipe_id") != expected["materialRecipeId"]:
        fail(f"room_component_object_invalid:{expected['name']}")
    half_extents = (
        expected["dimensionsM"]["widthM"] / 2,
        expected["dimensionsM"]["depthM"] / 2,
        expected["dimensionsM"]["heightM"] / 2,
    )
    local_bounds = [
        (
            min(vertex.co[axis] for vertex in value.data.vertices),
            max(vertex.co[axis] for vertex in value.data.vertices),
        )
        for axis in range(3)
    ]
    if any(abs(minimum + half_extents[axis]) > 1e-6 or abs(maximum - half_extents[axis]) > 1e-6
           for axis, (minimum, maximum) in enumerate(local_bounds)):
        fail(f"room_component_bounds_invalid:{expected['name']}")
    bevel_width = expected["bevel"]["widthM"]
    inset_axes = sum(
        any(abs(abs(vertex.co[axis]) - (half_extents[axis] - bevel_width)) <= 1e-5 for vertex in value.data.vertices)
        for axis in range(3)
    )
    if inset_axes != 3 or any(polygon.area <= 1e-12 for polygon in value.data.polygons):
        fail(f"room_component_bevel_topology_invalid:{expected['name']}")
    return {
        **expected,
        "centerM": {key: rounded(value) for key, value in actual_center.items()},
        "dimensionsM": {key: rounded(value) for key, value in actual_dimensions.items()},
        "vertexCount": len(value.data.vertices),
        "edgeCount": len(value.data.edges),
        "faceCount": len(value.data.polygons),
        "modifierCount": len(value.modifiers),
        "bevelApplied": True,
        "bevelInsetAxisCount": inset_axes,
        "topologySha256": component_mesh_digest(value),
    }


def create_component_object(bpy, record, collection, fixture_only):
    value = create_mesh_object(bpy, record, collection, fixture_only)
    value["wmmr_bevel_applied"] = False
    value["wmmr_bevel_width_m"] = record["bevel"]["widthM"]
    value["wmmr_bevel_segments"] = record["bevel"]["segments"]
    value["wmmr_bevel_clamp_overlap"] = record["bevel"]["clampOverlap"]
    value["wmmr_component_id"] = record["componentId"]
    value["wmmr_family_id"] = record["familyId"]
    value["wmmr_part_id"] = record["partId"]
    value["wmmr_material_slot_id"] = record["materialSlotId"]
    value["wmmr_material_recipe_id"] = record["materialRecipeId"]
    modifier = value.modifiers.new(name="approved-bevel", type="BEVEL")
    modifier.width = record["bevel"]["widthM"]
    modifier.segments = record["bevel"]["segments"]
    modifier.limit_method = "NONE"
    modifier.use_clamp_overlap = record["bevel"]["clampOverlap"]
    bpy.context.view_layer.objects.active = value
    value.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    value.select_set(False)
    value["wmmr_bevel_applied"] = True
    value.data.update(calc_edges=True)
    value.data.validate(verbose=False, clean_customdata=False)
    verify_component_object(value, record)
    return value


def apply_opening_cuts(bpy, wall, opening_plan, collection, fixture_only):
    for cut in opening_plan["cuts"]:
        cutter = create_mesh_object(bpy, cut, collection, fixture_only)
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


def verify_cut_wall(value, expected, opening_plan, room, assembly_objects, allow_materials=False):
    if value is None or value.type != "MESH" or (not allow_materials and len(value.material_slots) != 0):
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
        "imageCount": len(bpy.data.images),
        "textureCount": len(bpy.data.textures),
        "cameraCount": len(bpy.data.cameras),
        "lightCount": len(bpy.data.lights),
        "vertexCount": sum(len(value.data.vertices) for value in bpy.data.objects if value.type == "MESH"),
        "faceCount": sum(len(value.data.polygons) for value in bpy.data.objects if value.type == "MESH"),
        "objects": objects,
    }


def apply_plan(plan, opening_plan, profile_plan, component_plan, material_plan, scene_specification, specification_sha256, input_kind):
    try:
        import bpy
    except ImportError:
        fail("blender_python_required")

    version, build_hash, binary_sha256 = blender_identity(bpy)

    fixture_only = input_kind == SYNTHETIC_INPUT_KIND
    components_included = input_kind == CANDIDATE_COMPONENT_INPUT_KIND
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "WMMR_SYNTHETIC_SHELL" if fixture_only else "WMMR_CANDIDATE_01_COMPONENTS" if components_included else "WMMR_CANDIDATE_01_ARCHITECTURE"
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0
    scene["wmmr_fixture_only"] = fixture_only
    scene["wmmr_specification_sha256"] = specification_sha256
    if not fixture_only:
        scene["wmmr_approved_candidate_specification"] = True
        scene["wmmr_candidate_architecture_compiled"] = True
        scene["wmmr_components_specified"] = components_included
        scene["wmmr_components_compiled"] = components_included
        scene["wmmr_component_glb_byte_identical"] = False
        scene["wmmr_exterior_compiled"] = False
        scene["wmmr_lighting_compiled"] = False
        scene["wmmr_media_surfaces_compiled"] = False
        scene["wmmr_final_candidate_glb_verified"] = False
        scene["wmmr_publication_ready"] = False

    collection_name = COMPONENT_COLLECTION_NAME if components_included else plan["collectionName"]
    collection = bpy.data.collections.new(collection_name)
    scene.collection.children.link(collection)
    for record in plan["objects"]:
        create_mesh_object(bpy, record, collection, fixture_only)

    wall_record = next(record for record in plan["objects"] if record["name"] == "shell.walls")
    wall = bpy.data.objects.get("shell.walls")
    verify_object(wall, wall_record)
    apply_opening_cuts(bpy, wall, opening_plan, collection, fixture_only)
    for record in opening_plan["objects"]:
        create_mesh_object(bpy, record, collection, fixture_only)
    for record in profile_plan["objects"]:
        create_mesh_object(bpy, record, collection, fixture_only)
    if components_included:
        for record in component_plan["objects"]:
            create_component_object(bpy, record, collection, fixture_only)

    bpy.context.view_layer.update()
    shell_objects = [
        verify_object(bpy.data.objects.get(record["name"]), record)
        for record in plan["objects"]
        if record["name"] != "shell.walls"
    ]
    shell_objects.append(verify_cut_wall(wall, wall_record, opening_plan, scene_specification["room"], list(bpy.data.objects)))
    shell_objects.sort(key=lambda record: record["name"])
    opening_objects = [verify_object(bpy.data.objects.get(record["name"]), record) for record in opening_plan["objects"]]
    profile_objects = [verify_object(bpy.data.objects.get(record["name"]), record) for record in profile_plan["objects"]]
    architecture_objects = sorted([*shell_objects, *opening_objects, *profile_objects], key=lambda record: record["name"])
    expected_names = {record["name"] for record in [*architecture_objects, *component_plan["objects"]]}
    if set(bpy.data.objects.keys()) != expected_names or len(bpy.data.materials) != 0 or len(bpy.data.cameras) != 0 or len(bpy.data.lights) != 0:
        fail("room_opening_inventory_invalid")
    apply_material_plan(bpy, material_plan, scene_specification["room"])
    material_report = verify_material_plan(bpy, material_plan, scene_specification["room"], components_included)
    component_objects = [
        verify_component_object(bpy.data.objects.get(record["name"]), record, allow_materials=True)
        for record in component_plan["objects"]
    ]
    all_objects = sorted([*architecture_objects, *component_objects], key=lambda record: record["name"])
    return (
        bpy,
        version,
        build_hash,
        binary_sha256,
        shell_objects,
        opening_objects,
        profile_objects,
        component_objects,
        material_report,
        inventory_report(bpy, all_objects),
    )


def load_scene_specification(path, input_kind, expected_raw_sha256, expected_specification_sha256):
    expected = {
        SYNTHETIC_INPUT_KIND: (EXPECTED_SYNTHETIC_SCENE_RAW_SHA256, EXPECTED_SYNTHETIC_SPECIFICATION_SHA256),
        CANDIDATE_ARCHITECTURE_INPUT_KIND: (EXPECTED_CANDIDATE_SCENE_RAW_SHA256, EXPECTED_CANDIDATE_SPECIFICATION_SHA256),
        CANDIDATE_COMPONENT_INPUT_KIND: (EXPECTED_COMPONENT_SCENE_RAW_SHA256, EXPECTED_COMPONENT_SPECIFICATION_SHA256),
    }.get(input_kind)
    if expected is None:
        fail("room_shell_input_kind_invalid")
    if expected_raw_sha256 != expected[0] or expected_specification_sha256 != expected[1]:
        fail("room_shell_expected_hash_invalid")
    raw = path.read_bytes()
    if sha256_bytes(raw) != expected_raw_sha256:
        fail("room_shell_fixture_sha256_mismatch" if input_kind == SYNTHETIC_INPUT_KIND else "approved_candidate_scene_raw_sha256_mismatch")
    try:
        specification = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        fail("room_shell_scene_json_invalid")
    if canonical_sha256(specification) != expected_specification_sha256:
        fail("room_shell_specification_sha256_mismatch")
    return specification


def load_component_construction(path, expected_raw_sha256, expected_sha256):
    if expected_raw_sha256 != EXPECTED_COMPONENT_CONSTRUCTION_RAW_SHA256 \
            or expected_sha256 != EXPECTED_COMPONENT_CONSTRUCTION_SHA256:
        fail("room_component_expected_hash_invalid")
    raw = path.read_bytes()
    if sha256_bytes(raw) != expected_raw_sha256:
        fail("approved_candidate_component_raw_sha256_mismatch")
    try:
        construction = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("room_component_json_invalid")
    if canonical_sha256(construction) != expected_sha256:
        fail("room_component_sha256_mismatch")
    return construction


def inspect_current_blend(report_path, scene_specification, component_construction, specification_sha256, input_kind):
    try:
        import bpy
    except ImportError:
        fail("blender_python_required")
    version, build_hash, binary_sha256 = blender_identity(bpy)
    fixture_only = input_kind == SYNTHETIC_INPUT_KIND
    components_included = input_kind == CANDIDATE_COMPONENT_INPUT_KIND
    plan = build_shell_plan(scene_specification)
    opening_plan = build_opening_plan(scene_specification)
    profile_plan = build_profile_plan(scene_specification, opening_plan)
    material_plan = build_material_plan(scene_specification, opening_plan, profile_plan)
    component_plan = build_component_plan(scene_specification, component_construction) if components_included else {
        "specified": False, "compiled": False, "objects": []
    }
    if components_included:
        material_plan = with_component_materials(material_plan, component_plan, scene_specification)
    expected_names = {record["name"] for record in [*plan["objects"], *opening_plan["objects"], *profile_plan["objects"], *component_plan["objects"]]}
    collection_name = COMPONENT_COLLECTION_NAME if components_included else COLLECTION_NAME
    if set(bpy.data.objects.keys()) != expected_names \
            or len(bpy.data.meshes) != len(expected_names) \
            or len(bpy.data.materials) != material_plan["recipeCount"] \
            or len(bpy.data.images) != 0 \
            or len(bpy.data.cameras) != 0 \
            or len(bpy.data.lights) != 0 \
            or set(child.name for child in bpy.context.scene.collection.children) != {collection_name}:
        fail("room_shell_saved_inventory_invalid")
    collection = bpy.data.collections.get(collection_name)
    if collection is None or set(collection.objects.keys()) != expected_names:
        fail("room_shell_saved_collection_invalid")
    wall_record = next(record for record in plan["objects"] if record["name"] == "shell.walls")
    shell_objects = [
        verify_object(bpy.data.objects.get(record["name"]), record, allow_materials=True)
        for record in plan["objects"]
        if record["name"] != "shell.walls"
    ]
    shell_objects.append(verify_cut_wall(
        bpy.data.objects.get("shell.walls"),
        wall_record,
        opening_plan,
        scene_specification["room"],
        list(bpy.data.objects),
        allow_materials=True,
    ))
    opening_objects = [verify_object(bpy.data.objects.get(record["name"]), record, allow_materials=True) for record in opening_plan["objects"]]
    profile_objects = [verify_object(bpy.data.objects.get(record["name"]), record, allow_materials=True) for record in profile_plan["objects"]]
    material_report = verify_material_plan(bpy, material_plan, scene_specification["room"], components_included)
    component_objects = [
        verify_component_object(bpy.data.objects.get(record["name"]), record, allow_materials=True)
        for record in component_plan["objects"]
    ]
    objects = sorted([*shell_objects, *opening_objects, *profile_objects, *component_objects], key=lambda record: record["name"])
    if bpy.context.scene.get("wmmr_fixture_only") is not fixture_only \
            or bpy.context.scene.get("wmmr_specification_sha256") != specification_sha256:
        fail("room_shell_saved_metadata_invalid")
    if not fixture_only and (
            bpy.context.scene.get("wmmr_approved_candidate_specification") is not True
            or bpy.context.scene.get("wmmr_candidate_architecture_compiled") is not True
            or bpy.context.scene.get("wmmr_components_specified") is not components_included
            or bpy.context.scene.get("wmmr_components_compiled") is not components_included
            or bpy.context.scene.get("wmmr_component_glb_byte_identical") is not False
            or bpy.context.scene.get("wmmr_exterior_compiled") is not False
            or bpy.context.scene.get("wmmr_lighting_compiled") is not False
            or bpy.context.scene.get("wmmr_media_surfaces_compiled") is not False
            or bpy.context.scene.get("wmmr_final_candidate_glb_verified") is not False
            or bpy.context.scene.get("wmmr_publication_ready") is not False):
        fail("room_shell_saved_metadata_invalid")
    report = {
        "schemaVersion": 1,
        "status": "stage3-synthetic-room-profiles-materials-inspection-valid" if fixture_only else "stage3-approved-candidate-components-inspection-valid" if components_included else "stage3-approved-candidate-architecture-inspection-valid",
        "fixtureOnly": fixture_only,
        "specificationSha256": specification_sha256,
        "blender": {"version": version, "buildHash": build_hash, "binarySha256": binary_sha256},
        "profiles": {**profile_plan, "compiled": True, "objects": profile_objects},
        "materials": material_report,
        "inventory": inventory_report(bpy, objects),
    }
    if not fixture_only:
        report.update({
            "approvedCandidateSpecification": True,
            "candidateArchitectureCompiled": True,
            "componentsSpecified": components_included,
            "componentsCompiled": components_included,
            "componentGlbByteIdentical": False,
            "exteriorCompiled": False,
            "lightingCompiled": False,
            "mediaSurfacesCompiled": False,
            "finalCandidateGlbVerified": False,
            "publicationReady": False,
        })
        if components_included:
            report["components"] = {**component_plan, "compiled": True, "objects": component_objects}
            report["sceneBinaryAddedToRepository"] = False
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
    parser.add_argument("--input-kind", choices=(SYNTHETIC_INPUT_KIND, CANDIDATE_ARCHITECTURE_INPUT_KIND, CANDIDATE_COMPONENT_INPUT_KIND), required=True)
    parser.add_argument("--scene-spec")
    parser.add_argument("--expected-raw-sha256", required=True)
    parser.add_argument("--expected-specification-sha256", required=True)
    parser.add_argument("--component-constructions")
    parser.add_argument("--expected-component-raw-sha256")
    parser.add_argument("--expected-component-sha256")
    parser.add_argument("--report", required=True)
    parser.add_argument("--output-blend")
    parser.add_argument("--output-glb")
    parser.add_argument("--plan-only", action="store_true")
    parser.add_argument("--inspect-only", action="store_true")
    return parser.parse_args(argv)


def main(argv=None):
    args = parse_args(argv if argv is not None else sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else sys.argv[1:])
    report_path = outside_repository(Path(args.report), "room_shell_report")
    if report_path.exists():
        fail("room_shell_report_exists")
    if args.scene_spec is None:
        fail("room_shell_scene_missing")
    scene_path = Path(args.scene_spec).resolve(strict=True)
    scene = load_scene_specification(
        scene_path,
        args.input_kind,
        args.expected_raw_sha256,
        args.expected_specification_sha256,
    )
    components_included = args.input_kind == CANDIDATE_COMPONENT_INPUT_KIND
    component_arguments = (
        args.component_constructions,
        args.expected_component_raw_sha256,
        args.expected_component_sha256,
    )
    if components_included:
        if any(value is None for value in component_arguments):
            fail("room_component_arguments_missing")
        component_construction = load_component_construction(
            Path(args.component_constructions).resolve(strict=True),
            args.expected_component_raw_sha256,
            args.expected_component_sha256,
        )
    else:
        if any(value is not None for value in component_arguments):
            fail("room_component_arguments_invalid")
        component_construction = None

    if args.inspect_only:
        if args.output_blend is not None or args.output_glb is not None or args.plan_only:
            fail("room_shell_inspection_arguments_invalid")
        inspect_current_blend(report_path, scene, component_construction, args.expected_specification_sha256, args.input_kind)
        return
    plan = build_shell_plan(scene)
    if components_included:
        plan["collectionName"] = COMPONENT_COLLECTION_NAME
    opening_plan = build_opening_plan(scene)
    profile_plan = build_profile_plan(scene, opening_plan)
    material_plan = build_material_plan(scene, opening_plan, profile_plan)
    component_plan = build_component_plan(scene, component_construction) if components_included else {
        "specified": False,
        "compiled": False,
        "objects": [],
    }
    if components_included:
        material_plan = with_component_materials(material_plan, component_plan, scene)

    fixture_only = args.input_kind == SYNTHETIC_INPUT_KIND
    boundaries = {
        "approvedCandidateSpecification": False,
        "byteIdenticalExportsVerified": False,
        "componentsCompiled": False,
        "materialsCompiled": False,
        "openingsCompiled": False,
        "profilesCompiled": False,
        "sceneBinaryAddedToRepository": False,
    } if fixture_only else {
        "approvedCandidateSpecification": True,
        "byteIdenticalExportsVerified": False,
        "candidateArchitectureCompiled": False,
        "componentsCompiled": False,
        "finalCandidateGlbVerified": False,
        "materialsCompiled": False,
        "openingsCompiled": False,
        "profilesCompiled": False,
        "publicationReady": False,
        "sceneBinaryAddedToRepository": False,
    }
    if components_included:
        boundaries = {
            "approvedCandidateSpecification": True,
            "candidateArchitectureCompiled": False,
            "componentsSpecified": True,
            "componentsCompiled": False,
            "componentGlbByteIdentical": False,
            "exteriorCompiled": False,
            "lightingCompiled": False,
            "mediaSurfacesCompiled": False,
            "finalCandidateGlbVerified": False,
            "materialsCompiled": False,
            "openingsCompiled": False,
            "profilesCompiled": False,
            "publicationReady": False,
            "sceneBinaryAddedToRepository": False,
        }
    base_report = {
        "schemaVersion": 1,
        "fixtureOnly": fixture_only,
        "sceneId": scene.get("sceneId"),
        "specificationSha256": args.expected_specification_sha256,
        "shell": plan,
        "openings": {**opening_plan, "compiled": False, "cutObjectsPersisted": False},
        "profiles": {**profile_plan, "compiled": False},
        "materials": {**material_plan, "compiled": False},
        "boundaries": boundaries,
    }
    if not fixture_only:
        base_report.update({
            "approvedCandidateSpecification": True,
            "candidateArchitectureCompiled": False,
            "componentsSpecified": components_included,
            "componentsCompiled": False,
            "componentGlbByteIdentical": False,
            "exteriorCompiled": False,
            "lightingCompiled": False,
            "mediaSurfacesCompiled": False,
            "finalCandidateGlbVerified": False,
            "publicationReady": False,
        })
        if components_included:
            base_report["components"] = component_plan
            base_report["sceneBinaryAddedToRepository"] = False

    if args.plan_only:
        if args.output_blend is not None or args.output_glb is not None:
            fail("room_shell_plan_only_arguments_invalid")
        report = {
            **base_report,
            "status": "stage3-synthetic-room-profiles-materials-plan-valid" if fixture_only else "stage3-approved-candidate-components-plan-valid" if components_included else "stage3-approved-candidate-architecture-plan-valid",
            "execution": "plan-only",
            "blender": None,
            "outputBlend": None,
        }
        write_report(report_path, report)
        print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))
        return

    if args.output_blend is None or args.output_glb is None:
        fail("room_shell_blender_arguments_missing")
    output_path = outside_repository(Path(args.output_blend), "room_shell_output")
    glb_path = outside_repository(Path(args.output_glb), "room_glb_output")
    if output_path.suffix != ".blend" or output_path.exists():
        fail("room_shell_output_invalid")
    if glb_path.suffix != ".glb" or glb_path.exists() or glb_path == output_path:
        fail("room_glb_output_invalid")
    (
        bpy,
        version,
        build_hash,
        binary_sha256,
        shell_objects,
        opening_objects,
        profile_objects,
        component_objects,
        material_report,
        inventory,
    ) = apply_plan(
        plan,
        opening_plan,
        profile_plan,
        component_plan,
        material_plan,
        scene,
        args.expected_specification_sha256,
        args.input_kind,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path), check_existing=False, compress=False, relative_remap=False)
    output_bytes = output_path.read_bytes()
    bpy.ops.export_scene.gltf(
        filepath=str(glb_path),
        export_format="GLB",
        export_attributes=True,
        export_cameras=False,
        export_extras=True,
        export_lights=False,
        export_yup=True,
    )
    glb_bytes = glb_path.read_bytes()
    report = {
        **base_report,
        "status": "stage3-synthetic-room-profiles-materials-compiled" if fixture_only else "stage3-approved-candidate-components-compiled" if components_included else "stage3-approved-candidate-architecture-compiled",
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
        "outputGlb": {
            "byteLength": len(glb_bytes),
            "sha256": sha256_bytes(glb_bytes),
            "exportSettings": {
                "exportAttributes": True,
                "exportCameras": False,
                "exportExtras": True,
                "exportFormat": "GLB",
                "exportLights": False,
                "exportYup": True,
            },
        },
    }
    report["boundaries"] = {
        **boundaries,
        "candidateArchitectureCompiled": True,
        "materialsCompiled": True,
        "openingsCompiled": True,
        "profilesCompiled": True,
    } if not fixture_only else {**boundaries, "materialsCompiled": True, "openingsCompiled": True, "profilesCompiled": True}
    if not fixture_only:
        report["candidateArchitectureCompiled"] = True
        if components_included:
            report.update({
                "componentsSpecified": True,
                "componentsCompiled": True,
                "componentGlbByteIdentical": False,
                "exteriorCompiled": False,
                "lightingCompiled": False,
                "mediaSurfacesCompiled": False,
                "finalCandidateGlbVerified": False,
                "publicationReady": False,
            })
            report["boundaries"].update({
                "componentsSpecified": True,
                "componentsCompiled": True,
                "componentGlbByteIdentical": False,
                "exteriorCompiled": False,
                "lightingCompiled": False,
                "mediaSurfacesCompiled": False,
                "finalCandidateGlbVerified": False,
                "publicationReady": False,
                "sceneBinaryAddedToRepository": False,
            })
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
    report["profiles"] = {**profile_plan, "compiled": True, "objects": profile_objects}
    if components_included:
        report["components"] = {**component_plan, "compiled": True, "objects": component_objects}
    report["materials"] = material_report
    report["inventory"] = inventory
    write_report(report_path, report)
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1) from error
