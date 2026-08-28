import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test, { after } from "node:test";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import {
  compileApprovedCandidateLighting,
  createApprovedCandidateLightingGlbContract,
  inspectFirstViewPng,
  inspectGlb,
  loadApprovedCandidateExteriorSource,
  loadApprovedCandidateLightingSource,
  measureFirstViewRgb,
  roomOutputFaultInjection,
  validateApprovedCandidateLightingPhaseIsolation,
  verifyApprovedCandidateLightingReproducibility
} from "../compiler/compile-room-shell.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const candidateRepositoryPath = process.env.CANDIDATE_01_DIR ?? resolve(root, "../warm-modern-meeting-room-candidate-01");
const candidateCommit = "5a3a45a1e8e84867a4a4377b102025ef52f08e2e";
const candidateTree = "cd15988d106e687dc10a64e6677d9789d870384a";
const blender = process.env.BLENDER_BIN;
const adapter = resolve(root, "compiler/blender-room-shell.py");
const python = process.env.PYTHON ?? "python3";

const inputBlobs = {
  "source/scene-spec.json": {
    gitBlobOid: "b0876c5f1648d13cc8a5b2c043d48581516c4e07",
    rawSha256: "6cb67a644e251e3a0c9e0372c5b2ca1b93593cbab5ca11aad8712e9f94289a8a",
    byteLength: 12519
  },
  "provenance/asset-ledger.json": {
    gitBlobOid: "01f4421a161c4c14ee05db35f30669611584f8e7",
    rawSha256: "566a41415cb5ca2a5c79a189c1232fcc61254601b40b198bb0f1fc06a6cecea8",
    byteLength: 4149
  },
  "provenance/generation-ledger.json": {
    gitBlobOid: "818681718cec850450f4d79947090a817c213cf0",
    rawSha256: "7928a70464b60ca12a35c5fbaefe30ba99c937dfd69e6f65e519366cdbfe891e",
    byteLength: 96
  },
  "source/concept-selection.json": {
    gitBlobOid: "71192d2e57ee35e4a301f61bbc50b77ebfdf4b21",
    rawSha256: "978d0c7d75dd73d9c4d4419daa2f1530b0fdfac26c0eee1bcd7ef4e76501272a",
    byteLength: 1361
  },
  "source/component-constructions.json": {
    gitBlobOid: "f728ba5e555dcbb233f418b2306b39e576e094b1",
    rawSha256: "f32327442d015f4c89942bf752e959d6c0abc24613c72f32a8ba4c2b2b29d5d1",
    byteLength: 4250
  },
  "source/media-surface-constructions.json": {
    gitBlobOid: "87faedb5845ad1eed5cda3b1fac8a0f15cea5365",
    rawSha256: "0bdf11ca588d700c8a721d60cb503215c29ce021b48708302b8b9da45ec1036b",
    byteLength: 847
  },
  "source/exterior-constructions.json": {
    gitBlobOid: "7762f1c1bf9535b8e8f0d3f77bb5652bc365f814",
    rawSha256: "54a9e7b3b20c94844380c524443005006225eccbe22b4a57f4df50782e859639",
    byteLength: 3063
  },
  "source/lighting-constructions.json": {
    gitBlobOid: "a0ccda1e6ac94fe8611cbfbde66bb839c39ec8af",
    rawSha256: "ecb7c8da21191c2a9f893c0975de3bf2b8187cf6cd8a711bb3bb2b71f3610cad",
    byteLength: 7178
  }
};

function adapterArguments(source, scenePath, componentPath, exteriorPath, lightingPath, reportPath, extra = []) {
  return [
    adapter,
    "--input-kind", "approved-candidate-lighting",
    "--scene-spec", scenePath,
    "--expected-raw-sha256", source.rawSceneSha256,
    "--expected-specification-sha256", source.contract.specificationSha256,
    "--component-constructions", componentPath,
    "--expected-component-raw-sha256", source.rawComponentConstructionSha256,
    "--expected-component-sha256", source.componentContract.componentConstructionSha256,
    "--exterior-constructions", exteriorPath,
    "--expected-exterior-raw-sha256", source.rawExteriorConstructionSha256,
    "--expected-exterior-sha256", source.exteriorContract.exteriorConstructionSha256,
    "--lighting-constructions", lightingPath,
    "--expected-lighting-raw-sha256", source.rawLightingConstructionSha256,
    "--expected-lighting-sha256", source.lightingContract.lightingConstructionSha256,
    "--report", reportPath,
    ...extra
  ];
}

function isolationInput(source) {
  return {
    scene: structuredClone(source.scene),
    assetLedger: structuredClone(source.assetLedger),
    componentConstruction: structuredClone(source.componentConstruction),
    mediaSurfaceConstruction: structuredClone(source.mediaSurfaceConstruction),
    exteriorConstruction: structuredClone(source.exteriorConstruction),
    lightingConstruction: structuredClone(source.lightingConstruction),
    componentConstructionBytes: Buffer.from(source.componentConstructionBytes),
    mediaSurfaceConstructionBytes: Buffer.from(source.mediaSurfaceConstructionBytes),
    exteriorConstructionBytes: Buffer.from(source.exteriorConstructionBytes),
    rawLightingConstructionSha256: source.rawLightingConstructionSha256
  };
}

