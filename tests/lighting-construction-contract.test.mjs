import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseLightingConstructionContract,
  parseSceneContract,
  SceneContractError
} from "../compiler/scene-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const stage3FixtureRoot = resolve(root, "tests/fixtures/stage3");
const constructionFixtureRoot = resolve(root, "tests/fixtures/lighting-construction");

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
  const [scene, assetLedger, generationLedger, lightingConstructionText] = await Promise.all([
    readFixture(stage3FixtureRoot, "scene-spec.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "asset-ledger.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "generation-ledger.valid.json").then(JSON.parse),
    readFixture(constructionFixtureRoot, "lighting-constructions.valid.json")
  ]);
  const lightingConstruction = JSON.parse(lightingConstructionText);
  scene.lighting.splice(1, 0, {
    id: "ceiling-fill",
    kind: "spot",
    position: { x: 1.5, y: 2.95, z: -1 },
    temperatureK: 2900,
    intensityLumens: 1800,
    intendedContribution: "warm architectural fill from the ceiling"
  });
  const sourceRecord = {
    id: lightingConstruction.sourceRecordId,
    kind: "project-authored-input",
    source: { classification: "project-authored", publicUrl: null, repositoryPath: "source/lighting-constructions.json" },
    authorProvider: "project-team",
    license: { name: "LicenseRef-Project-Owned", reference: "provenance/licenses/project-owned.txt", commercialUse: true, redistribution: true, mlProcessing: true },
    acquiredOn: "2026-08-26",
    originalSha256: sha256(lightingConstructionText),
    allowedUse: { staging: true, production: false, webRuntime: true, screenshots: true, optimization: true, redistribution: true },
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
    lightingConstruction,
    lightingConstructionFixtureText: lightingConstructionText,
    sourceRecord
  };
}

