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

test("room shell plan is deterministic and uses closed metric assemblies", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-shell-plan-"));
  try {
    const first = await planAt(temporaryRoot, "first.json");
    const second = await planAt(temporaryRoot, "second.json");
    assert.deepEqual(first, second);
    assert.equal(first.status, "stage3-synthetic-room-shell-plan-valid");
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

test("exact Blender compiles the synthetic shell outside the repository", { skip: !process.env.BLENDER_BIN }, async () => {
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
    assert.equal(report.status, "stage3-synthetic-room-shell-compiled");
    assert.equal(report.blender.version, "4.5.12 LTS");
    assert.equal(report.blender.buildHash, "84afd5f785f7");
    assert.equal(report.blender.binarySha256, "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880");
    assert.ok(report.outputBlend.byteLength > 0);
    assert.equal(report.outputBlend.sha256, sha256(await readFile(outputBlendPath)));
    assert.deepEqual(report.shell.objects.map(({ vertexCount, faceCount }) => [vertexCount, faceCount]), [[8, 6], [8, 6], [16, 16]]);
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
