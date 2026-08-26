import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseExteriorConstructionContract,
  parseSceneContract,
  SceneContractError
} from "../compiler/scene-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const stage3FixtureRoot = resolve(root, "tests/fixtures/stage3");
const constructionFixtureRoot = resolve(root, "tests/fixtures/exterior-construction");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

async function readFixture(rootPath, name) {
  return readFile(resolve(rootPath, name), "utf8");
}

async function validObjects() {
  const [scene, assetLedger, generationLedger, exteriorConstructionText] = await Promise.all([
    readFixture(stage3FixtureRoot, "scene-spec.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "asset-ledger.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "generation-ledger.valid.json").then(JSON.parse),
    readFixture(constructionFixtureRoot, "exterior-constructions.valid.json")
  ]);
  const exteriorConstruction = JSON.parse(exteriorConstructionText);
  const sourceRecord = {
    id: exteriorConstruction.sourceRecordId,
    kind: "project-authored-input",
    source: { classification: "project-authored", publicUrl: null, repositoryPath: "source/exterior-constructions.json" },
    authorProvider: "project-team",
    license: { name: "LicenseRef-Project-Owned", reference: "provenance/licenses/project-owned.txt", commercialUse: true, redistribution: true, mlProcessing: true },
    acquiredOn: "2026-08-26",
    originalSha256: sha256(exteriorConstructionText),
    allowedUse: { staging: true, production: false, webRuntime: true, screenshots: true, optimization: true, redistribution: true },
    modifications: [],
    outputSha256: [],
    attribution: null
  };
  assetLedger.records.push(sourceRecord);
  scene.generator.acceptedInputSha256.push(sourceRecord.originalSha256);
  scene.exterior.sourceRecordIds = [sourceRecord.id];
  return {
    scene,
    assetLedger,
    generationLedger,
    exteriorConstruction,
    exteriorConstructionFixtureText: exteriorConstructionText,
    sourceRecord
  };
}

function textsFromObjects(value, options = {}) {
  const fixtureConstruction = JSON.parse(value.exteriorConstructionFixtureText);
  const exteriorConstructionText = JSON.stringify(value.exteriorConstruction) === JSON.stringify(fixtureConstruction)
    ? value.exteriorConstructionFixtureText
    : `${JSON.stringify(value.exteriorConstruction, null, 2)}\n`;
  const rawSha256 = sha256(exteriorConstructionText);
  const previousRawSha256 = value.sourceRecord.originalSha256;
  if (options.bindSource !== false) value.sourceRecord.originalSha256 = rawSha256;
  if (options.bindAcceptedInput !== false) {
    value.scene.generator.acceptedInputSha256 = [
      ...value.scene.generator.acceptedInputSha256.filter((digest) => digest !== previousRawSha256 && digest !== rawSha256),
      rawSha256
    ];
  }
  return {
    sceneText: `${JSON.stringify(value.scene, null, 2)}\n`,
    assetLedgerText: `${JSON.stringify(value.assetLedger, null, 2)}\n`,
    generationLedgerText: `${JSON.stringify(value.generationLedger, null, 2)}\n`,
    exteriorConstructionText
  };
}

async function validTexts() {
  return textsFromObjects(await validObjects());
}

function captureContractError(operation) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof SceneContractError, error?.stack);
    assert.deepEqual(error.issues, [...error.issues].sort());
    return error;
  }
  assert.fail("expected SceneContractError");
}

function setPath(target, path, value) {
  const segments = path.split(".");
  const key = segments.pop();
  let parent = target;
  for (const segment of segments) parent = parent[segment];
  parent[key] = value;
}