function glbWithMutatedJson(bytes, mutate) {
  const jsonLength = bytes.readUInt32LE(12);
  const document = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8").trimEnd());
  mutate(document);
  const rawJson = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
  const jsonHeader = Buffer.alloc(8);
  jsonHeader.writeUInt32LE(json.length, 0);
  jsonHeader.writeUInt32LE(0x4e4f534a, 4);
  const body = Buffer.concat([jsonHeader, json, bytes.subarray(20 + jsonLength)]);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + body.length, 8);
  return Buffer.concat([header, body]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBytes = Buffer.from(type, "ascii");
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.length, 0);
  typeBytes.copy(header, 4);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])), 0);
  return Buffer.concat([header, data, checksum]);
}

function solidScanlines(width, height, rgb) {
  const stride = width * 3;
  const filtered = Buffer.alloc(height * (stride + 1));
  for (let row = 0; row < height; row += 1) {
    const offset = row * (stride + 1) + 1;
    for (let column = 0; column < width; column += 1) {
      filtered.set(rgb, offset + column * 3);
    }
  }
  return filtered;
}

function pngBytes({
  width = 960,
  height = 540,
  rgb = [255, 255, 255],
  filtered,
  idatData,
  extraChunks = []
} = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  const scanlines = filtered ?? solidScanlines(width, height, rgb);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    ...extraChunks,
    pngChunk("IDAT", idatData ?? deflateSync(scanlines)),
    pngChunk("IEND")
  ]);
}

let compiledFixtureRoot;
let compiledFixturePromise;

async function compiledFixture() {
  if (!compiledFixturePromise) compiledFixturePromise = (async () => {
    compiledFixtureRoot = await mkdtemp(resolve(tmpdir(), "wmmr-lighting-fixture-"));
    const source = await loadApprovedCandidateLightingSource({ candidateRepositoryPath });
    const outputBlendPath = resolve(compiledFixtureRoot, "candidate-lighting.blend");
    const outputGlbPath = resolve(compiledFixtureRoot, "candidate-lighting.glb");
    const firstViewOutputPath = resolve(compiledFixtureRoot, "first-view.png");
    const reportPath = resolve(compiledFixtureRoot, "candidate-lighting.json");
    const report = await compileApprovedCandidateLighting({
      blenderPath: blender,
      candidateRepositoryPath,
      outputBlendPath,
      outputGlbPath,
      firstViewOutputPath,
      reportPath
    });
    return {
      source,
      report,
      glb: await readFile(outputGlbPath),
      firstView: await readFile(firstViewOutputPath),
      reportPath
    };
  })();
  return compiledFixturePromise;
}

after(async () => {
  if (compiledFixtureRoot) await rm(compiledFixtureRoot, { recursive: true, force: true });
});

function assertLockedEvidence(report, locked) {
  if (locked === null) {
    assert.equal(report.lockedLightingGlbEvidence, null);
    return;
  }
  const issueCounts = report.khronosValidation.issueCounts;
  const observed = {
    sha256: report.outputGlb.sha256,
    byteLength: report.outputGlb.byteLength,
    blendByteLength: report.outputBlend.byteLength,
    firstViewPixelCount: report.firstViewInspection.pixelCount,
    reopenInspectionSha256: report.reopenInspectionSha256,
    meshCount: report.inventory.meshCount,
    lightCount: report.inventory.lightCount,
    materialCount: report.inventory.materialCount,
    nodeCount: report.glbInspection.nodeCount,
    binaryByteLength: report.glbInspection.binaryByteLength,
    decodedVertexCount: report.glbInspection.decodedVertexCount,
    decodedIndexCount: report.glbInspection.decodedIndexCount,
    decodedTriangleCount: report.glbInspection.decodedTriangleCount,
    distinctPositionCount: report.glbInspection.decodedDistinctReferencedPositionCount,
    decodedNormalCount: report.glbInspection.decodedNormalCount,
    minimumNormalLength: report.glbInspection.minimumNormalLength,
    maximumNormalLength: report.glbInspection.maximumNormalLength,
    objectVertexCount: report.inventory.vertexCount,
    objectFaceCount: report.inventory.faceCount,
    architectureSemanticSha256: report.architectureBaseline.expectedSha256,
    khronosValidator: {
      package: report.khronosValidation.package,
      version: report.khronosValidation.version,
      errors: issueCounts.errors,
      warnings: issueCounts.warnings,
      infos: issueCounts.infos,
      hints: issueCounts.hints
    }
  };
  for (const [key, value] of Object.entries(observed)) assert.deepEqual(value, locked[key], key);
  assert.equal(locked.firstViewPngByteIdentityScope, "same-host-same-blender-binary-two-run");
  assert.equal(report.firstViewInspection.acceptancePass, true);
}

