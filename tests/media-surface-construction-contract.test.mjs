import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseMediaSurfaceConstructionContract,
  parseSceneContract,
  SceneContractError
} from "../compiler/scene-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const stage3FixtureRoot = resolve(root, "tests/fixtures/stage3");
const constructionFixtureRoot = resolve(root, "tests/fixtures/media-surface-construction");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readFixture(rootPath, name) {
  return readFile(resolve(rootPath, name), "utf8");
}

async function validObjects() {
  const [scene, assetLedger, generationLedger, mediaSurfaceConstructionText] = await Promise.all([
    readFixture(stage3FixtureRoot, "scene-spec.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "asset-ledger.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "generation-ledger.valid.json").then(JSON.parse),
    readFixture(constructionFixtureRoot, "media-surface-constructions.valid.json")
  ]);
  const mediaSurfaceConstruction = JSON.parse(mediaSurfaceConstructionText);
  const sourceRecord = {
    id: mediaSurfaceConstruction.sourceRecordId,
    kind: "project-authored-input",
    source: { classification: "project-authored", publicUrl: null, repositoryPath: "source/media-surface-constructions.json" },
    authorProvider: "project-team",
    license: { name: "LicenseRef-Project-Owned", reference: "provenance/licenses/project-owned.txt", commercialUse: true, redistribution: true, mlProcessing: true },
    acquiredOn: "2026-08-25",
    originalSha256: sha256(mediaSurfaceConstructionText),
    allowedUse: { staging: true, production: true, webRuntime: true, screenshots: true, optimization: true, redistribution: true },
    modifications: [],
    outputSha256: [],
    attribution: null
  };
  assetLedger.records.push(sourceRecord);
  scene.generator.acceptedInputSha256.push(sourceRecord.originalSha256);
  return {
    scene,
    assetLedger,
    generationLedger,
    mediaSurfaceConstruction,
    mediaSurfaceConstructionFixtureText: mediaSurfaceConstructionText,
    sourceRecord
  };
}

function textsFromObjects(value, options = {}) {
  const fixtureConstruction = JSON.parse(value.mediaSurfaceConstructionFixtureText);
  const mediaSurfaceConstructionText = JSON.stringify(value.mediaSurfaceConstruction) === JSON.stringify(fixtureConstruction)
    ? value.mediaSurfaceConstructionFixtureText
    : `${JSON.stringify(value.mediaSurfaceConstruction, null, 2)}\n`;
  const rawSha256 = sha256(mediaSurfaceConstructionText);
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
    mediaSurfaceConstructionText
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

test("candidate-owned media surface construction contract returns a frozen non-readiness report", async () => {
  const report = parseMediaSurfaceConstructionContract(await validTexts());
  assert.deepEqual(report, {
    status: "stage3-media-surface-construction-contract-valid",
    sceneId: "warm-modern-meeting-room-candidate-01",
    specificationSha256: "f46a3bf8e98d07f6c0d7b03d415dbcb67fe95e6faf3c5d205adf9a6b5c9948cb",
    assetLedgerSha256: "6f261c678dbb961cfbf5e3918d805089759ba022691adcf7e43299e1bd5da9d3",
    generationLedgerSha256: "39ef74d47488966b8e9b4df9541ba039085260a2a8fb75d9add3804558491c51",
    assetRecordCount: 8,
    generationRecordCount: 1,
    componentCount: 11,
    seatCount: 8,
    mediaSurfaceConstructionSha256: "6246a64d00aef7fc85c9c0afb2e61975ebd82428cfb509dc0841cea249dbee0a",
    mediaSurfaceConstructionRawSha256: "204aa0cdb84c224f6c347141266cc823ecf996e8c2f0429bade83b145cb565a5",
    surfaceCount: 2,
    resolvedSurfaceCount: 2,
    representation: "platform-runtime-plane",
    boundaries: {
      mediaSurfacesSpecified: true,
      mediaSurfacesCompiled: false,
      finalCandidateGlbVerified: false,
      publicationReady: false
    }
  });
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.boundaries));
});

