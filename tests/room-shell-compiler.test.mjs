import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { compileSyntheticRoomShell, inspectGlb, verifySyntheticRoomReproducibility } from "../compiler/compile-room-shell.mjs";
import { parseSceneContract } from "../compiler/scene-contract.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const python = process.env.PYTHON ?? "python3";
const adapter = resolve(root, "compiler/blender-room-shell.py");
const scenePath = resolve(root, "tests/fixtures/stage3/scene-spec.valid.json");
const assetLedgerPath = resolve(root, "tests/fixtures/stage3/asset-ledger.valid.json");
const generationLedgerPath = resolve(root, "tests/fixtures/stage3/generation-ledger.valid.json");
const syntheticSceneRawSha256 = "faef3aebe7278f72bf272411abdb0080792b4459ad7ca0097cca36e59498b748";
const architectureNodeNames = [
  "opening.main-door.frame.head",
  "opening.main-door.frame.left",
  "opening.main-door.frame.right",
  "opening.main-window.frame.bottom",
  "opening.main-window.frame.head",
  "opening.main-window.frame.left",
  "opening.main-window.frame.right",
  "opening.main-window.reveal.head",
  "opening.main-window.reveal.left",
  "opening.main-window.reveal.right",
  "opening.main-window.sill",
  "profile.east-baseboard.segment-01",
  "profile.north-baseboard.segment-01",
  "profile.south-baseboard.segment-01",
  "profile.south-baseboard.segment-02",
  "profile.west-baseboard.segment-01",
  "shell.ceiling",
  "shell.floor",
  "shell.walls"
];

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function colorFactor(hex) {
  const channel = (offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5), 1];
}

function architectureGlbFixture() {
  const recipes = [
    ["graphite-metal", "#343A3C", 0.35, 0.7, 0.2],
    ["mineral-plaster", "#DDD6C8", 0.84, 0, 0.5],
    ["warm-oak", "#A87543", 0.46, 0, 0.18]
  ];
  const records = architectureNodeNames.map((name, index) => ({
    name,
    geometry: "box",
    centerM: { x: index, y: 1, z: -index },
    dimensionsM: { widthM: 2, heightM: 2, depthM: 2 }
  }));
  const parts = [];
  const bufferViews = [];
  const accessors = [];
  let byteLength = 0;
  const encode = (values, method, componentByteLength) => {
    const bytes = Buffer.alloc(values.length * componentByteLength);
    values.forEach((value, index) => bytes[method](value, index * componentByteLength));
    return bytes;
  };
  const appendAccessor = (bytes, target, componentType, type, count, bounds = {}) => {
    const padding = (4 - byteLength % 4) % 4;
    if (padding !== 0) {
      parts.push(Buffer.alloc(padding));
      byteLength += padding;
    }
    const bufferView = bufferViews.length;
    bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: bytes.length, target });
    parts.push(bytes);
    byteLength += bytes.length;
    accessors.push({ bufferView, componentType, count, type, ...bounds });
    return accessors.length - 1;
  };
  const meshes = records.map(({ name, dimensionsM }, index) => {
    const half = [dimensionsM.widthM / 2, dimensionsM.heightM / 2, dimensionsM.depthM / 2];
    const positions = [
      [-half[0], -half[1], -half[2]], [half[0], -half[1], -half[2]], [half[0], half[1], -half[2]], [-half[0], half[1], -half[2]],
      [-half[0], -half[1], half[2]], [half[0], -half[1], half[2]], [half[0], half[1], half[2]], [-half[0], half[1], half[2]]
    ];
    const indices = [
      0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7,
      0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5,
      2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7
    ];
    const position = appendAccessor(
      encode(positions.flat(), "writeFloatLE", 4),
      34962,
      5126,
      "VEC3",
      positions.length,
      { min: half.map((value) => -value), max: [...half] }
    );
    const normal = appendAccessor(encode(positions.flatMap(() => [0, 1, 0]), "writeFloatLE", 4), 34962, 5126, "VEC3", positions.length);
    const uv = appendAccessor(encode(positions.flatMap((_, vertex) => [vertex % 2, Math.floor(vertex / 2) % 2]), "writeFloatLE", 4), 34962, 5126, "VEC2", positions.length);
    const indexAccessor = appendAccessor(encode(indices, "writeUInt16LE", 2), 34963, 5123, "SCALAR", indices.length);
    return {
      name: `mesh.${name}`,
      primitives: [{ attributes: { POSITION: position, NORMAL: normal, TEXCOORD_0: uv }, indices: indexAccessor, material: index % recipes.length }]
    };
  });
  const binary = Buffer.concat(parts);
  const document = {
    asset: { version: "2.0" },
    scene: 0,
    scenes: [{ nodes: architectureNodeNames.map((_, index) => index) }],
    nodes: records.map(({ name, centerM }, mesh) => ({ name, mesh, translation: [centerM.x, centerM.y, -centerM.z] })),
    meshes,
    buffers: [{ byteLength: binary.length }],
    bufferViews,
    accessors,
    materials: recipes.map(([recipeId, baseColorSrgb, roughnessFactor, metallicFactor, textureScaleM]) => ({
      doubleSided: true,
      extras: {
        wmmr_recipe_id: recipeId,
        wmmr_base_color_srgb: baseColorSrgb,
        wmmr_texture_scale_m: textureScaleM,
        wmmr_source_record_id: "asset-material-project"
      },
      name: `material.${recipeId}`,
      pbrMetallicRoughness: { baseColorFactor: colorFactor(baseColorSrgb), metallicFactor, roughnessFactor }
    }))
  };
  return { document, binary, records };
}