test("candidate-owned exterior construction returns a frozen non-readiness report", async () => {
  const value = await validObjects();
  const texts = textsFromObjects(value);
  const report = parseExteriorConstructionContract(texts);
  assert.deepEqual(Object.keys(report), [
    "status",
    "sceneId",
    "specificationSha256",
    "assetLedgerSha256",
    "generationLedgerSha256",
    "assetRecordCount",
    "generationRecordCount",
    "componentCount",
    "seatCount",
    "exteriorConstructionSha256",
    "exteriorConstructionRawSha256",
    "objectCount",
    "resolvedObjectCount",
    "materialCount",
    "roleCount",
    "strategy",
    "windowOpeningId",
    "objectNamePattern",
    "boundsM",
    "boundaries"
  ]);
  assert.equal(report.status, "stage3-exterior-construction-contract-valid");
  assert.equal(report.exteriorConstructionSha256, sha256(stableJson(value.exteriorConstruction)));
  assert.equal(report.exteriorConstructionRawSha256, sha256(texts.exteriorConstructionText));
  assert.equal(report.assetRecordCount, 8);
  assert.equal(report.objectCount, 4);
  assert.equal(report.resolvedObjectCount, 4);
  assert.equal(report.materialCount, 3);
  assert.equal(report.roleCount, 4);
  assert.equal(report.strategy, "project-authored-geometry");
  assert.equal(report.windowOpeningId, "main-window");
  assert.equal(report.objectNamePattern, "exterior.<objectId>");
  assert.deepEqual(report.boundsM, value.exteriorConstruction.boundsM);
  assert.deepEqual(report.boundaries, {
    exteriorSpecified: true,
    exteriorCompiled: false,
    finalCandidateGlbVerified: false,
    publicationReady: false
  });
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.boundsM));
  assert.ok(Object.isFrozen(report.boundsM.min));
  assert.ok(Object.isFrozen(report.boundsM.max));
  assert.ok(Object.isFrozen(report.boundaries));
});

test("existing scene parser remains unchanged and does not require exterior construction text", async () => {
  const texts = await validTexts();
  const report = parseSceneContract({
    sceneText: texts.sceneText,
    assetLedgerText: texts.assetLedgerText,
    generationLedgerText: texts.generationLedgerText
  });
  assert.deepEqual(Object.keys(report), [
    "status",
    "sceneId",
    "specificationSha256",
    "assetLedgerSha256",
    "generationLedgerSha256",
    "assetRecordCount",
    "generationRecordCount",
    "componentCount",
    "seatCount"
  ]);
  assert.equal(report.status, "stage3-scene-contract-valid");
});

test("source binding resolves a renamed project-authored exterior record without a hardcoded id", async () => {
  const value = await validObjects();
  value.sourceRecord.id = "asset-bounded-exterior-contract";
  value.exteriorConstruction.sourceRecordId = value.sourceRecord.id;
  value.scene.exterior.sourceRecordIds = [value.sourceRecord.id];
  assert.equal(parseExteriorConstructionContract(textsFromObjects(value)).status, "stage3-exterior-construction-contract-valid");
});

test("parser snapshots getter and proxy inputs exactly once before parsing", async () => {
  const texts = await validTexts();
  const expected = parseExteriorConstructionContract(texts);
  const reads = Object.fromEntries(Object.keys(texts).map((key) => [key, 0]));
  const getterOptions = {};
  for (const [key, text] of Object.entries(texts)) Object.defineProperty(getterOptions, key, {
    enumerable: true,
    get() {
      reads[key] += 1;
      return reads[key] === 1 ? text : "{\n";
    }
  });
  assert.deepEqual(parseExteriorConstructionContract(getterOptions), expected);
  assert.deepEqual(reads, {
    sceneText: 1,
    assetLedgerText: 1,
    generationLedgerText: 1,
    exteriorConstructionText: 1
  });

  const order = [];
  const proxy = new Proxy({}, {
    get(_target, key) {
      if (!Object.hasOwn(texts, key)) return undefined;
      order.push(key);
      return texts[key];
    }
  });
  assert.deepEqual(parseExteriorConstructionContract(proxy), expected);
  assert.deepEqual(order, ["sceneText", "assetLedgerText", "generationLedgerText", "exteriorConstructionText"]);
});

