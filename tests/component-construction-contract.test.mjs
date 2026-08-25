import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import {
  parseComponentConstructionContract,
  parseSceneContract,
  SceneContractError
} from "../compiler/scene-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const stage3FixtureRoot = resolve(root, "tests/fixtures/stage3");
const constructionFixtureRoot = resolve(root, "tests/fixtures/component-construction");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function readFixture(rootPath, name) {
  return readFile(resolve(rootPath, name), "utf8");
}

async function validObjects() {
  const [scene, sourceAssetLedger, generationLedger, componentConstructionText] = await Promise.all([
    readFixture(stage3FixtureRoot, "scene-spec.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "asset-ledger.valid.json").then(JSON.parse),
    readFixture(stage3FixtureRoot, "generation-ledger.valid.json").then(JSON.parse),
    readFixture(constructionFixtureRoot, "component-constructions.valid.json")
  ]);
  const componentConstruction = JSON.parse(componentConstructionText);
  scene.materialRecipes.push({
    id: "muted-grey-green-fabric",
    category: "fabric",
    baseColorSrgb: "#77877B",
    roughness: 0.8,
    metalness: 0,
    textureScaleM: 0.003,
    sourceRecordId: componentConstruction.materialSourceRecordId
  });
  for (const component of scene.components) {
    component.sourceRecordId = componentConstruction.sourceRecordId;
    component.generationRecordId = null;
  }
  const assetLedger = {
    ...sourceAssetLedger,
    records: sourceAssetLedger.records.filter(({ id }) => ["asset-exterior-project", componentConstruction.materialSourceRecordId].includes(id))
  };
  assetLedger.records.push({
    id: componentConstruction.sourceRecordId,
    kind: "project-authored-input",
    source: { classification: "project-authored", publicUrl: null, repositoryPath: "source/component-constructions.json" },
    authorProvider: "project-team",
    license: { name: "LicenseRef-Project-Owned", reference: "provenance/licenses/project-owned.txt", commercialUse: true, redistribution: true, mlProcessing: true },
    acquiredOn: "2026-08-25",
    originalSha256: sha256(componentConstructionText),
    allowedUse: { staging: true, production: true, webRuntime: true, screenshots: true, optimization: true, redistribution: true },
    modifications: [],
    outputSha256: [],
    attribution: null
  });
  generationLedger.records = [];
  scene.generator.acceptedInputSha256 = [sha256(componentConstructionText)];
  return { scene, assetLedger, generationLedger, componentConstruction, componentConstructionFixtureText: componentConstructionText };
}

function textsFromObjects(value, options = {}) {
  const fixtureConstruction = JSON.parse(value.componentConstructionFixtureText);
  const componentConstructionText = JSON.stringify(value.componentConstruction) === JSON.stringify(fixtureConstruction)
    ? value.componentConstructionFixtureText
    : `${JSON.stringify(value.componentConstruction, null, 2)}\n`;
  const rawSha256 = sha256(componentConstructionText);
  if (options.bindSource !== false) {
    const source = value.assetLedger.records.find(({ id }) => id === "asset-component-constructions");
    if (source) source.originalSha256 = rawSha256;
  }
  if (options.bindAcceptedInput !== false) value.scene.generator.acceptedInputSha256 = [rawSha256];
  return {
    sceneText: `${JSON.stringify(value.scene, null, 2)}\n`,
    assetLedgerText: `${JSON.stringify(value.assetLedger, null, 2)}\n`,
    generationLedgerText: `${JSON.stringify(value.generationLedger, null, 2)}\n`,
    componentConstructionText
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

test("candidate-owned component construction contract returns a stable non-readiness report", async () => {
  const report = parseComponentConstructionContract(await validTexts());
  assert.deepEqual(report, {
    status: "stage3-component-construction-contract-valid",
    sceneId: "warm-modern-meeting-room-candidate-01",
    specificationSha256: "63e1b366c45630e9311d38f3c9685296cf24c5f8eaf17626298f79f2b3296ef5",
    assetLedgerSha256: "250fe897e467fc8266c603d66eb224e695fd436829ce9d89aaca038d5f151f82",
    generationLedgerSha256: "42d49a3ad4f0f2a0b6f490461a30ed27a904396d51c34c9742862e02ba818930",
    assetRecordCount: 3,
    generationRecordCount: 0,
    componentCount: 11,
    seatCount: 8,
    componentConstructionSha256: "8a92cdf511b5ff1f8de5113505b59cf3ccb19c4124cd0b6dfa02a368d9317ce6",
    componentConstructionRawSha256: "6488d0db2572e62f91fa3770f288bf09dc524194946061e47eb942a34d6cd841",
    familyCount: 4,
    partCount: 38,
    overrideCount: 2,
    resolvedComponentCount: 11,
    resolvedMaterialCount: 4,
    objectNamePattern: "component.<componentId>.<partId>",
    boundaries: {
      componentsSpecified: true,
      componentsCompiled: false,
      finalCandidateGlbVerified: false,
      publicationReady: false
    }
  });
  assert.ok(Object.isFrozen(report));
  assert.ok(Object.isFrozen(report.boundaries));
});

test("existing scene parser remains unchanged and does not require construction text", async () => {
  const texts = await validTexts();
  const oldReport = parseSceneContract({
    sceneText: texts.sceneText,
    assetLedgerText: texts.assetLedgerText,
    generationLedgerText: texts.generationLedgerText
  });
  assert.deepEqual(Object.keys(oldReport), [
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
  assert.equal(oldReport.status, "stage3-scene-contract-valid");
});

test("material source binding accepts Candidate project-authored input without a hardcoded asset id", async () => {
  const value = await validObjects();
  const materialSource = value.assetLedger.records.find(({ id }) => id === value.componentConstruction.materialSourceRecordId);
  materialSource.id = "asset-layout-project";
  materialSource.kind = "project-authored-input";
  materialSource.source.repositoryPath = "source/concept-selection.json";
  value.componentConstruction.materialSourceRecordId = materialSource.id;
  for (const recipe of value.scene.materialRecipes) recipe.sourceRecordId = materialSource.id;
  assert.equal(parseComponentConstructionContract(textsFromObjects(value)).status, "stage3-component-construction-contract-valid");
});

test("parser snapshots getter and proxy text inputs once before parsing", async () => {
  const texts = await validTexts();
  const expectedConstructionReport = parseComponentConstructionContract(texts);
  const constructionReads = Object.fromEntries(Object.keys(texts).map((key) => [key, 0]));
  const getterOptions = {};
  for (const [key, text] of Object.entries(texts)) Object.defineProperty(getterOptions, key, {
    enumerable: true,
    get() {
      constructionReads[key] += 1;
      return constructionReads[key] === 1 ? text : "{";
    }
  });
  assert.deepEqual(parseComponentConstructionContract(getterOptions), expectedConstructionReport);
  assert.deepEqual(constructionReads, {
    sceneText: 1,
    assetLedgerText: 1,
    generationLedgerText: 1,
    componentConstructionText: 1
  });

  const sceneTexts = {
    sceneText: texts.sceneText,
    assetLedgerText: texts.assetLedgerText,
    generationLedgerText: texts.generationLedgerText
  };
  const expectedSceneReport = parseSceneContract(sceneTexts);
  const sceneReads = Object.fromEntries(Object.keys(sceneTexts).map((key) => [key, 0]));
  const proxyOptions = new Proxy({}, {
    get(_target, key) {
      if (!Object.hasOwn(sceneTexts, key)) return undefined;
      sceneReads[key] += 1;
      return sceneReads[key] === 1 ? sceneTexts[key] : "{";
    }
  });
  assert.deepEqual(parseSceneContract(proxyOptions), expectedSceneReport);
  assert.deepEqual(sceneReads, { sceneText: 1, assetLedgerText: 1, generationLedgerText: 1 });

  const snapshotOrder = [];
  const malformedTexts = { ...texts, sceneText: "{" };
  const malformedProxy = new Proxy({}, {
    get(_target, key) {
      if (!Object.hasOwn(malformedTexts, key)) return undefined;
      snapshotOrder.push(key);
      return malformedTexts[key];
    }
  });
  assert.deepEqual(captureContractError(() => parseComponentConstructionContract(malformedProxy)).issues, ["scene_json_invalid"]);
  assert.deepEqual(snapshotOrder, ["sceneText", "assetLedgerText", "generationLedgerText", "componentConstructionText"]);
});

test("construction parser rejects duplicate, malformed, and missing construction JSON after the scene contract", async () => {
  const texts = await validTexts();
  const duplicate = texts.componentConstructionText.replace(
    '  "schemaVersion": 1,',
    '  "schemaVersion": 1,\n  "schemaVersion": 1,'
  );
  assert.deepEqual(captureContractError(() => parseComponentConstructionContract({
    ...texts,
    componentConstructionText: duplicate
  })).issues, ["component_construction_duplicate_key"]);
  assert.deepEqual(captureContractError(() => parseComponentConstructionContract({
    ...texts,
    componentConstructionText: "{"
  })).issues, ["component_construction_json_invalid"]);
  const { componentConstructionText: omitted, ...withoutConstruction } = texts;
  assert.equal(typeof omitted, "string");
  assert.deepEqual(captureContractError(() => parseComponentConstructionContract(withoutConstruction)).issues, ["component_construction_text_invalid"]);

  const invalidSceneText = texts.sceneText.replace('"seed": 42', '"seed": -1');
  assert.deepEqual(captureContractError(() => parseComponentConstructionContract({
    ...texts,
    sceneText: invalidSceneText,
    componentConstructionText: "{"
  })).issues, ["schema_scene:generator:seed:minimum"]);
});

test("checked-in negative construction fixtures fail with stable diagnostics", async (t) => {
  const names = (await readdir(constructionFixtureRoot)).filter((name) => name.startsWith("negative.")).sort();
  assert.deepEqual(names, [
    "negative.duplicate-family.json",
    "negative.part-out-of-bounds.json",
    "negative.seat-height.json",
    "negative.source-path.json"
  ]);
  for (const name of names) await t.test(name, async () => {
    const mutation = JSON.parse(await readFixture(constructionFixtureRoot, name));
    const value = await validObjects();
    setPath(value[mutation.target], mutation.path, mutation.value);
    const error = captureContractError(() => parseComponentConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(mutation.expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("family, part, slot, override, and naming closure fails closed", async (t) => {
  const cases = [
    ["missing family", (value) => { value.componentConstruction.families.pop(); }, "schema_component_construction:families:minItems"],
    ["duplicate schema-valid family", (value) => { value.componentConstruction.families[1] = structuredClone(value.componentConstruction.families[0]); }, "component_construction_family_duplicate:conference-table"],
    ["unused family", (value) => { value.scene.components.pop(); }, "component_construction_family_unused:pendant-luminaire"],
    ["unresolved scene family", (value) => { value.scene.components.at(-1).family = "credenza"; }, "component_construction_scene_family_unresolved:credenza"],
    ["duplicate part", (value) => { value.componentConstruction.families[1].parts[1].id = "seat"; }, "component_construction_part_duplicate:task-chair:seat"],
    ["part redistribution preserving 38", (value) => { value.componentConstruction.families[2].parts.push(value.componentConstruction.families[0].parts.pop()); }, "schema_component_construction:families:0:parts:minItems"],
    ["duplicate slot", (value) => { value.componentConstruction.families[1].defaultMaterials[1].slot = "upholstery"; }, "component_construction_slot_duplicate:task-chair:upholstery"],
    ["unused slot", (value) => { value.componentConstruction.families[0].defaultMaterials.push({ slot: "unused", materialRecipeId: "warm-oak" }); }, "component_construction_slot_unused:conference-table:unused"],
    ["unknown part slot", (value) => { value.componentConstruction.families[0].parts[0].materialSlotId = "missing"; }, "component_construction_part_slot_unknown:conference-table:top:missing"],
    ["duplicate override", (value) => { value.componentConstruction.instanceMaterialOverrides[1] = { ...value.componentConstruction.instanceMaterialOverrides[0] }; }, "component_construction_override_duplicate:chair-02:upholstery"],
    ["unknown override component", (value) => { value.componentConstruction.instanceMaterialOverrides[0].componentId = "missing-chair"; }, "schema_component_construction:instanceMaterialOverrides:0:componentId:enum"],
    ["unknown override slot", (value) => { value.componentConstruction.instanceMaterialOverrides[0].slot = "missing"; }, "schema_component_construction:instanceMaterialOverrides:0:slot:const"],
    ["wrong override material", (value) => { value.componentConstruction.instanceMaterialOverrides[0].materialRecipeId = "sand-fabric"; }, "schema_component_construction:instanceMaterialOverrides:0:materialRecipeId:const"],
    ["unknown material", (value) => { value.componentConstruction.families[0].defaultMaterials[0].materialRecipeId = "missing-material"; }, "component_construction_material_unknown:conference-table:surface:missing-material"],
    ["derived object name collision", (value) => { value.componentConstruction.families[0].parts[1].id = "top"; }, "component_construction_object_name_duplicate:component.conference-table.top"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseComponentConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("default material mappings and per-part slots are exact", async (t) => {
  const cases = [
    ["coordinated slot rename", (value) => { const table = value.componentConstruction.families[0]; table.defaultMaterials[0].slot = "renamed-surface"; table.parts[0].materialSlotId = "renamed-surface"; }, "component_construction_default_material_missing:conference-table:surface"],
    ["valid recipe reassignment", (value) => { value.componentConstruction.families[0].defaultMaterials[0].materialRecipeId = "sand-fabric"; }, "component_construction_default_material_mismatch:conference-table:surface"],
    ["part slot reassignment", (value) => { value.componentConstruction.families[0].parts[0].materialSlotId = "frame"; }, "component_construction_part_material_slot_mismatch:conference-table:top"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseComponentConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("component overrides require the exact two approved instance bindings", async (t) => {
  const cases = [
    ["zero", (value) => { value.componentConstruction.instanceMaterialOverrides = []; }, "schema_component_construction:instanceMaterialOverrides:minItems"],
    ["one", (value) => { value.componentConstruction.instanceMaterialOverrides.pop(); }, "schema_component_construction:instanceMaterialOverrides:minItems"],
    ["three", (value) => { value.componentConstruction.instanceMaterialOverrides.push({ ...value.componentConstruction.instanceMaterialOverrides[0] }); }, "schema_component_construction:instanceMaterialOverrides:maxItems"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseComponentConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("source, raw-byte, component provenance, and material rights closure fails closed", async (t) => {
  const cases = [
    ["scene id", (value) => { value.componentConstruction.sceneId = "warm-modern-meeting-room-candidate-02"; }, {}, "component_construction_scene_id_mismatch"],
    ["unknown source", (value) => { value.componentConstruction.sourceRecordId = "missing-source"; }, {}, "component_construction_source_unknown:missing-source"],
    ["source kind", (value) => { value.assetLedger.records[2].kind = "mesh"; }, {}, "component_construction_source_kind_invalid:asset-component-constructions"],
    ["raw hash", (value) => { value.componentConstruction.instanceMaterialOverrides.reverse(); }, { bindSource: false, bindAcceptedInput: false }, "component_construction_source_sha256_mismatch:asset-component-constructions"],
    ["accepted input", (value) => { value.scene.generator.acceptedInputSha256 = [value.assetLedger.records[0].originalSha256]; }, { bindAcceptedInput: false }, "component_construction_input_sha256_missing:6488d0db2572e62f91fa3770f288bf09dc524194946061e47eb942a34d6cd841"],
    ["component source", (value) => { value.scene.components[0].sourceRecordId = "asset-material-project"; }, {}, "component_construction_component_source_mismatch:conference-table"],
    ["component generation", (value) => { value.scene.components[0].generationRecordId = "missing-generation"; }, {}, "component_generation_unknown:conference-table:missing-generation"],
    ["construction source rights", (value) => { value.assetLedger.records[2].allowedUse.webRuntime = false; }, {}, "component_source_use_invalid:chair-01:asset-component-constructions"],
    ["material source rights", (value) => { value.assetLedger.records[0].allowedUse.webRuntime = false; }, {}, "material_source_use_invalid:graphite-metal:asset-material-project"]
  ];
  for (const [name, mutate, options, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseComponentConstructionContract(textsFromObjects(value, options)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("construction geometry and furniture relationships fail closed", async (t) => {
  const nonFiniteTexts = await validTexts();
  nonFiniteTexts.componentConstructionText = nonFiniteTexts.componentConstructionText.replace('"widthM": 3.6', '"widthM": 1e999');
  assert.deepEqual(captureContractError(() => parseComponentConstructionContract(nonFiniteTexts)).issues, [
    "non_finite_number:componentConstruction:families:0:parts:0:dimensions:widthM"
  ]);
  const cases = [
    ["root property", (value) => { value.componentConstruction.unexpected = true; }, "schema_component_construction:root:additionalProperties"],
    ["part property", (value) => { value.componentConstruction.families[0].parts[0].unexpected = true; }, "schema_component_construction:families:0:parts:0:additionalProperties"],
    ["geometry kind", (value) => { value.componentConstruction.families[0].parts[0].geometry = "box"; }, "schema_component_construction:families:0:parts:0:geometry:const"],
    ["non-positive part", (value) => { value.componentConstruction.families[0].parts[0].dimensions.widthM = 0; }, "schema_component_construction:families:0:parts:0:dimensions:widthM:exclusiveMinimum"],
    ["non-positive bevel", (value) => { value.componentConstruction.families[0].parts[0].bevel.widthM = 0; }, "schema_component_construction:families:0:parts:0:bevel:widthM:exclusiveMinimum"],
    ["bevel segments", (value) => { value.componentConstruction.families[0].parts[0].bevel.segments = 2; }, "schema_component_construction:families:0:parts:0:bevel:segments:const"],
    ["bevel clamping", (value) => { value.componentConstruction.families[0].parts[0].bevel.clampOverlap = false; }, "schema_component_construction:families:0:parts:0:bevel:clampOverlap:const"],
    ["bevel maximum", (value) => { value.componentConstruction.families[0].parts[0].bevel.widthM = 0.061; }, "component_construction_bevel_out_of_bounds:conference-table:top"],
    ["local yaw", (value) => { value.componentConstruction.families[0].parts[0].localTransform.yaw = 0.1; }, "component_construction_part_yaw_invalid:conference-table:top"],
    ["yaw-aware bounds", (value) => { value.componentConstruction.families[0].parts[0].localTransform.yaw = 1.5707963267948966; }, "component_construction_part_out_of_component_bounds:conference-table:top"],
    ["negative local y", (value) => { value.componentConstruction.families[1].parts[2].localTransform.position.y = 0.1; }, "component_construction_part_out_of_component_bounds:chair-01:leg-negative-x"],
    ["world bounds", (value) => { value.componentConstruction.families[3].parts[0].localTransform.position.x = 3.5; }, "component_construction_part_world_bounds_invalid:pendant-fixture:bar-negative-x"],
    ["interior wall intersection", (value) => { value.scene.components.at(-1).transform.position.x = 2.37; }, "component_construction_part_world_bounds_invalid:pendant-fixture:bar-positive-x"],
    ["chair back direction", (value) => { value.componentConstruction.families[1].parts[1].localTransform.position.z = 0.24; }, "component_construction_chair_back_direction_invalid"],
    ["AV table contact", (value) => { value.componentConstruction.families[0].parts[0].localTransform.position.y = 0.67; }, "component_construction_av_table_height_mismatch"],
    ["shifted AV overhang", (value) => { value.scene.components.find(({ family }) => family === "conference-av").transform.position.x = 1.7; }, "component_construction_av_table_horizontal_mismatch"],
    ["yaw-aware AV overhang", (value) => { const av = value.scene.components.find(({ family }) => family === "conference-av"); av.transform.position.z = 0.45; av.transform.yaw = 1.5707963267948966; }, "component_construction_av_table_horizontal_mismatch"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseComponentConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("all five component-scoped material recipes are exact and share one approved material source", async (t) => {
  const cases = [
    ["muted color drift", (value) => { value.scene.materialRecipes.find(({ id }) => id === "muted-grey-green-fabric").baseColorSrgb = "#78877B"; }, "component_construction_material_recipe_mismatch:muted-grey-green-fabric:baseColorSrgb"],
    ["scalar drift", (value) => { value.scene.materialRecipes.find(({ id }) => id === "warm-oak").roughness = 0.47; }, "component_construction_material_recipe_mismatch:warm-oak:roughness"],
    ["muted roughness drift", (value) => { value.scene.materialRecipes.find(({ id }) => id === "muted-grey-green-fabric").roughness = 0.76; }, "component_construction_material_recipe_mismatch:muted-grey-green-fabric:roughness"],
    ["unknown material source", (value) => { value.componentConstruction.materialSourceRecordId = "missing-material-source"; }, "component_construction_material_source_unknown:missing-material-source"],
    ["construction source reused as material source", (value) => { value.componentConstruction.materialSourceRecordId = value.componentConstruction.sourceRecordId; }, "component_construction_material_source_must_be_separate"],
    ["unusable material source", (value) => { const source = structuredClone(value.assetLedger.records.find(({ id }) => id === value.componentConstruction.materialSourceRecordId)); source.id = "asset-unusable-material"; source.allowedUse.webRuntime = false; value.assetLedger.records.push(source); value.componentConstruction.materialSourceRecordId = source.id; }, "component_construction_material_source_use_invalid:asset-unusable-material"],
    ["mixed material sources", (value) => { value.scene.materialRecipes.find(({ id }) => id === "mineral-plaster").sourceRecordId = "asset-exterior-project"; }, "component_construction_material_source_mismatch:mineral-plaster:asset-exterior-project"],
    ["invalid material source kind", (value) => { value.componentConstruction.materialSourceRecordId = "asset-exterior-project"; }, "component_construction_material_source_kind_invalid:asset-exterior-project"],
    ["non-project-authored material source", (value) => { const source = value.assetLedger.records.find(({ id }) => id === value.componentConstruction.materialSourceRecordId); source.source.classification = "cc0"; }, "component_construction_material_source_invalid:asset-material-project"]
  ];
  for (const [name, mutate, expectedIssue] of cases) await t.test(name, async () => {
    const value = await validObjects();
    mutate(value);
    const error = captureContractError(() => parseComponentConstructionContract(textsFromObjects(value)));
    assert.ok(error.issues.includes(expectedIssue), `${name}: ${error.issues.join(",")}`);
  });
});

test("component construction schema exposes only the scoped candidate-owned contract", async () => {
  const schema = JSON.parse(await readFixture(root, "schemas/component-constructions.schema.json"));
  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ["schemaVersion", "sceneId", "sourceRecordId", "materialSourceRecordId", "families", "instanceMaterialOverrides"]);
  assert.equal(schema.properties.materialSourceRecordId.$ref, "#/$defs/id");
  assert.equal(schema.$defs.family.additionalProperties, false);
  assert.equal(schema.$defs.part.properties.geometry.const, "beveled-box");
  assert.equal(schema.$defs.part.properties.bevel.$ref, "#/$defs/bevel");
  assert.equal(schema.$defs.bevel.properties.segments.const, 3);
  assert.equal(schema.$defs.bevel.properties.clampOverlap.const, true);
  assert.equal(schema.$defs.materialOverride.additionalProperties, false);
  assert.equal(schema.properties.families.minItems, 4);
  assert.equal(schema.properties.families.maxItems, 4);
  assert.equal(schema.properties.instanceMaterialOverrides.minItems, 2);
  assert.equal(schema.properties.instanceMaterialOverrides.maxItems, 2);
  assert.deepEqual(schema.$defs.materialOverride.properties.componentId.enum, ["chair-02", "chair-07"]);
  assert.equal(schema.$defs.materialOverride.properties.slot.const, "upholstery");
  assert.equal(schema.$defs.materialOverride.properties.materialRecipeId.const, "muted-grey-green-fabric");
});
