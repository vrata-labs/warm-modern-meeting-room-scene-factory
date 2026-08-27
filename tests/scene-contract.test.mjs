import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { parseSceneContract, SceneContractError, validateSceneContract } from "../compiler/scene-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const fixtureRoot = resolve(root, "tests/fixtures/stage3");

async function fixture(name) {
  return readFile(resolve(fixtureRoot, name), "utf8");
}

async function validTexts() {
  const [sceneText, assetLedgerText, generationLedgerText] = await Promise.all([
    fixture("scene-spec.valid.json"),
    fixture("asset-ledger.valid.json"),
    fixture("generation-ledger.valid.json")
  ]);
  return { sceneText, assetLedgerText, generationLedgerText };
}

async function validObjects() {
  const texts = await validTexts();
  return {
    scene: JSON.parse(texts.sceneText),
    assetLedger: JSON.parse(texts.assetLedgerText),
    generationLedger: JSON.parse(texts.generationLedgerText)
  };
}

function captureContractError(operation) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof SceneContractError, error?.stack);
    return error;
  }
  assert.fail("expected SceneContractError");
}

function applyMutation(target, path, mutation) {
  const segments = path.split(".");
  const key = segments.pop();
  let parent = target;
  for (const segment of segments) parent = parent[segment];
  if (mutation.delete) delete parent[key];
  else parent[key] = mutation.value;
}

test("valid pilot scene contract produces stable public-safe diagnostics", async () => {
  const report = parseSceneContract(await validTexts());
  assert.deepEqual(report, {
    status: "stage3-scene-contract-valid",
    sceneId: "warm-modern-meeting-room-candidate-01",
    specificationSha256: "7835eb45004e91f29daf6ee6e6c4b7cb34ad081f4a90f234f38732f4daf92a91",
    assetLedgerSha256: "bc8dc412b38eb85c7a46cb96a5292f806e430fcfa2956f188d39a07fcd9f6d85",
    generationLedgerSha256: "39ef74d47488966b8e9b4df9541ba039085260a2a8fb75d9add3804558491c51",
    assetRecordCount: 7,
    generationRecordCount: 1,
    componentCount: 11,
    seatCount: 8
  });
});

test("required negative fixtures fail with stable diagnostic codes", async (t) => {
  const texts = await validTexts();
  const names = (await readdir(fixtureRoot)).filter((name) => name.startsWith("negative.")).sort();
  assert.deepEqual(names, [
    "negative.invalid-anchor.json",
    "negative.invalid-dimensions.json",
    "negative.missing-license.json",
    "negative.non-finite-transform.json",
    "negative.overlapping-openings.json",
    "negative.unknown-component.json"
  ]);
  for (const name of names) await t.test(name, async () => {
    const mutation = JSON.parse(await fixture(name));
    let error;
    if (mutation.target === "sceneText") {
      const sceneText = texts.sceneText.replace(mutation.replace, mutation.with);
      assert.notEqual(sceneText, texts.sceneText, "fixture replacement must change the scene");
      error = captureContractError(() => parseSceneContract({ ...texts, sceneText }));
    } else {
      const scene = JSON.parse(texts.sceneText);
      const assetLedger = JSON.parse(texts.assetLedgerText);
      const generationLedger = JSON.parse(texts.generationLedgerText);
      const target = mutation.target === "scene" ? scene : mutation.target === "assetLedger" ? assetLedger : generationLedger;
      applyMutation(target, mutation.path, mutation);
      error = captureContractError(() => validateSceneContract(scene, assetLedger, generationLedger));
    }
    assert.ok(error.issues.includes(mutation.expectedIssue), `${name}: ${error.issues.join(",")}`);
    assert.deepEqual(error.issues, [...error.issues].sort());
  });
});

test("strict parser rejects duplicate and malformed JSON before semantic validation", async () => {
  const texts = await validTexts();
  const duplicate = texts.sceneText.replace('{\n  "schemaVersion": 1,', '{\n  "schemaVersion": 1,\n  "schemaVersion": 1,');
  const duplicateError = captureContractError(() => parseSceneContract({ ...texts, sceneText: duplicate }));
  assert.deepEqual(duplicateError.issues, ["scene_duplicate_key"]);
  const malformedError = captureContractError(() => parseSceneContract({ ...texts, generationLedgerText: "{" }));
  assert.deepEqual(malformedError.issues, ["generation_ledger_json_invalid"]);
});