test("exterior JSON rejects duplicate keys, malformed text, missing text, and noncanonical encodings", async (t) => {
  const texts = await validTexts();
  const duplicate = texts.exteriorConstructionText.replace(
    '  "schemaVersion": 1,',
    '  "schemaVersion": 1,\n  "schemaVersion": 1,'
  );
  assert.deepEqual(captureContractError(() => parseExteriorConstructionContract({
    ...texts,
    exteriorConstructionText: duplicate
  })).issues, ["exterior_construction_duplicate_key"]);
  assert.deepEqual(captureContractError(() => parseExteriorConstructionContract({
    ...texts,
    exteriorConstructionText: "{\n"
  })).issues, ["exterior_construction_json_invalid"]);
  const { exteriorConstructionText: omitted, ...withoutConstruction } = texts;
  assert.equal(typeof omitted, "string");
  assert.deepEqual(captureContractError(() => parseExteriorConstructionContract(withoutConstruction)).issues, ["exterior_construction_text_invalid"]);

  const noncanonical = [
    ["missing final newline", texts.exteriorConstructionText.slice(0, -1)],
    ["CRLF", texts.exteriorConstructionText.replaceAll("\n", "\r\n")],
    ["tab", texts.exteriorConstructionText.replace('  "schemaVersion"', '\t"schemaVersion"')],
    ["BOM", `\ufeff${texts.exteriorConstructionText}`],
    ["extra final newline", `${texts.exteriorConstructionText}\n`],
    ["noncanonical spacing", texts.exteriorConstructionText.replace('  "schemaVersion"', '    "schemaVersion"')]
  ];
  for (const [name, exteriorConstructionText] of noncanonical) await t.test(name, () => {
    assert.deepEqual(captureContractError(() => parseExteriorConstructionContract({
      ...texts,
      exteriorConstructionText
    })).issues, ["exterior_construction_encoding_noncanonical"]);
  });

  const invalidSceneText = texts.sceneText.replace('"seed": 42', '"seed": -1');
  assert.deepEqual(captureContractError(() => parseExteriorConstructionContract({
    ...texts,
    sceneText: invalidSceneText,
    exteriorConstructionText: "{\n"
  })).issues, ["schema_scene:generator:seed:minimum"]);

  const deeplyNested = texts.exteriorConstructionText.replace(
    '  "sceneId": "warm-modern-meeting-room-candidate-01",',
    `  "sceneId": ${"[".repeat(5000)}0${"]".repeat(5000)},`
  );
  const depthError = captureContractError(() => parseExteriorConstructionContract({
    ...texts,
    exteriorConstructionText: deeplyNested
  }));
  assert.ok(depthError.issues.some((issue) => issue.startsWith("nesting_too_deep:exteriorConstruction:sceneId")));
});

