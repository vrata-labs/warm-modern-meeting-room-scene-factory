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

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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
    "--scene-spec",
    scenePath,
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
      "--scene-spec",
      changedPath,
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
    assert.deepEqual(report.glbInspection, {
      nodeCount: 19,
      meshCount: 19,
      materialCount: 3,
      cameraCount: 0,
      imageCount: 0,
      textureCount: 0,
      binaryChunkCount: 1
    });
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
    assert.equal(report.runs.length, 2);
    assert.equal(report.runs[0].glb.sha256, report.runs[1].glb.sha256);
    assert.equal(report.runs[0].glb.byteLength, report.runs[1].glb.byteLength);
    assert.equal(report.boundaries.syntheticFixtureGlbByteIdentical, true);
    assert.equal(report.boundaries.finalCandidateGlbVerified, false);
    assert.equal(report.boundaries.publicationReady, false);
    assert.deepEqual(report.acceptedInputSha256, ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
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
  const document = {
    asset: { version: "2.0" },
    nodes: [{ name: "opening.main-door.frame.head" }, ...Array.from({ length: 17 }, (_, index) => ({ name: `profile.${index}` })), { name: "shell.walls" }],
    meshes: Array(19).fill({}),
    materials: Array(3).fill({})
  };
  const rawJson = Buffer.from(JSON.stringify(document));
  const json = Buffer.concat([rawJson, Buffer.alloc((4 - rawJson.length % 4) % 4, 0x20)]);
  const chunk = (type, value) => {
    const header = Buffer.alloc(8);
    header.writeUInt32LE(value.length, 0);
    header.writeUInt32LE(type, 4);
    return Buffer.concat([header, value]);
  };
  const file = (chunks) => {
    const body = Buffer.concat(chunks);
    const header = Buffer.alloc(12);
    header.write("glTF", 0, "ascii");
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(header.length + body.length, 8);
    return Buffer.concat([header, body]);
  };
  const jsonChunk = chunk(0x4e4f534a, json);
  const binChunk = chunk(0x004e4942, Buffer.alloc(0));
  assert.equal(inspectGlb(file([jsonChunk, binChunk])).binaryChunkCount, 1);
  assert.throws(() => inspectGlb(file([binChunk, jsonChunk])), /room_glb_document_invalid/);
});

test("room shell Python adapter remains syntax-valid and network-free", async () => {
  const source = await readFile(adapter, "utf8");
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /(?:^|\n)\s*(?:import|from)\s+(?:socket|urllib|requests|subprocess)\b/m);
  await execFileAsync(python, ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", adapter], { cwd: root });
});