test("schema, provenance, rights, geometry, and route boundaries fail closed", async (t) => {
  const cases = [
    ["schema range", (value) => { value.scene.generator.seed = -1; }, "schema_scene:generator:seed:minimum"],
    ["rejected generation", (value) => { value.generationLedger.records[0].status = "rejected"; value.generationLedger.records[0].rejectionReasons = ["shape-failed"]; value.generationLedger.records[0].outputSha256 = []; }, "component_generation_rejected:chair-01:generation-chair-01"],
    ["generated source without accepted provenance", (value) => { value.generationLedger.records[0].status = "rejected"; value.generationLedger.records[0].rejectionReasons = ["shape-failed"]; value.generationLedger.records[0].outputSha256 = []; value.scene.components[1].generationRecordId = null; }, "generated_asset_provenance_missing:asset-chair-output"],
    ["generated kind bypass", (value) => { value.assetLedger.records[1].kind = "mesh"; }, "schema_asset_ledger:records:1:kind:const"],
    ["unbound generation", (value) => { value.generationLedger.records[0].rawOutputSha256 = "4444444444444444444444444444444444444444444444444444444444444444"; value.generationLedger.records[0].outputSha256 = ["5555555555555555555555555555555555555555555555555555555555555555"]; }, "component_generation_output_unbound:chair-01:generation-chair-01"],
    ["partially bound generation", (value) => { value.generationLedger.records[0].outputSha256 = ["5555555555555555555555555555555555555555555555555555555555555555"]; }, "component_generation_output_unbound:chair-01:generation-chair-01"],
    ["ML rights", (value) => { value.assetLedger.records[0].license.mlProcessing = false; }, "generation_input_ml_rights_invalid:generation-chair-01:asset-chair-input"],
    ["component runtime rights", (value) => { value.assetLedger.records[1].allowedUse.webRuntime = false; }, "component_source_use_invalid:chair-01:asset-chair-output"],
    ["material runtime rights", (value) => { value.assetLedger.records[2].allowedUse.webRuntime = false; }, "material_source_use_invalid:graphite-metal:asset-material-project"],
    ["generated material unsupported", (value) => { value.assetLedger.records[2].kind = "generated-output"; value.assetLedger.records[2].source.classification = "generated"; }, "generated_asset_role_unsupported:material:asset-material-project"],
    ["exterior runtime rights", (value) => { value.assetLedger.records[4].allowedUse.webRuntime = false; }, "exterior_source_use_invalid:asset-exterior-project"],
    ["generated exterior unsupported", (value) => { value.assetLedger.records[4].kind = "generated-output"; value.assetLedger.records[4].source.classification = "generated"; }, "generated_asset_role_unsupported:exterior:asset-exterior-project"],
    ["unsafe path", (value) => { value.assetLedger.records[0].source.repositoryPath = "C:/secret/input.png"; }, "schema_asset_ledger:records:0:source:repositoryPath:pattern"],
    ["private URL", (value) => { value.assetLedger.records[0].source.repositoryPath = null; value.assetLedger.records[0].source.publicUrl = "https://127.0.0.1/input.png"; }, "asset_source_url_invalid:asset-chair-input"],
    ["credential URL", (value) => { value.assetLedger.records[0].source.repositoryPath = null; value.assetLedger.records[0].source.publicUrl = "https://example.com/input.png?token=secret"; }, "asset_source_url_invalid:asset-chair-input"],
    ["CGNAT URL", (value) => { value.assetLedger.records[0].source.repositoryPath = null; value.assetLedger.records[0].source.publicUrl = "https://100.64.0.1/input.png"; }, "asset_source_url_invalid:asset-chair-input"],
    ["literal public IP URL", (value) => { value.assetLedger.records[0].source.repositoryPath = null; value.assetLedger.records[0].source.publicUrl = "https://8.8.8.8/input.png"; }, "asset_source_url_invalid:asset-chair-input"],
    ["internal DNS URL", (value) => { value.assetLedger.records[0].source.repositoryPath = null; value.assetLedger.records[0].source.publicUrl = "https://metadata.google.internal/input.png"; }, "asset_source_url_invalid:asset-chair-input"],
    ["component footprint", (value) => { value.scene.components[0].dimensions.widthM = 100; }, "component_footprint_out_of_bounds:conference-table"],
    ["seat alignment", (value) => { value.scene.seats[0].position.x += 0.2; }, "seat_component_alignment_invalid:seat-01:chair-01"],
    ["seat vertical alignment", (value) => { value.scene.components[1].transform.position.y = 0.5; }, "seat_component_alignment_invalid:seat-01:chair-01"],
    ["seat height geometry", (value) => { value.scene.components[1].dimensions.heightM = 0.1; }, "seat_height_outside_component:seat-01:chair-01"],
    ["opening profile kind", (value) => { value.scene.profiles.find(({ id }) => id === "window-frame-profile").kind = "trim"; }, "opening_profile_kind_invalid:main-window:window-frame-profile"],
    ["surface footprint", (value) => { value.scene.mediaSurfaces[0].widthM = 100; }, "media_surface_invalid:debug-main"],
    ["floating surface", (value) => { value.scene.mediaSurfaces[0].position.z = 0; }, "media_surface_invalid:debug-main"],
    ["surface opening overlap", (value) => { value.scene.mediaSurfaces[0].position.z = 2.4; value.scene.mediaSurfaces[0].yaw = 3.141593; }, "media_surface_opening_overlap:debug-main:main-window"],
    ["surface overlap", (value) => { value.scene.mediaSurfaces[1].position = { "x": -1, "y": 1.5, "z": -2.4 }; value.scene.mediaSurfaces[1].yaw = 0; }, "media_surface_overlap:debug-main:whiteboard-wall"],
    ["route collision", (value) => { value.scene.clearance.routes.find(({ id }) => id === "route-seat-01").points = [{ "x": 2.25, "z": -2.35 }, { "x": 0, "z": 0 }, { "x": -1.5, "z": 1.15 }]; }, "clearance_component_collision:route-seat-01:conference-table"],
    ["route containment", (value) => { value.scene.clearance.routes.find(({ id }) => id === "route-seat-01").points[1].x = 3.2; }, "clearance_corridor_out_of_bounds:route-seat-01:1"],
    ["route architectural inset", (value) => { value.scene.clearance.routes.find(({ id }) => id === "route-seat-01").points[1].z = -1.95; }, "clearance_corridor_out_of_bounds:route-seat-01:1"],
    ["entrance clearance", (value) => { value.scene.openings[0].widthM = 0.5; }, "entrance_clearance_invalid:main-door"],
    ["route wider than entrance", (value) => { value.scene.clearance.routes[0].widthM = 1.11; }, "entrance_clearance_invalid:main-door"],
    ["angled doorway corridor", (value) => { value.scene.clearance.routes[0].points[0].x = 2.5; value.scene.clearance.routes[0].points[1].x = 3; }, "clearance_entrance_corridor_invalid:route-main"],
    ["spawn wall containment", (value) => { value.scene.spawn.openRadiusM = 100; }, "anchor_out_of_bounds:main"],
    ["spawn architectural inset", (value) => { value.scene.spawn.position.z = -1.65; }, "anchor_out_of_bounds:main"],
    ["spawn component collision", (value) => { value.scene.spawn.position = { ...value.scene.components[8].transform.position }; }, "anchor_component_collision:main:chair-08"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => validateSceneContract(value.scene, value.assetLedger, value.generationLedger));
    assert.ok(error.issues.includes(expectedIssue), error.issues.join(","));
    assert.deepEqual(error.issues, [...error.issues].sort());
    if (name === "schema range") assert.deepEqual(error.issues, [expectedIssue]);
  });
});