test("checked-in negative exterior fixtures fail with stable diagnostics", async (t) => {
  const names = (await readdir(constructionFixtureRoot)).filter((name) => name.startsWith("negative.")).sort();
  assert.deepEqual(names, [
    "negative.duplicate-object.json",
    "negative.source-path.json",
    "negative.strategy-drift.json",
    "negative.window-binding.json"
  ]);
  for (const name of names) await t.test(name, async () => {
    const mutation = JSON.parse(await readFixture(constructionFixtureRoot, name));
    const value = await validObjects();
    setPath(value[mutation.target], mutation.path, mutation.value);
    const error = captureContractError(() => parseExteriorConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(mutation.expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("source provenance, rights, raw bytes, accepted input, and scene closure fail closed", async (t) => {
  const cases = [
    ["scene id", (value) => { value.exteriorConstruction.sceneId = "warm-modern-meeting-room-candidate-02"; }, {}, "exterior_construction_scene_id_mismatch"],
    ["unknown source", (value) => { value.exteriorConstruction.sourceRecordId = "missing-source"; }, {}, "exterior_construction_source_unknown:missing-source"],
    ["source kind", (value) => { value.sourceRecord.kind = "mesh"; }, {}, "exterior_construction_source_kind_invalid:asset-exterior-constructions"],
    ["generated source", (value) => { value.sourceRecord.kind = "generated-output"; value.sourceRecord.source.classification = "generated"; }, {}, "generated_asset_role_unsupported:exterior:asset-exterior-constructions"],
    ["raw hash", (value) => { value.exteriorConstruction.materials.reverse(); }, { bindSource: false, bindAcceptedInput: false }, "exterior_construction_source_sha256_mismatch:asset-exterior-constructions"],
    ["accepted input", (value) => { value.scene.generator.acceptedInputSha256 = [value.scene.generator.acceptedInputSha256[0]]; }, { bindAcceptedInput: false }, "exterior_construction_input_sha256_missing"],
    ["web runtime right", (value) => { value.sourceRecord.allowedUse.webRuntime = false; }, {}, "exterior_source_use_invalid:asset-exterior-constructions"],
    ["optimization right", (value) => { value.sourceRecord.allowedUse.optimization = false; }, {}, "exterior_source_use_invalid:asset-exterior-constructions"],
    ["ambiguous source path", (value) => { value.assetLedger.records.push({ ...structuredClone(value.sourceRecord), id: "asset-exterior-constructions-shadow" }); }, {}, "exterior_construction_source_path_ambiguous:source/exterior-constructions.json"],
    ["scene strategy", (value) => { value.scene.exterior.strategy = "procedural-exterior"; }, {}, "exterior_construction_strategy_mismatch:project-authored-geometry"],
    ["scene source set", (value) => { value.scene.exterior.sourceRecordIds.push("asset-material-project"); }, {}, "exterior_construction_scene_sources_mismatch"]
  ];
  for (const [name, mutate, options, expectedIssuePrefix] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseExteriorConstructionContract(textsFromObjects(value, options)));
    assert.ok(error.issues.some((issue) => issue.startsWith(expectedIssuePrefix)), `${name}: ${error.issues.join(",")}`);
  });
});

test("geometry, materials, support graph, visibility, and bounded depth fail closed", async (t) => {
  const cases = [
    ["missing vegetation role", (value) => { value.exteriorConstruction.objects[2].role = "vegetation-container"; }, "exterior_construction_role_missing:vegetation"],
    ["duplicate material", (value) => { value.exteriorConstruction.materials[1].id = "ground-mineral"; }, "exterior_construction_material_duplicate:ground-mineral"],
    ["unknown material", (value) => { value.exteriorConstruction.objects[1].materialId = "missing-material"; }, "exterior_construction_material_unknown:planter:missing-material"],
    ["material role", (value) => { value.exteriorConstruction.objects[2].materialId = "exterior-graphite"; }, "exterior_construction_material_role_invalid:hedge:exterior-graphite"],
    ["unused material", (value) => { value.exteriorConstruction.materials.push({ id: "unused-mineral", category: "mineral", baseColorSrgb: "#AAAAAA", roughness: 0.8, metalness: 0, textureScaleM: 0.5 }); }, "exterior_construction_material_unused:unused-mineral"],
    ["bevel", (value) => { value.exteriorConstruction.objects[0].dimensions.heightM = 0.08; value.exteriorConstruction.objects[0].transform.position.y = -0.04; value.exteriorConstruction.objects[0].bevel.widthM = 0.05; value.exteriorConstruction.boundsM.min.y = -0.08; }, "exterior_construction_bevel_out_of_bounds:near-ground"],
    ["inside room", (value) => { value.exteriorConstruction.objects[0].transform.position.z = 7.5; }, "exterior_construction_object_inside_room:near-ground"],
    ["declared union", (value) => { value.exteriorConstruction.boundsM.max.x = 5.1; }, "exterior_construction_bounds_union_mismatch:max:x"],
    ["support missing", (value) => { value.exteriorConstruction.objects[1].supportObjectId = null; }, "exterior_construction_support_missing:planter"],
    ["support unknown", (value) => { value.exteriorConstruction.objects[1].supportObjectId = "missing-support"; }, "exterior_construction_support_unknown:planter:missing-support"],
    ["support self", (value) => { value.exteriorConstruction.objects[1].supportObjectId = "planter"; }, "exterior_construction_support_self:planter"],
    ["support cycle", (value) => { value.exteriorConstruction.objects[0].supportObjectId = "planter"; }, "exterior_construction_support_cycle:near-ground"],
    ["support role", (value) => { value.exteriorConstruction.objects[2].supportObjectId = "near-ground"; }, "exterior_construction_support_role_invalid:hedge:near-ground"],
    ["support height", (value) => { value.exteriorConstruction.objects[1].transform.position.y = 0.4; }, "exterior_construction_support_height_mismatch:planter:near-ground"],
    ["support footprint", (value) => { value.exteriorConstruction.objects[2].transform.position.x = -2.1; }, "exterior_construction_support_footprint_invalid:hedge:planter"],
    ["positive overlap", (value) => { value.exteriorConstruction.objects[1].transform.position.y = 0.2; }, "exterior_construction_object_overlap:near-ground:planter"],
    ["ground window", (value) => { value.exteriorConstruction.objects[0].transform.position.x = 4; value.exteriorConstruction.boundsM.max.x = 9; value.exteriorConstruction.boundsM.min.x = -2.075; }, "exterior_construction_ground_window_mismatch:near-ground"],
    ["vegetation invisible", (value) => { value.exteriorConstruction.objects[2].transform.position.x = -4; }, "exterior_construction_vegetation_not_visible"],
    ["vegetation too distant", (value) => { value.exteriorConstruction.objects[1].transform.position.z = 8; value.exteriorConstruction.objects[2].transform.position.z = 8; }, "exterior_construction_vegetation_not_visible"],
    ["exterior occluded", (value) => { value.exteriorConstruction.objects.push({ id: "window-occluder", role: "vegetation-container", geometry: "beveled-box", dimensions: { widthM: 3.4, heightM: 2.5, depthM: 0.2 }, transform: { position: { x: -0.2, y: 1.25, z: 4.2 }, yaw: 0 }, bevel: { widthM: 0.01, segments: 3, clampOverlap: true }, materialId: "exterior-graphite", supportObjectId: "near-ground" }); }, "exterior_construction_vegetation_not_visible"],
    ["thin visible slit", (value) => { value.exteriorConstruction.objects.push({ id: "window-occluder", role: "vegetation-container", geometry: "beveled-box", dimensions: { widthM: 3.38, heightM: 2.5, depthM: 0.2 }, transform: { position: { x: -0.19, y: 1.25, z: 4.2 }, yaw: 0 }, bevel: { widthM: 0.01, segments: 3, clampOverlap: true }, materialId: "exterior-graphite", supportObjectId: "near-ground" }); }, "exterior_construction_vegetation_not_visible"],
    ["context depth", (value) => { value.exteriorConstruction.objects[3].transform.position.z = 6; }, "exterior_construction_context_depth_invalid:context-mass"],
    ["context invisible", (value) => { value.exteriorConstruction.objects[3].transform.position.x = 4; }, "exterior_construction_context_not_visible:context-mass"],
    ["floor-relative opening", (value) => { value.scene.room.floorY = -0.05; value.scene.room.ceilingY = 3.05; value.scene.reviewViews.forEach((view) => { view.position.y -= 0.05; }); value.exteriorConstruction.objects[0].transform.position.y = -0.14; value.exteriorConstruction.objects[1].dimensions.heightM = 2.43; value.exteriorConstruction.objects[1].transform.position.y = 1.165; value.exteriorConstruction.objects[2].transform.position.y = 2.72; value.exteriorConstruction.objects[3].transform.position.y = 1.45; value.exteriorConstruction.boundsM.min.y = -0.23; value.exteriorConstruction.boundsM.max.y = 3.06; }, "exterior_construction_vegetation_not_visible"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseExteriorConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("exterior construction schema exposes bounded volumetric project-authored geometry only", async () => {
  const schema = JSON.parse(await readFixture(root, "schemas/exterior-constructions.schema.json"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schemaVersion", "sceneId", "sourceRecordId", "strategy", "windowOpeningId", "boundsM", "materials", "objects"]);
  assert.equal(schema.properties.strategy.const, "project-authored-geometry");
  assert.equal(schema.properties.objects.minItems, 4);
  assert.equal(schema.properties.objects.maxItems, 12);
  assert.equal(schema.$defs.object.properties.geometry.const, "beveled-box");
  assert.deepEqual(schema.$defs.object.properties.role.enum, ["nearby-ground", "vegetation-container", "vegetation", "middle-distance-context"]);
  assert.equal(schema.$defs.transform.properties.yaw.const, 0);
  assert.equal(schema.$defs.bevel.properties.segments.const, 3);
  assert.equal(schema.$defs.bevel.properties.clampOverlap.const, true);
  assert.deepEqual(schema.$defs.material.properties.category.enum, ["ground", "metal", "mineral", "vegetation"]);
  for (const forbidden of ["image", "imageUrl", "texture", "textureUrl", "hdri", "publicUrl", "generationRecordId"]) {
    assert.equal(Object.hasOwn(schema.properties, forbidden), false);
    assert.equal(Object.hasOwn(schema.$defs.object.properties, forbidden), false);
  }
});
