import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { compileSyntheticRoomShell } from "../compiler/compile-room-shell.mjs";
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

test("room shell and opening plan is deterministic and dimensioned", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-plan-"));
  try {
    const first = await planAt(temporaryRoot, "first.json");
    const second = await planAt(temporaryRoot, "second.json");
    assert.deepEqual(first, second);
    assert.equal(first.status, "stage3-synthetic-room-shell-openings-plan-valid");
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
    assert.deepEqual(first.boundaries, {
      approvedCandidateSpecification: false,
      byteIdenticalExportsVerified: false,
      componentsCompiled: false,
      materialsCompiled: false,
      openingsCompiled: false,
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

test("exact Blender compiles and reopens synthetic shell openings", { skip: !process.env.BLENDER_BIN }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-blender-"));
  try {
    const outputBlendPath = resolve(temporaryRoot, "room-shell.blend");
    const reportPath = resolve(temporaryRoot, "room-shell-report.json");
    const report = await compileSyntheticRoomShell({
      blenderPath: process.env.BLENDER_BIN,
      scenePath,
      assetLedgerPath,
      generationLedgerPath,
      outputBlendPath,
      reportPath
    });
    assert.equal(report.status, "stage3-synthetic-room-shell-openings-compiled");
    assert.equal(report.blender.version, "4.5.12 LTS");
    assert.equal(report.blender.buildHash, "84afd5f785f7");
    assert.equal(report.blender.binarySha256, "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880");
    assert.ok(report.outputBlend.byteLength > 0);
    assert.equal(report.outputBlend.sha256, sha256(await readFile(outputBlendPath)));
    assert.equal(report.boundaries.openingsCompiled, true);
    assert.equal(report.boundaries.materialsCompiled, false);
    assert.equal(report.inventory.objectCount, 14);
    assert.equal(report.inventory.meshCount, 14);
    assert.equal(report.inventory.materialCount, 0);
    const wall = report.shell.objects.find(({ name }) => name === "shell.walls");
    assert.equal(wall.geometry, "rectangular-wall-ring-with-openings");
    assert.equal(wall.nonManifoldEdgeCount, 0);
    assert.equal(report.openings.frameObjectCount, 7);
    assert.equal(report.openings.revealObjectCount, 3);
    assert.equal(report.openings.sillObjectCount, 1);
    assert.equal(report.openings.overlapPairCount, 0);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("room shell Python adapter remains syntax-valid and network-free", async () => {
  const source = await readFile(adapter, "utf8");
  assert.doesNotMatch(source, /https?:\/\//);
  assert.doesNotMatch(source, /(?:socket|urllib|requests|subprocess)/);
  await execFileAsync(python, ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", adapter], { cwd: root });
});