test("Candidate 01 lighting source is pinned to one commit, one tree, and exactly eight Git blobs", async () => {
  const source = await loadApprovedCandidateLightingSource({ candidateRepositoryPath });
  assert.equal(source.inputKind, "approved-candidate-lighting");
  assert.equal(source.candidateSource.commit, candidateCommit);
  assert.equal(source.candidateSource.treeOid, candidateTree);
  assert.equal(source.candidateSource.validatorCommit, "ec0a8fb118ef9c5589ebb0bd4a9b9047616a56c2");
  assert.deepEqual(source.candidateSource.inputBlobs, inputBlobs);
  assert.equal(Object.keys(source.candidateSource.inputBlobs).length, 8);
  assert.deepEqual(source.acceptedInputSha256, [
    inputBlobs["source/concept-selection.json"].rawSha256,
    inputBlobs["source/component-constructions.json"].rawSha256,
    inputBlobs["source/media-surface-constructions.json"].rawSha256,
    inputBlobs["source/exterior-constructions.json"].rawSha256,
    inputBlobs["source/lighting-constructions.json"].rawSha256
  ]);
  assert.deepEqual(source.counts, {
    assetRecordCount: 5,
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
    exteriorRoleCount: 4,
    lightCount: 3,
    resolvedLightCount: 3
  });
  assert.equal(source.semanticReports.component.status, "stage3-component-construction-contract-valid");
  assert.equal(source.semanticReports.mediaSurfaces.status, "stage3-media-surface-construction-contract-valid");
  assert.equal(source.semanticReports.exterior.status, "stage3-exterior-construction-contract-valid");
  assert.equal(source.semanticReports.lighting.status, "stage3-lighting-construction-contract-valid");
  assert.equal(source.f4Baseline.commit, "380098d4b7cbc1d57498b059466f095ae3568929");
  assert.equal(source.f4Baseline.treeOid, "671af158f4b0f213d010191f21c3cd7d4779b5e9");
  assert.equal(source.lightingGlbEvidence.firstViewPngByteIdentityScope, "same-host-same-blender-binary-two-run");
  assert.deepEqual(source.boundaries, {
    componentsCompiled: true,
    mediaSurfacesCompiled: false,
    exteriorCompiled: true,
    lightingCompiled: true,
    lightingGlbByteIdentical: true,
    firstViewRendered: true,
    firstViewAcceptanceVerified: true,
    firstViewPngByteIdentical: true,
    byteIdenticalExportsVerified: false,
    finalCandidateGlbVerified: false,
    releaseArtifactsCreated: false,
    publicationReady: false,
    artifactBytesIncludedInRepository: false
  });

  await assert.rejects(loadApprovedCandidateLightingSource({
    candidateRepositoryPath,
    candidateCommit: source.f4Baseline.commit
  }), /approved_candidate_lighting_commit_not_locked/);
});

test("F5 phase isolation rejects prior scene, component, media, and exterior drift but permits lighting-only changes", async () => {
  const [source, exterior] = await Promise.all([
    loadApprovedCandidateLightingSource({ candidateRepositoryPath }),
    loadApprovedCandidateExteriorSource({ candidateRepositoryPath })
  ]);
  assert.equal(validateApprovedCandidateLightingPhaseIsolation(isolationInput(source), exterior), true);

  for (const [name, mutate] of [
    ["prior scene", (value) => { value.scene.reviewViews[0].fovDegrees += 1; }],
    ["components", (value) => { value.componentConstruction.families[0].parts[0].dimensions.widthM += 0.01; }],
    ["media", (value) => { value.mediaSurfaceConstruction.surfaces[0].pixelDimensions.width += 1; }],
    ["exterior", (value) => { value.exteriorConstruction.objects[0].transform.position.x += 0.01; }]
  ]) {
    const current = isolationInput(source);
    mutate(current);
    assert.throws(
      () => validateApprovedCandidateLightingPhaseIsolation(current, exterior),
      /approved_candidate_lighting_phase_isolation_mismatch/,
      name
    );
  }

  const lightingOnly = isolationInput(source);
  lightingOnly.scene.lighting[0].intensityLumens += 1;
  lightingOnly.lightingConstruction.lights[0].emitter.rollRadians += 0.01;
  assert.equal(validateApprovedCandidateLightingPhaseIsolation(lightingOnly, exterior), true);
});

