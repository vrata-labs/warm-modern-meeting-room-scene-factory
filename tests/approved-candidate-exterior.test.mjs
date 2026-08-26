import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  compileApprovedCandidateExterior,
  createApprovedCandidateExteriorGlbContract,
  inspectGlb,
  loadApprovedCandidateArchitectureSource,
  loadApprovedCandidateComponentSource,
  loadApprovedCandidateExteriorSource,
  loadApprovedCandidateMediaSurfaceSource,
  parseCandidateLockText,
  roomOutputFaultInjection,
  validateCompilerReport,
  validateApprovedCandidateExteriorPhaseIsolation,
  validateGlbWithKhronos,
  verifyApprovedCandidateExteriorReproducibility
} from "../compiler/compile-room-shell.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const candidateRepositoryPath = process.env.CANDIDATE_01_DIR ?? resolve(root, "../warm-modern-meeting-room-candidate-01");
const candidateCommit = "380098d4b7cbc1d57498b059466f095ae3568929";
const blender = process.env.BLENDER_BIN;
const adapter = resolve(root, "compiler/blender-room-shell.py");
const python = process.env.PYTHON ?? "python3";

const canonicalHashes = {
  specificationSha256: "d26cad260909d50082c07b13a86dd3ea8af4b6b32b591b825957dd26c9b53b12",
  assetLedgerSha256: "d3b01c23d371221783fd6f59e637f9fe619f1970a8683d07fef899464773b2ef",
  generationLedgerSha256: "42d49a3ad4f0f2a0b6f490461a30ed27a904396d51c34c9742862e02ba818930",
  componentConstructionSha256: "a28310aa7806fb05b8b08087a8b13de900498c3a12dbc6c3e0a5cc77ae7a3709",
  componentConstructionRawSha256: "f32327442d015f4c89942bf752e959d6c0abc24613c72f32a8ba4c2b2b29d5d1",
  mediaSurfaceConstructionSha256: "829c7ccba37c9bf73e570ad3769224895dbd2d2784fb0e9c776ad959bb6f9e8f",
  mediaSurfaceConstructionRawSha256: "0bdf11ca588d700c8a721d60cb503215c29ce021b48708302b8b9da45ec1036b",
  exteriorConstructionSha256: "5a02dc468db992bb7b12aa783b485408e4dde29ac4c29e09753c86c9c226a330",
  exteriorConstructionRawSha256: "54a9e7b3b20c94844380c524443005006225eccbe22b4a57f4df50782e859639"
};

const glbEvidence = {
  sha256: "eb74ca5e90b7dd09ad137c2127a53988491a557eb1d634093dd2b5eee6456b92",
  byteLength: 614784,
  blendByteLength: 1421892,
  reopenInspectionSha256: "d54209a0bb1c473910e701625f253d62fae5f70b3794dc04a8afeb3bd00f9f89",
  binaryByteLength: 535728,
  decodedVertexCount: 16656,
  decodedIndexCount: 24540,
  decodedTriangleCount: 8180,
  distinctPositionCount: 4208,
  decodedNormalCount: 16656,
  objectVertexCount: 4208,
  objectFaceCount: 4250
};

function glbWithMutatedJson(bytes, mutate) {
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  mutate(document);
  const rawJson = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
  const binaryChunk = bytes.subarray(20 + jsonLength);
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
  const normalOffset = 20 + jsonLength + 8 + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  for (let index = 0; index < 3; index += 1) mutated.writeFloatLE(0, normalOffset + index * 4);
  return mutated;
}

function adapterArguments(source, scenePath, componentPath, exteriorPath, reportPath, extra = []) {
  return [
    adapter,
    "--input-kind", "approved-candidate-exterior",
    "--scene-spec", scenePath,
    "--expected-raw-sha256", source.rawSceneSha256,
    "--expected-specification-sha256", source.contract.specificationSha256,
    "--component-constructions", componentPath,
    "--expected-component-raw-sha256", source.rawComponentConstructionSha256,
    "--expected-component-sha256", source.componentContract.componentConstructionSha256,
    "--exterior-constructions", exteriorPath,
    "--expected-exterior-raw-sha256", source.rawExteriorConstructionSha256,
    "--expected-exterior-sha256", source.exteriorContract.exteriorConstructionSha256,
    "--report", reportPath,
    ...extra
  ];
}