test("malformed in-memory records and parser options never escape as TypeError", async () => {
  const value = await validObjects();
  value.scene.seats[0].position = null;
  const seatError = captureContractError(() => validateSceneContract(value.scene, value.assetLedger, value.generationLedger));
  assert.ok(seatError.issues.some((issue) => issue.includes("seat")));
  const malformedComponent = await validObjects();
  malformedComponent.scene.components[0].transform = null;
  const componentError = captureContractError(() => validateSceneContract(malformedComponent.scene, malformedComponent.assetLedger, malformedComponent.generationLedger));
  assert.ok(componentError.issues.some((issue) => issue.includes("component")));
  const malformedRoute = await validObjects();
  malformedRoute.scene.clearance.routes[0].points[1] = null;
  const routeError = captureContractError(() => validateSceneContract(malformedRoute.scene, malformedRoute.assetLedger, malformedRoute.generationLedger));
  assert.ok(routeError.issues.some((issue) => issue.includes("clearance")));
  const cyclic = await validObjects();
  cyclic.scene.self = cyclic.scene;
  const cyclicError = captureContractError(() => validateSceneContract(cyclic.scene, cyclic.assetLedger, cyclic.generationLedger));
  assert.ok(cyclicError.issues.includes("cyclic_value:scene:self"));
  const deep = await validObjects();
  let nested = deep.scene;
  for (let index = 0; index < 200; index += 1) {
    nested.deep = {};
    nested = nested.deep;
  }
  const depthError = captureContractError(() => validateSceneContract(deep.scene, deep.assetLedger, deep.generationLedger));
  assert.ok(depthError.issues.some((issue) => issue.startsWith("nesting_too_deep:")));
  const optionsError = captureContractError(() => parseSceneContract(null));
  assert.deepEqual(optionsError.issues, ["parser_options_invalid"]);
});