test("lighting plan fixes energies, coordinate conversion, camera, and deterministic render contract", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-lighting-plan-"));
  try {
    const source = await loadApprovedCandidateLightingSource({ candidateRepositoryPath });
    const scenePath = resolve(temporaryRoot, "scene.json");
    const componentPath = resolve(temporaryRoot, "components.json");
    const exteriorPath = resolve(temporaryRoot, "exterior.json");
    const lightingPath = resolve(temporaryRoot, "lighting.json");
    const reportPath = resolve(temporaryRoot, "plan.json");
    await Promise.all([
      writeFile(scenePath, source.sceneBytes),
      writeFile(componentPath, source.componentConstructionBytes),
      writeFile(exteriorPath, source.exteriorConstructionBytes),
      writeFile(lightingPath, source.lightingConstructionBytes)
    ]);
    await execFileAsync(python, adapterArguments(source, scenePath, componentPath, exteriorPath, lightingPath, reportPath, ["--plan-only"]));
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "stage3-approved-candidate-lighting-plan-valid");
    assert.equal(report.shell.collectionName, "WMMR_APPROVED_CANDIDATE_LIGHTING");
    assert.deepEqual(report.lighting.lights.map((light) => ({
      name: light.name,
      blenderType: light.blenderType,
      energy: light.energy,
      energyUnit: light.energyUnit,
      scenePositionM: light.scenePositionM,
      blenderLocationM: light.blenderLocationM,
      sceneTargetM: light.sceneTargetM,
      blenderTargetM: light.blenderTargetM
    })), [
      {
        name: "light.window-daylight",
        blenderType: "SUN",
        energy: 25,
        energyUnit: "watt-per-square-meter",
        scenePositionM: { x: 0, y: 2.5, z: 2.4 },
        blenderLocationM: { x: 0, y: 2.4, z: 2.5 },
        sceneTargetM: { x: -0.45, y: 1.2, z: 0.05 },
        blenderTargetM: { x: -0.45, y: 0.05, z: 1.2 }
      },
      {
        name: "light.ceiling-fill",
        blenderType: "SPOT",
        energy: 180,
        energyUnit: "watt",
        scenePositionM: { x: 1.5, y: 2.95, z: -1 },
        blenderLocationM: { x: 1.5, y: -1, z: 2.95 },
        sceneTargetM: { x: -3.4, y: 1.55, z: 0.15 },
        blenderTargetM: { x: -3.4, y: 0.15, z: 1.55 }
      },
      {
        name: "light.table-pendant",
        blenderType: "SPOT",
        energy: 320,
        energyUnit: "watt",
        scenePositionM: { x: -0.45, y: 2.55, z: 0.05 },
        blenderLocationM: { x: -0.45, y: 0.05, z: 2.55 },
        sceneTargetM: { x: -0.45, y: 0.74, z: 0.05 },
        blenderTargetM: { x: -0.45, y: 0.05, z: 0.74 }
      }
    ]);
    assert.deepEqual(report.lighting.lights.slice(1).map((light) => ({
      rangeM: light.rangeM,
      inner: light.innerConeHalfAngleRadians,
      outer: light.outerConeHalfAngleRadians,
      spotSize: light.spotSizeRadians,
      spotBlend: light.spotBlend,
      radius: light.shadowSoftSizeM
    })), [
      { rangeM: 8, inner: 0.7, outer: 1.1, spotSize: 2.2, spotBlend: 0.363636364, radius: 0.12 },
      { rangeM: 6, inner: 0.65, outer: 1, spotSize: 2, spotBlend: 0.35, radius: 0.08 }
    ]);
    assert.deepEqual(report.firstView.camera, {
      name: "camera.review.entry",
      projection: "perspective",
      fovAxis: "vertical",
      verticalFovDegrees: 58,
      verticalFovRadians: 1.012290966,
      scenePositionM: { x: 2.6, y: 1.6, z: -1.64 },
      blenderLocationM: { x: 2.6, y: -1.64, z: 1.6 },
      sceneTargetM: { x: -0.45, y: 1.2, z: 0.05 },
      blenderTargetM: { x: -0.45, y: 0.05, z: 1.2 },
      rollRadians: 0
    });
    assert.deepEqual(report.firstView.capture, {
      engine: "CYCLES",
      device: "CPU",
      projection: "perspective",
      fovAxis: "vertical",
      resolution: { widthPx: 960, heightPx: 540, pixelAspectRatio: 1 },
      samples: 64,
      seed: 42,
      adaptiveSampling: false,
      denoising: false,
      transparentBackground: false,
      world: { colorSrgb: "#000000", strength: 0 },
      colorManagement: {
        displayDevice: "sRGB",
        viewTransform: "AgX",
        look: "AgX - Medium High Contrast",
        exposure: 0,
        gamma: 1
      },
      output: { format: "PNG", colorMode: "RGB", colorDepthBits: 8 },
      deterministic: {
        frame: 1,
        threadsMode: "FIXED",
        threads: 1,
        featureSet: "SUPPORTED",
        animatedSeed: false,
        guiding: false,
        samplingPattern: "AUTOMATIC",
        sampleSubset: false,
        sampleOffset: 0,
        persistentData: false,
        border: false,
        cropToBorder: false,
        ditherIntensity: 0,
        pngCompression: 15,
        curveMapping: false,
        whiteBalance: false,
        stampFlags: false,
        renderFilepathAfterCapture: "//first-view.png"
      }
    });
    assert.deepEqual(report.firstView.criteria, { averageLuminanceMinimum: 40, darkPixelRatioMaximum: 0.7 });
    assert.deepEqual(report.firstView.measurement.integerArithmetic, {
      redWeight: 2126,
      greenWeight: 7152,
      blueWeight: 722,
      divisor: 10000,
      weightedNumerator: "2126-times-r-plus-7152-times-g-plus-722-times-b",
      averagePass: "sum-weighted-numerators-gte-average-minimum-times-divisor-times-pixel-count",
      darkPixel: "weighted-numerator-lt-dark-pixel-threshold-times-divisor",
      darkRatioPass: "dark-count-times-10-lte-pixel-count-times-7"
    });
    assert.equal(report.lightingCompiled, false);
    assert.equal(report.firstViewRendered, false);
    assert.equal(report.firstViewAcceptanceVerified, false);
    assert.ok(["lightingCompiled", "firstViewRendered", "firstViewAcceptanceVerified", "lightingGlbByteIdentical", "firstViewPngByteIdentical"]
      .every((key) => report.boundaries[key] === false));

    const mixedLightingPath = resolve(temporaryRoot, "mixed-lighting.json");
    await writeFile(mixedLightingPath, Buffer.concat([source.lightingConstructionBytes, Buffer.from(" ")]));
    await assert.rejects(execFileAsync(python, adapterArguments(
      source,
      scenePath,
      componentPath,
      exteriorPath,
      mixedLightingPath,
      resolve(temporaryRoot, "mixed.json"),
      ["--plan-only"]
    )), /approved_candidate_lighting_raw_sha256_mismatch/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("measureFirstViewRgb uses exact integer arithmetic at luminance and dark-ratio boundaries", () => {
  assert.deepEqual(measureFirstViewRgb(Buffer.from([40, 40, 40]), 1, 1), {
    decodedRgbSha256: "04ba7b0a8b7f78bc535e32f6f4ff465933e2af38b65df9ace5b3553c45baea42",
    pixelCount: 1,
    weightedLuminanceSum: 400000,
    darkPixelCount: 0,
    averageLuminanceMinimum: 40,
    averagePass: true,
    darkPixelThreshold: 40,
    darkPixelRatioMaximum: 0.7,
    darkRatioPass: true,
    acceptancePass: true
  });
  const sevenDark = measureFirstViewRgb(Buffer.from([
    ...Array(7).fill([0, 0, 0]).flat(),
    ...Array(3).fill([255, 255, 255]).flat()
  ]), 10, 1);
  assert.deepEqual({
    weightedLuminanceSum: sevenDark.weightedLuminanceSum,
    darkPixelCount: sevenDark.darkPixelCount,
    averagePass: sevenDark.averagePass,
    darkRatioPass: sevenDark.darkRatioPass,
    acceptancePass: sevenDark.acceptancePass
  }, {
    weightedLuminanceSum: 7_650_000,
    darkPixelCount: 7,
    averagePass: true,
    darkRatioPass: true,
    acceptancePass: true
  });
  const eightDark = measureFirstViewRgb(Buffer.from([
    ...Array(8).fill([0, 0, 0]).flat(),
    ...Array(2).fill([255, 255, 255]).flat()
  ]), 10, 1);
  assert.deepEqual({
    weightedLuminanceSum: eightDark.weightedLuminanceSum,
    darkPixelCount: eightDark.darkPixelCount,
    averagePass: eightDark.averagePass,
    darkRatioPass: eightDark.darkRatioPass,
    acceptancePass: eightDark.acceptancePass
  }, {
    weightedLuminanceSum: 5_100_000,
    darkPixelCount: 8,
    averagePass: true,
    darkRatioPass: false,
    acceptancePass: false
  });
  assert.deepEqual({
    weightedLuminanceSum: measureFirstViewRgb(Buffer.from([255, 0, 0]), 1, 1).weightedLuminanceSum,
    acceptancePass: measureFirstViewRgb(Buffer.from([39, 39, 39]), 1, 1).acceptancePass
  }, { weightedLuminanceSum: 542130, acceptancePass: false });
  assert.throws(() => measureFirstViewRgb(new Uint8Array(3), 1, 1), /first_view_rgb_measurement_invalid/);
  assert.throws(() => measureFirstViewRgb(Buffer.alloc(2), 1, 1), /first_view_rgb_measurement_invalid/);
  assert.throws(() => measureFirstViewRgb(Buffer.alloc(3), 1, 1, { darkPixelRatioMaximum: 0.69 }), /first_view_rgb_measurement_invalid/);
});

test("first-view PNG parser accepts canonical RGB and rejects malformed, unsupported, and failed evidence", () => {
  const white = pngBytes();
  const accepted = inspectFirstViewPng(white);
  assert.equal(accepted.status, "first-view-png-acceptance-valid");
  assert.deepEqual([accepted.widthPx, accepted.heightPx, accepted.pixelCount], [960, 540, 518400]);
  assert.equal(accepted.weightedLuminanceSum, 1_321_920_000_000);
  assert.equal(accepted.darkPixelCount, 0);
  assert.deepEqual(accepted.chunkTypes, ["IHDR", "IDAT", "IEND"]);

  assert.throws(() => inspectFirstViewPng(Buffer.alloc(45)), /first_view_png_signature_invalid/);
  const badCrc = Buffer.from(white);
  badCrc[badCrc.length - 1] ^= 1;
  assert.throws(() => inspectFirstViewPng(badCrc), /first_view_png_crc_invalid/);
  assert.throws(() => inspectFirstViewPng(pngBytes({ extraChunks: [pngChunk("tEXt", Buffer.from("x"))] })), /first_view_png_metadata_forbidden:tEXt/);
  assert.throws(() => inspectFirstViewPng(pngBytes({ width: 959 })), /first_view_png_ihdr_invalid/);
  assert.throws(() => inspectFirstViewPng(pngBytes({ idatData: Buffer.from("not-deflate") })), /first_view_png_deflate_invalid/);
  const deflateWithTrailingBytes = deflateSync(solidScanlines(960, 540, [255, 255, 255]));
  assert.throws(() => inspectFirstViewPng(pngBytes({ idatData: Buffer.concat([deflateWithTrailingBytes, Buffer.from("trailing")]) })), /first_view_png_deflate_invalid/);
  assert.throws(() => inspectFirstViewPng(pngBytes({ idatData: deflateSync(Buffer.alloc(1)) })), /first_view_png_scanline_invalid/);
  const invalidFilter = solidScanlines(960, 540, [255, 255, 255]);
  invalidFilter[0] = 5;
  assert.throws(() => inspectFirstViewPng(pngBytes({ filtered: invalidFilter })), /first_view_png_filter_invalid/);
  const signature = white.subarray(0, 8);
  const ihdrEnd = 8 + 12 + 13;
  assert.throws(
    () => inspectFirstViewPng(Buffer.concat([signature, white.subarray(8, ihdrEnd), pngChunk("IEND")])),
    /first_view_png_chunk_order_invalid/
  );
  assert.throws(() => inspectFirstViewPng(pngBytes({ rgb: [0, 0, 0] })), (error) => {
    assert.match(error.message, /first_view_png_acceptance_failed/);
    assert.deepEqual({
      weightedLuminanceSum: error.measurement.weightedLuminanceSum,
      darkPixelCount: error.measurement.darkPixelCount,
      averagePass: error.measurement.averagePass,
      darkRatioPass: error.measurement.darkRatioPass
    }, {
      weightedLuminanceSum: 0,
      darkPixelCount: 518400,
      averagePass: false,
      darkRatioPass: false
    });
    return true;
  });
});

test("exact Blender compile, reopen, Khronos, and first-view evidence stays locked", { skip: !blender, timeout: 1_300_000 }, async () => {
  const { source, report, firstView, reportPath } = await compiledFixture();
  assert.equal(report.status, "stage3-approved-candidate-lighting-compiled");
  assert.deepEqual([
    report.inventory.objectCount,
    report.inventory.meshCount,
    report.inventory.materialCount,
    report.inventory.cameraCount,
    report.inventory.lightCount,
    report.inventory.imageCount,
    report.inventory.textureCount
  ], [65, 61, 8, 1, 3, 0, 0]);
  assert.deepEqual(report.lighting.lights.map(({ name, blenderType, energy, energyUnit }) => ({ name, blenderType, energy, energyUnit })), [
    { name: "light.window-daylight", blenderType: "SUN", energy: 25, energyUnit: "watt-per-square-meter" },
    { name: "light.ceiling-fill", blenderType: "SPOT", energy: 180, energyUnit: "watt" },
    { name: "light.table-pendant", blenderType: "SPOT", energy: 320, energyUnit: "watt" }
  ]);
  assert.equal(report.firstView.camera.name, "camera.review.entry");
  assert.equal(report.firstView.renderSettings.output.filepath, "//first-view.png");
  assert.deepEqual(report.outputFirstView, report.firstViewInspection);
  assert.deepEqual(report.firstView.acceptance, report.firstViewInspection);
  assert.deepEqual(inspectFirstViewPng(firstView), report.firstViewInspection);
  assert.deepEqual([
    report.firstViewInspection.widthPx,
    report.firstViewInspection.heightPx,
    report.firstViewInspection.pixelCount,
    report.firstViewInspection.averagePass,
    report.firstViewInspection.darkRatioPass,
    report.firstViewInspection.acceptancePass
  ], [960, 540, 518400, true, true, true]);
  assert.equal(report.reopenInspection.status, "stage3-approved-candidate-lighting-inspection-valid");
  assert.deepEqual(report.reopenInspection.lighting, report.lighting);
  assert.deepEqual(report.reopenInspection.firstView.camera, report.firstView.camera);
  assert.deepEqual(report.reopenInspection.firstView.renderSettings, report.firstView.renderSettings);
  assert.equal(report.glbInspection.status, "approved-candidate-lighting-glb-inspection-valid");
  assert.deepEqual([
    report.glbInspection.nodeCount,
    report.glbInspection.meshCount,
    report.glbInspection.materialCount,
    report.glbInspection.lightCount,
    report.glbInspection.cameraCount,
    report.glbInspection.extensionCount
  ], [64, 61, 8, 3, 0, 4]);
  assert.deepEqual(report.glbInspection.extensionsUsed, ["KHR_lights_punctual"]);
  assert.deepEqual(report.glbInspection.extensionsRequired, ["KHR_lights_punctual"]);
  const spotEvidence = [...report.glbInspection.lightEvidence].filter(({ type }) => type === "spot").sort((left, right) => left.nodeName.localeCompare(right.nodeName));
  assert.deepEqual(spotEvidence.map((light) => ({
    nodeName: light.nodeName,
    range: light.range
  })), [
    { nodeName: "light.ceiling-fill", range: 8 },
    { nodeName: "light.table-pendant", range: 6 }
  ]);
  for (const [actual, expected] of [
    [spotEvidence[0].innerConeAngle, 0.7],
    [spotEvidence[0].outerConeAngle, 1.1],
    [spotEvidence[1].innerConeAngle, 0.65],
    [spotEvidence[1].outerConeAngle, 1]
  ]) assert.ok(Math.abs(actual - expected) <= 1e-6);
  assert.equal(report.khronosValidation.version, "2.0.0-dev.3.10");
  assert.deepEqual(report.khronosValidation.issueCounts, { errors: 0, warnings: 0, infos: 61, hints: 0 });
  assert.equal(report.architectureBaseline.expectedSha256, "ae24faad5306191667195c0157db9cd5c6d800875492cdf242fe32d1ff962b33");
  assert.equal(report.lightingCompiled, true);
  assert.equal(report.firstViewRendered, true);
  assert.equal(report.firstViewAcceptanceVerified, true);
  assert.equal(report.lightingGlbByteIdentical, false);
  assert.equal(report.firstViewPngByteIdentical, false);
  assert.equal(report.finalCandidateGlbVerified, false);
  assert.equal(report.publicationReady, false);
  assertLockedEvidence(report, source.lightingGlbEvidence);
  assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
});

test("inspectGlb fails closed on every KHR_lights_punctual binding and camera tamper", { skip: !blender, timeout: 1_300_000 }, async () => {
  const { source, report, glb } = await compiledFixture();
  const contract = createApprovedCandidateLightingGlbContract(report, source);
  assert.deepEqual(inspectGlb(glb, contract), report.glbInspection);
  const lightNode = (document, name = "light.ceiling-fill") => document.nodes.find((node) => node.name === name);
  const lightRecord = (document, name = "light.ceiling-fill") => {
    const node = lightNode(document, name);
    return document.extensions.KHR_lights_punctual.lights[node.extensions.KHR_lights_punctual.light];
  };
  for (const [name, mutate, issue] of [
    ["extension", (document) => { document.extensionsRequired = []; }, /room_glb_lighting_extension_invalid/],
    ["light-node index", (document) => { lightNode(document).extensions.KHR_lights_punctual.light = 3; }, /room_glb_light_node_invalid/],
    ["light-node extras", (document) => { lightNode(document).extras.wmmr_scene_light_id = "tampered"; }, /room_glb_light_node_invalid/],
    ["light-node transform", (document) => { lightNode(document).translation[0] += 0.1; }, /room_glb_light_node_invalid/],
    ["light-node rotation", (document) => { lightNode(document).rotation = [0, 0, 0, 0]; }, /room_glb_light_node_invalid/],
    ["intensity", (document) => { lightRecord(document).intensity += 1; }, /room_glb_light_invalid/],
    ["range", (document) => { lightRecord(document).range += 1; }, /room_glb_light_invalid/],
    ["inner cone", (document) => { lightRecord(document).spot.innerConeAngle += 0.1; }, /room_glb_light_invalid/],
    ["outer cone", (document) => { lightRecord(document).spot.outerConeAngle += 0.1; }, /room_glb_light_invalid/],
    ["camera", (document) => { document.cameras = []; }, /room_glb_prohibited_content/]
  ]) {
    assert.throws(() => inspectGlb(glbWithMutatedJson(glb, mutate), contract), issue, name);
  }
});

test("two exact Blender runs produce identical lighting GLB and first-view PNG bytes", { skip: !blender, timeout: 2_500_000 }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-lighting-repro-"));
  try {
    const reportPath = resolve(temporaryRoot, "reproducibility.json");
    const report = await verifyApprovedCandidateLightingReproducibility({
      blenderPath: blender,
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath
    });
    assert.equal(report.status, "stage3-approved-candidate-lighting-glb-and-first-view-byte-identical");
    assert.equal(report.comparison.glbByteIdentical, true);
    assert.equal(report.comparison.pngByteIdentical, true);
    assert.equal(report.comparison.reopenInspectionIdentical, true);
    assert.equal(report.comparison.averagePass, true);
    assert.equal(report.comparison.darkRatioPass, true);
    assert.equal(report.lightingGlbByteIdentical, true);
    assert.equal(report.firstViewPngByteIdentical, true);
    assert.equal(report.firstViewPngByteIdentityScope, "same-host-same-blender-binary-two-run");
    assert.equal(report.comparison.pngByteIdentityScope, "same-host-same-blender-binary-two-run");
    assert.equal(report.byteIdenticalExportsVerified, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.runs[0].glb.sha256, report.runs[1].glb.sha256);
    assert.equal(report.runs[0].firstView.sha256, report.runs[1].firstView.sha256);
    assert.equal(report.runs[0].reopenInspection.sha256, report.runs[1].reopenInspection.sha256);
    assert.deepEqual(
      await readFile(resolve(temporaryRoot, "run-01.glb")),
      await readFile(resolve(temporaryRoot, "run-02.glb"))
    );
    assert.deepEqual(
      await readFile(resolve(temporaryRoot, "run-01.first-view.png")),
      await readFile(resolve(temporaryRoot, "run-02.first-view.png"))
    );
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
    const source = await loadApprovedCandidateLightingSource({ candidateRepositoryPath });
    if (source.lightingGlbEvidence !== null) {
      assert.equal(report.comparison.glbSha256, source.lightingGlbEvidence.sha256);
      assert.equal(report.comparison.reopenInspectionSha256, source.lightingGlbEvidence.reopenInspectionSha256);
      assert.equal(source.lightingGlbEvidence.firstViewPngByteIdentityScope, report.firstViewPngByteIdentityScope);
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("lighting reproducibility rejects trusted output roots and path conflicts without Blender", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-lighting-output-roots-"));
  try {
    for (const outputDirectory of [root, candidateRepositoryPath]) {
      await assert.rejects(verifyApprovedCandidateLightingReproducibility({
        blenderPath: blender ?? "/missing/blender",
        candidateRepositoryPath,
        outputDirectory,
        reportPath: resolve(temporaryRoot, `report-${outputDirectory.length}.json`)
      }), /room_reproducibility_output_directory_invalid/);
    }
    const forbiddenReportPath = resolve(root, "review-f5-lighting-reproducibility.json");
    await assert.rejects(verifyApprovedCandidateLightingReproducibility({
      blenderPath: blender ?? "/missing/blender",
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath: forbiddenReportPath
    }), /room_reproducibility_report_invalid/);
    assert.equal(await lstat(forbiddenReportPath).catch(() => null), null);
    await assert.rejects(verifyApprovedCandidateLightingReproducibility({
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

test("lighting compile rejects each output inside trusted roots", { skip: !blender, timeout: 300_000 }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-lighting-compile-roots-"));
  try {
    const defaults = {
      outputBlendPath: resolve(temporaryRoot, "candidate.blend"),
      outputGlbPath: resolve(temporaryRoot, "candidate.glb"),
      firstViewOutputPath: resolve(temporaryRoot, "first-view.png"),
      reportPath: resolve(temporaryRoot, "report.json")
    };
    const extensions = {
      outputBlendPath: ".blend",
      outputGlbPath: ".glb",
      firstViewOutputPath: ".png",
      reportPath: ".json"
    };
    for (const forbiddenRoot of [root, candidateRepositoryPath]) {
      for (const [field, extension] of Object.entries(extensions)) {
        const forbiddenPath = resolve(forbiddenRoot, `review-f5-${field}${extension}`);
        await assert.rejects(compileApprovedCandidateLighting({
          blenderPath: blender,
          candidateRepositoryPath,
          ...defaults,
          [field]: forbiddenPath
        }), /room_(?:shell|glb|first_view)_(?:output|report)_invalid/);
        assert.equal(await lstat(forbiddenPath).catch(() => null), null);
      }
    }
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("four-output atomic lighting publication preserves a racing report and removes owned outputs", { skip: !blender, timeout: 1_300_000 }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-lighting-output-race-"));
  try {
    const outputBlendPath = resolve(temporaryRoot, "candidate.blend");
    const outputGlbPath = resolve(temporaryRoot, "candidate.glb");
    const firstViewOutputPath = resolve(temporaryRoot, "first-view.png");
    const reportPath = resolve(temporaryRoot, "report.json");
    await assert.rejects(compileApprovedCandidateLighting({
      blenderPath: blender,
      candidateRepositoryPath,
      outputBlendPath,
      outputGlbPath,
      firstViewOutputPath,
      reportPath,
      [roomOutputFaultInjection]: { artifact: "compile-report", phase: "replace-before-link" }
    }), /EEXIST/);
    assert.equal(await readFile(reportPath, "utf8"), "external-race\n");
    assert.equal(await lstat(outputBlendPath).catch(() => null), null);
    assert.equal(await lstat(outputGlbPath).catch(() => null), null);
    assert.equal(await lstat(firstViewOutputPath).catch(() => null), null);
    assert.deepEqual(await readdir(temporaryRoot), ["report.json"]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