test("Candidate 01 exterior source reads and validates exactly seven locked Git blobs", async () => {
  const source = await loadApprovedCandidateExteriorSource({ candidateRepositoryPath });
  assert.equal(source.inputKind, "approved-candidate-exterior");
  assert.equal(source.candidateSource.commit, candidateCommit);
  assert.equal(source.candidateSource.treeOid, "671af158f4b0f213d010191f21c3cd7d4779b5e9");
  assert.equal(source.candidateSource.validatorCommit, "156bbc3b3e15f8d24ee3d60ee01f6f4ac2c91de2");
  assert.deepEqual(source.canonicalHashes, canonicalHashes);
  assert.deepEqual(source.acceptedInputSha256, [
    "978d0c7d75dd73d9c4d4419daa2f1530b0fdfac26c0eee1bcd7ef4e76501272a",
    canonicalHashes.componentConstructionRawSha256,
    canonicalHashes.mediaSurfaceConstructionRawSha256,
    canonicalHashes.exteriorConstructionRawSha256
  ]);
  assert.deepEqual(Object.keys(source.candidateSource.inputBlobs).sort(), [
    "provenance/asset-ledger.json",
    "provenance/generation-ledger.json",
    "source/component-constructions.json",
    "source/concept-selection.json",
    "source/exterior-constructions.json",
    "source/media-surface-constructions.json",
    "source/scene-spec.json"
  ]);
  assert.deepEqual(source.candidateSource.inputBlobs["source/exterior-constructions.json"], {
    gitBlobOid: "7762f1c1bf9535b8e8f0d3f77bb5652bc365f814",
    rawSha256: canonicalHashes.exteriorConstructionRawSha256,
    byteLength: 3063
  });
  assert.deepEqual(source.counts, {
    assetRecordCount: 4,
    generationRecordCount: 0,
    familyCount: 4,
    partCount: 38,
    overrideCount: 2,
    componentCount: 11,
    resolvedComponentCount: 11,
    materialCount: 5,
    resolvedMaterialCount: 4,
    seatCount: 8,
    surfaceCount: 2,
    resolvedSurfaceCount: 2,
    exteriorObjectCount: 4,
    exteriorResolvedObjectCount: 4,
    exteriorMaterialCount: 3,
    exteriorRoleCount: 4
  });
  assert.equal(source.semanticReports.component.status, "stage3-component-construction-contract-valid");
  assert.equal(source.semanticReports.mediaSurfaces.status, "stage3-media-surface-construction-contract-valid");
  assert.equal(source.semanticReports.exterior.status, "stage3-exterior-construction-contract-valid");
  assert.equal(source.exteriorGlbEvidence.sha256, glbEvidence.sha256);
  assert.ok(Object.values(source.boundaries).every((value) => value === false));
});

test("F1, F2, and F3 loaders remain pinned to historical baselines", async () => {
  const [architecture, components, media, exterior] = await Promise.all([
    loadApprovedCandidateArchitectureSource({ candidateRepositoryPath }),
    loadApprovedCandidateComponentSource({ candidateRepositoryPath }),
    loadApprovedCandidateMediaSurfaceSource({ candidateRepositoryPath }),
    loadApprovedCandidateExteriorSource({ candidateRepositoryPath })
  ]);
  assert.equal(architecture.candidateSource.commit, "df564befcd65cb51a345fa9d315e40cadef6e563");
  assert.equal(components.candidateSource.commit, "8fec157a37bf619797f1ff200ccc32f611f94c18");
  assert.equal(media.candidateSource.commit, "26d3af6e2720576113431c22b9443533b919f390");
  assert.equal(exterior.candidateSource.commit, candidateCommit);
  assert.equal(architecture.architectureBaseline.sha256, "ae24faad5306191667195c0157db9cd5c6d800875492cdf242fe32d1ff962b33");
  assert.equal(components.componentGlbEvidence.sha256, "a6e67219590ae4bbc1e887f97f9a7c071c924943223a90ef3560bdd7b06e5c69");
  assert.equal(media.mediaSurfaceProjectionEvidence.sha256, "352b31af533049d7fe84f1ecb55643db85e7258ceff1e2d87be8f8785e38a4fb");
});

