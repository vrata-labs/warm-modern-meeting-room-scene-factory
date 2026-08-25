import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import { posix } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
const validateSceneSchema = ajv.compile(JSON.parse(readFileSync(new URL("../schemas/scene-spec.schema.json", import.meta.url), "utf8")));
const validateAssetLedgerSchema = ajv.compile(JSON.parse(readFileSync(new URL("../schemas/asset-ledger.schema.json", import.meta.url), "utf8")));
const validateGenerationLedgerSchema = ajv.compile(JSON.parse(readFileSync(new URL("../schemas/generation-ledger.schema.json", import.meta.url), "utf8")));
const validateComponentConstructionSchema = ajv.compile(JSON.parse(readFileSync(new URL("../schemas/component-constructions.schema.json", import.meta.url), "utf8")));

const sceneKeys = ["architecturalDetails", "assetLedgerPath", "clearance", "components", "exterior", "generationLedgerPath", "generator", "lighting", "materialRecipes", "materialZones", "mediaSurfaces", "openings", "profiles", "reviewViews", "room", "sceneId", "schemaVersion", "seats", "spawn"];
const generatorKeys = ["acceptedInputSha256", "blenderBuildHash", "blenderVersion", "commit", "repository", "seed"];
const roomKeys = ["ceilingY", "depthM", "floorY", "heightM", "polygon", "wallThicknessM", "widthM"];
const assetLedgerKeys = ["records", "sceneId", "schemaVersion"];
const generationLedgerKeys = ["records", "sceneId", "schemaVersion"];
const assetRecordKeys = ["acquiredOn", "allowedUse", "attribution", "authorProvider", "id", "kind", "license", "modifications", "originalSha256", "outputSha256", "source"];
const assetSourceKeys = ["classification", "publicUrl", "repositoryPath"];
const assetLicenseKeys = ["commercialUse", "mlProcessing", "name", "redistribution", "reference"];
const assetAllowedUseKeys = ["optimization", "production", "redistribution", "screenshots", "staging", "webRuntime"];
const generationRecordKeys = ["cleanupMinutes", "codeRevision", "componentId", "dependencyLockSha256", "id", "inputAssetIds", "modelRevision", "outputSha256", "prompt", "providerRegion", "rawOutputSha256", "rejectionReasons", "seed", "status", "weightsSha256"];
const profileKeys = ["depthM", "id", "kind", "materialRecipeId", "widthM"];
const materialRecipeKeys = ["baseColorSrgb", "category", "id", "metalness", "roughness", "sourceRecordId", "textureScaleM"];
const materialZoneKeys = ["id", "recipeId", "surface"];
const openingKeys = ["heightM", "id", "kind", "offsetM", "profileId", "sillM", "wall", "widthM"];
const architecturalDetailKeys = ["id", "kind", "profileId", "wall"];
const lightKeys = ["id", "intendedContribution", "intensityLumens", "kind", "position", "temperatureK"];
const exteriorKeys = ["sourceRecordIds", "strategy", "windowOpeningId"];
const componentKeys = ["dimensions", "family", "generationRecordId", "id", "sourceRecordId", "transform"];
const dimensionKeys = ["depthM", "heightM", "widthM"];
const transformKeys = ["position", "yaw"];
const clearanceKeys = ["minimumRouteWidthM", "routes"];
const clearanceRouteKeys = ["destinationId", "id", "points", "widthM"];
const spawnKeys = ["id", "openRadiusM", "position"];
const seatKeys = ["componentId", "id", "position", "radius", "seatHeight", "yaw"];
const surfaceKeys = ["heightM", "position", "surfaceId", "widthM", "yaw"];
const reviewViewKeys = ["fovDegrees", "id", "position", "target"];
const seatIds = Object.freeze(["seat-01", "seat-02", "seat-03", "seat-04", "seat-05", "seat-06", "seat-07", "seat-08"]);
const surfaceIds = Object.freeze(["debug-main", "whiteboard-wall"]);
const reviewViewIds = Object.freeze(["entry", "participant", "presenter", "diagonal-overview"]);
const wallIds = new Set(["north", "east", "south", "west"]);
const componentFamilies = new Set(["acoustic-module", "conference-av", "conference-table", "credenza", "laptop-stationery", "pendant-luminaire", "planter", "power-cable-management", "task-chair"]);
const sha1Pattern = /^[0-9a-f]{40}$/;
const sha256Pattern = /^[0-9a-f]{64}$/;
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class SceneContractError extends Error {
  constructor(issues) {
    const stableIssues = [...new Set(issues)].sort(asciiCompare);
    super(`scene_contract_invalid:${stableIssues.join(",")}`);
    this.name = "SceneContractError";
    this.issues = stableIssues;
  }
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function denseArray(value) {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}

function exactKeys(value, expected, code, issues) {
  if (!isObject(value)) {
    issues.push(code.replace(/_keys_invalid$/, "_invalid"));
    return false;
  }
  const actual = Object.keys(value).sort(asciiCompare);
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) issues.push(code);
  return true;
}

function firstDuplicateJsonKey(text) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const scanString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") index += 2;
      else if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else index += 1;
    }
    return null;
  };
  const scanValue = () => {
    skipWhitespace();
    if (text[index] === '"') {
      scanString();
      return null;
    }
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return null;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = scanString();
        if (keys.has(key)) return key;
        keys.add(key);
        skipWhitespace();
        index += 1;
        const duplicate = scanValue();
        if (duplicate !== null) return duplicate;
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return null;
        }
        index += 1;
      }
      return null;
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return null;
      }
      while (index < text.length) {
        const duplicate = scanValue();
        if (duplicate !== null) return duplicate;
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return null;
        }
        index += 1;
      }
      return null;
    }
    const token = text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    index += token?.length ?? 0;
    return null;
  };
  return scanValue();
}

function parseStrictJson(text, label, issues) {
  if (typeof text !== "string") {
    issues.push(`${label}_text_invalid`);
    return null;
  }
  try {
    if (firstDuplicateJsonKey(text) !== null) issues.push(`${label}_duplicate_key`);
    return JSON.parse(text);
  } catch {
    issues.push(`${label}_json_invalid`);
    return null;
  }
}

