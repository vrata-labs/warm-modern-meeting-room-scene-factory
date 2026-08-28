#!/usr/bin/env python3

import argparse
import binascii
import hashlib
import json
import math
import struct
import sys
import zlib
from pathlib import Path


EXPECTED_BLENDER_VERSION = "4.5.12 LTS"
EXPECTED_BLENDER_BUILD_HASH = "84afd5f785f7"
EXPECTED_BLENDER_BINARY_SHA256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880"
SYNTHETIC_INPUT_KIND = "synthetic-fixture"
CANDIDATE_ARCHITECTURE_INPUT_KIND = "approved-candidate-architecture"
CANDIDATE_COMPONENT_INPUT_KIND = "approved-candidate-components"
CANDIDATE_EXTERIOR_INPUT_KIND = "approved-candidate-exterior"
CANDIDATE_LIGHTING_INPUT_KIND = "approved-candidate-lighting"
EXPECTED_SYNTHETIC_SPECIFICATION_SHA256 = "7835eb45004e91f29daf6ee6e6c4b7cb34ad081f4a90f234f38732f4daf92a91"
EXPECTED_SYNTHETIC_SCENE_RAW_SHA256 = "faef3aebe7278f72bf272411abdb0080792b4459ad7ca0097cca36e59498b748"
EXPECTED_CANDIDATE_SPECIFICATION_SHA256 = "29d76ca0feaefd4bf9cac9ebd25113c601e358c939778c4a0f43f3f94b58e0dd"
EXPECTED_CANDIDATE_SCENE_RAW_SHA256 = "875619d8513467417bbc89d50cd11b07fc363e8c4fbaeb8161394c8f2e885b76"
EXPECTED_COMPONENT_SPECIFICATION_SHA256 = "10106915ffabfdd4580b3866c3714f05f22bec9ce430a7bc62c7c4d2e1578644"
EXPECTED_COMPONENT_SCENE_RAW_SHA256 = "0afe14089767436df4f3d286ccacd4a1fcc46772dab071266034550bf94fcf8e"
EXPECTED_COMPONENT_CONSTRUCTION_SHA256 = "a28310aa7806fb05b8b08087a8b13de900498c3a12dbc6c3e0a5cc77ae7a3709"
EXPECTED_COMPONENT_CONSTRUCTION_RAW_SHA256 = "f32327442d015f4c89942bf752e959d6c0abc24613c72f32a8ba4c2b2b29d5d1"
EXPECTED_EXTERIOR_SPECIFICATION_SHA256 = "d26cad260909d50082c07b13a86dd3ea8af4b6b32b591b825957dd26c9b53b12"
EXPECTED_EXTERIOR_SCENE_RAW_SHA256 = "7f6822b6298b1e2fb606cfd4db310663b7cbab74989245c61bff3f25b1f0c8b6"
EXPECTED_EXTERIOR_CONSTRUCTION_SHA256 = "5a02dc468db992bb7b12aa783b485408e4dde29ac4c29e09753c86c9c226a330"
EXPECTED_EXTERIOR_CONSTRUCTION_RAW_SHA256 = "54a9e7b3b20c94844380c524443005006225eccbe22b4a57f4df50782e859639"
EXPECTED_LIGHTING_SPECIFICATION_SHA256 = "7867defa7627115c756ceda215e4a176473f13ec841a7b10b90e7dd17159aad2"
EXPECTED_LIGHTING_SCENE_RAW_SHA256 = "6cb67a644e251e3a0c9e0372c5b2ca1b93593cbab5ca11aad8712e9f94289a8a"
EXPECTED_LIGHTING_CONSTRUCTION_SHA256 = "a7debec463c57f30a7016addff5fb722dd301dc9d810275920c64df78a8277d7"
EXPECTED_LIGHTING_CONSTRUCTION_RAW_SHA256 = "ecb7c8da21191c2a9f893c0975de3bf2b8187cf6cd8a711bb3bb2b71f3610cad"
COLLECTION_NAME = "WMMR_ARCHITECTURE"
COMPONENT_COLLECTION_NAME = "WMMR_APPROVED_CANDIDATE_COMPONENTS"
EXTERIOR_COLLECTION_NAME = "WMMR_APPROVED_CANDIDATE_EXTERIOR"
LIGHTING_COLLECTION_NAME = "WMMR_APPROVED_CANDIDATE_LIGHTING"
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


def build_exterior_plan(construction):
    materials = {material["id"]: material for material in construction["materials"]}
    objects = []
    for source in construction["objects"]:
        if source["geometry"] != "beveled-box" or source["transform"]["yaw"] != 0:
            fail(f"room_exterior_object_geometry_invalid:{source['id']}")
        bevel = source["bevel"]
        if bevel["segments"] != 3 or bevel["clampOverlap"] is not True:
            fail(f"room_exterior_bevel_invalid:{source['id']}")
        material = materials.get(source["materialId"])
        if material is None:
            fail(f"room_exterior_material_missing:{source['id']}")
        position = source["transform"]["position"]
        dimensions = source["dimensions"]
        record = box(
            f"exterior.{source['id']}",
            dimensions["widthM"],
            dimensions["heightM"],
            dimensions["depthM"],
            position["x"],
            position["y"],
            position["z"],
        )
        record.update({
            "geometry": "beveled-box",
            "objectId": source["id"],
            "role": source["role"],
            "worldYaw": 0.0,
            "bevel": {
                "widthM": rounded(bevel["widthM"]),
                "segments": bevel["segments"],
                "clampOverlap": bevel["clampOverlap"],
            },
            "materialId": source["materialId"],
            "materialRecipeId": source["materialId"],
            "supportObjectId": source["supportObjectId"],
            "vertexCount": 96,
            "edgeCount": 192,
            "faceCount": 98,
        })
        objects.append(record)
    objects.sort(key=lambda value: value["name"])
    names = [record["name"] for record in objects]
    used_materials = {record["materialId"] for record in objects}
    if len(objects) != 4 or len(set(names)) != 4 or len(materials) != 3 or used_materials != set(materials):
        fail("room_exterior_inventory_invalid")
    return {
        "specified": True,
        "compiled": False,
        "strategy": construction["strategy"],
        "windowOpeningId": construction["windowOpeningId"],
        "sourceRecordId": construction["sourceRecordId"],
        "objectNamePattern": "exterior.<objectId>",
        "objectCount": len(objects),
        "materialCount": len(materials),
        "boundsM": construction["boundsM"],
        "objects": objects,
    }


def with_exterior_materials(component_material_plan, exterior_plan, construction):
    exterior_recipes = [{
        **material,
        "sourceRecordId": construction["sourceRecordId"],
    } for material in construction["materials"]]
    recipes = {recipe["id"]: recipe for recipe in [*component_material_plan["recipes"], *exterior_recipes]}
    exterior_assignments = [{
        "objectName": record["name"],
        "zones": [{
            "id": f"exterior-zone:{record['name']}",
            "surface": f"exterior:{record['role']}",
            "recipeId": record["materialRecipeId"],
        }],
    } for record in exterior_plan["objects"]]
    assignments = sorted([*component_material_plan["assignments"], *exterior_assignments], key=lambda value: value["objectName"])
    used_recipe_ids = sorted({zone["recipeId"] for assignment in assignments for zone in assignment["zones"]})
    if len(used_recipe_ids) != 8 or len(assignments) != 61:
        fail("room_exterior_material_inventory_invalid")
    return {
        **component_material_plan,
        "recipeCount": len(used_recipe_ids),
        "zoneCount": sum(len(assignment["zones"]) for assignment in assignments),
        "assignmentCount": len(assignments),
        "exteriorAssignmentCount": len(exterior_assignments),
        "exteriorMaterialCount": len(exterior_recipes),
        "recipes": [recipes[identifier] for identifier in used_recipe_ids],
        "assignments": assignments,
    }