test("seat yaw comparison treats pi and minus pi as equivalent", async () => {
  const value = await validObjects();
  value.scene.seats[0].yaw = -3.141593;
  assert.equal(validateSceneContract(value.scene, value.assetLedger, value.generationLedger).status, "stage3-scene-contract-valid");
});

test("media surface may share a wall interval with an opening when vertically separated", async () => {
  const value = await validObjects();
  value.scene.mediaSurfaces[0] = { surfaceId: "debug-main", widthM: 0.8, heightM: 0.45, position: { x: 0, y: 2.8, z: 2.4 }, yaw: 3.141593 };
  assert.equal(validateSceneContract(value.scene, value.assetLedger, value.generationLedger).status, "stage3-scene-contract-valid");
});

test("scene, ledger, and separate construction schemas expose their scoped Stage 3 contracts", async () => {
  const [sceneSchema, assetSchema, generationSchema, componentConstructionSchema, mediaSurfaceConstructionSchema, lightingConstructionSchema] = await Promise.all([
    fixture("../../../schemas/scene-spec.schema.json").then(JSON.parse),
    fixture("../../../schemas/asset-ledger.schema.json").then(JSON.parse),
    fixture("../../../schemas/generation-ledger.schema.json").then(JSON.parse),
    fixture("../../../schemas/component-constructions.schema.json").then(JSON.parse),
    fixture("../../../schemas/media-surface-constructions.schema.json").then(JSON.parse),
    fixture("../../../schemas/lighting-constructions.schema.json").then(JSON.parse)
  ]);
  assert.equal(sceneSchema.properties.room.properties.polygon.minItems, 4);
  assert.equal(sceneSchema.properties.openings.minItems, 2);
  assert.equal(sceneSchema.properties.architecturalDetails.minItems, 4);
  assert.equal(sceneSchema.properties.reviewViews.minItems, 4);
  assert.equal(sceneSchema.$defs.clearance.properties.routes.minItems, 10);
  assert.equal(assetSchema.$defs.record.properties.license.required.includes("redistribution"), true);
  assert.equal(generationSchema.$defs.record.properties.cleanupMinutes.maximum, 45);
  assert.equal(generationSchema.$defs.record.properties.outputSha256.maxItems, 128);
  assert.equal(componentConstructionSchema.additionalProperties, false);
  assert.deepEqual(componentConstructionSchema.$defs.family.properties.id.enum, ["conference-table", "task-chair", "conference-av", "pendant-luminaire"]);
  assert.equal(componentConstructionSchema.$defs.part.properties.geometry.const, "beveled-box");
  assert.equal(mediaSurfaceConstructionSchema.additionalProperties, false);
  assert.equal(mediaSurfaceConstructionSchema.properties.surfaces.minItems, 2);
  assert.equal(mediaSurfaceConstructionSchema.properties.surfaces.maxItems, 2);
  assert.equal(mediaSurfaceConstructionSchema.$defs.debugMain.properties.representation.const, "platform-runtime-plane");
  assert.equal(lightingConstructionSchema.additionalProperties, false);
  assert.deepEqual(lightingConstructionSchema.$defs.light.required, ["sceneLightId", "binding", "emitter"]);
  assert.equal(lightingConstructionSchema.properties.styleBibleSha256.const, "d8147f9495fb8d2cb50bbccf6849cf272b30b662bffb985b6e46e3c604384656");
});