function glbChunks(document, binaryBytes) {
  const rawJson = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
  const chunk = (type, value) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(value.length, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, value]);
  };
  return {
    json: chunk(0x4e4f534a, json),
    binary: chunk(0x004e4942, Buffer.concat([binaryBytes, Buffer.alloc((4 - binaryBytes.length % 4) % 4)]))
  };
}

function glbFile(chunks) {
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(12);
  header.write("glTF", 0, "ascii");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(header.length + body.length, 8);
  return Buffer.concat([header, body]);
}

async function contractInput() {
  const [sceneText, assetLedgerText, generationLedgerText] = await Promise.all([
    readFile(scenePath, "utf8"),
    readFile(assetLedgerPath, "utf8"),
    readFile(generationLedgerPath, "utf8")
  ]);
  return {
    sceneText,
    contract: parseSceneContract({ sceneText, assetLedgerText, generationLedgerText })
  };
}

async function planAt(directory, name) {
  const { sceneText, contract } = await contractInput();
  const reportPath = resolve(directory, name);
  await execFileAsync(python, [
    adapter,
    "--input-kind",
    "synthetic-fixture",
    "--scene-spec",
    scenePath,
    "--expected-raw-sha256",
    syntheticSceneRawSha256,
    "--expected-specification-sha256",
    contract.specificationSha256,
    "--report",
    reportPath,
    "--plan-only"
  ], { cwd: root });
  return JSON.parse(await readFile(reportPath, "utf8"));
}