def scene_to_blender_point(value):
    return {
        "x": rounded(value["x"]),
        "y": rounded(value["z"]),
        "z": rounded(value["y"]),
    }


def srgb_encoded_to_linear(channel):
    value = channel / 255.0
    return value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4


def tanner_helland_color(temperature_kelvin):
    temperature = min(40000.0, max(1000.0, float(temperature_kelvin))) / 100.0
    if temperature <= 66.0:
        red = 255.0
        green = 99.4708025861 * math.log(temperature) - 161.1195681661
        blue = 0.0 if temperature <= 19.0 else 138.5177312231 * math.log(temperature - 10.0) - 305.0447927307
    else:
        red = 329.698727446 * ((temperature - 60.0) ** -0.1332047592)
        green = 288.1221695283 * ((temperature - 60.0) ** -0.0755148492)
        blue = 255.0
    encoded = [min(255.0, max(0.0, value)) for value in (red, green, blue)]
    linear = [srgb_encoded_to_linear(value) for value in encoded]
    return {
        "encodedSrgb": [rounded(value) for value in encoded],
        "linearSrgb": [rounded(value) for value in linear],
    }


def build_lighting_plan(scene, construction):
    scene_lights = {light["id"]: light for light in scene["lighting"]}
    lights = []
    for implementation in construction["lights"]:
        identifier = implementation["sceneLightId"]
        source = scene_lights.get(identifier)
        if source is None:
            fail(f"room_lighting_scene_light_missing:{identifier}")
        emitter = implementation["emitter"]
        directional = emitter["type"] == "directional"
        if emitter["type"] not in ("directional", "spot"):
            fail(f"room_lighting_emitter_invalid:{identifier}")
        energy = source["intensityLumens"] / emitter["intensityMapping"]["divisor"]
        color = tanner_helland_color(source["temperatureK"])
        record = {
            "name": f"light.{identifier}",
            "sceneLightId": identifier,
            "sceneKind": source["kind"],
            "blenderType": "SUN" if directional else "SPOT",
            "scenePositionM": {key: rounded(value) for key, value in source["position"].items()},
            "blenderLocationM": scene_to_blender_point(source["position"]),
            "sceneTargetM": {key: rounded(value) for key, value in emitter["target"].items()},
            "blenderTargetM": scene_to_blender_point(emitter["target"]),
            "rollRadians": rounded(emitter["rollRadians"]),
            "temperatureK": source["temperatureK"],
            "intensityLumens": source["intensityLumens"],
            "energy": rounded(energy),
            "energyUnit": emitter["intensityMapping"]["outputUnit"],
            "encodedColorSrgb": color["encodedSrgb"],
            "linearColor": color["linearSrgb"],
            "exposure": 0.0,
            "normalize": True,
            "useNodes": False,
            "useTemperature": False,
            "useShadow": emitter["castShadow"],
        }
        if directional:
            record["angleRadians"] = rounded(emitter["angularDiameterDegrees"] * math.pi / 180.0)
        else:
            record.update({
                "rangeM": rounded(emitter["rangeM"]),
                "useCustomDistance": True,
                "cutoffDistanceM": rounded(emitter["rangeM"]),
                "innerConeHalfAngleRadians": rounded(emitter["innerConeHalfAngleRadians"]),
                "outerConeHalfAngleRadians": rounded(emitter["outerConeHalfAngleRadians"]),
                "spotSizeRadians": rounded(2.0 * emitter["outerConeHalfAngleRadians"]),
                "spotBlend": rounded(1.0 - emitter["innerConeHalfAngleRadians"] / emitter["outerConeHalfAngleRadians"]),
                "shadowSoftSizeM": rounded(emitter["radiusM"]),
            })
        lights.append(record)
    if len(lights) != 3 or len({light["name"] for light in lights}) != 3:
        fail("room_lighting_inventory_invalid")
    return {
        "specified": True,
        "compiled": False,
        "sourceRecordId": construction["sourceRecordId"],
        "objectNamePattern": "light.<sceneLightId>",
        "lightCount": len(lights),
        "lights": lights,
    }


def build_first_view_plan(scene, construction):
    acceptance = construction["firstViewAcceptance"]
    review = next((value for value in scene["reviewViews"] if value["id"] == acceptance["reviewViewId"]), None)
    if review is None:
        fail("room_first_view_review_missing")
    capture = acceptance["capture"]
    return {
        "specified": True,
        "rendered": False,
        "acceptanceVerified": False,
        "reviewViewId": review["id"],
        "camera": {
            "name": f"camera.review.{review['id']}",
            "projection": "perspective",
            "fovAxis": "vertical",
            "verticalFovDegrees": rounded(review["fovDegrees"]),
            "verticalFovRadians": rounded(review["fovDegrees"] * math.pi / 180.0),
            "scenePositionM": {key: rounded(value) for key, value in review["position"].items()},
            "blenderLocationM": scene_to_blender_point(review["position"]),
            "sceneTargetM": {key: rounded(value) for key, value in review["target"].items()},
            "blenderTargetM": scene_to_blender_point(review["target"]),
            "rollRadians": 0.0,
        },
        "capture": {
            **capture,
            "deterministic": {
                "frame": 1,
                "threadsMode": "FIXED",
                "threads": 1,
                "featureSet": "SUPPORTED",
                "animatedSeed": False,
                "guiding": False,
                "samplingPattern": "AUTOMATIC",
                "sampleSubset": False,
                "sampleOffset": 0,
                "persistentData": False,
                "border": False,
                "cropToBorder": False,
                "ditherIntensity": 0.0,
                "pngCompression": 15,
                "curveMapping": False,
                "whiteBalance": False,
                "stampFlags": False,
                "renderFilepathAfterCapture": "//first-view.png",
            },
        },
        "measurement": acceptance["measurement"],
        "criteria": acceptance["criteria"],
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


def verify_exterior_object(value, expected, allow_materials=False):
    if value is None or value.type != "MESH":
        fail(f"room_exterior_object_missing:{expected['name']}")
    actual_dimensions = {
        "widthM": float(value.dimensions.x),
        "heightM": float(value.dimensions.z),
        "depthM": float(value.dimensions.y),
    }
    actual_center = {"x": float(value.location.x), "y": float(value.location.z), "z": float(value.location.y)}
    expected_materials = [f"material.{expected['materialRecipeId']}"] if allow_materials else []
    support = value.get("wmmr_support_object_id") or None
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
            or value.get("wmmr_exterior_object_id") != expected["objectId"] \
            or value.get("wmmr_exterior_role") != expected["role"] \
            or value.get("wmmr_exterior_material_id") != expected["materialId"] \
            or support != expected["supportObjectId"]:
        fail(f"room_exterior_object_invalid:{expected['name']}")
    half_extents = (
        expected["dimensionsM"]["widthM"] / 2,
        expected["dimensionsM"]["depthM"] / 2,
        expected["dimensionsM"]["heightM"] / 2,
    )
    local_bounds = [
        (min(vertex.co[axis] for vertex in value.data.vertices), max(vertex.co[axis] for vertex in value.data.vertices))
        for axis in range(3)
    ]
    if any(abs(minimum + half_extents[axis]) > 1e-6 or abs(maximum - half_extents[axis]) > 1e-6
           for axis, (minimum, maximum) in enumerate(local_bounds)):
        fail(f"room_exterior_bounds_invalid:{expected['name']}")
    bevel_width = expected["bevel"]["widthM"]
    inset_axes = sum(
        any(abs(abs(vertex.co[axis]) - (half_extents[axis] - bevel_width)) <= 1e-5 for vertex in value.data.vertices)
        for axis in range(3)
    )
    if inset_axes != 3 or any(polygon.area <= 1e-12 for polygon in value.data.polygons):
        fail(f"room_exterior_bevel_topology_invalid:{expected['name']}")
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
        "parentName": value.parent.name if value.parent is not None else None,
        "topologySha256": component_mesh_digest(value),
    }


