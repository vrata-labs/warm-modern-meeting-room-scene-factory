import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const python = process.env.PYTHON ?? "python3";

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(path) {
  return createHash("sha256").update(await readFile(path)).digest("hex");
}

test("generation probe writes validated binary PLY without importing ML runtime", async () => {
  const { stdout } = await execFileAsync(python, [resolve(root, "scripts/run-generation-probe.py"), "--self-test"], { cwd: root });
  assert.equal(JSON.parse(stdout).status, "generation-probe-self-test-pass");
});

test("probe input script stays project-authored and deterministic", async () => {
  const source = await readFile(resolve(root, "scripts/create-gpu-probe-input.py"), "utf8");
  assert.match(source, /deterministic-project-authored-blender-render/);
  assert.match(source, /film_transparent = True/);
  assert.doesNotMatch(source, /https?:\/\//);
  await execFileAsync(python, ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", resolve(root, "scripts/create-gpu-probe-input.py")], { cwd: root });
});

test("window trim probe input is project-authored and dimensioned", async () => {
  const path = resolve(root, "scripts/create-window-trim-probe-input.py");
  const source = await readFile(path, "utf8");
  assert.match(source, /deterministic-project-authored-blender-window-trim-render/);
  assert.match(source, /OUTER_WIDTH_M = 2\.6/);
  assert.match(source, /OUTER_HEIGHT_M = 2\.2/);
  assert.match(source, /"paneCount": 3/);
  assert.match(source, /film_transparent = True/);
  assert.doesNotMatch(source, /https?:\/\//);
  await execFileAsync(python, ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", path], { cwd: root });
});

test("probe preparation and watchdog scripts contain no operator identity", async () => {
  const preparationPath = resolve(root, "scripts/prepare-gpu-probe-output.py");
  const preparationSource = await readFile(preparationPath, "utf8");
  assert.match(preparationSource, /chair seed 42/);
  await execFileAsync(python, ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", preparationPath], { cwd: root });
  const componentPreparationPath = resolve(root, "scripts/prepare-gpu-component-probe-output.py");
  const componentPreparationSource = await readFile(componentPreparationPath, "utf8");
  assert.match(componentPreparationSource, /WMMR AI probe \{source\.stem\}/);
  assert.doesNotMatch(componentPreparationSource, /chair seed/);
  await execFileAsync(python, ["-c", "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())", componentPreparationPath], { cwd: root });
  const cloudInit = await readFile(resolve(root, "scripts/gpu-probe-cloud-init.yaml"), "utf8");
  assert.match(cloudInit, /sleep 2700/);
  assert.doesNotMatch(cloudInit, /ssh_authorized_keys|ssh-(?:rsa|ed25519)|@/);
});

test("GPU generation probe lock is self-consistent and contains no restricted locator", async () => {
  const path = resolve(root, "experiment/warm-modern-meeting-room/gpu-generation-probe-lock.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  const { lockSha256, ...payload } = lock;
  assert.equal(createHash("sha256").update(stableStringify(payload)).digest("hex"), lockSha256);
  assert.equal(lock.status, "internal-gpu-generation-probe-pass");
  assert.equal(lock.generation.status, "gpu-generation-probe-pass");
  assert.equal(lock.generation.rawMesh.vertexCount, 253646);
  assert.equal(lock.generation.rawMesh.faceCount, 507226);
  assert.equal(lock.generation.prohibitedModulesObserved.length, 0);
  assert.equal(lock.boundaries.generationExecuted, true);
  assert.equal(lock.boundaries.generatedBinaryAddedToPublicGit, false);
  assert.equal(lock.source.reproductionHarness.sha256, await sha256(resolve(root, lock.source.reproductionHarness.path)));
  assert.equal(lock.input.generatorSha256, await sha256(resolve(root, lock.input.generatorPath)));
  assert.equal(lock.reviewArtifacts.preparationScriptSha256, await sha256(resolve(root, lock.reviewArtifacts.preparationScriptPath)));
  assert.doesNotMatch(JSON.stringify(lock), /(?:bucket|objectKey|storageLocator|serviceAccountId|kmsKeyId|publicIp)/i);
});

test("window trim generation probe closes the component feasibility threshold", async () => {
  const path = resolve(root, "experiment/warm-modern-meeting-room/gpu-window-trim-generation-probe-lock.json");
  const lock = JSON.parse(await readFile(path, "utf8"));
  const readiness = JSON.parse(await readFile(resolve(root, "experiment/warm-modern-meeting-room/readiness.json"), "utf8"));
  const { lockSha256, ...payload } = lock;
  assert.equal(createHash("sha256").update(stableStringify(payload)).digest("hex"), lockSha256);
  assert.equal(lock.status, "internal-gpu-component-generation-probe-pass");
  assert.equal(lock.component, "window-and-trim-assembly");
  assert.equal(lock.generation.rawMesh.vertexCount, 415342);
  assert.equal(lock.generation.rawMesh.faceCount, 830724);
  assert.equal(lock.reviewArtifacts.optimizedGlb.triangleCount, 149530);
  assert.equal(lock.reviewArtifacts.validatorReport.errors, 0);
  assert.equal(lock.reviewArtifacts.validatorReport.warnings, 0);
  assert.equal(lock.generation.prohibitedModulesObserved.length, 0);
  assert.equal(lock.restrictedRetention.fullReadbackHashesMatched, true);
  assert.equal(lock.restrictedRetention.incompleteMultipartUploadCount, 0);
  assert.equal(lock.boundaries.generatedBinaryAddedToPublicGit, false);
  assert.equal(lock.boundaries.productionPublicationApproved, false);
  assert.equal(lock.source.reproductionHarness.sha256, await sha256(resolve(root, lock.source.reproductionHarness.path)));
  assert.equal(lock.input.generatorSha256, await sha256(resolve(root, lock.input.generatorPath)));
  assert.equal(lock.reviewArtifacts.preparationScriptSha256, await sha256(resolve(root, lock.reviewArtifacts.preparationScriptPath)));
  assert.equal(readiness.aiRights.gpuWindowTrimGenerationProbe.lockSha256, lockSha256);
  assert.equal(readiness.aiRights.gpuComponentProbeFeasibility.successfulCount, 2);
  assert.equal(readiness.resolved.greenAiFeasibilityGate, true);
  assert.deepEqual(readiness.stageRules.stage3BlockedUntil, []);
  assert.doesNotMatch(JSON.stringify(lock), /(?:bucket|objectKey|storageLocator|serviceAccountId|kmsKeyId|publicIp)/i);
});