test("F4 rejects current component or media drift from the historical F2 and F3 semantics", async () => {
  const [components, media, exterior] = await Promise.all([
    loadApprovedCandidateComponentSource({ candidateRepositoryPath }),
    loadApprovedCandidateMediaSurfaceSource({ candidateRepositoryPath }),
    loadApprovedCandidateExteriorSource({ candidateRepositoryPath })
  ]);
  assert.equal(validateApprovedCandidateExteriorPhaseIsolation(
    exterior.scene,
    exterior.componentConstruction,
    exterior.mediaSurfaceConstruction,
    components,
    media
  ), true);
  for (const [name, mutate] of [
    ["component transform", (value) => { value.scene.components[0].transform.position.x += 0.01; }],
    ["component material", (value) => { value.scene.materialRecipes[0].roughness += 0.01; }],
    ["media transform", (value) => { value.scene.mediaSurfaces[0].yaw += 0.01; }],
    ["media semantics", (value) => { value.mediaSurfaceConstruction.surfaces[0].pixelDimensions.width += 1; }]
  ]) {
    const value = {
      scene: structuredClone(exterior.scene),
      componentConstruction: structuredClone(exterior.componentConstruction),
      mediaSurfaceConstruction: structuredClone(exterior.mediaSurfaceConstruction)
    };
    mutate(value);
    assert.throws(() => validateApprovedCandidateExteriorPhaseIsolation(
      value.scene,
      value.componentConstruction,
      value.mediaSurfaceConstruction,
      components,
      media
    ), /approved_candidate_exterior_phase_isolation_mismatch/, name);
  }

  const lockText = await readFile(resolve(root, "experiment/warm-modern-meeting-room/candidate-lock.json"), "utf8");
  const lock = JSON.parse(lockText);
  lock.candidates.candidate01.componentConstructionSha256 = "0".repeat(64);
  assert.throws(
    () => parseCandidateLockText(`${JSON.stringify(lock, null, 2)}\n`),
    /approved_candidate_lock_invalid/
  );
});