def create_exterior_object(bpy, record, collection, fixture_only):
    value = create_mesh_object(bpy, record, collection, fixture_only)
    value["wmmr_bevel_applied"] = False
    value["wmmr_bevel_width_m"] = record["bevel"]["widthM"]
    value["wmmr_bevel_segments"] = record["bevel"]["segments"]
    value["wmmr_bevel_clamp_overlap"] = record["bevel"]["clampOverlap"]
    value["wmmr_exterior_object_id"] = record["objectId"]
    value["wmmr_exterior_role"] = record["role"]
    value["wmmr_exterior_material_id"] = record["materialId"]
    value["wmmr_support_object_id"] = record["supportObjectId"] or ""
    modifier = value.modifiers.new(name="approved-exterior-bevel", type="BEVEL")
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
    verify_exterior_object(value, record)
    return value


def target_quaternion(source, target, roll_radians):
    from mathutils import Quaternion, Vector

    direction = Vector((target["x"], target["y"], target["z"])) - Vector((source["x"], source["y"], source["z"]))
    if direction.length <= 1e-9:
        fail("room_oriented_object_target_invalid")
    rotation = direction.normalized().to_track_quat("-Z", "Y")
    if abs(roll_radians) > 0:
        rotation = rotation @ Quaternion((0.0, 0.0, -1.0), roll_radians)
    return rotation.normalized()


def light_extras(record):
    return {
        "wmmr_cast_shadow": record["useShadow"],
        "wmmr_intensity_lumens": record["intensityLumens"],
        "wmmr_light_kind": record["sceneKind"],
        "wmmr_roll_radians": record["rollRadians"],
        "wmmr_scene_light_id": record["sceneLightId"],
        "wmmr_target_x": record["sceneTargetM"]["x"],
        "wmmr_target_y": record["sceneTargetM"]["y"],
        "wmmr_target_z": record["sceneTargetM"]["z"],
        "wmmr_temperature_kelvin": record["temperatureK"],
    }


def create_lights_and_camera(bpy, lighting_plan, first_view_plan, collection):
    for record in lighting_plan["lights"]:
        data = bpy.data.lights.new(record["name"], record["blenderType"])
        data.energy = record["energy"]
        data.exposure = 0.0
        data.normalize = True
        data.use_nodes = False
        data.use_temperature = False
        data.use_shadow = record["useShadow"]
        data.color = tuple(record["linearColor"])
        if record["blenderType"] == "SUN":
            data.angle = record["angleRadians"]
        else:
            data.use_custom_distance = True
            data.cutoff_distance = record["cutoffDistanceM"]
            data.spot_size = record["spotSizeRadians"]
            data.spot_blend = record["spotBlend"]
            data.shadow_soft_size = record["shadowSoftSizeM"]
        value = bpy.data.objects.new(record["name"], data)
        location = record["blenderLocationM"]
        value.location = (location["x"], location["y"], location["z"])
        value.rotation_mode = "QUATERNION"
        value.rotation_quaternion = target_quaternion(location, record["blenderTargetM"], record["rollRadians"])
        for key, expected in light_extras(record).items():
            value[key] = expected
        collection.objects.link(value)

    camera_plan = first_view_plan["camera"]
    camera_data = bpy.data.cameras.new(camera_plan["name"])
    camera_data.type = "PERSP"
    camera_data.sensor_fit = "VERTICAL"
    camera_data.angle_y = camera_plan["verticalFovRadians"]
    camera = bpy.data.objects.new(camera_plan["name"], camera_data)
    location = camera_plan["blenderLocationM"]
    camera.location = (location["x"], location["y"], location["z"])
    camera.rotation_mode = "QUATERNION"
    camera.rotation_quaternion = target_quaternion(location, camera_plan["blenderTargetM"], camera_plan["rollRadians"])
    camera["wmmr_review_view_id"] = first_view_plan["reviewViewId"]
    collection.objects.link(camera)
    bpy.context.scene.camera = camera


def quaternion_report(value):
    return {
        "w": rounded(value.w),
        "x": rounded(value.x),
        "y": rounded(value.y),
        "z": rounded(value.z),
    }


def verify_lights_and_camera(bpy, lighting_plan, first_view_plan):
    reports = []
    expected_names = {record["name"] for record in lighting_plan["lights"]}
    if set(bpy.data.lights.keys()) != expected_names:
        fail("room_lighting_saved_inventory_invalid")
    for record in lighting_plan["lights"]:
        value = bpy.data.objects.get(record["name"])
        data = bpy.data.lights.get(record["name"])
        expected_rotation = target_quaternion(record["blenderLocationM"], record["blenderTargetM"], record["rollRadians"])
        actual_extras = {key: value.get(key) for key in light_extras(record)} if value is not None else {}
        common_invalid = value is None or value.type != "LIGHT" or value.data != data or value.parent is not None \
            or value.rotation_mode != "QUATERNION" \
            or any(abs(float(value.location[index]) - record["blenderLocationM"][axis]) > 1e-6 for index, axis in enumerate(("x", "y", "z"))) \
            or abs(value.rotation_quaternion.rotation_difference(expected_rotation).angle) > 1e-6 \
            or actual_extras != light_extras(record) \
            or data is None or data.type != record["blenderType"] \
            or abs(data.energy - record["energy"]) > 1e-6 \
            or abs(data.exposure) > 1e-9 \
            or data.normalize is not True or data.use_nodes is not False \
            or data.use_temperature is not False or data.use_shadow is not record["useShadow"] \
            or any(abs(actual - expected) > 1e-6 for actual, expected in zip(data.color, record["linearColor"]))
        if common_invalid:
            fail(f"room_light_invalid:{record['name']}")
        if record["blenderType"] == "SUN":
            if abs(data.angle - record["angleRadians"]) > 1e-6:
                fail(f"room_light_invalid:{record['name']}")
        elif data.use_custom_distance is not True \
                or abs(data.cutoff_distance - record["cutoffDistanceM"]) > 1e-6 \
                or abs(data.spot_size - record["spotSizeRadians"]) > 1e-6 \
                or abs(data.spot_blend - record["spotBlend"]) > 1e-6 \
                or abs(data.shadow_soft_size - record["shadowSoftSizeM"]) > 1e-6:
            fail(f"room_light_invalid:{record['name']}")
        report = {
            **record,
            "energy": rounded(data.energy),
            "linearColor": [rounded(channel) for channel in data.color],
            "rotationQuaternion": quaternion_report(value.rotation_quaternion),
            "extras": actual_extras,
        }
        if record["blenderType"] == "SUN":
            report["angleRadians"] = rounded(data.angle)
        else:
            report.update({
                "cutoffDistanceM": rounded(data.cutoff_distance),
                "spotSizeRadians": rounded(data.spot_size),
                "spotBlend": rounded(data.spot_blend),
                "shadowSoftSizeM": rounded(data.shadow_soft_size),
                "cyclesCutoffDistanceAffectsRender": False,
                "glbRangeValidatedSeparately": True,
            })
        reports.append(report)

    camera_plan = first_view_plan["camera"]
    camera = bpy.data.objects.get(camera_plan["name"])
    data = bpy.data.cameras.get(camera_plan["name"])
    expected_rotation = target_quaternion(camera_plan["blenderLocationM"], camera_plan["blenderTargetM"], camera_plan["rollRadians"])
    if len(bpy.data.cameras) != 1 or camera is None or camera.type != "CAMERA" or camera.data != data or camera.parent is not None \
            or camera.rotation_mode != "QUATERNION" \
            or bpy.context.scene.camera != camera or data.type != "PERSP" or data.sensor_fit != "VERTICAL" \
            or abs(data.angle_y - camera_plan["verticalFovRadians"]) > 1e-6 \
            or any(abs(float(camera.location[index]) - camera_plan["blenderLocationM"][axis]) > 1e-6 for index, axis in enumerate(("x", "y", "z"))) \
            or abs(camera.rotation_quaternion.rotation_difference(expected_rotation).angle) > 1e-6 \
            or camera.get("wmmr_review_view_id") != first_view_plan["reviewViewId"]:
        fail("room_first_view_camera_invalid")
    return {
        "lighting": {**lighting_plan, "compiled": True, "lights": reports},
        "camera": {
            **camera_plan,
            "verticalFovRadians": rounded(data.angle_y),
            "lensMm": rounded(data.lens),
            "rotationQuaternion": quaternion_report(camera.rotation_quaternion),
        },
    }