test("existing scene parser remains unchanged and does not require media construction text", async () => {
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

test("source binding resolves a renamed project-authored record without a hardcoded id", async () => {
  const value = await validObjects();
  value.sourceRecord.id = "asset-runtime-plane-contract";
  value.mediaSurfaceConstruction.sourceRecordId = value.sourceRecord.id;
  assert.equal(
    parseMediaSurfaceConstructionContract(textsFromObjects(value)).status,
    "stage3-media-surface-construction-contract-valid"
  );
});

test("parser snapshots getter and proxy inputs exactly once before parsing", async () => {
  const texts = await validTexts();
  const expected = parseMediaSurfaceConstructionContract(texts);
  const reads = Object.fromEntries(Object.keys(texts).map((key) => [key, 0]));
  const getterOptions = {};
  for (const [key, text] of Object.entries(texts)) Object.defineProperty(getterOptions, key, {
    enumerable: true,
    get() {
      reads[key] += 1;
      return reads[key] === 1 ? text : "{\n";
    }
  });
  assert.deepEqual(parseMediaSurfaceConstructionContract(getterOptions), expected);
  assert.deepEqual(reads, {
    sceneText: 1,
    assetLedgerText: 1,
    generationLedgerText: 1,
    mediaSurfaceConstructionText: 1
  });

  const order = [];
  const proxy = new Proxy({}, {
    get(_target, key) {
      if (!Object.hasOwn(texts, key)) return undefined;
      order.push(key);
      return texts[key];
    }
  });
  assert.deepEqual(parseMediaSurfaceConstructionContract(proxy), expected);
  assert.deepEqual(order, ["sceneText", "assetLedgerText", "generationLedgerText", "mediaSurfaceConstructionText"]);
});

test("construction JSON rejects duplicate keys, malformed text, missing text, and noncanonical encodings", async (t) => {
  const texts = await validTexts();
  const duplicate = texts.mediaSurfaceConstructionText.replace(
    '  "schemaVersion": 1,',
    '  "schemaVersion": 1,\n  "schemaVersion": 1,'
  );
  assert.deepEqual(captureContractError(() => parseMediaSurfaceConstructionContract({
    ...texts,
    mediaSurfaceConstructionText: duplicate
  })).issues, ["media_surface_construction_duplicate_key"]);
  assert.deepEqual(captureContractError(() => parseMediaSurfaceConstructionContract({
    ...texts,
    mediaSurfaceConstructionText: "{\n"
  })).issues, ["media_surface_construction_json_invalid"]);
  const { mediaSurfaceConstructionText: omitted, ...withoutConstruction } = texts;
  assert.equal(typeof omitted, "string");
  assert.deepEqual(captureContractError(() => parseMediaSurfaceConstructionContract(withoutConstruction)).issues, ["media_surface_construction_text_invalid"]);

  const noncanonical = [
    ["missing final newline", texts.mediaSurfaceConstructionText.slice(0, -1)],
    ["CRLF", texts.mediaSurfaceConstructionText.replaceAll("\n", "\r\n")],
    ["tab", texts.mediaSurfaceConstructionText.replace("  \"schemaVersion\"", "\t\"schemaVersion\"")],
    ["BOM", `\ufeff${texts.mediaSurfaceConstructionText}`],
    ["extra final newline", `${texts.mediaSurfaceConstructionText}\n`],
    ["noncanonical spacing", texts.mediaSurfaceConstructionText.replace('  "schemaVersion"', '    "schemaVersion"')]
  ];
  for (const [name, mediaSurfaceConstructionText] of noncanonical) await t.test(name, () => {
    assert.deepEqual(captureContractError(() => parseMediaSurfaceConstructionContract({
      ...texts,
      mediaSurfaceConstructionText
    })).issues, ["media_surface_construction_encoding_noncanonical"]);
  });

  const invalidSceneText = texts.sceneText.replace('"seed": 42', '"seed": -1');
  assert.deepEqual(captureContractError(() => parseMediaSurfaceConstructionContract({
    ...texts,
    sceneText: invalidSceneText,
    mediaSurfaceConstructionText: "{\n"
  })).issues, ["schema_scene:generator:seed:minimum"]);
});

test("checked-in negative media surface construction fixtures fail with stable diagnostics", async (t) => {
  const names = (await readdir(constructionFixtureRoot)).filter((name) => name.startsWith("negative.")).sort();
  assert.deepEqual(names, [
    "negative.duplicate-surface.json",
    "negative.physical-dimensions.json",
    "negative.purpose-drift.json",
    "negative.source-path.json"
  ]);
  for (const name of names) await t.test(name, async () => {
    const mutation = JSON.parse(await readFixture(constructionFixtureRoot, name));
    const value = await validObjects();
    setPath(value[mutation.target], mutation.path, mutation.value);
    const error = captureContractError(() => parseMediaSurfaceConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(mutation.expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("surface set and exact runtime-plane semantics fail closed", async (t) => {
  const cases = [
    ["missing surface", (value) => { value.mediaSurfaceConstruction.surfaces.pop(); }, "schema_media_surface_construction:surfaces:minItems"],
    ["extra surface", (value) => { value.mediaSurfaceConstruction.surfaces.push(structuredClone(value.mediaSurfaceConstruction.surfaces[0])); }, "schema_media_surface_construction:surfaces:maxItems"],
    ["unknown id", (value) => { value.mediaSurfaceConstruction.surfaces[1].surfaceId = "room-screen"; }, "schema_media_surface_construction:surfaces:1:surfaceId:const"],
    ["representation", (value) => { value.mediaSurfaceConstruction.surfaces[0].representation = "mesh"; }, "schema_media_surface_construction:surfaces:0:representation:const"],
    ["pixel width", (value) => { value.mediaSurfaceConstruction.surfaces[0].pixelDimensions.width = 1919; }, "schema_media_surface_construction:surfaces:0:pixelDimensions:width:const"],
    ["pixel height", (value) => { value.mediaSurfaceConstruction.surfaces[1].pixelDimensions.height = 1080; }, "schema_media_surface_construction:surfaces:1:pixelDimensions:height:const"],
    ["front face", (value) => { value.mediaSurfaceConstruction.surfaces[0].frontFace = "local-negative-z"; }, "schema_media_surface_construction:surfaces:0:frontFace:const"],
    ["input disabled", (value) => { value.mediaSurfaceConstruction.surfaces[0].input.enabled = false; }, "schema_media_surface_construction:surfaces:0:input:enabled:const"],
    ["input distance", (value) => { value.mediaSurfaceConstruction.surfaces[1].input.maxDistanceM = 0.051; }, "schema_media_surface_construction:surfaces:1:input:maxDistanceM:const"],
    ["position duplication", (value) => { value.mediaSurfaceConstruction.surfaces[0].position = { x: 0, y: 1.5, z: 0 }; }, "schema_media_surface_construction:surfaces:0:additionalProperties"],
    ["top-level extra", (value) => { value.mediaSurfaceConstruction.widthM = 3.2; }, "schema_media_surface_construction:root:additionalProperties"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseMediaSurfaceConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("source provenance, rights, raw bytes, and accepted input fail closed", async (t) => {
  const cases = [
    ["scene id", (value) => { value.mediaSurfaceConstruction.sceneId = "warm-modern-meeting-room-candidate-02"; }, {}, "media_surface_construction_scene_id_mismatch"],
    ["unknown source", (value) => { value.mediaSurfaceConstruction.sourceRecordId = "missing-source"; }, {}, "media_surface_construction_source_unknown:missing-source"],
    ["source kind", (value) => { value.sourceRecord.kind = "mesh"; }, {}, "media_surface_construction_source_kind_invalid:asset-media-surface-constructions"],
    ["generated source", (value) => { value.sourceRecord.kind = "generated-output"; value.sourceRecord.source.classification = "generated"; }, {}, "media_surface_construction_source_generated:asset-media-surface-constructions"],
    ["raw hash", (value) => { value.mediaSurfaceConstruction.surfaces.reverse(); }, { bindSource: false, bindAcceptedInput: false }, "media_surface_construction_source_sha256_mismatch:asset-media-surface-constructions"],
    ["accepted input", (value) => { value.scene.generator.acceptedInputSha256 = [value.scene.generator.acceptedInputSha256[0]]; }, { bindAcceptedInput: false }, "media_surface_construction_input_sha256_missing"],
    ["web runtime right", (value) => { value.sourceRecord.allowedUse.webRuntime = false; }, {}, "media_surface_construction_source_use_invalid:asset-media-surface-constructions"],
    ["redistribution right", (value) => { value.sourceRecord.allowedUse.webRuntime = false; value.sourceRecord.allowedUse.redistribution = false; }, {}, "media_surface_construction_source_use_invalid:asset-media-surface-constructions"]
  ];
  for (const [name, mutate, options, expectedIssuePrefix] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseMediaSurfaceConstructionContract(textsFromObjects(value, options)));
    assert.ok(error.issues.some((issue) => issue.startsWith(expectedIssuePrefix)), `${name}: ${error.issues.join(",")}`);
  });
});

test("media surface construction schema exposes only semantic runtime ownership", async () => {
  const schema = JSON.parse(await readFixture(root, "schemas/media-surface-constructions.schema.json"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schemaVersion", "sceneId", "sourceRecordId", "surfaces"]);
  assert.equal(schema.properties.surfaces.minItems, 2);
  assert.equal(schema.properties.surfaces.maxItems, 2);
  assert.deepEqual(schema.$defs.surface.oneOf, [
    { $ref: "#/$defs/debugMain" },
    { $ref: "#/$defs/whiteboardWall" }
  ]);
  assert.equal(schema.$defs.debugMain.properties.surfaceId.const, "debug-main");
  assert.equal(schema.$defs.debugMain.properties.purpose.const, "presentation-display");
  assert.equal(schema.$defs.debugMain.properties.pixelDimensions.properties.width.const, 1920);
  assert.equal(schema.$defs.debugMain.properties.pixelDimensions.properties.height.const, 1080);
  assert.equal(schema.$defs.whiteboardWall.properties.surfaceId.const, "whiteboard-wall");
  assert.equal(schema.$defs.whiteboardWall.properties.purpose.const, "collaboration-whiteboard");
  assert.equal(schema.$defs.whiteboardWall.properties.pixelDimensions.properties.width.const, 1920);
  assert.equal(schema.$defs.whiteboardWall.properties.pixelDimensions.properties.height.const, 1000);
  for (const definition of [schema.$defs.debugMain, schema.$defs.whiteboardWall]) {
    assert.equal(definition.properties.representation.const, "platform-runtime-plane");
    assert.equal(definition.properties.frontFace.const, "local-positive-z");
    assert.equal(definition.properties.input.$ref, "#/$defs/input");
    for (const physicalKey of ["widthM", "heightM", "position", "yaw"]) assert.equal(Object.hasOwn(definition.properties, physicalKey), false);
  }
  assert.equal(schema.$defs.input.properties.enabled.const, true);
  assert.equal(schema.$defs.input.properties.maxDistanceM.const, 0.05);
});