test("room shell, profile, and material plan is deterministic and dimensioned", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-plan-"));
  try {
    const first = await planAt(temporaryRoot, "first.json");
    const second = await planAt(temporaryRoot, "second.json");
    assert.deepEqual(first, second);
    assert.equal(first.status, "stage3-synthetic-room-profiles-materials-plan-valid");
    assert.equal(first.fixtureOnly, true);
    assert.equal(first.shell.joinStrategy, "welded-rectangular-ring");
    assert.equal(first.shell.objectCount, 3);
    assert.equal(first.shell.vertexCount, 32);
    assert.equal(first.shell.faceCount, 28);
    assert.deepEqual(first.shell.objects.map(({ name }) => name), [
      "shell.ceiling",
      "shell.floor",
      "shell.walls"
    ]);
    assert.deepEqual(first.shell.objects.find(({ name }) => name === "shell.floor").dimensionsM, { widthM: 7.18, heightM: 0.18, depthM: 5.18 });
    const walls = first.shell.objects.find(({ name }) => name === "shell.walls");
    assert.deepEqual(walls.dimensionsM, { widthM: 7.18, heightM: 3.1, depthM: 5.18 });
    assert.deepEqual(walls.interiorDimensionsM, { widthM: 6.82, depthM: 4.82 });
    assert.deepEqual([walls.vertexCount, walls.faceCount], [16, 16]);
    assert.equal(first.openings.compiled, false);
    assert.equal(first.openings.openingCount, 2);
    assert.equal(first.openings.cutCount, 2);
    assert.equal(first.openings.frameObjectCount, 7);
    assert.equal(first.openings.revealObjectCount, 3);
    assert.equal(first.openings.sillObjectCount, 1);
    assert.equal(first.openings.overlapPairCount, 0);
    assert.deepEqual(first.openings.openings.map(({ id, wall, centerAlongM, bottomM, topM }) => ({ id, wall, centerAlongM, bottomM, topM })), [
      { id: "main-door", wall: "south", centerAlongM: 2.25, bottomM: 0, topM: 2.2 },
      { id: "main-window", wall: "north", centerAlongM: -0.2, bottomM: 0.7, topM: 2.5 }
    ]);
    assert.deepEqual(first.openings.openings.map(({ id, clearWidthM, clearHeightM, clearBottomM, clearTopM }) => ({ id, clearWidthM, clearHeightM, clearBottomM, clearTopM })), [
      { id: "main-door", clearWidthM: 0.94, clearHeightM: 2.12, clearBottomM: 0, clearTopM: 2.12 },
      { id: "main-window", clearWidthM: 3.24, clearHeightM: 1.64, clearBottomM: 0.78, clearTopM: 2.42 }
    ]);
    assert.equal(first.openings.objects.find(({ name }) => name === "opening.main-door.frame.left").centerM.x, 1.74);
    assert.equal(first.openings.objects.find(({ name }) => name === "opening.main-window.reveal.left").centerM.z, 2.39);
    assert.equal(first.profiles.compiled, false);
    assert.equal(first.profiles.baseboardDetailCount, 4);
    assert.equal(first.profiles.baseboardObjectCount, 5);
    assert.equal(first.profiles.overlapPairCount, 0);
    assert.equal(first.profiles.details.find(({ id }) => id === "south-baseboard").objectNames.length, 2);
    assert.equal(first.materials.compiled, false);
    assert.equal(first.materials.recipeCount, 3);
    assert.equal(first.materials.zoneCount, 22);
    assert.equal(first.materials.assignmentCount, 19);
    assert.equal(first.materials.uvUnits, "meters-divided-by-textureScaleM");
    assert.deepEqual(first.materials.recipes.map(({ id }) => id), ["graphite-metal", "mineral-plaster", "warm-oak"]);
    assert.deepEqual(first.boundaries, {
      approvedCandidateSpecification: false,
      byteIdenticalExportsVerified: false,
      componentsCompiled: false,
      materialsCompiled: false,
      openingsCompiled: false,
      profilesCompiled: false,
      sceneBinaryAddedToRepository: false
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("room shell adapter rejects non-fixture input and repository output", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-negative-"));
  try {
    const { sceneText, contract } = await contractInput();
    const changedPath = resolve(temporaryRoot, "changed.json");
    await writeFile(changedPath, sceneText.replace('"seed": 42', '"seed": 43'));
    await assert.rejects(execFileAsync(python, [
      adapter,
      "--input-kind",
      "synthetic-fixture",
      "--scene-spec",
      changedPath,
      "--expected-raw-sha256",
      syntheticSceneRawSha256,
      "--expected-specification-sha256",
      contract.specificationSha256,
      "--report",
      resolve(temporaryRoot, "mismatch.json"),
      "--plan-only"
    ]), /room_shell_fixture_sha256_mismatch/);
    await assert.rejects(planAt(root, "room-shell-report.invalid.json"), /room_shell_report_must_be_outside_repository/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("exact Blender compiles and reopens synthetic profiles and material zones", { skip: !process.env.BLENDER_BIN }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-blender-"));
  try {
    const outputBlendPath = resolve(temporaryRoot, "room-shell.blend");
    const outputGlbPath = resolve(temporaryRoot, "room-shell.glb");
    const reportPath = resolve(temporaryRoot, "room-shell-report.json");
    const report = await compileSyntheticRoomShell({
      blenderPath: process.env.BLENDER_BIN,
      scenePath,
      assetLedgerPath,
      generationLedgerPath,
      outputBlendPath,
      outputGlbPath,
      reportPath
    });
    assert.equal(report.status, "stage3-synthetic-room-profiles-materials-compiled");
    assert.equal(report.blender.version, "4.5.12 LTS");
    assert.equal(report.blender.buildHash, "84afd5f785f7");
    assert.equal(report.blender.binarySha256, "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880");
    assert.ok(report.outputBlend.byteLength > 0);
    assert.equal(report.outputBlend.sha256, sha256(await readFile(outputBlendPath)));
    assert.equal(report.outputGlb.sha256, sha256(await readFile(outputGlbPath)));
    assert.equal(report.glbInspection.status, "architecture-only-glb-inspection-valid");
    assert.equal(report.glbInspection.nodeCount, 19);
    assert.equal(report.glbInspection.meshCount, 19);
    assert.equal(report.glbInspection.materialCount, 3);
    assert.equal(report.glbInspection.reachableNodeCount, 19);
    assert.equal(report.glbInspection.uniqueMeshBindingCount, 19);
    assert.equal(report.glbInspection.primitiveCount, 19);
    assert.equal(report.glbInspection.binaryByteLength, 17376);
    assert.equal(report.glbInspection.decodedVertexCount, 528);
    assert.equal(report.glbInspection.decodedIndexCount, 852);
    assert.equal(report.glbInspection.decodedTriangleCount, 284);
    assert.equal(report.glbInspection.geometryEvidence.length, 19);
    assert.equal(report.glbInspection.extensionCount, 0);
    assert.deepEqual(report.glbInspection.nodeNames, architectureNodeNames);
    assert.deepEqual(report.glbInspection.materialNames, ["material.graphite-metal", "material.mineral-plaster", "material.warm-oak"]);
    assert.equal(report.reopenInspection.status, "stage3-synthetic-room-profiles-materials-inspection-valid");
    assert.equal(report.reopenInspection.inventory.objectCount, 19);
    assert.equal(report.reopenInspectionSha256, sha256(stableJson(report.reopenInspection)));
    assert.equal(report.boundaries.openingsCompiled, true);
    assert.equal(report.boundaries.profilesCompiled, true);
    assert.equal(report.boundaries.materialsCompiled, true);
    assert.equal(report.inventory.objectCount, 19);
    assert.equal(report.inventory.meshCount, 19);
    assert.equal(report.inventory.materialCount, 3);
    assert.equal(report.inventory.imageCount, 0);
    assert.equal(report.inventory.textureCount, 0);
    const wall = report.shell.objects.find(({ name }) => name === "shell.walls");
    assert.equal(wall.geometry, "rectangular-wall-ring-with-openings");
    assert.equal(wall.nonManifoldEdgeCount, 0);
    assert.equal(report.openings.frameObjectCount, 7);
    assert.equal(report.openings.revealObjectCount, 3);
    assert.equal(report.openings.sillObjectCount, 1);
    assert.equal(report.openings.overlapPairCount, 0);
    assert.equal(report.profiles.baseboardObjectCount, 5);
    assert.equal(report.profiles.overlapPairCount, 0);
    assert.equal(report.materials.recipeCount, 3);
    assert.equal(report.materials.zoneCount, 22);
    assert.equal(report.materials.assignmentCount, 19);
    assert.equal(report.materials.imageCount, 0);
    assert.equal(report.materials.textureCount, 0);
    assert.equal(report.materials.textureNodeCount, 0);
    assert.ok(report.materials.assignments.every(({ uvLoopCount }) => uvLoopCount > 0));
    assert.deepEqual(report.materials.assignments.find(({ objectName }) => objectName === "shell.walls").zoneIds, ["east-wall-zone", "north-wall-zone", "south-wall-zone", "west-wall-zone"]);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("two independent exact-Blender exports produce a byte-identical synthetic GLB", { skip: !process.env.BLENDER_BIN }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-repro-"));
  try {
    const reportPath = resolve(temporaryRoot, "reproducibility.json");
    const report = await verifySyntheticRoomReproducibility({
      blenderPath: process.env.BLENDER_BIN,
      scenePath,
      assetLedgerPath,
      generationLedgerPath,
      outputDirectory: temporaryRoot,
      reportPath
    });
    assert.equal(report.status, "stage3-synthetic-room-glb-byte-identical");
    assert.equal(report.comparison.glbByteIdentical, true);
    assert.equal(report.comparison.reopenInspectionIdentical, true);
    assert.equal(report.runs.length, 2);
    assert.equal(report.runs[0].glb.sha256, report.runs[1].glb.sha256);
    assert.equal(report.runs[0].glb.byteLength, report.runs[1].glb.byteLength);
    assert.equal(report.boundaries.syntheticFixtureGlbByteIdentical, true);
    assert.equal(report.boundaries.finalCandidateGlbVerified, false);
    assert.equal(report.boundaries.publicationReady, false);
    assert.deepEqual(report.acceptedInputSha256, ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
    for (const [index, run] of report.runs.entries()) {
      const runReport = JSON.parse(await readFile(resolve(temporaryRoot, `run-0${index + 1}.json`), "utf8"));
      assert.equal(runReport.reopenInspectionSha256, sha256(stableJson(runReport.reopenInspection)));
      assert.deepEqual(run.reopenInspection, {
        status: runReport.reopenInspection.status,
        inventory: runReport.reopenInspection.inventory,
        sha256: runReport.reopenInspectionSha256
      });
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("reproducibility preflight rejects conflicting report paths without artifacts", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-repro-conflict-"));
  try {
    await assert.rejects(verifySyntheticRoomReproducibility({
      blenderPath: process.env.BLENDER_BIN ?? "/missing/blender",
      scenePath,
      assetLedgerPath,
      generationLedgerPath,
      outputDirectory: temporaryRoot,
      reportPath: resolve(temporaryRoot, "run-01.json")
    }), /room_reproducibility_output_paths_conflict/);
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("GLB validation requires JSON then BIN chunk order", () => {
  const fixture = architectureGlbFixture();
  const { json, binary } = glbChunks(fixture.document, fixture.binary);
  assert.equal(inspectGlb(glbFile([json, binary]), fixture.records).binaryChunkCount, 1);
  assert.throws(() => inspectGlb(glbFile([binary, json]), fixture.records), /room_glb_document_invalid/);
});

test("GLB validation rejects a rogue node in the 19-item inventory", () => {
  const fixture = architectureGlbFixture();
  fixture.document.nodes[0].name = "component.rogue";
  const { json, binary } = glbChunks(fixture.document, fixture.binary);
  assert.throws(() => inspectGlb(glbFile([json, binary]), fixture.records), /room_glb_inventory_invalid/);
});

test("GLB validation rejects punctual lights and unknown extensions", () => {
  const lightFixture = architectureGlbFixture();
  lightFixture.document.extensionsUsed = ["KHR_lights_punctual"];
  lightFixture.document.extensions = { KHR_lights_punctual: { lights: [{ type: "point" }] } };
  let chunks = glbChunks(lightFixture.document, lightFixture.binary);
  assert.throws(() => inspectGlb(glbFile([chunks.json, chunks.binary]), lightFixture.records), /room_glb_prohibited_content/);

  const extensionFixture = architectureGlbFixture();
  extensionFixture.document.nodes[0].extensions = { VENDOR_architecture_proxy: {} };
  chunks = glbChunks(extensionFixture.document, extensionFixture.binary);
  assert.throws(() => inspectGlb(glbFile([chunks.json, chunks.binary]), extensionFixture.records), /room_glb_prohibited_content/);
});

test("GLB validation rejects an unreachable architecture node", () => {
  const fixture = architectureGlbFixture();
  fixture.document.scenes[0].nodes.pop();
  const { json, binary } = glbChunks(fixture.document, fixture.binary);
  assert.throws(() => inspectGlb(glbFile([json, binary]), fixture.records), /room_glb_scene_invalid/);
});

test("GLB validation rejects missing BIN buffer backing", () => {
  const fixture = architectureGlbFixture();
  const { json, binary } = glbChunks(fixture.document, Buffer.alloc(0));
  assert.throws(() => inspectGlb(glbFile([json, binary]), fixture.records), /room_glb_buffer_invalid/);
});

test("GLB validation rejects an out-of-range index", () => {
  const fixture = architectureGlbFixture();
  const accessor = fixture.document.accessors[fixture.document.meshes[0].primitives[0].indices];
  const view = fixture.document.bufferViews[accessor.bufferView];
  const changedBinary = Buffer.from(fixture.binary);
  changedBinary.writeUInt16LE(999, view.byteOffset + (accessor.byteOffset ?? 0));
  const { json, binary } = glbChunks(fixture.document, changedBinary);
  assert.throws(() => inspectGlb(glbFile([json, binary]), fixture.records), /room_glb_index_invalid/);
});

test("GLB validation rejects a degenerate triangle", () => {
  const fixture = architectureGlbFixture();
  const accessor = fixture.document.accessors[fixture.document.meshes[0].primitives[0].indices];
  const view = fixture.document.bufferViews[accessor.bufferView];
  const changedBinary = Buffer.from(fixture.binary);
  for (let index = 0; index < 3; index += 1) changedBinary.writeUInt16LE(0, view.byteOffset + (accessor.byteOffset ?? 0) + index * 2);
  const { json, binary } = glbChunks(fixture.document, changedBinary);
  assert.throws(() => inspectGlb(glbFile([json, binary]), fixture.records), /room_glb_triangle_degenerate/);
});

test("GLB validation rejects an expected architecture bound mismatch", () => {
  const fixture = architectureGlbFixture();
  fixture.records[0].dimensionsM.widthM += 1;
  const { json, binary } = glbChunks(fixture.document, fixture.binary);
  assert.throws(() => inspectGlb(glbFile([json, binary]), fixture.records), /room_glb_expected_bound_mismatch/);
});

test("room shell Python adapter remains syntax-valid and network-free", async () => {
  const source = await readFile(adapter, "utf8");
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:import|from)\s+(?:socket|urllib|requests|subprocess)\b/m);
  await execFileAsync(python, ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", adapter], { cwd: root });
});