STAMP_FLAGS = (
    "use_stamp", "use_stamp_camera", "use_stamp_date", "use_stamp_filename", "use_stamp_frame",
    "use_stamp_frame_range", "use_stamp_hostname", "use_stamp_labels", "use_stamp_lens", "use_stamp_marker",
    "use_stamp_memory", "use_stamp_note", "use_stamp_render_time", "use_stamp_scene", "use_stamp_sequencer_strip",
    "use_stamp_time",
)


def configure_first_view_render(bpy, first_view_plan, output_path):
    scene = bpy.context.scene
    capture = first_view_plan["capture"]
    render = scene.render
    cycles = scene.cycles
    scene.frame_set(1)
    render.engine = "CYCLES"
    cycles.device = "CPU"
    cycles.feature_set = "SUPPORTED"
    cycles.samples = capture["samples"]
    cycles.seed = capture["seed"]
    cycles.use_adaptive_sampling = False
    cycles.use_denoising = False
    cycles.use_animated_seed = False
    cycles.use_guiding = False
    cycles.sampling_pattern = "AUTOMATIC"
    cycles.use_sample_subset = False
    cycles.sample_offset = 0
    render.threads_mode = "FIXED"
    render.threads = 1
    render.resolution_x = capture["resolution"]["widthPx"]
    render.resolution_y = capture["resolution"]["heightPx"]
    render.resolution_percentage = 100
    render.pixel_aspect_x = capture["resolution"]["pixelAspectRatio"]
    render.pixel_aspect_y = capture["resolution"]["pixelAspectRatio"]
    render.film_transparent = False
    render.use_persistent_data = False
    render.use_border = False
    render.use_crop_to_border = False
    render.use_sequencer = False
    render.dither_intensity = 0.0
    render.filepath = str(output_path)
    render.use_file_extension = True
    render.image_settings.file_format = "PNG"
    render.image_settings.color_mode = "RGB"
    render.image_settings.color_depth = "8"
    render.image_settings.compression = 15
    scene.display_settings.display_device = "sRGB"
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.view_settings.gamma = 1.0
    scene.view_settings.use_curve_mapping = False
    scene.view_settings.use_white_balance = False
    for attribute in STAMP_FLAGS:
        setattr(render, attribute, False)
    world = bpy.data.worlds.get("world.first-view.black") or bpy.data.worlds.new("world.first-view.black")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    if background is None:
        fail("room_first_view_world_invalid")
    background.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    background.inputs["Strength"].default_value = 0.0
    scene.world = world


def render_settings_report(bpy):
    scene = bpy.context.scene
    render = scene.render
    cycles = scene.cycles
    world = scene.world
    background = world.node_tree.nodes.get("Background") if world is not None and world.use_nodes else None
    report = {
        "frame": scene.frame_current,
        "engine": render.engine,
        "device": cycles.device,
        "featureSet": cycles.feature_set,
        "samples": cycles.samples,
        "seed": cycles.seed,
        "adaptiveSampling": cycles.use_adaptive_sampling,
        "denoising": cycles.use_denoising,
        "animatedSeed": cycles.use_animated_seed,
        "guiding": cycles.use_guiding,
        "samplingPattern": cycles.sampling_pattern,
        "sampleSubset": cycles.use_sample_subset,
        "sampleOffset": cycles.sample_offset,
        "threadsMode": render.threads_mode,
        "threads": render.threads,
        "resolution": {
            "widthPx": render.resolution_x,
            "heightPx": render.resolution_y,
            "percentage": render.resolution_percentage,
            "pixelAspectX": rounded(render.pixel_aspect_x),
            "pixelAspectY": rounded(render.pixel_aspect_y),
        },
        "transparentBackground": render.film_transparent,
        "persistentData": render.use_persistent_data,
        "border": render.use_border,
        "cropToBorder": render.use_crop_to_border,
        "sequencer": render.use_sequencer,
        "ditherIntensity": rounded(render.dither_intensity),
        "output": {
            "format": render.image_settings.file_format,
            "colorMode": render.image_settings.color_mode,
            "colorDepthBits": int(render.image_settings.color_depth),
            "pngCompression": render.image_settings.compression,
            "filepath": render.filepath,
        },
        "colorManagement": {
            "displayDevice": scene.display_settings.display_device,
            "viewTransform": scene.view_settings.view_transform,
            "look": scene.view_settings.look,
            "exposure": rounded(scene.view_settings.exposure),
            "gamma": rounded(scene.view_settings.gamma),
            "curveMapping": scene.view_settings.use_curve_mapping,
            "whiteBalance": scene.view_settings.use_white_balance,
        },
        "world": {
            "name": world.name if world is not None else None,
            "useNodes": world.use_nodes if world is not None else None,
            "colorLinear": [rounded(value) for value in background.inputs["Color"].default_value] if background is not None else None,
            "strength": rounded(background.inputs["Strength"].default_value) if background is not None else None,
        },
        "stampFlags": {attribute: getattr(render, attribute) for attribute in STAMP_FLAGS},
    }
    expected = {
        "frame": 1, "engine": "CYCLES", "device": "CPU", "featureSet": "SUPPORTED", "samples": 64,
        "seed": 42, "adaptiveSampling": False, "denoising": False, "animatedSeed": False, "guiding": False,
        "samplingPattern": "AUTOMATIC", "sampleSubset": False, "sampleOffset": 0, "threadsMode": "FIXED",
        "threads": 1, "transparentBackground": False, "persistentData": False, "border": False,
        "cropToBorder": False, "sequencer": False, "ditherIntensity": 0.0,
    }
    if any(report[key] != value for key, value in expected.items()) \
            or report["resolution"] != {"widthPx": 960, "heightPx": 540, "percentage": 100, "pixelAspectX": 1.0, "pixelAspectY": 1.0} \
            or report["output"] != {"format": "PNG", "colorMode": "RGB", "colorDepthBits": 8, "pngCompression": 15, "filepath": "//first-view.png"} \
            or report["colorManagement"] != {"displayDevice": "sRGB", "viewTransform": "AgX", "look": "AgX - Medium High Contrast", "exposure": 0.0, "gamma": 1.0, "curveMapping": False, "whiteBalance": False} \
            or report["world"] != {"name": "world.first-view.black", "useNodes": True, "colorLinear": [0.0, 0.0, 0.0, 1.0], "strength": 0.0} \
            or any(report["stampFlags"].values()):
        fail("room_first_view_render_settings_invalid")
    return report


def paeth_predictor(left, above, upper_left):
    prediction = left + above - upper_left
    left_distance = abs(prediction - left)
    above_distance = abs(prediction - above)
    upper_left_distance = abs(prediction - upper_left)
    return left if left_distance <= above_distance and left_distance <= upper_left_distance else above if above_distance <= upper_left_distance else upper_left


