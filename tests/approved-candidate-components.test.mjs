import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  compileApprovedCandidateComponents,
  createApprovedCandidateComponentGlbContract,
  inspectGlb,
  loadApprovedCandidateComponentSource,
  validateCompilerReport,
  validateGlbWithKhronos,
  verifyArchitectureBaselineEvidence,
  verifyApprovedCandidateComponentsReproducibility
} from "../compiler/compile-room-shell.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const candidateRepositoryPath = process.env.CANDIDATE_01_DIR ?? resolve(root, "../warm-modern-meeting-room-candidate-01");
const candidateCommit = "8fec157a37bf619797f1ff200ccc32f611f94c18";
const blender = process.env.BLENDER_BIN;
const adapter = resolve(root, "compiler/blender-room-shell.py");
const python = process.env.PYTHON ?? "python3";

const canonicalHashes = {
  specificationSha256: "10106915ffabfdd4580b3866c3714f05f22bec9ce430a7bc62c7c4d2e1578644",
  assetLedgerSha256: "18f6efeaab40f19e68e012628f9f1f1f8db5603d7ac98c65b88e9a8d23c80419",
  generationLedgerSha256: "42d49a3ad4f0f2a0b6f490461a30ed27a904396d51c34c9742862e02ba818930",
  componentConstructionSha256: "a28310aa7806fb05b8b08087a8b13de900498c3a12dbc6c3e0a5cc77ae7a3709",
  componentConstructionRawSha256: "f32327442d015f4c89942bf752e959d6c0abc24613c72f32a8ba4c2b2b29d5d1"
};

function glbWithMutatedJson(bytes, mutate) {
  const jsonLength = bytes.readUInt32LE(12);
  const jsonType = bytes.readUInt32LE(16);
  assert.equal(jsonType, 0x4e4f534a);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  mutate(document);
  const rawJson = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
  const binaryOffset = 20 + jsonLength;
  const binaryChunk = bytes.subarray(binaryOffset);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const body = Buffer.concat([jsonHeader, json, binaryChunk]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + body.length, 8);
  return Buffer.concat([header, body]);
}