function textsFromObjects(value, options = {}) {
  const fixtureConstruction = JSON.parse(value.lightingConstructionFixtureText);
  const lightingConstructionText = JSON.stringify(value.lightingConstruction) === JSON.stringify(fixtureConstruction)
    ? value.lightingConstructionFixtureText
    : `${JSON.stringify(value.lightingConstruction, null, 2)}\n`;
  const rawSha256 = sha256(lightingConstructionText);
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
    lightingConstructionText
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

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("candidate-owned lighting construction returns a frozen non-readiness report", async () => {
  const value = await validObjects();
  const texts = textsFromObjects(value);
  const sceneReport = parseSceneContract(texts);
  const report = parseLightingConstructionContract(texts);
  assert.deepEqual(report, {
    ...sceneReport,
    status: "stage3-lighting-construction-contract-valid",
    lightingConstructionSha256: sha256(stableJson(value.lightingConstruction)),
    lightingConstructionRawSha256: sha256(texts.lightingConstructionText),
    lightCount: 3,
    resolvedLightCount: 3,
    objectNamePattern: "light.<sceneLightId>",
    resolvedIntensityOutputs: [
      { sceneLightId: "window-daylight", value: 2.5, unit: "watt-per-square-meter" },
      { sceneLightId: "ceiling-fill", value: 18, unit: "watt" },
      { sceneLightId: "table-pendant", value: 32, unit: "watt" }
    ],
    firstViewAcceptance: value.lightingConstruction.firstViewAcceptance,
    boundaries: {
      lightingSpecified: true,
      firstViewAcceptanceSpecified: true,
      lightingCompiled: false,
      firstViewRendered: false,
      firstViewAcceptanceVerified: false,
      finalCandidateGlbVerified: false,
      publicationReady: false
    }
  });
  assert.equal(report.assetRecordCount, 8);
  assertDeepFrozen(report);
  assertDeepFrozen(report.resolvedIntensityOutputs);
  assertDeepFrozen(report.firstViewAcceptance);
  assertDeepFrozen(report.boundaries);
});

test("emitter output is derived only from scene intensity and fixed divisors", async () => {
  const value = await validObjects();
  value.scene.lighting[0].intensityLumens = 7200;
  value.scene.lighting[1].intensityLumens = 2500;
  value.scene.lighting[2].intensityLumens = 4100;
  assert.deepEqual(parseLightingConstructionContract(textsFromObjects(value)).resolvedIntensityOutputs, [
    { sceneLightId: "window-daylight", value: 2, unit: "watt-per-square-meter" },
    { sceneLightId: "ceiling-fill", value: 25, unit: "watt" },
    { sceneLightId: "table-pendant", value: 41, unit: "watt" }
  ]);
});

test("existing scene parser remains unchanged and does not require lighting construction text", async () => {
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

test("source binding resolves a renamed project-authored lighting record without a hardcoded id", async () => {
  const value = await validObjects();
  value.sourceRecord.id = "asset-candidate-lighting-policy";
  value.lightingConstruction.sourceRecordId = value.sourceRecord.id;
  assert.equal(parseLightingConstructionContract(textsFromObjects(value)).status, "stage3-lighting-construction-contract-valid");
});

test("parser snapshots getter and proxy inputs exactly once before parsing", async () => {
  const texts = await validTexts();
  const expected = parseLightingConstructionContract(texts);
  const reads = Object.fromEntries(Object.keys(texts).map((key) => [key, 0]));
  const getterOptions = {};
  for (const [key, text] of Object.entries(texts)) Object.defineProperty(getterOptions, key, {
    enumerable: true,
    get() {
      reads[key] += 1;
      return reads[key] === 1 ? text : "{\n";
    }
  });
  assert.deepEqual(parseLightingConstructionContract(getterOptions), expected);
  assert.deepEqual(reads, {
    sceneText: 1,
    assetLedgerText: 1,
    generationLedgerText: 1,
    lightingConstructionText: 1
  });

  const order = [];
  const proxy = new Proxy({}, {
    get(_target, key) {
      if (!Object.hasOwn(texts, key)) return undefined;
      order.push(key);
      return texts[key];
    }
  });
  assert.deepEqual(parseLightingConstructionContract(proxy), expected);
  assert.deepEqual(order, ["sceneText", "assetLedgerText", "generationLedgerText", "lightingConstructionText"]);
});

test("lighting JSON rejects duplicate keys, malformed text, missing text, noncanonical encodings, deep values, and non-finite numbers", async (t) => {
  const texts = await validTexts();
  const duplicate = texts.lightingConstructionText.replace(
    '  "schemaVersion": 1,',
    '  "schemaVersion": 1,\n  "schemaVersion": 1,'
  );
  assert.deepEqual(captureContractError(() => parseLightingConstructionContract({
    ...texts,
    lightingConstructionText: duplicate
  })).issues, ["lighting_construction_duplicate_key"]);
  assert.deepEqual(captureContractError(() => parseLightingConstructionContract({
    ...texts,
    lightingConstructionText: "{\n"
  })).issues, ["lighting_construction_json_invalid"]);
  const { lightingConstructionText: omitted, ...withoutConstruction } = texts;
  assert.equal(typeof omitted, "string");
  assert.deepEqual(captureContractError(() => parseLightingConstructionContract(withoutConstruction)).issues, ["lighting_construction_text_invalid"]);

  const noncanonical = [
    ["missing final newline", texts.lightingConstructionText.slice(0, -1)],
    ["CRLF", texts.lightingConstructionText.replaceAll("\n", "\r\n")],
    ["tab", texts.lightingConstructionText.replace('  "schemaVersion"', '\t"schemaVersion"')],
    ["BOM", `\ufeff${texts.lightingConstructionText}`],
    ["extra final newline", `${texts.lightingConstructionText}\n`],
    ["noncanonical spacing", texts.lightingConstructionText.replace('  "schemaVersion"', '    "schemaVersion"')]
  ];
  for (const [name, lightingConstructionText] of noncanonical) await t.test(name, () => {
    assert.deepEqual(captureContractError(() => parseLightingConstructionContract({
      ...texts,
      lightingConstructionText
    })).issues, ["lighting_construction_encoding_noncanonical"]);
  });

  const invalidSceneText = texts.sceneText.replace('"seed": 42', '"seed": -1');
  assert.deepEqual(captureContractError(() => parseLightingConstructionContract({
    ...texts,
    sceneText: invalidSceneText,
    lightingConstructionText: "{\n"
  })).issues, ["schema_scene:generator:seed:minimum"]);

  const deeplyNested = texts.lightingConstructionText.replace(
    '  "sceneId": "warm-modern-meeting-room-candidate-01",',
    `  "sceneId": ${"[".repeat(5000)}0${"]".repeat(5000)},`
  );
  const depthError = captureContractError(() => parseLightingConstructionContract({
    ...texts,
    lightingConstructionText: deeplyNested
  }));
  assert.ok(depthError.issues.some((issue) => issue.startsWith("nesting_too_deep:lightingConstruction:sceneId")));

  const nonFinite = {
    ...texts,
    lightingConstructionText: texts.lightingConstructionText.replace('"rollRadians": 0', '"rollRadians": 1e999')
  };
  assert.deepEqual(captureContractError(() => parseLightingConstructionContract(nonFinite)).issues, [
    "non_finite_number:lightingConstruction:lights:0:emitter:rollRadians"
  ]);
  assert.deepEqual(captureContractError(() => parseLightingConstructionContract(null)).issues, ["parser_options_invalid"]);
});

test("checked-in negative lighting fixtures fail with stable diagnostics", async (t) => {
  const names = (await readdir(constructionFixtureRoot)).filter((name) => name.startsWith("negative.")).sort();
  assert.deepEqual(names, [
    "negative.acceptance-drift.json",
    "negative.capture-drift.json",
    "negative.duplicate-light.json",
    "negative.host-binding.json",
    "negative.source-path.json",
    "negative.unbound-scene-light.json"
  ]);
  for (const name of names) await t.test(name, async () => {
    const mutation = JSON.parse(await readFixture(constructionFixtureRoot, name));
    const value = await validObjects();
    setPath(value[mutation.target], mutation.path, mutation.value);
    const error = captureContractError(() => parseLightingConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(mutation.expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("scene light order, role closure, host binding, targeting, and spot geometry fail closed", async (t) => {
  const cases = [
    ["order", (value) => { value.lightingConstruction.lights.reverse(); }, "lighting_construction_scene_light_order_mismatch:0:window-daylight:table-pendant"],
    ["extra light", (value) => { value.lightingConstruction.lights.push(structuredClone(value.lightingConstruction.lights[0])); }, "lighting_construction_light_count_mismatch:3:4"],
    ["unsupported area", (value) => { value.scene.lighting[1].kind = "area"; }, "lighting_construction_scene_light_kind_unsupported:ceiling-fill:area"],
    ["missing daylight role", (value) => { value.scene.lighting[0].kind = "area"; value.scene.lighting[0].temperatureK = 2900; }, "lighting_construction_role_missing:daylight"],
    ["daylight door", (value) => { value.lightingConstruction.lights[0].binding.openingId = "main-door"; }, "lighting_construction_daylight_opening_invalid:window-daylight:main-door"],
    ["daylight aperture", (value) => { value.scene.lighting[0].position.x = 2.5; }, "lighting_construction_daylight_position_unbound:window-daylight:main-window"],
    ["daylight inward", (value) => { value.lightingConstruction.lights[0].emitter.target.z = 2.45; }, "lighting_construction_daylight_target_not_inward:window-daylight:main-window"],
    ["target distinct", (value) => { value.lightingConstruction.lights[1].emitter.target = structuredClone(value.scene.lighting[1].position); }, "lighting_construction_target_equals_source:ceiling-fill"],
    ["target room", (value) => { value.lightingConstruction.lights[1].emitter.target.x = 4; }, "lighting_construction_target_out_of_bounds:ceiling-fill"],
    ["pendant position", (value) => { value.scene.lighting[2].position.x = 0.1; }, "lighting_construction_pendant_position_unbound:table-pendant:pendant-fixture"],
    ["pendant table target", (value) => { value.lightingConstruction.lights[2].emitter.target.x = 2; }, "lighting_construction_pendant_target_invalid:table-pendant"],
    ["architectural ceiling position", (value) => { value.scene.lighting[1].position.y = 2.7; }, "lighting_construction_architectural_position_unbound:ceiling-fill:ceiling"],
    ["architectural target below", (value) => { value.lightingConstruction.lights[1].emitter.target.y = 3; }, "lighting_construction_architectural_target_not_below:ceiling-fill"],
    ["spot cone order", (value) => { value.lightingConstruction.lights[1].emitter.innerConeHalfAngleRadians = 1.2; }, "lighting_construction_spot_cone_order_invalid:ceiling-fill"],
    ["spot cone below Blender minimum", (value) => { value.lightingConstruction.lights[1].emitter.outerConeHalfAngleRadians = 0.008; }, "schema_lighting_construction:lights:1:emitter:outerConeHalfAngleRadians:minimum"],
    ["spot cone above Blender maximum", (value) => { value.lightingConstruction.lights[1].emitter.outerConeHalfAngleRadians = 1.6; }, "schema_lighting_construction:lights:1:emitter:outerConeHalfAngleRadians:maximum"],
    ["spot range", (value) => { value.lightingConstruction.lights[2].emitter.rangeM = 1; }, "lighting_construction_target_out_of_range:table-pendant"],
    ["daylight implementation", (value) => { value.lightingConstruction.lights[0].binding = structuredClone(value.lightingConstruction.lights[2].binding); value.lightingConstruction.lights[0].emitter = structuredClone(value.lightingConstruction.lights[2].emitter); }, "lighting_construction_daylight_binding_invalid:window-daylight"],
    ["pendant implementation", (value) => { value.lightingConstruction.lights[2].emitter = structuredClone(value.lightingConstruction.lights[0].emitter); }, "lighting_construction_pendant_emitter_invalid:table-pendant"],
    ["architectural implementation", (value) => { value.lightingConstruction.lights[1].binding = structuredClone(value.lightingConstruction.lights[0].binding); }, "lighting_construction_architectural_binding_invalid:ceiling-fill"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseLightingConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("source provenance, rights, raw bytes, accepted input, style bible, and criteria fail closed", async (t) => {
  const cases = [
    ["scene id", (value) => { value.lightingConstruction.sceneId = "warm-modern-meeting-room-candidate-02"; }, {}, "lighting_construction_scene_id_mismatch"],
    ["unknown source", (value) => { value.lightingConstruction.sourceRecordId = "missing-source"; }, {}, "lighting_construction_source_unknown:missing-source"],
    ["source kind", (value) => { value.sourceRecord.kind = "mesh"; }, {}, "lighting_construction_source_kind_invalid:asset-lighting-constructions"],
    ["generated source", (value) => { value.sourceRecord.kind = "generated-output"; value.sourceRecord.source.classification = "generated"; }, {}, "lighting_construction_source_generated:asset-lighting-constructions"],
    ["raw hash", (value) => { value.lightingConstruction.lights.reverse(); }, { bindSource: false, bindAcceptedInput: false }, "lighting_construction_source_sha256_mismatch:asset-lighting-constructions"],
    ["accepted input", (value) => { value.scene.generator.acceptedInputSha256 = [value.scene.generator.acceptedInputSha256[0]]; }, { bindAcceptedInput: false }, "lighting_construction_input_sha256_missing:"],
    ["staging right", (value) => { value.sourceRecord.allowedUse.staging = false; }, {}, "lighting_construction_source_use_invalid:asset-lighting-constructions"],
    ["optimization right", (value) => { value.sourceRecord.allowedUse.optimization = false; }, {}, "lighting_construction_source_use_invalid:asset-lighting-constructions"],
    ["web runtime right", (value) => { value.sourceRecord.allowedUse.webRuntime = false; }, {}, "lighting_construction_source_use_invalid:asset-lighting-constructions"],
    ["screenshot right", (value) => { value.sourceRecord.allowedUse.screenshots = false; }, {}, "lighting_construction_source_use_invalid:asset-lighting-constructions"],
    ["material screenshot right", (value) => { value.assetLedger.records.find(({ id }) => id === "asset-material-project").allowedUse.screenshots = false; }, {}, "lighting_construction_first_view_screenshot_rights_invalid:asset-material-project"],
    ["component screenshot right", (value) => { value.assetLedger.records.find(({ id }) => id === "asset-table-project").allowedUse.screenshots = false; }, {}, "lighting_construction_first_view_screenshot_rights_invalid:asset-table-project"],
    ["exterior screenshot right", (value) => { value.assetLedger.records.find(({ id }) => id === "asset-exterior-project").allowedUse.screenshots = false; }, {}, "lighting_construction_first_view_screenshot_rights_invalid:asset-exterior-project"],
    ["ambiguous source", (value) => { value.assetLedger.records.push({ ...structuredClone(value.sourceRecord), id: "asset-lighting-constructions-shadow" }); }, {}, "lighting_construction_source_path_ambiguous:source/lighting-constructions.json"],
    ["style bible hash", (value) => { value.lightingConstruction.styleBibleSha256 = "a".repeat(64); }, {}, "schema_lighting_construction:styleBibleSha256:const"],
    ["review view", (value) => { value.lightingConstruction.firstViewAcceptance.reviewViewId = "presenter"; }, {}, "schema_lighting_construction:firstViewAcceptance:reviewViewId:const"],
    ["entry view position equals target", (value) => { const entry = value.scene.reviewViews.find(({ id }) => id === "entry"); entry.target = structuredClone(entry.position); }, {}, "lighting_construction_review_view_position_equals_target:entry"],
    ["directional intensity divisor", (value) => { value.lightingConstruction.lights[0].emitter.intensityMapping.divisor = 3599; }, {}, "schema_lighting_construction:lights:0:emitter:intensityMapping:divisor:const"],
    ["spot intensity divisor", (value) => { value.lightingConstruction.lights[1].emitter.intensityMapping.divisor = 99; }, {}, "schema_lighting_construction:lights:1:emitter:intensityMapping:divisor:const"],
    ["candidate energy", (value) => { value.lightingConstruction.lights[2].emitter.energy = { value: 32, unit: "watt" }; }, {}, "schema_lighting_construction:lights:2:emitter:additionalProperties"],
    ["coordinate conversion", (value) => { value.lightingConstruction.lights[0].emitter.coordinateConversion.blenderY = "negative-scene-z"; }, {}, "schema_lighting_construction:lights:0:emitter:coordinateConversion:blenderY:const"],
    ["Kelvin conversion", (value) => { value.lightingConstruction.lights[1].emitter.kelvinConversion = "blackbody-v1"; }, {}, "schema_lighting_construction:lights:1:emitter:kelvinConversion:const"],
    ["spot size mapping", (value) => { value.lightingConstruction.lights[2].emitter.coneMapping.spotSizeFormula = "outer-cone-half-angle"; }, {}, "schema_lighting_construction:lights:2:emitter:coneMapping:spotSizeFormula:const"],
    ["spot range property", (value) => { value.lightingConstruction.lights[2].emitter.rangeMapping.cutoffDistanceProperty = "distance"; }, {}, "schema_lighting_construction:lights:2:emitter:rangeMapping:cutoffDistanceProperty:const"],
    ["metric weight", (value) => { value.lightingConstruction.firstViewAcceptance.measurement.integerArithmetic.redWeight = 2125; }, {}, "schema_lighting_construction:firstViewAcceptance:measurement:integerArithmetic:redWeight:const"],
    ["metric linearization", (value) => { value.lightingConstruction.firstViewAcceptance.measurement.linearization = "srgb-to-linear"; }, {}, "schema_lighting_construction:firstViewAcceptance:measurement:linearization:const"],
    ["dark ratio", (value) => { value.lightingConstruction.firstViewAcceptance.criteria.darkPixelRatioMaximum = 0.69; }, {}, "schema_lighting_construction:firstViewAcceptance:criteria:darkPixelRatioMaximum:const"]
  ];
  for (const [name, mutate, options, expectedIssuePrefix] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseLightingConstructionContract(textsFromObjects(value, options)));
    assert.ok(error.issues.some((issue) => issue.startsWith(expectedIssuePrefix)), `${name}: ${error.issues.join(",")}`);
  });
});

test("lighting construction schema exposes only exact uncompiled implementation intent", async () => {
  const schema = JSON.parse(await readFixture(root, "schemas/lighting-constructions.schema.json"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schemaVersion", "sceneId", "sourceRecordId", "styleBibleSha256", "lights", "firstViewAcceptance"]);
  assert.equal(schema.properties.styleBibleSha256.const, "d8147f9495fb8d2cb50bbccf6849cf272b30b662bffb985b6e46e3c604384656");
  assert.deepEqual(schema.$defs.light.required, ["sceneLightId", "binding", "emitter"]);
  assert.deepEqual(Object.keys(schema.$defs.light.properties), ["sceneLightId", "binding", "emitter"]);
  for (const duplicatedSceneField of ["position", "temperatureK", "intensityLumens", "intendedContribution"]) {
    assert.equal(Object.hasOwn(schema.$defs.light.properties, duplicatedSceneField), false);
  }
  assert.deepEqual(schema.$defs.binding.oneOf, [
    { $ref: "#/$defs/openingBinding" },
    { $ref: "#/$defs/componentBinding" },
    { $ref: "#/$defs/roomSurfaceBinding" }
  ]);
  assert.equal(schema.properties.lights.maxItems, 8);
  assert.equal(Object.hasOwn(schema.$defs.directionalEmitter.properties, "energy"), false);
  assert.equal(Object.hasOwn(schema.$defs.spotEmitter.properties, "energy"), false);
  assert.equal(schema.$defs.directionalEmitter.properties.intensityMapping.$ref, "#/$defs/directionalIntensityMapping");
  assert.equal(schema.$defs.directionalIntensityMapping.properties.source.const, "scene-intensity-lumens");
  assert.equal(schema.$defs.directionalIntensityMapping.properties.operation.const, "divide");
  assert.equal(schema.$defs.directionalIntensityMapping.properties.divisor.const, 3600);
  assert.equal(schema.$defs.directionalIntensityMapping.properties.outputUnit.const, "watt-per-square-meter");
  assert.equal(schema.$defs.spotEmitter.properties.intensityMapping.$ref, "#/$defs/spotIntensityMapping");
  assert.equal(schema.$defs.spotIntensityMapping.properties.divisor.const, 100);
  assert.equal(schema.$defs.spotIntensityMapping.properties.outputUnit.const, "watt");
  assert.equal(schema.$defs.directionalEmitter.properties.angularDiameterDegrees.maximum, 15);
  assert.equal(schema.$defs.spotEmitter.properties.rangeM.maximum, 20);
  assert.equal(schema.$defs.spotEmitter.properties.radiusM.maximum, 1);
  assert.equal(schema.$defs.coordinateConversion.properties.id.const, "scene-y-up-to-blender-z-up-v1");
  assert.deepEqual([
    schema.$defs.coordinateConversion.properties.blenderX.const,
    schema.$defs.coordinateConversion.properties.blenderY.const,
    schema.$defs.coordinateConversion.properties.blenderZ.const
  ], ["scene-x", "scene-z", "scene-y"]);
  assert.equal(schema.$defs.orientationConvention.properties.forwardAxis.const, "local-negative-z");
  assert.equal(schema.$defs.orientationConvention.properties.upAxis.const, "local-y");
  assert.equal(schema.$defs.orientationConvention.properties.rollOrder.const, "after-target-alignment");
  assert.equal(schema.$defs.directionalEmitter.properties.kelvinConversion.const, "tanner-helland-2012-clamped-srgb-to-linear-v1");
  assert.equal(schema.$defs.angularDiameterMapping.properties.operation.const, "multiply-by-pi-divide-by-180");
  assert.equal(schema.$defs.angularDiameterMapping.properties.blenderProperty.const, "angle");
  assert.equal(schema.$defs.spotEmitter.properties.innerConeHalfAngleRadians.type, "number");
  assert.equal(schema.$defs.spotConeMapping.properties.angleConvention.const, "half-angles-radians");
  assert.equal(schema.$defs.spotConeMapping.properties.spotSizeProperty.const, "spot_size");
  assert.equal(schema.$defs.spotConeMapping.properties.spotSizeFormula.const, "two-times-outer-cone-half-angle");
  assert.equal(schema.$defs.spotConeMapping.properties.spotBlendProperty.const, "spot_blend");
  assert.equal(schema.$defs.spotConeMapping.properties.spotBlendFormula.const, "one-minus-inner-cone-half-angle-divided-by-outer-cone-half-angle");
  assert.equal(schema.$defs.spotRangeMapping.properties.useCustomDistanceProperty.const, "use_custom_distance");
  assert.equal(schema.$defs.spotRangeMapping.properties.useCustomDistanceValue.const, true);
  assert.equal(schema.$defs.spotRangeMapping.properties.cutoffDistanceProperty.const, "cutoff_distance");
  assert.equal(schema.$defs.spotRangeMapping.properties.cutoffDistanceSource.const, "range-m");
  assert.equal(schema.$defs.spotRadiusMapping.properties.blenderProperty.const, "shadow_soft_size");
  assert.equal(schema.$defs.spotRadiusMapping.properties.source.const, "radius-m");
  assert.equal(schema.$defs.directionalEmitter.properties.colorSource.const, "scene-temperature-kelvin");
  assert.equal(schema.$defs.spotEmitter.properties.castShadow.const, true);
  assert.equal(schema.$defs.firstViewAcceptance.properties.reviewViewId.const, "entry");
  assert.equal(schema.$defs.capture.properties.engine.const, "CYCLES");
  assert.equal(schema.$defs.capture.properties.device.const, "CPU");
  assert.equal(schema.$defs.capture.properties.projection.const, "perspective");
  assert.equal(schema.$defs.capture.properties.fovAxis.const, "vertical");
  assert.deepEqual([
    schema.$defs.resolution.properties.widthPx.const,
    schema.$defs.resolution.properties.heightPx.const,
    schema.$defs.resolution.properties.pixelAspectRatio.const,
    schema.$defs.capture.properties.samples.const,
    schema.$defs.capture.properties.seed.const
  ], [960, 540, 1, 64, 42]);
  assert.equal(schema.$defs.measurement.properties.metric.const, "display-srgb8-rec709-luma-v1");
  assert.equal(schema.$defs.measurement.properties.scope.const, "all-rendered-pixels");
  assert.equal(schema.$defs.measurement.properties.sampleEncoding.const, "display-srgb8-encoded-rgb-bytes");
  assert.equal(schema.$defs.measurement.properties.channelValueDomain.const, "integer-0-to-255");
  assert.equal(schema.$defs.measurement.properties.linearization.const, "none");
  assert.deepEqual([
    schema.$defs.integerArithmetic.properties.redWeight.const,
    schema.$defs.integerArithmetic.properties.greenWeight.const,
    schema.$defs.integerArithmetic.properties.blueWeight.const,
    schema.$defs.integerArithmetic.properties.divisor.const
  ], [2126, 7152, 722, 10000]);
  assert.equal(schema.$defs.integerArithmetic.properties.averagePass.const, "sum-weighted-numerators-gte-average-minimum-times-divisor-times-pixel-count");
  assert.equal(schema.$defs.integerArithmetic.properties.darkPixel.const, "weighted-numerator-lt-dark-pixel-threshold-times-divisor");
  assert.equal(schema.$defs.integerArithmetic.properties.darkRatioPass.const, "dark-count-times-10-lte-pixel-count-times-7");
  assert.equal(schema.$defs.measurement.properties.darkPixelThreshold.const, 40);
  assert.equal(schema.$defs.criteria.properties.averageLuminanceMinimum.const, 40);
  assert.equal(schema.$defs.criteria.properties.darkPixelRatioMaximum.const, 0.7);

  const propertyNames = [];
  const visit = (value) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    if (value.properties) propertyNames.push(...Object.keys(value.properties));
    Object.values(value).forEach(visit);
  };
  visit(schema);
  for (const forbidden of ["observed", "compiled", "render", "rendered", "lightingCompiled", "firstViewRendered", "firstViewAcceptanceVerified"]) {
    assert.equal(propertyNames.includes(forbidden), false);
  }
});