def inspect_first_view_png(path, first_view_plan):
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        fail("room_first_view_png_signature_invalid")
    offset = 8
    chunks = []
    idat = []
    while offset < len(raw):
        if offset + 12 > len(raw):
            fail("room_first_view_png_chunk_invalid")
        length = struct.unpack(">I", raw[offset:offset + 4])[0]
        chunk_type = raw[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(raw):
            fail("room_first_view_png_chunk_invalid")
        data = raw[offset + 8:offset + 8 + length]
        expected_crc = struct.unpack(">I", raw[offset + 8 + length:end])[0]
        if binascii.crc32(chunk_type + data) & 0xffffffff != expected_crc:
            fail("room_first_view_png_crc_invalid")
        name = chunk_type.decode("ascii", errors="strict")
        if name not in ("IHDR", "IDAT", "IEND"):
            fail(f"room_first_view_png_metadata_forbidden:{name}")
        chunks.append((name, data))
        if name == "IDAT":
            idat.append(data)
        offset = end
        if name == "IEND":
            break
    if offset != len(raw) or not chunks or chunks[0][0] != "IHDR" or chunks[-1][0] != "IEND" \
            or sum(name == "IHDR" for name, _ in chunks) != 1 or sum(name == "IEND" for name, _ in chunks) != 1 \
            or not idat or chunks[-1][1] != b"" or any(name == "IDAT" for name, _ in chunks[1 + len(idat): -1]):
        fail("room_first_view_png_chunk_order_invalid")
    ihdr = chunks[0][1]
    if len(ihdr) != 13:
        fail("room_first_view_png_ihdr_invalid")
    width, height, bit_depth, color_type, compression, filtering, interlace = struct.unpack(">IIBBBBB", ihdr)
    if (width, height, bit_depth, color_type, compression, filtering, interlace) != (960, 540, 8, 2, 0, 0, 0):
        fail("room_first_view_png_ihdr_invalid")
    stride = width * 3
    expected_filtered_length = height * (stride + 1)
    try:
        decompressor = zlib.decompressobj()
        filtered = decompressor.decompress(b"".join(idat), expected_filtered_length + 1)
    except zlib.error:
        fail("room_first_view_png_deflate_invalid")
    if not decompressor.eof or decompressor.unused_data or decompressor.unconsumed_tail:
        fail("room_first_view_png_deflate_invalid")
    if len(filtered) != expected_filtered_length:
        fail("room_first_view_png_scanline_invalid")
    decoded = bytearray(height * stride)
    for row in range(height):
        source_offset = row * (stride + 1)
        filter_type = filtered[source_offset]
        if filter_type > 4:
            fail("room_first_view_png_filter_invalid")
        for column in range(stride):
            raw_value = filtered[source_offset + 1 + column]
            target_offset = row * stride + column
            left = decoded[target_offset - 3] if column >= 3 else 0
            above = decoded[target_offset - stride] if row > 0 else 0
            upper_left = decoded[target_offset - stride - 3] if row > 0 and column >= 3 else 0
            predictor = 0 if filter_type == 0 else left if filter_type == 1 else above if filter_type == 2 else (left + above) // 2 if filter_type == 3 else paeth_predictor(left, above, upper_left)
            decoded[target_offset] = (raw_value + predictor) & 0xff
    pixel_count = width * height
    weighted_sum = 0
    dark_count = 0
    threshold = first_view_plan["measurement"]["darkPixelThreshold"] * 10000
    for offset in range(0, len(decoded), 3):
        numerator = 2126 * decoded[offset] + 7152 * decoded[offset + 1] + 722 * decoded[offset + 2]
        weighted_sum += numerator
        dark_count += numerator < threshold
    average_minimum = first_view_plan["criteria"]["averageLuminanceMinimum"]
    average_pass = weighted_sum >= average_minimum * 10000 * pixel_count
    dark_ratio_pass = dark_count * 10 <= pixel_count * 7
    if not average_pass or not dark_ratio_pass:
        print(json.dumps({
            "status": "room_first_view_acceptance_failed",
            "pixelCount": pixel_count,
            "weightedLuminanceSum": weighted_sum,
            "averageLuminance": weighted_sum / (10000 * pixel_count),
            "averageLuminanceMinimum": average_minimum,
            "averagePass": average_pass,
            "darkPixelCount": dark_count,
            "darkPixelRatio": dark_count / pixel_count,
            "darkPixelRatioMaximum": first_view_plan["criteria"]["darkPixelRatioMaximum"],
            "darkRatioPass": dark_ratio_pass,
        }, sort_keys=True), file=sys.stderr)
        fail("room_first_view_acceptance_failed")
    return {
        "status": "first-view-png-acceptance-valid",
        "sha256": sha256_bytes(raw),
        "byteLength": len(raw),
        "decodedRgbSha256": sha256_bytes(decoded),
        "widthPx": width,
        "heightPx": height,
        "pixelCount": pixel_count,
        "weightedLuminanceSum": weighted_sum,
        "darkPixelCount": dark_count,
        "averageLuminanceMinimum": average_minimum,
        "averagePass": average_pass,
        "darkPixelThreshold": first_view_plan["measurement"]["darkPixelThreshold"],
        "darkPixelRatioMaximum": first_view_plan["criteria"]["darkPixelRatioMaximum"],
        "darkRatioPass": dark_ratio_pass,
        "acceptancePass": average_pass and dark_ratio_pass,
        "chunkTypes": [name for name, _ in chunks],
    }


def strip_first_view_png_metadata(path):
    raw = path.read_bytes()
    if raw[:8] != b"\x89PNG\r\n\x1a\n":
        fail("room_first_view_png_signature_invalid")
    offset = 8
    stripped = bytearray(raw[:8])
    while offset < len(raw):
        if offset + 12 > len(raw):
            fail("room_first_view_png_chunk_invalid")
        length = struct.unpack(">I", raw[offset:offset + 4])[0]
        chunk_type = raw[offset + 4:offset + 8]
        end = offset + 12 + length
        if end > len(raw):
            fail("room_first_view_png_chunk_invalid")
        data = raw[offset + 8:offset + 8 + length]
        expected_crc = struct.unpack(">I", raw[offset + 8 + length:end])[0]
        if binascii.crc32(chunk_type + data) & 0xffffffff != expected_crc:
            fail("room_first_view_png_crc_invalid")
        if chunk_type in (b"IHDR", b"IDAT", b"IEND"):
            stripped.extend(raw[offset:end])
        offset = end
        if chunk_type == b"IEND":
            break
    if offset != len(raw):
        fail("room_first_view_png_chunk_order_invalid")
    path.write_bytes(stripped)


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


def apply_plan(plan, opening_plan, profile_plan, component_plan, exterior_plan, lighting_plan, first_view_plan, material_plan, scene_specification, specification_sha256, input_kind):
    try:
        import bpy
    except ImportError:
        fail("blender_python_required")

    version, build_hash, binary_sha256 = blender_identity(bpy)

    fixture_only = input_kind == SYNTHETIC_INPUT_KIND
    components_included = input_kind in (CANDIDATE_COMPONENT_INPUT_KIND, CANDIDATE_EXTERIOR_INPUT_KIND, CANDIDATE_LIGHTING_INPUT_KIND)
    exterior_included = input_kind in (CANDIDATE_EXTERIOR_INPUT_KIND, CANDIDATE_LIGHTING_INPUT_KIND)
    lighting_included = input_kind == CANDIDATE_LIGHTING_INPUT_KIND
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = "WMMR_SYNTHETIC_SHELL" if fixture_only else "WMMR_CANDIDATE_01_LIGHTING" if lighting_included else "WMMR_CANDIDATE_01_EXTERIOR" if exterior_included else "WMMR_CANDIDATE_01_COMPONENTS" if components_included else "WMMR_CANDIDATE_01_ARCHITECTURE"
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
        scene["wmmr_exterior_compiled"] = exterior_included
        scene["wmmr_lighting_compiled"] = lighting_included
        if lighting_included:
            scene["wmmr_first_view_rendered"] = False
            scene["wmmr_first_view_acceptance_verified"] = False
        scene["wmmr_media_surfaces_compiled"] = False
        scene["wmmr_final_candidate_glb_verified"] = False
        scene["wmmr_publication_ready"] = False
        if exterior_included:
            scene["wmmr_exterior_specified"] = True
            scene["wmmr_release_artifacts_created"] = False
            scene["wmmr_artifact_bytes_included_in_repository"] = False
            scene["wmmr_byte_identical_exports_verified"] = False

    collection_name = LIGHTING_COLLECTION_NAME if lighting_included else EXTERIOR_COLLECTION_NAME if exterior_included else COMPONENT_COLLECTION_NAME if components_included else plan["collectionName"]
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
    if exterior_included:
        for record in exterior_plan["objects"]:
            create_exterior_object(bpy, record, collection, fixture_only)
    if lighting_included:
        create_lights_and_camera(bpy, lighting_plan, first_view_plan, collection)

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
    expected_names = {record["name"] for record in [*architecture_objects, *component_plan["objects"], *exterior_plan["objects"]]}
    if lighting_included:
        expected_names.update(record["name"] for record in lighting_plan["lights"])
        expected_names.add(first_view_plan["camera"]["name"])
    if set(bpy.data.objects.keys()) != expected_names or len(bpy.data.materials) != 0 \
            or len(bpy.data.cameras) != (1 if lighting_included else 0) \
            or len(bpy.data.lights) != (3 if lighting_included else 0):
        fail("room_opening_inventory_invalid")
    apply_material_plan(bpy, material_plan, scene_specification["room"])
    material_report = verify_material_plan(bpy, material_plan, scene_specification["room"], components_included)
    component_objects = [
        verify_component_object(bpy.data.objects.get(record["name"]), record, allow_materials=True)
        for record in component_plan["objects"]
    ]
    exterior_objects = [
        verify_exterior_object(bpy.data.objects.get(record["name"]), record, allow_materials=True)
        for record in exterior_plan["objects"]
    ]
    lighting_report = verify_lights_and_camera(bpy, lighting_plan, first_view_plan) if lighting_included else None
    all_objects = sorted([*architecture_objects, *component_objects, *exterior_objects], key=lambda record: record["name"])
    return (
        bpy,
        version,
        build_hash,
        binary_sha256,
        shell_objects,
        opening_objects,
        profile_objects,
        component_objects,
        exterior_objects,
        lighting_report,
        material_report,
        inventory_report(bpy, all_objects),
    )


def load_scene_specification(path, input_kind, expected_raw_sha256, expected_specification_sha256):
    expected = {
        SYNTHETIC_INPUT_KIND: (EXPECTED_SYNTHETIC_SCENE_RAW_SHA256, EXPECTED_SYNTHETIC_SPECIFICATION_SHA256),
        CANDIDATE_ARCHITECTURE_INPUT_KIND: (EXPECTED_CANDIDATE_SCENE_RAW_SHA256, EXPECTED_CANDIDATE_SPECIFICATION_SHA256),
        CANDIDATE_COMPONENT_INPUT_KIND: (EXPECTED_COMPONENT_SCENE_RAW_SHA256, EXPECTED_COMPONENT_SPECIFICATION_SHA256),
        CANDIDATE_EXTERIOR_INPUT_KIND: (EXPECTED_EXTERIOR_SCENE_RAW_SHA256, EXPECTED_EXTERIOR_SPECIFICATION_SHA256),
        CANDIDATE_LIGHTING_INPUT_KIND: (EXPECTED_LIGHTING_SCENE_RAW_SHA256, EXPECTED_LIGHTING_SPECIFICATION_SHA256),
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


def load_exterior_construction(path, expected_raw_sha256, expected_sha256):
    if expected_raw_sha256 != EXPECTED_EXTERIOR_CONSTRUCTION_RAW_SHA256 \
            or expected_sha256 != EXPECTED_EXTERIOR_CONSTRUCTION_SHA256:
        fail("room_exterior_expected_hash_invalid")
    raw = path.read_bytes()
    if sha256_bytes(raw) != expected_raw_sha256:
        fail("approved_candidate_exterior_raw_sha256_mismatch")
    try:
        construction = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("room_exterior_json_invalid")
    if canonical_sha256(construction) != expected_sha256:
        fail("room_exterior_sha256_mismatch")
    return construction


def load_lighting_construction(path, expected_raw_sha256, expected_sha256):
    if expected_raw_sha256 != EXPECTED_LIGHTING_CONSTRUCTION_RAW_SHA256 \
            or expected_sha256 != EXPECTED_LIGHTING_CONSTRUCTION_SHA256:
        fail("room_lighting_expected_hash_invalid")
    raw = path.read_bytes()
    if sha256_bytes(raw) != expected_raw_sha256:
        fail("approved_candidate_lighting_raw_sha256_mismatch")
    try:
        construction = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        fail("room_lighting_json_invalid")
    if canonical_sha256(construction) != expected_sha256:
        fail("room_lighting_sha256_mismatch")
    return construction


def inspect_current_blend(report_path, scene_specification, component_construction, exterior_construction, lighting_construction, specification_sha256, input_kind):
    try:
        import bpy
    except ImportError:
        fail("blender_python_required")
    version, build_hash, binary_sha256 = blender_identity(bpy)
    fixture_only = input_kind == SYNTHETIC_INPUT_KIND
    components_included = input_kind in (CANDIDATE_COMPONENT_INPUT_KIND, CANDIDATE_EXTERIOR_INPUT_KIND, CANDIDATE_LIGHTING_INPUT_KIND)
    exterior_included = input_kind in (CANDIDATE_EXTERIOR_INPUT_KIND, CANDIDATE_LIGHTING_INPUT_KIND)
    lighting_included = input_kind == CANDIDATE_LIGHTING_INPUT_KIND
    plan = build_shell_plan(scene_specification)
    opening_plan = build_opening_plan(scene_specification)
    profile_plan = build_profile_plan(scene_specification, opening_plan)
    material_plan = build_material_plan(scene_specification, opening_plan, profile_plan)
    component_plan = build_component_plan(scene_specification, component_construction) if components_included else {
        "specified": False, "compiled": False, "objects": []
    }
    exterior_plan = build_exterior_plan(exterior_construction) if exterior_included else {
        "specified": False, "compiled": False, "objects": []
    }
    lighting_plan = build_lighting_plan(scene_specification, lighting_construction) if lighting_included else {
        "specified": False, "compiled": False, "lights": []
    }
    first_view_plan = build_first_view_plan(scene_specification, lighting_construction) if lighting_included else None
    if components_included:
        material_plan = with_component_materials(material_plan, component_plan, scene_specification)
    if exterior_included:
        material_plan = with_exterior_materials(material_plan, exterior_plan, exterior_construction)
    expected_names = {record["name"] for record in [*plan["objects"], *opening_plan["objects"], *profile_plan["objects"], *component_plan["objects"], *exterior_plan["objects"]]}
    if lighting_included:
        expected_names.update(record["name"] for record in lighting_plan["lights"])
        expected_names.add(first_view_plan["camera"]["name"])
    collection_name = LIGHTING_COLLECTION_NAME if lighting_included else EXTERIOR_COLLECTION_NAME if exterior_included else COMPONENT_COLLECTION_NAME if components_included else COLLECTION_NAME
    if set(bpy.data.objects.keys()) != expected_names \
            or len(bpy.data.meshes) != len(expected_names) - (4 if lighting_included else 0) \
            or len(bpy.data.materials) != material_plan["recipeCount"] \
            or len(bpy.data.images) != 0 \
            or len(bpy.data.cameras) != (1 if lighting_included else 0) \
            or len(bpy.data.lights) != (3 if lighting_included else 0) \
            or set(child.name for child in bpy.context.scene.collection.children) != {collection_name}:
        print(json.dumps({
            "status": "room_shell_saved_inventory_invalid",
            "actualObjectNames": sorted(bpy.data.objects.keys()),
            "expectedObjectNames": sorted(expected_names),
            "meshCount": len(bpy.data.meshes),
            "expectedMeshCount": len(expected_names) - (4 if lighting_included else 0),
            "materialCount": len(bpy.data.materials),
            "expectedMaterialCount": material_plan["recipeCount"],
            "imageNames": sorted(bpy.data.images.keys()),
            "cameraNames": sorted(bpy.data.cameras.keys()),
            "lightNames": sorted(bpy.data.lights.keys()),
            "sceneCollectionNames": sorted(child.name for child in bpy.context.scene.collection.children),
            "expectedSceneCollectionName": collection_name,
        }, sort_keys=True), file=sys.stderr)
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
    exterior_objects = [
        verify_exterior_object(bpy.data.objects.get(record["name"]), record, allow_materials=True)
        for record in exterior_plan["objects"]
    ]
    lighting_report = verify_lights_and_camera(bpy, lighting_plan, first_view_plan) if lighting_included else None
    render_settings = render_settings_report(bpy) if lighting_included else None
    objects = sorted([*shell_objects, *opening_objects, *profile_objects, *component_objects, *exterior_objects], key=lambda record: record["name"])
    if bpy.context.scene.get("wmmr_fixture_only") is not fixture_only \
            or bpy.context.scene.get("wmmr_specification_sha256") != specification_sha256:
        fail("room_shell_saved_metadata_invalid")
    if not fixture_only and (
            bpy.context.scene.get("wmmr_approved_candidate_specification") is not True
            or bpy.context.scene.get("wmmr_candidate_architecture_compiled") is not True
            or bpy.context.scene.get("wmmr_components_specified") is not components_included
            or bpy.context.scene.get("wmmr_components_compiled") is not components_included
            or bpy.context.scene.get("wmmr_component_glb_byte_identical") is not False
            or bpy.context.scene.get("wmmr_exterior_compiled") is not exterior_included
            or bpy.context.scene.get("wmmr_lighting_compiled") is not lighting_included
            or bpy.context.scene.get("wmmr_media_surfaces_compiled") is not False
            or bpy.context.scene.get("wmmr_final_candidate_glb_verified") is not False
            or bpy.context.scene.get("wmmr_publication_ready") is not False):
        fail("room_shell_saved_metadata_invalid")
    if lighting_included and (
            bpy.context.scene.get("wmmr_first_view_rendered") is not True
            or bpy.context.scene.get("wmmr_first_view_acceptance_verified") is not True):
        fail("room_shell_saved_metadata_invalid")
    if not lighting_included and (
            "wmmr_first_view_rendered" in bpy.context.scene
            or "wmmr_first_view_acceptance_verified" in bpy.context.scene):
        fail("room_shell_saved_metadata_invalid")
    if exterior_included and (
            bpy.context.scene.get("wmmr_exterior_specified") is not True
            or bpy.context.scene.get("wmmr_release_artifacts_created") is not False
            or bpy.context.scene.get("wmmr_artifact_bytes_included_in_repository") is not False
            or bpy.context.scene.get("wmmr_byte_identical_exports_verified") is not False):
        fail("room_shell_saved_metadata_invalid")
    report = {
        "schemaVersion": 1,
        "status": "stage3-synthetic-room-profiles-materials-inspection-valid" if fixture_only else "stage3-approved-candidate-lighting-inspection-valid" if lighting_included else "stage3-approved-candidate-exterior-inspection-valid" if exterior_included else "stage3-approved-candidate-components-inspection-valid" if components_included else "stage3-approved-candidate-architecture-inspection-valid",
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
            "exteriorCompiled": exterior_included,
            "lightingCompiled": lighting_included,
            "mediaSurfacesCompiled": False,
            "finalCandidateGlbVerified": False,
            "publicationReady": False,
        })
        if components_included:
            report["components"] = {**component_plan, "compiled": True, "objects": component_objects}
            report["sceneBinaryAddedToRepository"] = False
        if exterior_included:
            report.update({
                "exterior": {**exterior_plan, "compiled": True, "objects": exterior_objects},
                "exteriorSpecified": True,
                "exteriorGlbByteIdentical": False,
                "byteIdenticalExportsVerified": False,
                "releaseArtifactsCreated": False,
                "artifactBytesIncludedInRepository": False,
            })
        if lighting_included:
            report.update({
                "lighting": lighting_report["lighting"],
                "lightingSpecified": True,
                "lightingGlbByteIdentical": False,
                "firstViewRendered": True,
                "firstViewAcceptanceVerified": True,
                "firstView": {
                    **first_view_plan,
                    "rendered": True,
                    "acceptanceVerified": True,
                    "camera": lighting_report["camera"],
                    "renderSettings": render_settings,
                },
                "firstViewPngByteIdentical": False,
            })
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
    parser.add_argument("--input-kind", choices=(SYNTHETIC_INPUT_KIND, CANDIDATE_ARCHITECTURE_INPUT_KIND, CANDIDATE_COMPONENT_INPUT_KIND, CANDIDATE_EXTERIOR_INPUT_KIND, CANDIDATE_LIGHTING_INPUT_KIND), required=True)
    parser.add_argument("--scene-spec")
    parser.add_argument("--expected-raw-sha256", required=True)
    parser.add_argument("--expected-specification-sha256", required=True)
    parser.add_argument("--component-constructions")
    parser.add_argument("--expected-component-raw-sha256")
    parser.add_argument("--expected-component-sha256")
    parser.add_argument("--exterior-constructions")
    parser.add_argument("--expected-exterior-raw-sha256")
    parser.add_argument("--expected-exterior-sha256")
    parser.add_argument("--lighting-constructions")
    parser.add_argument("--expected-lighting-raw-sha256")
    parser.add_argument("--expected-lighting-sha256")
    parser.add_argument("--report", required=True)
    parser.add_argument("--output-blend")
    parser.add_argument("--output-glb")
    parser.add_argument("--output-first-view")
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
    components_included = args.input_kind in (CANDIDATE_COMPONENT_INPUT_KIND, CANDIDATE_EXTERIOR_INPUT_KIND, CANDIDATE_LIGHTING_INPUT_KIND)
    exterior_included = args.input_kind in (CANDIDATE_EXTERIOR_INPUT_KIND, CANDIDATE_LIGHTING_INPUT_KIND)
    lighting_included = args.input_kind == CANDIDATE_LIGHTING_INPUT_KIND
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

    exterior_arguments = (
        args.exterior_constructions,
        args.expected_exterior_raw_sha256,
        args.expected_exterior_sha256,
    )
    if exterior_included:
        if any(value is None for value in exterior_arguments):
            fail("room_exterior_arguments_missing")
        exterior_construction = load_exterior_construction(
            Path(args.exterior_constructions).resolve(strict=True),
            args.expected_exterior_raw_sha256,
            args.expected_exterior_sha256,
        )
    else:
        if any(value is not None for value in exterior_arguments):
            fail("room_exterior_arguments_invalid")
        exterior_construction = None

    lighting_arguments = (
        args.lighting_constructions,
        args.expected_lighting_raw_sha256,
        args.expected_lighting_sha256,
    )
    if lighting_included:
        if any(value is None for value in lighting_arguments):
            fail("room_lighting_arguments_missing")
        lighting_construction = load_lighting_construction(
            Path(args.lighting_constructions).resolve(strict=True),
            args.expected_lighting_raw_sha256,
            args.expected_lighting_sha256,
        )
    else:
        if any(value is not None for value in lighting_arguments):
            fail("room_lighting_arguments_invalid")
        lighting_construction = None

    if args.inspect_only:
        if args.output_blend is not None or args.output_glb is not None or args.output_first_view is not None or args.plan_only:
            fail("room_shell_inspection_arguments_invalid")
        inspect_current_blend(report_path, scene, component_construction, exterior_construction, lighting_construction, args.expected_specification_sha256, args.input_kind)
        return
    plan = build_shell_plan(scene)
    if components_included:
        plan["collectionName"] = COMPONENT_COLLECTION_NAME
    if exterior_included:
        plan["collectionName"] = EXTERIOR_COLLECTION_NAME
    if lighting_included:
        plan["collectionName"] = LIGHTING_COLLECTION_NAME
    opening_plan = build_opening_plan(scene)
    profile_plan = build_profile_plan(scene, opening_plan)
    material_plan = build_material_plan(scene, opening_plan, profile_plan)
    component_plan = build_component_plan(scene, component_construction) if components_included else {
        "specified": False,
        "compiled": False,
        "objects": [],
    }
    exterior_plan = build_exterior_plan(exterior_construction) if exterior_included else {
        "specified": False,
        "compiled": False,
        "objects": [],
    }
    lighting_plan = build_lighting_plan(scene, lighting_construction) if lighting_included else {
        "specified": False,
        "compiled": False,
        "lights": [],
    }
    first_view_plan = build_first_view_plan(scene, lighting_construction) if lighting_included else None
    if components_included:
        material_plan = with_component_materials(material_plan, component_plan, scene)
    if exterior_included:
        material_plan = with_exterior_materials(material_plan, exterior_plan, exterior_construction)

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
    if exterior_included:
        boundaries = {
            **boundaries,
            "exteriorSpecified": True,
            "exteriorCompiled": False,
            "exteriorGlbByteIdentical": False,
            "byteIdenticalExportsVerified": False,
            "releaseArtifactsCreated": False,
            "artifactBytesIncludedInRepository": False,
        }
    if lighting_included:
        boundaries = {
            **boundaries,
            "lightingSpecified": True,
            "lightingCompiled": False,
            "lightingGlbByteIdentical": False,
            "firstViewRendered": False,
            "firstViewAcceptanceVerified": False,
            "firstViewPngByteIdentical": False,
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
        if exterior_included:
            base_report.update({
                "exterior": exterior_plan,
                "exteriorSpecified": True,
                "exteriorCompiled": False,
                "exteriorGlbByteIdentical": False,
                "byteIdenticalExportsVerified": False,
                "releaseArtifactsCreated": False,
                "artifactBytesIncludedInRepository": False,
            })
        if lighting_included:
            base_report.update({
                "lighting": lighting_plan,
                "lightingSpecified": True,
                "lightingCompiled": False,
                "lightingGlbByteIdentical": False,
                "firstView": first_view_plan,
                "firstViewRendered": False,
                "firstViewAcceptanceVerified": False,
                "firstViewPngByteIdentical": False,
            })

    if args.plan_only:
        if args.output_blend is not None or args.output_glb is not None or args.output_first_view is not None:
            fail("room_shell_plan_only_arguments_invalid")
        report = {
            **base_report,
            "status": "stage3-synthetic-room-profiles-materials-plan-valid" if fixture_only else "stage3-approved-candidate-lighting-plan-valid" if lighting_included else "stage3-approved-candidate-exterior-plan-valid" if exterior_included else "stage3-approved-candidate-components-plan-valid" if components_included else "stage3-approved-candidate-architecture-plan-valid",
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
    first_view_path = outside_repository(Path(args.output_first_view), "room_first_view_output") if args.output_first_view is not None else None
    if output_path.suffix != ".blend" or output_path.exists():
        fail("room_shell_output_invalid")
    if glb_path.suffix != ".glb" or glb_path.exists() or glb_path == output_path:
        fail("room_glb_output_invalid")
    if lighting_included:
        if first_view_path is None or first_view_path.suffix != ".png" or first_view_path.exists() \
                or first_view_path in (output_path, glb_path):
            fail("room_first_view_output_invalid")
    elif first_view_path is not None:
        fail("room_first_view_output_invalid")
    (
        bpy,
        version,
        build_hash,
        binary_sha256,
        shell_objects,
        opening_objects,
        profile_objects,
        component_objects,
        exterior_objects,
        lighting_report,
        material_report,
        inventory,
    ) = apply_plan(
        plan,
        opening_plan,
        profile_plan,
        component_plan,
        exterior_plan,
        lighting_plan,
        first_view_plan,
        material_plan,
        scene,
        args.expected_specification_sha256,
        args.input_kind,
    )
    first_view_evidence = None
    render_settings = None
    if lighting_included:
        configure_first_view_render(bpy, first_view_plan, first_view_path)
        bpy.ops.render.render(write_still=True)
        strip_first_view_png_metadata(first_view_path)
        first_view_evidence = inspect_first_view_png(first_view_path, first_view_plan)
        render_result = bpy.data.images.get("Render Result")
        if render_result is not None:
            bpy.data.images.remove(render_result)
        bpy.context.scene.render.filepath = "//first-view.png"
        bpy.context.scene["wmmr_first_view_rendered"] = True
        bpy.context.scene["wmmr_first_view_acceptance_verified"] = True
        render_settings = render_settings_report(bpy)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path), check_existing=False, compress=False, relative_remap=False)
    output_bytes = output_path.read_bytes()
    export_settings = {
        "filepath": str(glb_path),
        "export_format": "GLB",
        "export_attributes": True,
        "export_cameras": False,
        "export_extras": True,
        "export_lights": lighting_included,
        "export_yup": True,
    }
    if lighting_included:
        export_settings["export_import_convert_lighting_mode"] = "SPEC"
    bpy.ops.export_scene.gltf(**export_settings)
    glb_bytes = glb_path.read_bytes()
    report = {
        **base_report,
        "status": "stage3-synthetic-room-profiles-materials-compiled" if fixture_only else "stage3-approved-candidate-lighting-compiled" if lighting_included else "stage3-approved-candidate-exterior-compiled" if exterior_included else "stage3-approved-candidate-components-compiled" if components_included else "stage3-approved-candidate-architecture-compiled",
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
                "exportLights": lighting_included,
                "exportYup": True,
                **({"exportImportConvertLightingMode": "SPEC"} if lighting_included else {}),
            },
        },
        **({
            "outputFirstView": first_view_evidence,
        } if lighting_included else {}),
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
                "lightingCompiled": lighting_included,
                "mediaSurfacesCompiled": False,
                "finalCandidateGlbVerified": False,
                "publicationReady": False,
            })
            report["boundaries"].update({
                "componentsSpecified": True,
                "componentsCompiled": True,
                "componentGlbByteIdentical": False,
                "exteriorCompiled": False,
                "lightingCompiled": lighting_included,
                "mediaSurfacesCompiled": False,
                "finalCandidateGlbVerified": False,
                "publicationReady": False,
                "sceneBinaryAddedToRepository": False,
            })
        if exterior_included:
            report.update({
                "exteriorSpecified": True,
                "exteriorCompiled": True,
                "exteriorGlbByteIdentical": False,
                "byteIdenticalExportsVerified": False,
                "releaseArtifactsCreated": False,
                "artifactBytesIncludedInRepository": False,
            })
            report["boundaries"].update({
                "exteriorSpecified": True,
                "exteriorCompiled": True,
                "exteriorGlbByteIdentical": False,
                "byteIdenticalExportsVerified": False,
                "lightingCompiled": lighting_included,
                "mediaSurfacesCompiled": False,
                "finalCandidateGlbVerified": False,
                "releaseArtifactsCreated": False,
                "publicationReady": False,
                "artifactBytesIncludedInRepository": False,
                "sceneBinaryAddedToRepository": False,
            })
        if lighting_included:
            report.update({
                "lighting": lighting_report["lighting"],
                "lightingSpecified": True,
                "lightingCompiled": True,
                "lightingGlbByteIdentical": False,
                "firstView": {
                    **first_view_plan,
                    "rendered": True,
                    "acceptanceVerified": True,
                    "camera": lighting_report["camera"],
                    "renderSettings": render_settings,
                    "acceptance": first_view_evidence,
                },
                "firstViewRendered": True,
                "firstViewAcceptanceVerified": True,
                "firstViewPngByteIdentical": False,
            })
            report["boundaries"].update({
                "lightingSpecified": True,
                "lightingCompiled": True,
                "lightingGlbByteIdentical": False,
                "firstViewRendered": True,
                "firstViewAcceptanceVerified": True,
                "firstViewPngByteIdentical": False,
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
    if exterior_included:
        report["exterior"] = {**exterior_plan, "compiled": True, "objects": exterior_objects}
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