function glbWithZeroNormal(bytes) {
  const mutated = Buffer.from(bytes);
  const jsonLength = mutated.readUInt32LE(12);
  const document = JSON.parse(mutated.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  const accessor = document.accessors[document.meshes[0].primitives[0].attributes.NORMAL];
  const view = document.bufferViews[accessor.bufferView];
  const binaryDataOffset = 20 + jsonLength + 8;
  const normalOffset = binaryDataOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  for (let index = 0; index < 3; index += 1) mutated.writeFloatLE(0, normalOffset + index * 4);
  return mutated;
}

function componentAdapterArguments(source, scenePath, constructionPath, reportPath, extra = []) {
  return [
    adapter,
    "--input-kind", "approved-candidate-components",
    "--scene-spec", scenePath,
    "--expected-raw-sha256", source.rawSceneSha256,
    "--expected-specification-sha256", source.contract.specificationSha256,
    "--component-constructions", constructionPath,
    "--expected-component-raw-sha256", source.rawComponentConstructionSha256,
    "--expected-component-sha256", source.contract.componentConstructionSha256,
    "--report", reportPath,
    ...extra
  ];
}

test("Candidate 01 component source reads and validates exactly five locked Git blobs", async () => {
  const source = await loadApprovedCandidateComponentSource({ candidateRepositoryPath });
  assert.equal(source.inputKind, "approved-candidate-components");
  assert.equal(source.candidateSource.commit, candidateCommit);
  assert.equal(source.candidateSource.validatorCommit, "60617c021a8434f6687af038706b411e2e4b265c");
  assert.deepEqual(source.canonicalHashes, canonicalHashes);
  assert.deepEqual(source.acceptedInputSha256, [
    "978d0c7d75dd73d9c4d4419daa2f1530b0fdfac26c0eee1bcd7ef4e76501272a",
    canonicalHashes.componentConstructionRawSha256
  ]);
  assert.deepEqual(source.counts, {
    assetRecordCount: 2,
    generationRecordCount: 0,
    familyCount: 4,
    partCount: 38,
    overrideCount: 2,
    componentCount: 11,
    resolvedComponentCount: 11,
    materialCount: 5,
    resolvedMaterialCount: 4,
    seatCount: 8
  });
  assert.deepEqual(Object.keys(source.candidateSource.inputBlobs).sort(), [
    "provenance/asset-ledger.json",
    "provenance/generation-ledger.json",
    "source/component-constructions.json",
    "source/concept-selection.json",
    "source/scene-spec.json"
  ]);
  assert.deepEqual(source.candidateSource.inputBlobs["source/component-constructions.json"], {
    gitBlobOid: "f728ba5e555dcbb233f418b2306b39e576e094b1",
    rawSha256: canonicalHashes.componentConstructionRawSha256,
    byteLength: 4250
  });
  assert.equal(source.contract.status, "stage3-component-construction-contract-valid");
});

test("component loader rejects a wrong commit and ignores mixed worktree bytes", async () => {
  await assert.rejects(loadApprovedCandidateComponentSource({
    candidateRepositoryPath,
    candidateCommit: "df564befcd65cb51a345fa9d315e40cadef6e563"
  }), /approved_candidate_component_commit_not_locked/);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-component-source-"));
  try {
    const clonePath = resolve(temporaryRoot, "candidate-01");
    await execFileAsync("git", ["clone", "--local", "--no-checkout", candidateRepositoryPath, clonePath]);
    await mkdir(resolve(clonePath, "source"), { recursive: true });
    await writeFile(resolve(clonePath, "source/component-constructions.json"), "{}\n");
    const source = await loadApprovedCandidateComponentSource({ candidateRepositoryPath: clonePath });
    assert.equal(source.rawComponentConstructionSha256, canonicalHashes.componentConstructionRawSha256);
    assert.equal(source.contract.partCount, 38);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("component plan resolves exact part centers, materials, counts, and false final boundaries", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-component-plan-"));
  try {
    const source = await loadApprovedCandidateComponentSource({ candidateRepositoryPath });
    const scenePath = resolve(temporaryRoot, "scene.json");
    const constructionPath = resolve(temporaryRoot, "components.json");
    await writeFile(scenePath, source.sceneBytes);
    await writeFile(constructionPath, source.componentConstructionBytes);
    const reportPath = resolve(temporaryRoot, "plan.json");
    await execFileAsync(python, componentAdapterArguments(source, scenePath, constructionPath, reportPath, ["--plan-only"]));
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "stage3-approved-candidate-components-plan-valid");
    assert.equal(report.shell.collectionName, "WMMR_APPROVED_CANDIDATE_COMPONENTS");
    assert.equal(report.components.partObjectCount, 38);
    assert.deepEqual(report.components.familyObjectCounts, {
      "conference-av": 1,
      "conference-table": 3,
      "pendant-luminaire": 2,
      "task-chair": 32
    });
    assert.equal(report.components.objects.find(({ name }) => name === "component.chair-01.back").centerM.z, 1.39);
    assert.equal(report.components.objects.find(({ name }) => name === "component.chair-02.seat").materialRecipeId, "muted-grey-green-fabric");
    assert.equal(report.materials.recipeCount, 5);
    assert.equal(report.materials.assignmentCount, 57);
    assert.equal(report.componentGlbByteIdentical, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.publicationReady, false);

    const mixedPath = resolve(temporaryRoot, "mixed-components.json");
    await writeFile(mixedPath, Buffer.concat([source.componentConstructionBytes, Buffer.from(" ")]));
    await assert.rejects(execFileAsync(python, componentAdapterArguments(
      source,
      scenePath,
      mixedPath,
      resolve(temporaryRoot, "mixed.json"),
      ["--plan-only"]
    )), /approved_candidate_component_raw_sha256_mismatch/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("exact Blender compiles and reopens 57 mesh objects with applied bevel topology", { skip: !blender }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-component-compile-"));
  try {
    const source = await loadApprovedCandidateComponentSource({ candidateRepositoryPath });
    const outputBlendPath = resolve(temporaryRoot, "candidate-components.blend");
    const outputGlbPath = resolve(temporaryRoot, "candidate-components.glb");
    const reportPath = resolve(temporaryRoot, "candidate-components.json");
    const report = await compileApprovedCandidateComponents({
      blenderPath: blender,
      candidateRepositoryPath,
      outputBlendPath,
      outputGlbPath,
      reportPath
    });
    assert.equal(report.status, "stage3-approved-candidate-components-compiled");
    assert.deepEqual([report.inventory.objectCount, report.inventory.meshCount, report.inventory.materialCount], [57, 57, 5]);
    assert.deepEqual([report.inventory.vertexCount, report.inventory.faceCount], [3824, 3858]);
    assert.equal(report.inventory.cameraCount, 0);
    assert.equal(report.inventory.lightCount, 0);
    assert.equal(report.inventory.imageCount, 0);
    assert.equal(report.inventory.textureCount, 0);
    assert.equal(report.components.partObjectCount, 38);
    assert.ok(report.components.objects.every(({ modifierCount, bevelApplied, bevelInsetAxisCount, vertexCount, edgeCount, faceCount, topologySha256 }) => (
      modifierCount === 0 && bevelApplied === true && bevelInsetAxisCount === 3
      && vertexCount === 96 && edgeCount === 192 && faceCount === 98 && /^[0-9a-f]{64}$/.test(topologySha256)
    )));
    assert.equal(report.glbInspection.status, "approved-candidate-components-glb-inspection-valid");
    assert.equal(report.outputGlb.sha256, "a6e67219590ae4bbc1e887f97f9a7c071c924943223a90ef3560bdd7b06e5c69");
    assert.equal(report.outputGlb.byteLength, 557976);
    assert.deepEqual([
      report.glbInspection.nodeCount,
      report.glbInspection.meshCount,
      report.glbInspection.materialCount,
      report.glbInspection.reachableNodeCount,
      report.glbInspection.uniqueMeshBindingCount,
      report.glbInspection.primitiveCount
    ], [57, 57, 5, 57, 57, 57]);
    assert.equal(report.glbInspection.extensionCount, 0);
    assert.equal(report.glbInspection.cameraCount, 0);
    assert.equal(report.glbInspection.lightCount, 0);
    assert.equal(report.glbInspection.imageCount, 0);
    assert.equal(report.glbInspection.textureCount, 0);
    assert.equal(report.glbInspection.animationCount, 0);
    assert.equal(report.glbInspection.skinCount, 0);
    assert.deepEqual([
      report.glbInspection.binaryByteLength,
      report.glbInspection.decodedVertexCount,
      report.glbInspection.decodedIndexCount,
      report.glbInspection.decodedTriangleCount,
      report.glbInspection.decodedDistinctReferencedPositionCount
    ], [485448, 15120, 22284, 7428, 3824]);
    assert.equal(report.glbInspection.geometryEvidence.filter(({ geometry }) => geometry === "beveled-box").length, 38);
    assert.ok(report.glbInspection.geometryEvidence.filter(({ geometry }) => geometry === "beveled-box").every(({ bevelInsetAxisCount }) => bevelInsetAxisCount === 3));
    assert.equal(report.glbInspection.decodedNormalCount, 15120);
    assert.ok(report.glbInspection.minimumNormalLength >= 1 - 1e-4);
    assert.ok(report.glbInspection.maximumNormalLength <= 1 + 1e-4);
    assert.deepEqual(report.glbInspection.materialNames, [
      "material.graphite-metal",
      "material.mineral-plaster",
      "material.muted-grey-green-fabric",
      "material.sand-fabric",
      "material.warm-oak"
    ]);
    assert.equal(report.componentsSpecified, true);
    assert.equal(report.componentsCompiled, true);
    assert.equal(report.componentGlbByteIdentical, false);
    assert.equal(report.exteriorCompiled, false);
    assert.equal(report.lightingCompiled, false);
    assert.equal(report.mediaSurfacesCompiled, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.sceneBinaryAddedToRepository, false);
    assert.equal(report.boundaries.sceneBinaryAddedToRepository, false);
    assert.equal(report.khronosValidation.status, "khronos-gltf-validator-valid");
    assert.equal(report.khronosValidation.version, "2.0.0-dev.3.10");
    assert.deepEqual(report.khronosValidation.issueCounts, { errors: 0, warnings: 0, infos: 57, hints: 0 });
    assert.equal(report.architectureBaseline.expectedSha256, "ae24faad5306191667195c0157db9cd5c6d800875492cdf242fe32d1ff962b33");
    assert.equal(new Set([
      report.architectureBaseline.planSha256,
      report.architectureBaseline.reopenSha256,
      report.architectureBaseline.glbSha256
    ]).size, 1);
    assert.equal(report.reopenInspection.materials.materialEvidence.length, 5);
    const reopenedOak = report.reopenInspection.materials.materialEvidence.find(({ recipeId }) => recipeId === "warm-oak");
    assert.deepEqual({
      recipeId: reopenedOak.recipeId,
      baseColorSrgb: reopenedOak.baseColorSrgb,
      textureScaleM: reopenedOak.textureScaleM,
      sourceRecordId: reopenedOak.sourceRecordId,
      metalness: reopenedOak.metalness
    }, {
      recipeId: "warm-oak",
      baseColorSrgb: "#A87543",
      textureScaleM: 0.18,
      sourceRecordId: "asset-layout-project",
      metalness: 0
    });
    assert.ok(Math.abs(reopenedOak.roughness - 0.46) <= 1e-6);
    assert.equal(report.reopenInspection.materials.assignments.find(({ objectName }) => objectName === "shell.floor").materialSlots[0].recipeId, "warm-oak");
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);

    const glb = await readFile(outputGlbPath);
    const contract = createApprovedCandidateComponentGlbContract(report, source);
    for (const [name, mutate, issue] of [
      ["rogue component", (document) => { document.nodes[0].name = "component.rogue.body"; }, /room_glb_inventory_invalid/],
      ["helper", (document) => { document.nodes[0].name = "helper.component-root"; }, /room_glb_inventory_invalid/],
      ["light", (document) => { document.extensionsUsed = ["KHR_lights_punctual"]; }, /room_glb_prohibited_content/]
    ]) {
      assert.throws(() => inspectGlb(glbWithMutatedJson(glb, mutate), contract), issue, name);
    }
    assert.throws(() => inspectGlb(glbWithZeroNormal(glb), contract), /room_glb_normal_invalid/);
    assert.throws(() => inspectGlb(glbWithMutatedJson(glb, (document) => {
      document.accessors[document.meshes[0].primitives[0].attributes.NORMAL].min = [2, 2, 2];
    }), contract), /room_glb_accessor_bounds_invalid/);
    await assert.rejects(validateGlbWithKhronos(glbWithMutatedJson(glb, (document) => {
      document.asset.version = "1.0";
    })), /khronos_gltf_validation_issues/);

    const architectureMutation = structuredClone(report);
    architectureMutation.inventory.objects.find(({ name }) => name === "shell.floor").dimensionsM.widthM += 0.01;
    assert.throws(() => verifyArchitectureBaselineEvidence(
      source.architectureBaseline,
      architectureMutation,
      report.reopenInspection,
      report.glbInspection
    ), /architecture_baseline_mismatch/);

    const falseFinal = structuredClone(report);
    falseFinal.finalCandidateGlbVerified = true;
    assert.throws(() => validateCompilerReport(falseFinal, source, report.blender.binarySha256), /room_shell_report_invalid/);

    const scenePath = resolve(temporaryRoot, "scene.json");
    const constructionPath = resolve(temporaryRoot, "components.json");
    await writeFile(scenePath, source.sceneBytes);
    await writeFile(constructionPath, source.componentConstructionBytes);
    const materialTamperPath = resolve(temporaryRoot, "material-tamper.blend");
    await copyFile(outputBlendPath, materialTamperPath);
    await execFileAsync(blender, [
      "--background",
      materialTamperPath,
      "--python-expr",
      "import bpy; bpy.data.materials['material.warm-oak']['wmmr_source_record_id']='tampered'; bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)"
    ], { timeout: 300_000 });
    await assert.rejects(execFileAsync(blender, [
      "--background", materialTamperPath,
      "--python", adapter,
      "--",
      ...componentAdapterArguments(source, scenePath, constructionPath, resolve(temporaryRoot, "invalid-material-reopen.json"), ["--inspect-only"]).slice(1)
    ], { timeout: 300_000 }), /room_material_recipe_mismatch:warm-oak/);

    await execFileAsync(blender, [
      "--background",
      outputBlendPath,
      "--python-expr",
      "import bpy; o=bpy.data.objects['component.conference-table.top']; o.modifiers.new(name='unapplied', type='BEVEL'); bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)"
    ], { timeout: 300_000 });
    await assert.rejects(execFileAsync(blender, [
      "--background", outputBlendPath,
      "--python", adapter,
      "--",
      ...componentAdapterArguments(source, scenePath, constructionPath, resolve(temporaryRoot, "invalid-reopen.json"), ["--inspect-only"]).slice(1)
    ], { timeout: 300_000 }), /room_component_object_invalid:component\.conference-table\.top/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("two exact Blender component runs produce a byte-identical GLB and identical reopen digest", { skip: !blender }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-component-repro-"));
  try {
    const report = await verifyApprovedCandidateComponentsReproducibility({
      blenderPath: blender,
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath: resolve(temporaryRoot, "reproducibility.json")
    });
    assert.equal(report.status, "stage3-approved-candidate-components-glb-byte-identical");
    assert.equal(report.comparison.glbByteIdentical, true);
    assert.equal(report.comparison.reopenInspectionIdentical, true);
    assert.equal(report.comparison.glbSha256, "a6e67219590ae4bbc1e887f97f9a7c071c924943223a90ef3560bdd7b06e5c69");
    assert.equal(report.comparison.glbByteLength, 557976);
    assert.equal(report.comparison.reopenInspectionSha256, "5a1014f9fad8f12929d43d7fae0fd8155274754dc514db6590151bbbcda5e810");
    assert.equal(report.componentGlbByteIdentical, true);
    assert.equal(report.boundaries.componentGlbByteIdentical, true);
    assert.equal(report.boundaries.finalCandidateGlbVerified, false);
    assert.equal(report.boundaries.publicationReady, false);
    assert.equal(report.sceneBinaryAddedToRepository, false);
    assert.equal(report.runs[0].glb.sha256, report.runs[1].glb.sha256);
    assert.equal(report.runs[0].reopenInspection.sha256, report.runs[1].reopenInspection.sha256);
    assert.deepEqual(JSON.parse(await readFile(resolve(temporaryRoot, "reproducibility.json"), "utf8")), report);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("component compile and reproducibility preflights reject output path conflicts", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-component-conflict-"));
  try {
    if (blender) await assert.rejects(compileApprovedCandidateComponents({
      blenderPath: blender,
      candidateRepositoryPath,
      outputBlendPath: resolve(temporaryRoot, "same.blend"),
      outputGlbPath: resolve(temporaryRoot, "same.blend"),
      reportPath: resolve(temporaryRoot, "report.json")
    }), /room_glb_output_invalid/);
    await assert.rejects(verifyApprovedCandidateComponentsReproducibility({
      blenderPath: blender ?? "/missing/blender",
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath: resolve(temporaryRoot, "run-01.json")
    }), /room_reproducibility_output_paths_conflict/);
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