test("exterior loader rejects wrong commits and ignores worktree, replacement, and ambient Git drift", async () => {
  await assert.rejects(loadApprovedCandidateExteriorSource({
    candidateRepositoryPath,
    candidateCommit: "26d3af6e2720576113431c22b9443533b919f390"
  }), /approved_candidate_exterior_commit_not_locked/);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-exterior-source-"));
  const ambientNames = ["GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];
  const ambient = Object.fromEntries(ambientNames.map((name) => [name, process.env[name]]));
  try {
    const clonePath = resolve(temporaryRoot, "candidate-01");
    await execFileAsync("git", ["clone", "--local", "--no-checkout", candidateRepositoryPath, clonePath]);
    await execFileAsync("git", ["-C", clonePath, "replace", candidateCommit, "26d3af6e2720576113431c22b9443533b919f390"]);
    await mkdir(resolve(clonePath, "source"), { recursive: true });
    await writeFile(resolve(clonePath, "source/exterior-constructions.json"), "{}\n");
    process.env.GIT_DIR = resolve(temporaryRoot, "hostile.git");
    process.env.GIT_WORK_TREE = temporaryRoot;
    process.env.GIT_OBJECT_DIRECTORY = resolve(temporaryRoot, "objects");
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = resolve(temporaryRoot, "alternates");
    const source = await loadApprovedCandidateExteriorSource({ candidateRepositoryPath: clonePath });
    assert.equal(source.candidateSource.commit, candidateCommit);
    assert.equal(source.exteriorConstruction.objects.length, 4);
  } finally {
    for (const name of ambientNames) {
      if (ambient[name] === undefined) delete process.env[name];
      else process.env[name] = ambient[name];
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("exterior plan resolves exact names, transforms, support metadata, materials, and false final boundaries", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-exterior-plan-"));
  try {
    const source = await loadApprovedCandidateExteriorSource({ candidateRepositoryPath });
    const scenePath = resolve(temporaryRoot, "scene.json");
    const componentPath = resolve(temporaryRoot, "components.json");
    const exteriorPath = resolve(temporaryRoot, "exterior.json");
    const reportPath = resolve(temporaryRoot, "plan.json");
    await writeFile(scenePath, source.sceneBytes);
    await writeFile(componentPath, source.componentConstructionBytes);
    await writeFile(exteriorPath, source.exteriorConstructionBytes);
    await execFileAsync(python, adapterArguments(source, scenePath, componentPath, exteriorPath, reportPath, ["--plan-only"]));
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "stage3-approved-candidate-exterior-plan-valid");
    assert.equal(report.shell.collectionName, "WMMR_APPROVED_CANDIDATE_EXTERIOR");
    assert.equal(report.components.partObjectCount, 38);
    assert.equal(report.exterior.objectCount, 4);
    assert.equal(report.exterior.objectNamePattern, "exterior.<objectId>");
    assert.deepEqual(report.exterior.objects.map(({ name }) => name), [
      "exterior.context-mass",
      "exterior.hedge",
      "exterior.near-ground",
      "exterior.planter"
    ]);
    assert.deepEqual(report.exterior.objects.find(({ name }) => name === "exterior.hedge"), {
      name: "exterior.hedge",
      geometry: "beveled-box",
      dimensionsM: { widthM: 1.1, heightM: 0.68, depthM: 0.42 },
      centerM: { x: -1.35, y: 0.96, z: 4.65 },
      vertexCount: 96,
      faceCount: 98,
      objectId: "hedge",
      role: "vegetation",
      worldYaw: 0,
      bevel: { widthM: 0.025, segments: 3, clampOverlap: true },
      materialId: "exterior-vegetation",
      materialRecipeId: "exterior-vegetation",
      supportObjectId: "planter",
      edgeCount: 192
    });
    assert.equal(report.materials.recipeCount, 8);
    assert.equal(report.materials.assignmentCount, 61);
    assert.equal(report.materials.zoneCount, 64);
    assert.equal(report.materials.recipes.find(({ id }) => id === "exterior-vegetation").sourceRecordId, "asset-exterior-constructions-project");
    assert.equal(report.exteriorGlbByteIdentical, false);
    assert.equal(report.byteIdenticalExportsVerified, false);
    assert.equal(report.lightingCompiled, false);
    assert.equal(report.mediaSurfacesCompiled, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.releaseArtifactsCreated, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.artifactBytesIncludedInRepository, false);

    const mixedPath = resolve(temporaryRoot, "mixed-exterior.json");
    await writeFile(mixedPath, Buffer.concat([source.exteriorConstructionBytes, Buffer.from(" ")]));
    await assert.rejects(execFileAsync(python, adapterArguments(
      source,
      scenePath,
      componentPath,
      mixedPath,
      resolve(temporaryRoot, "mixed.json"),
      ["--plan-only"]
    )), /approved_candidate_exterior_raw_sha256_mismatch/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("exact Blender compiles and reopens 19 architecture, 38 component, and 4 exterior meshes", { skip: !blender }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-exterior-compile-"));
  try {
    const source = await loadApprovedCandidateExteriorSource({ candidateRepositoryPath });
    const outputBlendPath = resolve(temporaryRoot, "candidate-exterior.blend");
    const outputGlbPath = resolve(temporaryRoot, "candidate-exterior.glb");
    const reportPath = resolve(temporaryRoot, "candidate-exterior.json");
    const report = await compileApprovedCandidateExterior({
      blenderPath: blender,
      candidateRepositoryPath,
      outputBlendPath,
      outputGlbPath,
      reportPath
    });
    assert.equal(report.status, "stage3-approved-candidate-exterior-compiled");
    assert.deepEqual([report.inventory.objectCount, report.inventory.meshCount, report.inventory.materialCount], [61, 61, 8]);
    assert.deepEqual([report.inventory.vertexCount, report.inventory.faceCount], [glbEvidence.objectVertexCount, glbEvidence.objectFaceCount]);
    assert.equal(report.inventory.cameraCount, 0);
    assert.equal(report.inventory.lightCount, 0);
    assert.equal(report.inventory.imageCount, 0);
    assert.equal(report.inventory.textureCount, 0);
    assert.equal(report.components.objects.length, 38);
    assert.equal(report.exterior.objects.length, 4);
    assert.ok(report.exterior.objects.every(({ name, parentName, modifierCount, bevelApplied, bevelInsetAxisCount, vertexCount, edgeCount, faceCount, topologySha256 }) => (
      /^exterior\.[a-z0-9-]+$/.test(name)
      && parentName === null && modifierCount === 0 && bevelApplied === true && bevelInsetAxisCount === 3
      && vertexCount === 96 && edgeCount === 192 && faceCount === 98 && /^[0-9a-f]{64}$/.test(topologySha256)
    )));
    assert.equal(report.outputBlend.byteLength, glbEvidence.blendByteLength);
    assert.equal(report.outputGlb.sha256, glbEvidence.sha256);
    assert.equal(report.outputGlb.byteLength, glbEvidence.byteLength);
    assert.equal(report.reopenInspectionSha256, glbEvidence.reopenInspectionSha256);
    assert.equal(report.glbInspection.status, "approved-candidate-exterior-glb-inspection-valid");
    assert.deepEqual([
      report.glbInspection.nodeCount,
      report.glbInspection.meshCount,
      report.glbInspection.materialCount,
      report.glbInspection.reachableNodeCount,
      report.glbInspection.uniqueMeshBindingCount,
      report.glbInspection.primitiveCount
    ], [61, 61, 8, 61, 61, 61]);
    assert.deepEqual([
      report.glbInspection.binaryByteLength,
      report.glbInspection.decodedVertexCount,
      report.glbInspection.decodedIndexCount,
      report.glbInspection.decodedTriangleCount,
      report.glbInspection.decodedDistinctReferencedPositionCount,
      report.glbInspection.decodedNormalCount
    ], [
      glbEvidence.binaryByteLength,
      glbEvidence.decodedVertexCount,
      glbEvidence.decodedIndexCount,
      glbEvidence.decodedTriangleCount,
      glbEvidence.distinctPositionCount,
      glbEvidence.decodedNormalCount
    ]);
    assert.equal(report.glbInspection.extensionCount, 0);
    assert.equal(report.glbInspection.cameraCount, 0);
    assert.equal(report.glbInspection.lightCount, 0);
    assert.equal(report.glbInspection.imageCount, 0);
    assert.equal(report.glbInspection.textureCount, 0);
    assert.equal(report.glbInspection.animationCount, 0);
    assert.equal(report.glbInspection.skinCount, 0);
    assert.equal(report.glbInspection.geometryEvidence.filter(({ name }) => name.startsWith("exterior.")).length, 4);
    assert.ok(report.glbInspection.geometryEvidence.filter(({ name }) => name.startsWith("exterior.")).every(({ bevelInsetAxisCount }) => bevelInsetAxisCount === 3));
    assert.ok(report.glbInspection.minimumNormalLength >= 1 - 1e-4);
    assert.ok(report.glbInspection.maximumNormalLength <= 1 + 1e-4);
    assert.deepEqual(report.glbInspection.materialNames, [
      "material.exterior-graphite",
      "material.exterior-vegetation",
      "material.graphite-metal",
      "material.ground-mineral",
      "material.mineral-plaster",
      "material.muted-grey-green-fabric",
      "material.sand-fabric",
      "material.warm-oak"
    ]);
    assert.deepEqual(new Set(report.glbInspection.materialEvidence.map(({ sourceRecordId }) => sourceRecordId)), new Set([
      "asset-layout-project",
      "asset-exterior-constructions-project"
    ]));
    assert.ok(report.glbInspection.materialEvidence.filter(({ name }) => name.startsWith("material.exterior-") || name === "material.ground-mineral")
      .every(({ sourceRecordId }) => sourceRecordId === "asset-exterior-constructions-project"));
    assert.equal(report.khronosValidation.version, "2.0.0-dev.3.10");
    assert.deepEqual(report.khronosValidation.issueCounts, { errors: 0, warnings: 0, infos: 61, hints: 0 });
    assert.equal(report.architectureBaseline.expectedSha256, "ae24faad5306191667195c0157db9cd5c6d800875492cdf242fe32d1ff962b33");
    assert.equal(new Set([
      report.architectureBaseline.planSha256,
      report.architectureBaseline.reopenSha256,
      report.architectureBaseline.glbSha256
    ]).size, 1);
    assert.equal(report.exteriorCompiled, true);
    assert.equal(report.exteriorGlbByteIdentical, false);
    assert.equal(report.byteIdenticalExportsVerified, false);
    assert.equal(report.lightingCompiled, false);
    assert.equal(report.mediaSurfacesCompiled, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.releaseArtifactsCreated, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.artifactBytesIncludedInRepository, false);
    assert.equal(report.sceneBinaryAddedToRepository, false);
    const reopenedHedge = report.reopenInspection.exterior.objects.find(({ name }) => name === "exterior.hedge");
    for (const [key, expected] of Object.entries({ x: -1.35, y: 0.96, z: 4.65 })) {
      assert.ok(Math.abs(reopenedHedge.centerM[key] - expected) <= 1e-6);
    }
    for (const [key, expected] of Object.entries({ widthM: 1.1, heightM: 0.68, depthM: 0.42 })) {
      assert.ok(Math.abs(reopenedHedge.dimensionsM[key] - expected) <= 1e-6);
    }
    assert.deepEqual({
      supportObjectId: reopenedHedge.supportObjectId,
      parentName: reopenedHedge.parentName,
      materialRecipeId: reopenedHedge.materialRecipeId
    }, {
      supportObjectId: "planter",
      parentName: null,
      materialRecipeId: "exterior-vegetation"
    });
    assert.equal(report.reopenInspection.materials.materialEvidence.find(({ recipeId }) => recipeId === "exterior-vegetation").sourceRecordId, "asset-exterior-constructions-project");
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);

    const glb = await readFile(outputGlbPath);
    const contract = createApprovedCandidateExteriorGlbContract(report, source);
    for (const [name, mutate, issue] of [
      ["rogue exterior", (document) => { document.nodes.find(({ name: nodeName }) => nodeName.startsWith("exterior.")).name = "exterior.rogue"; }, /room_glb_inventory_invalid/],
      ["support metadata", (document) => { document.nodes.find(({ name: nodeName }) => nodeName === "exterior.hedge").extras.wmmr_support_object_id = "near-ground"; }, /room_glb_exterior_metadata_invalid/],
      ["material provenance", (document) => { document.materials.find(({ name: materialName }) => materialName === "material.exterior-vegetation").extras.wmmr_source_record_id = "asset-layout-project"; }, /room_glb_material_invalid/],
      ["parenting", (document) => { document.nodes[0].children = [1]; }, /room_glb_scene_invalid|room_glb_expected_bound_mismatch/],
      ["light", (document) => { document.extensionsUsed = ["KHR_lights_punctual"]; }, /room_glb_prohibited_content/]
    ]) assert.throws(() => inspectGlb(glbWithMutatedJson(glb, mutate), contract), issue, name);
    assert.throws(() => inspectGlb(glbWithZeroNormal(glb), contract), /room_glb_normal_invalid/);
    assert.throws(() => inspectGlb(glbWithMutatedJson(glb, (document) => {
      document.accessors[document.meshes[0].primitives[0].attributes.POSITION].max = [20, 20, 20];
    }), contract), /room_glb_accessor_bounds_invalid/);
    await assert.rejects(validateGlbWithKhronos(glbWithMutatedJson(glb, (document) => {
      document.asset.version = "1.0";
    })), /khronos_gltf_validation_issues/);

    const falseFinal = structuredClone(report);
    falseFinal.finalCandidateGlbVerified = true;
    assert.throws(() => validateCompilerReport(falseFinal, source, report.blender.binarySha256), /room_shell_report_invalid/);

    const scenePath = resolve(temporaryRoot, "scene.json");
    const componentPath = resolve(temporaryRoot, "components.json");
    const exteriorPath = resolve(temporaryRoot, "exterior.json");
    await writeFile(scenePath, source.sceneBytes);
    await writeFile(componentPath, source.componentConstructionBytes);
    await writeFile(exteriorPath, source.exteriorConstructionBytes);
    const tamperedBlendPath = resolve(temporaryRoot, "tampered.blend");
    await copyFile(outputBlendPath, tamperedBlendPath);
    await execFileAsync(blender, [
      "--background",
      tamperedBlendPath,
      "--python-expr",
      "import bpy; o=bpy.data.objects['exterior.hedge']; o.parent=bpy.data.objects['exterior.planter']; bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath, check_existing=False)"
    ], { timeout: 300_000 });
    await assert.rejects(execFileAsync(blender, [
      "--background", tamperedBlendPath,
      "--python", adapter,
      "--",
      ...adapterArguments(source, scenePath, componentPath, exteriorPath, resolve(temporaryRoot, "invalid-reopen.json"), ["--inspect-only"]).slice(1)
    ], { timeout: 300_000 }), /room_exterior_object_invalid:exterior\.hedge/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("two exact Blender exterior runs produce a byte-identical scoped GLB and identical reopen digest", { skip: !blender }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-exterior-repro-"));
  try {
    const reportPath = resolve(temporaryRoot, "reproducibility.json");
    const report = await verifyApprovedCandidateExteriorReproducibility({
      blenderPath: blender,
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath
    });
    assert.equal(report.status, "stage3-approved-candidate-exterior-glb-byte-identical");
    assert.equal(report.comparison.glbByteIdentical, true);
    assert.equal(report.comparison.glbSha256, glbEvidence.sha256);
    assert.equal(report.comparison.glbByteLength, glbEvidence.byteLength);
    assert.equal(report.comparison.blendByteIdentical, false);
    assert.equal(report.comparison.reopenInspectionIdentical, true);
    assert.equal(report.comparison.reopenInspectionSha256, glbEvidence.reopenInspectionSha256);
    assert.equal(report.exteriorGlbByteIdentical, true);
    assert.equal(report.byteIdenticalExportsVerified, false);
    assert.equal(report.boundaries.exteriorGlbByteIdentical, true);
    assert.equal(report.boundaries.byteIdenticalExportsVerified, false);
    assert.equal(report.boundaries.lightingCompiled, false);
    assert.equal(report.boundaries.mediaSurfacesCompiled, false);
    assert.equal(report.boundaries.finalCandidateGlbVerified, false);
    assert.equal(report.boundaries.releaseArtifactsCreated, false);
    assert.equal(report.boundaries.publicationReady, false);
    assert.equal(report.boundaries.artifactBytesIncludedInRepository, false);
    assert.equal(report.boundaries.sceneBinaryAddedToRepository, false);
    assert.equal(report.runs[0].glb.sha256, report.runs[1].glb.sha256);
    assert.equal(report.runs[0].reopenInspection.sha256, report.runs[1].reopenInspection.sha256);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("atomic exterior publication preserves a racing foreign output and removes invocation-owned files", { skip: !blender }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-exterior-output-race-"));
  try {
    const outputBlendPath = resolve(temporaryRoot, "candidate-exterior.blend");
    const outputGlbPath = resolve(temporaryRoot, "candidate-exterior.glb");
    const reportPath = resolve(temporaryRoot, "candidate-exterior.json");
    await assert.rejects(compileApprovedCandidateExterior({
      blenderPath: blender,
      candidateRepositoryPath,
      outputBlendPath,
      outputGlbPath,
      reportPath,
      [roomOutputFaultInjection]: { artifact: "blend", phase: "replace-before-link" }
    }), /EEXIST/);
    assert.equal(await readFile(outputBlendPath, "utf8"), "external-race\n");
    assert.equal(await lstat(outputGlbPath).catch(() => null), null);
    assert.equal(await lstat(reportPath).catch(() => null), null);
    assert.deepEqual((await readdir(temporaryRoot)).sort(), ["candidate-exterior.blend"]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("exterior compile and reproducibility reject conflicts and repository-root outputs", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-exterior-conflict-"));
  try {
    if (blender) await assert.rejects(compileApprovedCandidateExterior({
      blenderPath: blender,
      candidateRepositoryPath,
      outputBlendPath: resolve(temporaryRoot, "same.blend"),
      outputGlbPath: resolve(temporaryRoot, "same.blend"),
      reportPath: resolve(temporaryRoot, "report.json")
    }), /room_glb_output_invalid/);
    await assert.rejects(verifyApprovedCandidateExteriorReproducibility({
      blenderPath: blender ?? "/missing/blender",
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath: resolve(temporaryRoot, "run-01.json")
    }), /room_reproducibility_output_paths_conflict/);
    assert.deepEqual(await readdir(temporaryRoot), []);

    for (const outputBlendPath of [resolve(root, "review-f4.blend"), resolve(candidateRepositoryPath, "review-f4.blend")]) {
      await assert.rejects(compileApprovedCandidateExterior({
        blenderPath: blender ?? "/missing/blender",
        candidateRepositoryPath,
        outputBlendPath,
        outputGlbPath: resolve(temporaryRoot, `review-${outputBlendPath.length}.glb`),
        reportPath: resolve(temporaryRoot, `review-${outputBlendPath.length}.json`)
      }), /room_shell_(?:blender|output)_invalid/);
      assert.equal(await lstat(outputBlendPath).catch(() => null), null);
    }
    for (const outputDirectory of [root, candidateRepositoryPath]) {
      await assert.rejects(verifyApprovedCandidateExteriorReproducibility({
        blenderPath: blender ?? "/missing/blender",
        candidateRepositoryPath,
        outputDirectory,
        reportPath: resolve(temporaryRoot, `repro-${outputDirectory.length}.json`)
      }), /room_reproducibility_output_directory_invalid/);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