export function parseCanonicalJsonText(text, label = "canonical_json") {
  if (typeof text !== "string") throw new SceneContractError([`${label}_text_invalid`]);
  if (!text.endsWith("\n")
    || text.endsWith("\n\n")
    || text.includes("\r")
    || text.includes("\t")
    || text.charCodeAt(0) === 0xfeff
    || /[^\x0A\x20-\x7E]/.test(text)) throw new SceneContractError([`${label}_encoding_noncanonical`]);
  const issues = [];
  const value = parseStrictJson(text, label, issues);
  if (issues.length !== 0) throw new SceneContractError(issues);
  return value;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) return `{${Object.keys(value).sort(asciiCompare).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function applySchemaValidation(validate, value, label, issues) {
  if (validate(value)) return;
  for (const error of validate.errors ?? []) {
    const path = error.instancePath ? error.instancePath.replaceAll("/", ":") : ":root";
    issues.push(`schema_${label}${path}:${error.keyword}`);
  }
}

function safeRepositoryPath(path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.includes("%") || /^[a-zA-Z]:/.test(path) || posix.isAbsolute(path)) return false;
  const normalized = posix.normalize(path);
  return normalized === path && !normalized.startsWith("../") && /^(?:source|provenance)\/[a-zA-Z0-9._/-]+$/.test(path);
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host || url.username || url.password || url.hash || url.search) return false;
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan") || host === "metadata.google.internal") return false;
    const ipv6 = host.replace(/^\[|\]$/g, "");
    if (isIP(ipv6) !== 0) return false;
    return host.includes(".");
  } catch {
    return false;
  }
}

function sameStringSet(left, right) {
  if (!denseArray(left) || !denseArray(right) || left.length !== right.length) return false;
  const rightSet = new Set(right);
  return rightSet.size === right.length && left.every((value) => rightSet.has(value));
}

function consumedAssetUsable(asset) {
  return asset?.allowedUse?.staging === true && asset.allowedUse.optimization === true && asset.allowedUse.webRuntime === true;
}

function angleDistance(left, right) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right)));
}

function collectNonFinite(value, path, issues) {
  const ancestors = new WeakSet();
  const stack = [{ value, path, depth: 0, exit: false }];
  while (stack.length !== 0) {
    const entry = stack.pop();
    if (entry.exit) {
      ancestors.delete(entry.value);
      continue;
    }
    if (typeof entry.value === "number" && !Number.isFinite(entry.value)) {
      issues.push(`non_finite_number:${entry.path}`);
      continue;
    }
    if (!Array.isArray(entry.value) && !isObject(entry.value)) continue;
    if (entry.depth > 128) {
      issues.push(`nesting_too_deep:${entry.path}`);
      continue;
    }
    if (ancestors.has(entry.value)) {
      issues.push(`cyclic_value:${entry.path}`);
      continue;
    }
    ancestors.add(entry.value);
    stack.push({ ...entry, exit: true });
    const children = Array.isArray(entry.value) ? entry.value.map((child, index) => [String(index), child]) : Object.entries(entry.value);
    for (let index = children.length - 1; index >= 0; index -= 1) {
      const [key, child] = children[index];
      stack.push({ value: child, path: `${entry.path}:${key}`, depth: entry.depth + 1, exit: false });
    }
  }
}

function idMap(records, label, issues) {
  const result = new Map();
  if (!denseArray(records)) {
    issues.push(`${label}_invalid`);
    return result;
  }
  records.forEach((record, index) => {
    if (!isObject(record) || typeof record.id !== "string" || !idPattern.test(record.id)) {
      issues.push(`${label}_id_invalid:${index}`);
      return;
    }
    if (result.has(record.id)) issues.push(`${label}_id_duplicate:${record.id}`);
    result.set(record.id, record);
  });
  return result;
}

function stringSet(values, label, issues, pattern = idPattern) {
  const result = new Set();
  if (!denseArray(values)) {
    issues.push(`${label}_invalid`);
    return result;
  }
  values.forEach((value, index) => {
    if (typeof value !== "string" || !pattern.test(value)) issues.push(`${label}_value_invalid:${index}`);
    else if (result.has(value)) issues.push(`${label}_duplicate:${value}`);
    else result.add(value);
  });
  return result;
}

function positionValid(position, label, issues) {
  if (!exactKeys(position, ["x", "y", "z"], `${label}_keys_invalid`, issues)) return false;
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    issues.push(`${label}_invalid`);
    return false;
  }
  return true;
}

function horizontalPointValid(point, label, issues) {
  if (!exactKeys(point, ["x", "z"], `${label}_keys_invalid`, issues)) return false;
  if (![point.x, point.z].every(Number.isFinite)) {
    issues.push(`${label}_invalid`);
    return false;
  }
  return true;
}

function insideRoom(position, room, wallMargin = 0) {
  return Number.isFinite(position?.x) && Number.isFinite(position?.y) && Number.isFinite(position?.z)
    && Math.abs(position.x) <= room.widthM / 2 - wallMargin
    && Math.abs(position.z) <= room.depthM / 2 - wallMargin
    && position.y >= room.floorY - 1e-6
    && position.y <= room.ceilingY + 1e-6;
}

function openingInteriorPoint(opening, room) {
  const center = opening.offsetM + opening.widthM / 2;
  if (opening.wall === "south") return { x: -room.widthM / 2 + center, z: -room.depthM / 2 + 0.15 };
  if (opening.wall === "north") return { x: room.widthM / 2 - center, z: room.depthM / 2 - 0.15 };
  if (opening.wall === "west") return { x: -room.widthM / 2 + 0.15, z: room.depthM / 2 - center };
  return { x: room.widthM / 2 - 0.15, z: -room.depthM / 2 + center };
}

function openingWallInterval(opening, room) {
  const wallLength = opening.wall === "north" || opening.wall === "south" ? room.widthM : room.depthM;
  const reverse = opening.wall === "north" || opening.wall === "west";
  const start = reverse ? wallLength / 2 - opening.offsetM - opening.widthM : -wallLength / 2 + opening.offsetM;
  return { start, end: start + opening.widthM };
}

function segmentIntersectsBox(start, end, minX, maxX, minZ, maxZ) {
  let low = 0;
  let high = 1;
  for (const [origin, delta, minimum, maximum] of [[start.x, end.x - start.x, minX, maxX], [start.z, end.z - start.z, minZ, maxZ]]) {
    if (Math.abs(delta) < 1e-9) {
      if (origin >= minimum && origin <= maximum) continue;
      return false;
    }
    const first = (minimum - origin) / delta;
    const second = (maximum - origin) / delta;
    low = Math.max(low, Math.min(first, second));
    high = Math.min(high, Math.max(first, second));
    if (low > high) return false;
  }
  return true;
}

function validateAssetLedger(ledger, sceneId, issues) {
  if (!exactKeys(ledger, assetLedgerKeys, "asset_ledger_keys_invalid", issues)) return new Map();
  if (ledger.schemaVersion !== 1) issues.push("asset_ledger_schema_version_invalid");
  if (ledger.sceneId !== sceneId) issues.push("asset_ledger_scene_id_mismatch");
  const assets = idMap(ledger.records, "asset_record", issues);
  for (const [id, record] of assets) {
    exactKeys(record, assetRecordKeys, `asset_record_keys_invalid:${id}`, issues);
    if (!isObject(record.license) || !record.license.name || !record.license.reference) issues.push(`asset_license_missing:${id}`);
    else exactKeys(record.license, assetLicenseKeys, `asset_license_keys_invalid:${id}`, issues);
    if (!sha256Pattern.test(record.originalSha256 ?? "")) issues.push(`asset_original_sha256_invalid:${id}`);
    const source = record.source;
    if (!isObject(source)) issues.push(`asset_source_invalid:${id}`);
    else {
      exactKeys(source, assetSourceKeys, `asset_source_keys_invalid:${id}`, issues);
      const hasUrl = typeof source.publicUrl === "string";
      const hasPath = typeof source.repositoryPath === "string";
      if (hasUrl === hasPath) issues.push(`asset_source_locator_invalid:${id}`);
      if (hasUrl && !safeHttpsUrl(source.publicUrl)) issues.push(`asset_source_url_invalid:${id}`);
      if (hasPath && !safeRepositoryPath(source.repositoryPath)) issues.push(`asset_source_path_invalid:${id}`);
      if ((record.kind === "generated-output") !== (source.classification === "generated") || (record.kind === "project-authored-input" && source.classification !== "project-authored")) issues.push(`asset_kind_classification_invalid:${id}`);
    }
    exactKeys(record.allowedUse, assetAllowedUseKeys, `asset_allowed_use_keys_invalid:${id}`, issues);
    const licenseFlagsValid = [record.license?.commercialUse, record.license?.redistribution, record.license?.mlProcessing].every((value) => typeof value === "boolean");
    const useFlagsValid = Object.values(record.allowedUse ?? {}).every((value) => typeof value === "boolean");
    if (!licenseFlagsValid || !useFlagsValid) issues.push(`asset_rights_flags_invalid:${id}`);
    if (record.allowedUse?.production === true && record.license?.commercialUse !== true) issues.push(`asset_production_rights_invalid:${id}`);
    if (record.allowedUse?.redistribution === true && record.license?.redistribution !== true) issues.push(`asset_redistribution_rights_invalid:${id}`);
    if (record.allowedUse?.webRuntime === true && record.allowedUse?.redistribution !== true) issues.push(`asset_web_runtime_rights_invalid:${id}`);
    if (!denseArray(record.outputSha256) || record.outputSha256.some((digest) => !sha256Pattern.test(digest))) issues.push(`asset_output_sha256_invalid:${id}`);
  }
  return assets;
}

function validateGenerationLedger(ledger, sceneId, assets, issues) {
  if (!exactKeys(ledger, generationLedgerKeys, "generation_ledger_keys_invalid", issues)) return new Map();
  if (ledger.schemaVersion !== 1) issues.push("generation_ledger_schema_version_invalid");
  if (ledger.sceneId !== sceneId) issues.push("generation_ledger_scene_id_mismatch");
  const generations = idMap(ledger.records, "generation_record", issues);
  for (const [id, record] of generations) {
    exactKeys(record, generationRecordKeys, `generation_record_keys_invalid:${id}`, issues);
    if (!sha1Pattern.test(record.codeRevision ?? "")) issues.push(`generation_code_revision_invalid:${id}`);
    if (!sha256Pattern.test(record.dependencyLockSha256 ?? "") || !sha256Pattern.test(record.rawOutputSha256 ?? "")) issues.push(`generation_sha256_invalid:${id}`);
    if (!Number.isFinite(record.cleanupMinutes) || record.cleanupMinutes < 0 || record.cleanupMinutes > 45) issues.push(`generation_cleanup_minutes_invalid:${id}`);
    const inputIds = stringSet(record.inputAssetIds, `generation_input_asset:${id}`, issues);
    stringSet(record.weightsSha256, `generation_weight_sha256:${id}`, issues, sha256Pattern);
    stringSet(record.outputSha256, `generation_output_sha256:${id}`, issues, sha256Pattern);
    for (const assetId of inputIds) {
      if (!assets.has(assetId)) issues.push(`generation_input_asset_unknown:${id}:${assetId}`);
      else if (assets.get(assetId).license?.mlProcessing !== true) issues.push(`generation_input_ml_rights_invalid:${id}:${assetId}`);
    }
    if (record.status === "accepted" && denseArray(record.rejectionReasons) && record.rejectionReasons.length !== 0) issues.push(`accepted_generation_has_rejection:${id}`);
    if (record.status === "accepted" && (!denseArray(record.outputSha256) || record.outputSha256.length === 0)) issues.push(`accepted_generation_output_missing:${id}`);
    if (record.status === "rejected" && (!denseArray(record.rejectionReasons) || record.rejectionReasons.length === 0)) issues.push(`rejected_generation_reason_missing:${id}`);
  }
  return generations;
}

function validateRoom(scene, issues) {
  const room = scene.room;
  if (!exactKeys(room, roomKeys, "room_keys_invalid", issues)) return null;
  const dimensions = [room.widthM, room.depthM, room.heightM, room.wallThicknessM, room.floorY, room.ceilingY];
  if (!dimensions.every(Number.isFinite) || room.widthM < 6.3 || room.widthM > 7.7 || room.depthM < 4.5 || room.depthM > 5.5 || room.heightM < 2.79 || room.heightM > 3.41 || room.wallThicknessM !== 0.18 || Math.abs((room.ceilingY - room.floorY) - room.heightM) > 1e-6) issues.push("room_dimensions_invalid");
  if (!denseArray(room.polygon) || room.polygon.length !== 4 || room.polygon.some((point, index) => !horizontalPointValid(point, `room_polygon:${index}`, issues))) issues.push("room_polygon_invalid");
  else {
    const expected = [[-room.widthM / 2, -room.depthM / 2], [room.widthM / 2, -room.depthM / 2], [room.widthM / 2, room.depthM / 2], [-room.widthM / 2, room.depthM / 2]];
    if (room.polygon.some((point, index) => Math.abs(point.x - expected[index][0]) > 1e-6 || Math.abs(point.z - expected[index][1]) > 1e-6)) issues.push("room_polygon_not_rectangular_ccw");
  }
  return room;
}

function validateOpenings(scene, room, profiles, issues) {
  const openings = idMap(scene.openings, "opening", issues);
  let doorCount = 0;
  let windowCount = 0;
  const intervals = new Map();
  for (const [id, opening] of openings) {
    exactKeys(opening, openingKeys, `opening_keys_invalid:${id}`, issues);
    if (opening.kind === "door") doorCount += 1;
    else if (opening.kind === "window") windowCount += 1;
    else issues.push(`opening_kind_invalid:${id}`);
    if (!wallIds.has(opening.wall)) issues.push(`opening_wall_invalid:${id}`);
    if (!profiles.has(opening.profileId)) issues.push(`opening_profile_unknown:${id}:${opening.profileId}`);
    else {
      const expectedKind = opening.kind === "door" ? "door-frame" : "window-frame";
      if (profiles.get(opening.profileId).kind !== expectedKind) issues.push(`opening_profile_kind_invalid:${id}:${opening.profileId}`);
    }
    const wallLength = opening.wall === "north" || opening.wall === "south" ? room?.widthM : room?.depthM;
    if (![opening.offsetM, opening.widthM, opening.heightM, opening.sillM, wallLength].every(Number.isFinite) || opening.offsetM < 0 || opening.widthM <= 0 || opening.heightM <= 0 || opening.sillM < 0 || opening.offsetM + opening.widthM > wallLength + 1e-6 || opening.sillM + opening.heightM > room.heightM + 1e-6) issues.push(`opening_out_of_bounds:${id}`);
    if (opening.kind === "door" && opening.sillM !== 0) issues.push(`door_sill_invalid:${id}`);
    if (opening.kind === "window" && (opening.widthM < 2 || opening.heightM < 1.2)) issues.push(`window_not_large:${id}`);
    const wallIntervals = intervals.get(opening.wall) ?? [];
    for (const other of wallIntervals) if (opening.offsetM < other.end && opening.offsetM + opening.widthM > other.start) issues.push(`opening_overlap:${other.id}:${id}`);
    wallIntervals.push({ id, start: opening.offsetM, end: opening.offsetM + opening.widthM });
    intervals.set(opening.wall, wallIntervals);
  }
  if (doorCount !== 1) issues.push("entrance_count_invalid");
  if (windowCount < 1) issues.push("window_count_invalid");
  return openings;
}

function validateScene(scene, assets, generations, issues) {
  if (!exactKeys(scene, sceneKeys, "scene_keys_invalid", issues)) return;
  if (scene.schemaVersion !== 1) issues.push("scene_schema_version_invalid");
  if (!/^warm-modern-meeting-room-candidate-(?:01|02)$/.test(scene.sceneId ?? "")) issues.push("scene_id_invalid");
  if (scene.assetLedgerPath !== "provenance/asset-ledger.json" || scene.generationLedgerPath !== "provenance/generation-ledger.json") issues.push("ledger_path_invalid");
  if (exactKeys(scene.generator, generatorKeys, "generator_keys_invalid", issues)) {
    if (scene.generator.repository !== "vrata-labs/warm-modern-meeting-room-scene-factory" || !sha1Pattern.test(scene.generator.commit ?? "") || scene.generator.blenderVersion !== "4.5.12 LTS" || !/^[0-9a-f]{12}$/.test(scene.generator.blenderBuildHash ?? "") || !Number.isInteger(scene.generator.seed)) issues.push("generator_identity_invalid");
    const inputs = stringSet(scene.generator.acceptedInputSha256, "accepted_input_sha256", issues, sha256Pattern);
    const knownDigests = new Set([...assets.values()].flatMap((asset) => [asset.originalSha256, ...(denseArray(asset.outputSha256) ? asset.outputSha256 : [])]));
    for (const digest of inputs) if (!knownDigests.has(digest)) issues.push(`accepted_input_sha256_unknown:${digest}`);
  }
  const room = validateRoom(scene, issues);
  if (!room) return;
  const consumedGeneratedAssets = new Set();
  const profiles = idMap(scene.profiles, "profile", issues);
  const recipes = idMap(scene.materialRecipes, "material_recipe", issues);
  for (const [id, profile] of profiles) {
    exactKeys(profile, profileKeys, `profile_keys_invalid:${id}`, issues);
    if (!recipes.has(profile.materialRecipeId)) issues.push(`profile_material_recipe_unknown:${id}:${profile.materialRecipeId}`);
    if (![profile.widthM, profile.depthM].every((value) => Number.isFinite(value) && value > 0 && value <= 0.5)) issues.push(`profile_dimensions_invalid:${id}`);
  }
  for (const [id, recipe] of recipes) {
    exactKeys(recipe, materialRecipeKeys, `material_recipe_keys_invalid:${id}`, issues);
    if (!assets.has(recipe.sourceRecordId)) issues.push(`material_source_unknown:${id}:${recipe.sourceRecordId}`);
    else {
      const sourceAsset = assets.get(recipe.sourceRecordId);
      if (!consumedAssetUsable(sourceAsset)) issues.push(`material_source_use_invalid:${id}:${recipe.sourceRecordId}`);
      if (sourceAsset.source?.classification === "generated") issues.push(`generated_asset_role_unsupported:material:${recipe.sourceRecordId}`);
    }
    if (!/^#[0-9A-F]{6}$/.test(recipe.baseColorSrgb ?? "") || ![recipe.roughness, recipe.metalness].every((value) => Number.isFinite(value) && value >= 0 && value <= 1) || !Number.isFinite(recipe.textureScaleM) || recipe.textureScaleM <= 0) issues.push(`material_recipe_values_invalid:${id}`);
  }
  const zones = idMap(scene.materialZones, "material_zone", issues);
  const coveredSurfaces = new Set();
  for (const [id, zone] of zones) {
    exactKeys(zone, materialZoneKeys, `material_zone_keys_invalid:${id}`, issues);
    if (!recipes.has(zone.recipeId)) issues.push(`material_zone_recipe_unknown:${id}:${zone.recipeId}`);
    coveredSurfaces.add(zone.surface);
  }
  for (const surface of ["floor", "ceiling", "north", "east", "south", "west"]) if (!coveredSurfaces.has(surface)) issues.push(`material_surface_missing:${surface}`);
  const openings = validateOpenings(scene, room, profiles, issues);
  const details = idMap(scene.architecturalDetails, "architectural_detail", issues);
  for (const [id, detail] of details) {
    exactKeys(detail, architecturalDetailKeys, `architectural_detail_keys_invalid:${id}`, issues);
    if (!wallIds.has(detail.wall)) issues.push(`architectural_detail_wall_invalid:${id}`);
    if (!profiles.has(detail.profileId)) issues.push(`architectural_detail_profile_unknown:${id}:${detail.profileId}`);
  }
  const lights = idMap(scene.lighting, "light", issues);
  for (const [id, light] of lights) {
    exactKeys(light, lightKeys, `light_keys_invalid:${id}`, issues);
    if (!positionValid(light.position, `light_position:${id}`, issues) || !insideRoom(light.position, room)) issues.push(`light_out_of_bounds:${id}`);
    if (!Number.isFinite(light.intensityLumens) || light.intensityLumens <= 0) issues.push(`light_intensity_invalid:${id}`);
    if (light.kind !== "daylight" && (!Number.isInteger(light.temperatureK) || light.temperatureK < 2700 || light.temperatureK > 3000)) issues.push(`light_temperature_invalid:${id}`);
  }
  exactKeys(scene.exterior, exteriorKeys, "exterior_keys_invalid", issues);
  if (!isObject(scene.exterior) || !openings.has(scene.exterior.windowOpeningId) || openings.get(scene.exterior.windowOpeningId)?.kind !== "window") issues.push("exterior_window_opening_invalid");
  for (const assetId of stringSet(scene.exterior?.sourceRecordIds, "exterior_source_record", issues)) {
    if (!assets.has(assetId)) issues.push(`exterior_source_unknown:${assetId}`);
    else {
      const sourceAsset = assets.get(assetId);
      if (!consumedAssetUsable(sourceAsset)) issues.push(`exterior_source_use_invalid:${assetId}`);
      if (sourceAsset.source?.classification === "generated") issues.push(`generated_asset_role_unsupported:exterior:${assetId}`);
    }
  }
  const components = idMap(scene.components, "component", issues);
  const referencedGenerations = new Set();
  for (const [id, component] of components) {
    exactKeys(component, componentKeys, `component_keys_invalid:${id}`, issues);
    if (!componentFamilies.has(component.family)) issues.push(`component_family_invalid:${id}`);
    if (!assets.has(component.sourceRecordId)) issues.push(`component_source_unknown:${id}:${component.sourceRecordId}`);
    else {
      const sourceAsset = assets.get(component.sourceRecordId);
      if (!consumedAssetUsable(sourceAsset)) issues.push(`component_source_use_invalid:${id}:${component.sourceRecordId}`);
      if (sourceAsset.source?.classification === "generated") consumedGeneratedAssets.add(component.sourceRecordId);
    }
    if (component.generationRecordId !== null) {
      if (!generations.has(component.generationRecordId)) issues.push(`component_generation_unknown:${id}:${component.generationRecordId}`);
      else {
        const generation = generations.get(component.generationRecordId);
        referencedGenerations.add(component.generationRecordId);
        if (generation.componentId !== id) issues.push(`component_generation_mismatch:${id}:${component.generationRecordId}`);
        if (generation.status !== "accepted") issues.push(`component_generation_rejected:${id}:${component.generationRecordId}`);
        const sourceAsset = assets.get(component.sourceRecordId);
        if (!sourceAsset || generation.rawOutputSha256 !== sourceAsset.originalSha256 || !sameStringSet(generation.outputSha256, sourceAsset.outputSha256)) issues.push(`component_generation_output_unbound:${id}:${component.generationRecordId}`);
      }
    }
    const dimensions = component.dimensions;
    exactKeys(dimensions, dimensionKeys, `component_dimensions_keys_invalid:${id}`, issues);
    if (!isObject(dimensions) || ![dimensions.widthM, dimensions.heightM, dimensions.depthM].every((value) => Number.isFinite(value) && value > 0)) issues.push(`component_dimensions_invalid:${id}`);
    const position = component.transform?.position;
    exactKeys(component.transform, transformKeys, `component_transform_keys_invalid:${id}`, issues);
    if (!positionValid(position, `component_position:${id}`, issues) || !insideRoom(position, room)) issues.push(`component_out_of_bounds:${id}`);
    if (!Number.isFinite(component.transform?.yaw) || Math.abs(component.transform.yaw) > Math.PI + 1e-6) issues.push(`component_yaw_invalid:${id}`);
    if (isObject(dimensions) && positionValid(position, `component_bounds_position:${id}`, issues) && Number.isFinite(component.transform?.yaw)) {
      const halfX = Math.abs(Math.cos(component.transform.yaw)) * dimensions.widthM / 2 + Math.abs(Math.sin(component.transform.yaw)) * dimensions.depthM / 2;
      const halfZ = Math.abs(Math.sin(component.transform.yaw)) * dimensions.widthM / 2 + Math.abs(Math.cos(component.transform.yaw)) * dimensions.depthM / 2;
      if (Math.abs(position.x) + halfX > room.widthM / 2 || Math.abs(position.z) + halfZ > room.depthM / 2 || position.y + dimensions.heightM > room.ceilingY + 1e-6) issues.push(`component_footprint_out_of_bounds:${id}`);
    }
  }
  for (const assetId of consumedGeneratedAssets) {
    const asset = assets.get(assetId);
    const bound = [...generations.values()].some((generation) => generation.status === "accepted" && generation.rawOutputSha256 === asset.originalSha256 && sameStringSet(generation.outputSha256, asset.outputSha256));
    if (!bound) issues.push(`generated_asset_provenance_missing:${assetId}`);
  }
  for (const [id, generation] of generations) if (generation.status === "accepted" && !referencedGenerations.has(id)) issues.push(`accepted_generation_orphaned:${id}`);
  exactKeys(scene.clearance, clearanceKeys, "clearance_keys_invalid", issues);
  const routes = idMap(scene.clearance?.routes, "clearance_route", issues);
  const clearanceInsets = { north: 0, east: 0, south: 0, west: 0 };
  for (const detail of scene.architecturalDetails) {
    if (detail.kind !== "baseboard") continue;
    const profile = profiles.get(detail.profileId);
    if (profile) clearanceInsets[detail.wall] = Math.max(clearanceInsets[detail.wall], profile.depthM);
  }
  if (!isObject(scene.clearance) || !Number.isFinite(scene.clearance.minimumRouteWidthM) || scene.clearance.minimumRouteWidthM < 0.9 || routes.size !== 10) issues.push("clearance_invalid");
  for (const [id, route] of routes) {
    exactKeys(route, clearanceRouteKeys, `clearance_route_keys_invalid:${id}`, issues);
    if (!Number.isFinite(route.widthM) || route.widthM < scene.clearance.minimumRouteWidthM || !denseArray(route.points) || route.points.length < 2) issues.push(`clearance_route_invalid:${id}`);
    else route.points.forEach((point, index) => {
      if (!horizontalPointValid(point, `clearance_point:${id}:${index}`, issues) || Math.abs(point.x) > room.widthM / 2 || Math.abs(point.z) > room.depthM / 2) issues.push(`clearance_point_out_of_bounds:${id}:${index}`);
      if (index > 0 && (point.x + route.widthM / 2 > room.widthM / 2 - room.wallThicknessM / 2 - clearanceInsets.east
        || point.x - route.widthM / 2 < -room.widthM / 2 + room.wallThicknessM / 2 + clearanceInsets.west
        || point.z + route.widthM / 2 > room.depthM / 2 - room.wallThicknessM / 2 - clearanceInsets.north
        || point.z - route.widthM / 2 < -room.depthM / 2 + room.wallThicknessM / 2 + clearanceInsets.south)) issues.push(`clearance_corridor_out_of_bounds:${id}:${index}`);
      if (index > 0 && Math.hypot(point.x - route.points[index - 1].x, point.z - route.points[index - 1].z) < 1e-6) issues.push(`clearance_segment_empty:${id}:${index - 1}`);
    });
  }
  exactKeys(scene.spawn, spawnKeys, "spawn_keys_invalid", issues);
  if (!isObject(scene.spawn) || scene.spawn.id !== "main" || !positionValid(scene.spawn.position, "spawn_position", issues) || !insideRoom(scene.spawn.position, room, 0.5) || Math.abs(scene.spawn.position.y - room.floorY) > 0.1 || !Number.isFinite(scene.spawn.openRadiusM) || scene.spawn.openRadiusM < 0.75
    || scene.spawn.position.x + scene.spawn.openRadiusM > room.widthM / 2 - room.wallThicknessM / 2 - clearanceInsets.east
    || scene.spawn.position.x - scene.spawn.openRadiusM < -room.widthM / 2 + room.wallThicknessM / 2 + clearanceInsets.west
    || scene.spawn.position.z + scene.spawn.openRadiusM > room.depthM / 2 - room.wallThicknessM / 2 - clearanceInsets.north
    || scene.spawn.position.z - scene.spawn.openRadiusM < -room.depthM / 2 + room.wallThicknessM / 2 + clearanceInsets.south) issues.push("anchor_out_of_bounds:main");
  if (isObject(scene.spawn) && positionValid(scene.spawn.position, "spawn_collision_position", issues) && Number.isFinite(scene.spawn.openRadiusM)) for (const [componentId, component] of components) {
    if (component.transform?.position?.y >= 2 || !isObject(component.dimensions)) continue;
    const position = component.transform.position;
    const yaw = component.transform.yaw;
    const halfX = Math.abs(Math.cos(yaw)) * component.dimensions.widthM / 2 + Math.abs(Math.sin(yaw)) * component.dimensions.depthM / 2;
    const halfZ = Math.abs(Math.sin(yaw)) * component.dimensions.widthM / 2 + Math.abs(Math.cos(yaw)) * component.dimensions.depthM / 2;
    const closestX = Math.max(position.x - halfX, Math.min(scene.spawn.position.x, position.x + halfX));
    const closestZ = Math.max(position.z - halfZ, Math.min(scene.spawn.position.z, position.z + halfZ));
    if (Math.hypot(scene.spawn.position.x - closestX, scene.spawn.position.z - closestZ) < scene.spawn.openRadiusM) issues.push(`anchor_component_collision:main:${componentId}`);
  }
  const seatMap = idMap(scene.seats, "seat", issues);
  if (seatIds.some((id) => !seatMap.has(id)) || seatMap.size !== seatIds.length) issues.push("seat_ids_invalid");
  const seatValues = [...seatMap.values()];
  const overlapSafeSeats = [];
  for (const seat of seatValues) {
    exactKeys(seat, seatKeys, `seat_keys_invalid:${seat.id}`, issues);
    const hasValidPosition = positionValid(seat.position, `seat_position:${seat.id}`, issues);
    const hasValidValues = Number.isFinite(seat.yaw) && Math.abs(seat.yaw) <= Math.PI + 1e-6 && Number.isFinite(seat.radius) && seat.radius >= 0.35 && seat.radius <= 0.8 && Number.isFinite(seat.seatHeight) && seat.seatHeight >= 0 && seat.seatHeight <= 0.8;
    if (!hasValidPosition || !insideRoom(seat.position, room) || Math.abs(seat.position?.y - room.floorY) > 0.1) issues.push(`seat_out_of_bounds:${seat.id}`);
    if (!hasValidValues) issues.push(`seat_values_invalid:${seat.id}`);
    if (!components.has(seat.componentId) || components.get(seat.componentId)?.family !== "task-chair") issues.push(`seat_component_invalid:${seat.id}:${seat.componentId}`);
    else if (hasValidPosition && hasValidValues) {
      const chair = components.get(seat.componentId);
      if (Math.hypot(seat.position.x - chair.transform.position.x, seat.position.z - chair.transform.position.z) > 0.05 || Math.abs(seat.position.y - chair.transform.position.y) > 0.05 || angleDistance(seat.yaw, chair.transform.yaw) > 1e-6) issues.push(`seat_component_alignment_invalid:${seat.id}:${seat.componentId}`);
      if (seat.seatHeight > chair.dimensions.heightM || seat.position.y + seat.seatHeight > chair.transform.position.y + chair.dimensions.heightM) issues.push(`seat_height_outside_component:${seat.id}:${seat.componentId}`);
    }
    if (hasValidPosition && hasValidValues) overlapSafeSeats.push(seat);
  }
  for (let left = 0; left < overlapSafeSeats.length; left += 1) for (let right = left + 1; right < overlapSafeSeats.length; right += 1) {
    const a = overlapSafeSeats[left];
    const b = overlapSafeSeats[right];
    const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
    if (distance < 1.5 * Math.max(a.radius, b.radius)) issues.push(`seat_overlap:${a.id}:${b.id}`);
  }
  const surfaces = new Map();
  const surfaceIntervals = [];
  if (!denseArray(scene.mediaSurfaces)) issues.push("media_surfaces_invalid");
  else for (const surface of scene.mediaSurfaces) {
    if (!isObject(surface)) {
      issues.push("media_surface_record_invalid");
      continue;
    }
    exactKeys(surface, surfaceKeys, `media_surface_keys_invalid:${surface.surfaceId}`, issues);
    if (surfaces.has(surface.surfaceId)) issues.push(`media_surface_duplicate:${surface.surfaceId}`);
    surfaces.set(surface.surfaceId, surface);
    const target = surface.surfaceId === "debug-main" ? 1.7777777778 : 1.92;
    const onNorthWall = angleDistance(surface.yaw, Math.PI) < 1e-4 && Math.abs(surface.position.z - (room.depthM / 2 - room.wallThicknessM / 2)) <= 0.15;
    const onSouthWall = angleDistance(surface.yaw, 0) < 1e-4 && Math.abs(surface.position.z + (room.depthM / 2 - room.wallThicknessM / 2)) <= 0.15;
    const onEastWall = angleDistance(surface.yaw, -Math.PI / 2) < 1e-4 && Math.abs(surface.position.x - (room.widthM / 2 - room.wallThicknessM / 2)) <= 0.15;
    const onWestWall = angleDistance(surface.yaw, Math.PI / 2) < 1e-4 && Math.abs(surface.position.x + (room.widthM / 2 - room.wallThicknessM / 2)) <= 0.15;
    const horizontalFits = onNorthWall || onSouthWall ? Math.abs(surface.position.x) + surface.widthM / 2 <= room.widthM / 2 : onEastWall || onWestWall ? Math.abs(surface.position.z) + surface.widthM / 2 <= room.depthM / 2 : false;
    if (!positionValid(surface.position, `media_surface_position:${surface.surfaceId}`, issues) || !insideRoom(surface.position, room) || !Number.isFinite(surface.widthM) || !Number.isFinite(surface.heightM) || surface.widthM <= 0 || surface.heightM <= 0 || Math.abs(surface.widthM / surface.heightM - target) > target * 0.02 || !horizontalFits || surface.position.y - surface.heightM / 2 < room.floorY || surface.position.y + surface.heightM / 2 > room.ceilingY) issues.push(`media_surface_invalid:${surface.surfaceId}`);
    const wall = onNorthWall ? "north" : onSouthWall ? "south" : onEastWall ? "east" : onWestWall ? "west" : null;
    if (wall) {
      const center = wall === "north" || wall === "south" ? surface.position.x : surface.position.z;
      surfaceIntervals.push({ id: surface.surfaceId, wall, start: center - surface.widthM / 2, end: center + surface.widthM / 2, bottom: surface.position.y - surface.heightM / 2, top: surface.position.y + surface.heightM / 2 });
    }
  }
  for (const id of surfaceIds) if (!surfaces.has(id)) issues.push(`media_surface_missing:${id}`);
  for (let left = 0; left < surfaceIntervals.length; left += 1) {
    const surface = surfaceIntervals[left];
    for (let right = left + 1; right < surfaceIntervals.length; right += 1) {
      const other = surfaceIntervals[right];
      if (surface.wall === other.wall && surface.start < other.end && surface.end > other.start && surface.bottom < other.top && surface.top > other.bottom) issues.push(`media_surface_overlap:${surface.id}:${other.id}`);
    }
    for (const opening of openings.values()) {
      if (opening.wall !== surface.wall) continue;
      const openingInterval = openingWallInterval(opening, room);
      if (surface.start < openingInterval.end && surface.end > openingInterval.start && surface.bottom < opening.sillM + opening.heightM && surface.top > opening.sillM) issues.push(`media_surface_opening_overlap:${surface.id}:${opening.id}`);
    }
  }
  const views = new Map();
  if (!denseArray(scene.reviewViews)) issues.push("review_views_invalid");
  else for (const view of scene.reviewViews) {
    if (!isObject(view)) {
      issues.push("review_view_record_invalid");
      continue;
    }
    exactKeys(view, reviewViewKeys, `review_view_keys_invalid:${view.id}`, issues);
    if (views.has(view.id)) issues.push(`review_view_duplicate:${view.id}`);
    views.set(view.id, view);
    if (!positionValid(view.position, `review_view_position:${view.id}`, issues) || !insideRoom(view.position, room) || Math.abs(view.position.y - (room.floorY + 1.6)) > 1e-6 || !positionValid(view.target, `review_view_target:${view.id}`, issues) || !insideRoom(view.target, room) || !Number.isFinite(view.fovDegrees) || view.fovDegrees < 35 || view.fovDegrees > 90) issues.push(`review_view_invalid:${view.id}`);
  }
  for (const id of reviewViewIds) if (!views.has(id)) issues.push(`review_view_missing:${id}`);
  const destinations = new Map([["main", scene.spawn?.position], ["presenter", views.get("presenter")?.position]]);
  for (const [id, seat] of seatMap) destinations.set(id, seat.position);
  const requiredDestinations = new Set(["main", "presenter", ...seatIds]);
  const entrance = [...openings.values()].find((opening) => opening.kind === "door");
  const entrancePoint = entrance ? openingInteriorPoint(entrance, room) : null;
  const maximumRouteWidth = Math.max(scene.clearance.minimumRouteWidthM, ...[...routes.values()].map((route) => route.widthM));
  if (entrance && (entrance.widthM < maximumRouteWidth || entrance.heightM < 2)) issues.push(`entrance_clearance_invalid:${entrance.id}`);
  const observedDestinations = new Set();
  for (const [id, route] of routes) {
    if (!requiredDestinations.has(route.destinationId) || observedDestinations.has(route.destinationId)) issues.push(`clearance_destination_invalid:${id}:${route.destinationId}`);
    observedDestinations.add(route.destinationId);
    if (!denseArray(route.points) || route.points.length < 2) continue;
    const start = route.points[0];
    const end = route.points.at(-1);
    const destination = destinations.get(route.destinationId);
    if (!entrancePoint || Math.hypot(start.x - entrancePoint.x, start.z - entrancePoint.z) > 0.25) issues.push(`clearance_start_mismatch:${id}`);
    if (entrance && route.points.length >= 2) {
      const interval = openingWallInterval(entrance, room);
      const coordinate = entrance.wall === "north" || entrance.wall === "south" ? "x" : "z";
      const minimum = interval.start + route.widthM / 2;
      const maximum = interval.end - route.widthM / 2;
      if (start[coordinate] < minimum || start[coordinate] > maximum || route.points[1][coordinate] < minimum || route.points[1][coordinate] > maximum) issues.push(`clearance_entrance_corridor_invalid:${id}`);
    }
    if (!destination || Math.hypot(end.x - destination.x, end.z - destination.z) > 0.05) issues.push(`clearance_end_mismatch:${id}:${route.destinationId}`);
    const destinationSeat = seatMap.get(route.destinationId);
    for (let index = 1; index < route.points.length; index += 1) for (const [componentId, component] of components) {
      if (destinationSeat?.componentId === componentId || component.transform?.position?.y >= 2) continue;
      const dimensions = component.dimensions;
      const position = component.transform?.position;
      const yaw = component.transform?.yaw;
      if (!isObject(dimensions) || !position || !Number.isFinite(yaw)) continue;
      const halfX = Math.abs(Math.cos(yaw)) * dimensions.widthM / 2 + Math.abs(Math.sin(yaw)) * dimensions.depthM / 2 + route.widthM / 2;
      const halfZ = Math.abs(Math.sin(yaw)) * dimensions.widthM / 2 + Math.abs(Math.cos(yaw)) * dimensions.depthM / 2 + route.widthM / 2;
      if (segmentIntersectsBox(route.points[index - 1], route.points[index], position.x - halfX, position.x + halfX, position.z - halfZ, position.z + halfZ)) issues.push(`clearance_component_collision:${id}:${componentId}`);
    }
  }
  for (const destination of requiredDestinations) if (!observedDestinations.has(destination)) issues.push(`clearance_destination_missing:${destination}`);
}

export function validateSceneContract(scene, assetLedger, generationLedger) {
  const issues = [];
  collectNonFinite(scene, "scene", issues);
  collectNonFinite(assetLedger, "assetLedger", issues);
  collectNonFinite(generationLedger, "generationLedger", issues);
  if (issues.length !== 0) throw new SceneContractError(issues);
  applySchemaValidation(validateSceneSchema, scene, "scene", issues);
  applySchemaValidation(validateAssetLedgerSchema, assetLedger, "asset_ledger", issues);
  applySchemaValidation(validateGenerationLedgerSchema, generationLedger, "generation_ledger", issues);
  if (issues.length !== 0) throw new SceneContractError(issues);
  const sceneId = scene?.sceneId;
  const assets = validateAssetLedger(assetLedger, sceneId, issues);
  const generations = validateGenerationLedger(generationLedger, sceneId, assets, issues);
  validateScene(scene, assets, generations, issues);
  if (issues.length !== 0) throw new SceneContractError(issues);
  return Object.freeze({
    status: "stage3-scene-contract-valid",
    sceneId,
    specificationSha256: sha256(stableJson(scene)),
    assetLedgerSha256: sha256(stableJson(assetLedger)),
    generationLedgerSha256: sha256(stableJson(generationLedger)),
    assetRecordCount: assets.size,
    generationRecordCount: generations.size,
    componentCount: scene.components.length,
    seatCount: scene.seats.length
  });
}

function snapshotParserTexts(options, includeComponentConstruction) {
  if (!isObject(options)) throw new SceneContractError(["parser_options_invalid"]);
  const sceneText = options.sceneText;
  const assetLedgerText = options.assetLedgerText;
  const generationLedgerText = options.generationLedgerText;
  const componentConstructionText = includeComponentConstruction ? options.componentConstructionText : undefined;
  return Object.freeze({ sceneText, assetLedgerText, generationLedgerText, componentConstructionText });
}

function parseSceneContractSnapshot(texts) {
  const issues = [];
  const scene = parseStrictJson(texts.sceneText, "scene", issues);
  const assetLedger = parseStrictJson(texts.assetLedgerText, "asset_ledger", issues);
  const generationLedger = parseStrictJson(texts.generationLedgerText, "generation_ledger", issues);
  if (issues.length !== 0) throw new SceneContractError(issues);
  return Object.freeze({
    scene,
    assetLedger,
    generationLedger,
    report: validateSceneContract(scene, assetLedger, generationLedger)
  });
}

export function parseSceneContract(options) {
  return parseSceneContractSnapshot(snapshotParserTexts(options, false)).report;
}

const constructionFamilyIds = Object.freeze(["conference-av", "conference-table", "pendant-luminaire", "task-chair"]);
const constructionFamilyPartIds = Object.freeze({
  "conference-table": Object.freeze(["leg-negative-x", "leg-positive-x", "top"]),
  "task-chair": Object.freeze(["back", "leg-negative-x", "leg-positive-x", "seat"]),
  "conference-av": Object.freeze(["body"]),
  "pendant-luminaire": Object.freeze(["bar-negative-x", "bar-positive-x"])
});
const constructionFamilyDefaultMaterials = Object.freeze({
  "conference-table": Object.freeze({ surface: "warm-oak", frame: "graphite-metal" }),
  "task-chair": Object.freeze({ upholstery: "sand-fabric", frame: "graphite-metal" }),
  "conference-av": Object.freeze({ body: "graphite-metal" }),
  "pendant-luminaire": Object.freeze({ housing: "graphite-metal" })
});
const constructionPartMaterialSlots = Object.freeze({
  "conference-table": Object.freeze({ top: "surface", "leg-negative-x": "frame", "leg-positive-x": "frame" }),
  "task-chair": Object.freeze({ seat: "upholstery", back: "upholstery", "leg-negative-x": "frame", "leg-positive-x": "frame" }),
  "conference-av": Object.freeze({ body: "body" }),
  "pendant-luminaire": Object.freeze({ "bar-negative-x": "housing", "bar-positive-x": "housing" })
});
const constructionOverrides = Object.freeze(new Map([
  ["chair-02:upholstery", "muted-grey-green-fabric"],
  ["chair-07:upholstery", "muted-grey-green-fabric"]
]));
const constructionMaterialSourceKinds = Object.freeze(new Set(["material", "project-authored-input"]));
const constructionMaterialRecipes = Object.freeze(new Map([
  ["warm-oak", Object.freeze({ category: "wood", baseColorSrgb: "#A87543", roughness: 0.46, metalness: 0, textureScaleM: 0.18 })],
  ["mineral-plaster", Object.freeze({ category: "mineral", baseColorSrgb: "#DDD6C8", roughness: 0.84, metalness: 0, textureScaleM: 0.5 })],
  ["graphite-metal", Object.freeze({ category: "metal", baseColorSrgb: "#343A3C", roughness: 0.35, metalness: 0.7, textureScaleM: 0.2 })],
  ["sand-fabric", Object.freeze({ category: "fabric", baseColorSrgb: "#B9A98E", roughness: 0.72, metalness: 0, textureScaleM: 0.003 })],
  ["muted-grey-green-fabric", Object.freeze({ category: "fabric", baseColorSrgb: "#77877B", roughness: 0.8, metalness: 0, textureScaleM: 0.003 })]
]));

function validateConstructionMaterial(recipeId, context, recipes, assets, resolvedMaterials, issues) {
  if (!recipes.has(recipeId)) {
    issues.push(`component_construction_material_unknown:${context}:${recipeId}`);
    return;
  }
  const recipe = recipes.get(recipeId);
  const source = assets.get(recipe.sourceRecordId);
  if (!source || !consumedAssetUsable(source)) issues.push(`component_construction_material_use_invalid:${context}:${recipeId}`);
  resolvedMaterials.add(recipeId);
}

function worldPartHorizontal(component, part) {
  const componentYaw = component.transform.yaw;
  const localPosition = part.localTransform.position;
  return {
    x: component.transform.position.x + Math.cos(componentYaw) * localPosition.x - Math.sin(componentYaw) * localPosition.z,
    z: component.transform.position.z + Math.sin(componentYaw) * localPosition.x + Math.cos(componentYaw) * localPosition.z,
    yaw: componentYaw + part.localTransform.yaw,
    widthM: part.dimensions.widthM,
    depthM: part.dimensions.depthM
  };
}

function rectangleContainsRectangle(container, contained) {
  const containerCos = Math.cos(container.yaw);
  const containerSin = Math.sin(container.yaw);
  const containedCos = Math.cos(contained.yaw);
  const containedSin = Math.sin(contained.yaw);
  for (const xSign of [-1, 1]) for (const zSign of [-1, 1]) {
    const localX = xSign * contained.widthM / 2;
    const localZ = zSign * contained.depthM / 2;
    const worldX = contained.x + containedCos * localX - containedSin * localZ;
    const worldZ = contained.z + containedSin * localX + containedCos * localZ;
    const deltaX = worldX - container.x;
    const deltaZ = worldZ - container.z;
    const containerX = containerCos * deltaX + containerSin * deltaZ;
    const containerZ = -containerSin * deltaX + containerCos * deltaZ;
    if (Math.abs(containerX) > container.widthM / 2 + 1e-9 || Math.abs(containerZ) > container.depthM / 2 + 1e-9) return false;
  }
  return true;
}

function validateComponentConstructionContract(scene, assetLedger, construction, constructionText, sceneReport) {
  const issues = [];
  collectNonFinite(construction, "componentConstruction", issues);
  if (issues.length !== 0) throw new SceneContractError(issues);
  applySchemaValidation(validateComponentConstructionSchema, construction, "component_construction", issues);
  if (issues.length !== 0) throw new SceneContractError(issues);

  const constructionRawSha256 = sha256(constructionText);
  const assets = new Map(assetLedger.records.map((record) => [record.id, record]));
  const recipes = new Map(scene.materialRecipes.map((recipe) => [recipe.id, recipe]));
  const components = new Map(scene.components.map((component) => [component.id, component]));
  const seats = new Map(scene.seats.map((seat) => [seat.componentId, seat]));
  const families = new Map();
  const familySlots = new Map();
  const resolvedMaterials = new Set();
  const objectNames = new Set();
  let resolvedPartCount = 0;

  if (construction.sceneId !== scene.sceneId) issues.push("component_construction_scene_id_mismatch");
  const source = assets.get(construction.sourceRecordId);
  if (!source) issues.push(`component_construction_source_unknown:${construction.sourceRecordId}`);
  else {
    if (source.kind !== "project-authored-input" || source.source?.classification !== "project-authored") issues.push(`component_construction_source_kind_invalid:${construction.sourceRecordId}`);
    if (source.source?.repositoryPath !== "source/component-constructions.json" || source.source?.publicUrl !== null) issues.push(`component_construction_source_path_invalid:${construction.sourceRecordId}`);
    if (source.originalSha256 !== constructionRawSha256) issues.push(`component_construction_source_sha256_mismatch:${construction.sourceRecordId}`);
    if (!consumedAssetUsable(source)) issues.push(`component_construction_source_use_invalid:${construction.sourceRecordId}`);
  }
  if (!scene.generator.acceptedInputSha256.includes(constructionRawSha256)) issues.push(`component_construction_input_sha256_missing:${constructionRawSha256}`);

  if (construction.materialSourceRecordId === construction.sourceRecordId) issues.push("component_construction_material_source_must_be_separate");
  const materialSource = assets.get(construction.materialSourceRecordId);
  if (!materialSource) issues.push(`component_construction_material_source_unknown:${construction.materialSourceRecordId}`);
  else {
    if (!constructionMaterialSourceKinds.has(materialSource.kind)) issues.push(`component_construction_material_source_kind_invalid:${construction.materialSourceRecordId}`);
    if (materialSource.source?.classification !== "project-authored"
      || materialSource.source?.publicUrl !== null
      || typeof materialSource.source?.repositoryPath !== "string"
      || !materialSource.source.repositoryPath.startsWith("source/")
      || materialSource.source.repositoryPath === "source/component-constructions.json") issues.push(`component_construction_material_source_invalid:${construction.materialSourceRecordId}`);
    if (!consumedAssetUsable(materialSource)) issues.push(`component_construction_material_source_use_invalid:${construction.materialSourceRecordId}`);
  }

  if (scene.materialRecipes.length !== constructionMaterialRecipes.size) issues.push(`component_construction_material_recipe_count_invalid:${scene.materialRecipes.length}`);
  for (const [recipeId, expected] of constructionMaterialRecipes) {
    const recipe = recipes.get(recipeId);
    if (!recipe) {
      issues.push(`component_construction_material_recipe_missing:${recipeId}`);
      continue;
    }
    for (const [field, value] of Object.entries(expected)) if (recipe[field] !== value) issues.push(`component_construction_material_recipe_mismatch:${recipeId}:${field}`);
    if (recipe.sourceRecordId !== construction.materialSourceRecordId) issues.push(`component_construction_material_source_mismatch:${recipeId}:${recipe.sourceRecordId}`);
  }
  for (const recipeId of recipes.keys()) if (!constructionMaterialRecipes.has(recipeId)) issues.push(`component_construction_material_recipe_unexpected:${recipeId}`);

  for (const family of construction.families) {
    if (families.has(family.id)) issues.push(`component_construction_family_duplicate:${family.id}`);
    else families.set(family.id, family);
  }
  for (const familyId of constructionFamilyIds) if (!families.has(familyId)) issues.push(`component_construction_family_missing:${familyId}`);
  for (const familyId of families.keys()) if (!constructionFamilyIds.includes(familyId)) issues.push(`component_construction_family_unexpected:${familyId}`);

  const usedFamilies = new Set(scene.components.map((component) => component.family));
  if (usedFamilies.size !== 4) issues.push("component_construction_used_family_count_invalid");
  for (const familyId of usedFamilies) if (!families.has(familyId)) issues.push(`component_construction_scene_family_unresolved:${familyId}`);
  for (const familyId of families.keys()) if (!usedFamilies.has(familyId)) issues.push(`component_construction_family_unused:${familyId}`);

  for (const family of construction.families) {
    const slots = new Map();
    const usedSlots = new Set();
    for (const mapping of family.defaultMaterials) {
      if (slots.has(mapping.slot)) issues.push(`component_construction_slot_duplicate:${family.id}:${mapping.slot}`);
      else slots.set(mapping.slot, mapping.materialRecipeId);
      validateConstructionMaterial(mapping.materialRecipeId, `${family.id}:${mapping.slot}`, recipes, assets, resolvedMaterials, issues);
    }
    familySlots.set(family.id, slots);
    const expectedDefaultMaterials = constructionFamilyDefaultMaterials[family.id] ?? {};
    if (family.defaultMaterials.length !== Object.keys(expectedDefaultMaterials).length) issues.push(`component_construction_default_material_count_invalid:${family.id}:${family.defaultMaterials.length}`);
    for (const [slot, recipeId] of Object.entries(expectedDefaultMaterials)) {
      if (!slots.has(slot)) issues.push(`component_construction_default_material_missing:${family.id}:${slot}`);
      else if (slots.get(slot) !== recipeId) issues.push(`component_construction_default_material_mismatch:${family.id}:${slot}`);
    }
    for (const slot of slots.keys()) if (!Object.hasOwn(expectedDefaultMaterials, slot)) issues.push(`component_construction_default_material_unexpected:${family.id}:${slot}`);
    const partIds = new Set();
    for (const part of family.parts) {
      if (partIds.has(part.id)) issues.push(`component_construction_part_duplicate:${family.id}:${part.id}`);
      else partIds.add(part.id);
      if (!slots.has(part.materialSlotId)) issues.push(`component_construction_part_slot_unknown:${family.id}:${part.id}:${part.materialSlotId}`);
      else usedSlots.add(part.materialSlotId);
      const expectedMaterialSlot = constructionPartMaterialSlots[family.id]?.[part.id];
      if (expectedMaterialSlot !== undefined && part.materialSlotId !== expectedMaterialSlot) issues.push(`component_construction_part_material_slot_mismatch:${family.id}:${part.id}`);
      const dimensions = part.dimensions;
      const position = part.localTransform.position;
      const yaw = part.localTransform.yaw;
      if (yaw !== 0) issues.push(`component_construction_part_yaw_invalid:${family.id}:${part.id}`);
      const minimumDimension = Math.min(dimensions.widthM, dimensions.heightM, dimensions.depthM);
      if (part.bevel.widthM > minimumDimension / 2 + 1e-9) issues.push(`component_construction_bevel_out_of_bounds:${family.id}:${part.id}`);
      for (const component of scene.components.filter((record) => record.family === family.id)) {
        const halfX = Math.abs(Math.cos(yaw)) * dimensions.widthM / 2 + Math.abs(Math.sin(yaw)) * dimensions.depthM / 2;
        const halfZ = Math.abs(Math.sin(yaw)) * dimensions.widthM / 2 + Math.abs(Math.cos(yaw)) * dimensions.depthM / 2;
        const localBottom = position.y - dimensions.heightM / 2;
        const localTop = position.y + dimensions.heightM / 2;
        if (position.x - halfX < -component.dimensions.widthM / 2 - 1e-9
          || position.x + halfX > component.dimensions.widthM / 2 + 1e-9
          || position.z - halfZ < -component.dimensions.depthM / 2 - 1e-9
          || position.z + halfZ > component.dimensions.depthM / 2 + 1e-9
          || localBottom < -1e-9
          || localTop > component.dimensions.heightM + 1e-9) issues.push(`component_construction_part_out_of_component_bounds:${component.id}:${part.id}`);

        const componentYaw = component.transform.yaw;
        const worldX = component.transform.position.x + Math.cos(componentYaw) * position.x - Math.sin(componentYaw) * position.z;
        const worldZ = component.transform.position.z + Math.sin(componentYaw) * position.x + Math.cos(componentYaw) * position.z;
        const worldYaw = componentYaw + yaw;
        const worldHalfX = Math.abs(Math.cos(worldYaw)) * dimensions.widthM / 2 + Math.abs(Math.sin(worldYaw)) * dimensions.depthM / 2;
        const worldHalfZ = Math.abs(Math.sin(worldYaw)) * dimensions.widthM / 2 + Math.abs(Math.cos(worldYaw)) * dimensions.depthM / 2;
        const worldBottom = component.transform.position.y + localBottom;
        const worldTop = component.transform.position.y + localTop;
        const interiorHalfWidth = scene.room.widthM / 2 - scene.room.wallThicknessM / 2;
        const interiorHalfDepth = scene.room.depthM / 2 - scene.room.wallThicknessM / 2;
        if (Math.abs(worldX) + worldHalfX > interiorHalfWidth + 1e-9
          || Math.abs(worldZ) + worldHalfZ > interiorHalfDepth + 1e-9
          || worldBottom < scene.room.floorY - 1e-9
          || worldTop > scene.room.ceilingY + 1e-9) issues.push(`component_construction_part_world_bounds_invalid:${component.id}:${part.id}`);

        const objectName = `component.${component.id}.${part.id}`;
        if (objectNames.has(objectName)) issues.push(`component_construction_object_name_duplicate:${objectName}`);
        objectNames.add(objectName);
        resolvedPartCount += 1;
      }
    }
    const expectedPartIds = constructionFamilyPartIds[family.id] ?? [];
    if (family.parts.length !== expectedPartIds.length) issues.push(`component_construction_family_part_count_invalid:${family.id}:${family.parts.length}`);
    for (const partId of expectedPartIds) if (!partIds.has(partId)) issues.push(`component_construction_family_part_missing:${family.id}:${partId}`);
    for (const partId of partIds) if (!expectedPartIds.includes(partId)) issues.push(`component_construction_family_part_unexpected:${family.id}:${partId}`);
    for (const slot of slots.keys()) if (!usedSlots.has(slot)) issues.push(`component_construction_slot_unused:${family.id}:${slot}`);
  }

  for (const component of scene.components) {
    if (component.sourceRecordId !== construction.sourceRecordId) issues.push(`component_construction_component_source_mismatch:${component.id}`);
    if (component.generationRecordId !== null) issues.push(`component_construction_component_generation_invalid:${component.id}`);
  }

  const overrideKeys = new Set();
  if (construction.instanceMaterialOverrides.length !== constructionOverrides.size) issues.push(`component_construction_override_count_invalid:${construction.instanceMaterialOverrides.length}`);
  for (const override of construction.instanceMaterialOverrides) {
    const key = `${override.componentId}:${override.slot}`;
    if (overrideKeys.has(key)) issues.push(`component_construction_override_duplicate:${key}`);
    else overrideKeys.add(key);
    const component = components.get(override.componentId);
    if (!component) {
      issues.push(`component_construction_override_component_unknown:${override.componentId}`);
      continue;
    }
    const slots = familySlots.get(component.family);
    if (!slots?.has(override.slot)) issues.push(`component_construction_override_slot_unknown:${key}`);
    else if (slots.get(override.slot) === override.materialRecipeId) issues.push(`component_construction_override_unused:${key}`);
    if (constructionOverrides.get(key) !== override.materialRecipeId) issues.push(`component_construction_override_exact_invalid:${key}`);
    validateConstructionMaterial(override.materialRecipeId, key, recipes, assets, resolvedMaterials, issues);
  }
  for (const key of constructionOverrides.keys()) if (!overrideKeys.has(key)) issues.push(`component_construction_override_missing:${key}`);

  const chairFamily = families.get("task-chair");
  const chairSeat = chairFamily?.parts.find((part) => part.id === "seat");
  const chairBack = chairFamily?.parts.find((part) => part.id === "back");
  if (!chairSeat) issues.push("component_construction_chair_seat_missing");
  else for (const component of scene.components.filter((record) => record.family === "task-chair")) {
    const seat = seats.get(component.id);
    if (!seat) continue;
    const seatHeight = seat.position.y + seat.seatHeight;
    const partBottom = component.transform.position.y + chairSeat.localTransform.position.y - chairSeat.dimensions.heightM / 2;
    const partTop = component.transform.position.y + chairSeat.localTransform.position.y + chairSeat.dimensions.heightM / 2;
    if (seatHeight < partBottom - 1e-9 || seatHeight > partTop + 1e-9) issues.push(`component_construction_seat_height_miss:${seat.id}:${component.id}`);
  }
  if (!chairBack) issues.push("component_construction_chair_back_missing");
  else if (chairBack.localTransform.position.z + chairBack.dimensions.depthM / 2 > 1e-9) issues.push("component_construction_chair_back_direction_invalid");

  const table = scene.components.find((component) => component.family === "conference-table");
  const av = scene.components.find((component) => component.family === "conference-av");
  const tableTop = families.get("conference-table")?.parts.find((part) => part.id === "top");
  const avBody = families.get("conference-av")?.parts.find((part) => part.id === "body");
  if (!table || !av || !tableTop || !avBody) issues.push("component_construction_av_table_parts_missing");
  else {
    const tableTopY = table.transform.position.y + tableTop.localTransform.position.y + tableTop.dimensions.heightM / 2;
    const avBottomY = av.transform.position.y + avBody.localTransform.position.y - avBody.dimensions.heightM / 2;
    if (Math.abs(tableTopY - avBottomY) > 1e-9) issues.push("component_construction_av_table_height_mismatch");
    if (!rectangleContainsRectangle(worldPartHorizontal(table, tableTop), worldPartHorizontal(av, avBody))) issues.push("component_construction_av_table_horizontal_mismatch");
  }

  if (resolvedPartCount !== 38) issues.push(`component_construction_part_count_invalid:${resolvedPartCount}`);
  if (issues.length !== 0) throw new SceneContractError(issues);
  return Object.freeze({
    ...sceneReport,
    status: "stage3-component-construction-contract-valid",
    componentConstructionSha256: sha256(stableJson(construction)),
    componentConstructionRawSha256: constructionRawSha256,
    familyCount: families.size,
    partCount: resolvedPartCount,
    overrideCount: construction.instanceMaterialOverrides.length,
    resolvedComponentCount: components.size,
    resolvedMaterialCount: resolvedMaterials.size,
    objectNamePattern: "component.<componentId>.<partId>",
    boundaries: Object.freeze({
      componentsSpecified: true,
      componentsCompiled: false,
      finalCandidateGlbVerified: false,
      publicationReady: false
    })
  });
}

export function parseComponentConstructionContract(options) {
  const texts = snapshotParserTexts(options, true);
  const sceneContract = parseSceneContractSnapshot(texts);
  const issues = [];
  const construction = parseStrictJson(texts.componentConstructionText, "component_construction", issues);
  if (issues.length !== 0) throw new SceneContractError(issues);
  return validateComponentConstructionContract(sceneContract.scene, sceneContract.assetLedger, construction, texts.componentConstructionText, sceneContract.report);
}
