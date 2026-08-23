import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const python = process.env.PYTHON ?? "python3";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function semanticDigest(lock) {
  const value = structuredClone(lock);
  delete value.lockSha256;
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

async function json(relative) {
  return JSON.parse(await readFile(resolve(root, relative), "utf8"));
}

async function run(script, args = []) {
  return execFileAsync(python, [resolve(root, script), ...args], {
    cwd: root,
    maxBuffer: 4 * 1024 * 1024
  });
}

async function temporaryLock(lock) {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-runtime-lock-"));
  const path = join(directory, "lock.json");
  await writeFile(path, `${JSON.stringify(lock, null, 2)}\n`);
  return { directory, path };
}

async function temporaryRawLock(raw) {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-runtime-lock-"));
  const path = join(directory, "lock.json");
  await writeFile(path, raw);
  return { directory, path };
}

test("runtime dependency wheel lock is canonical and binds the cu118 xformers wheel", async () => {
  const lock = await json("experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json");
  const { stdout } = await run("scripts/verify-runtime-wheel-lock.py", ["--lock-only"]);
  const result = JSON.parse(stdout);
  const xformers = lock.wheelSet.wheels.find(({ distribution }) => distribution === "xformers");
  assert.equal(result.status, "canonical-public-runtime-wheel-lock-verified");
  assert.equal(lock.wheelSet.count, 41);
  assert.equal(lock.wheelSet.wheelInventorySha256, "7ef3a07c4d9e0d62b4dfca3eff1bcb639d4747a6048f91422320add47d32bc9c");
  assert.equal(xformers.byteLength, 13310212);
  assert.equal(xformers.sha256, "c938925b2fed8641efc62ac8fec98e56cb3f78f40c25d2e768654b99fdb05d0c");
  assert.deepEqual(lock.gateEffect.directlyResolvedGates, ["dependencyWheelHashLock"]);
  assert.equal(lock.boundaries.runtimeImportsExecuted, false);
  assert.equal(lock.boundaries.generationAllowed, false);
});

test("runtime dependency verifier rejects boundary drift and an empty wheelhouse", async () => {
  const lock = await json("experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json");
  const drift = structuredClone(lock);
  drift.normalCi.networkRequestInitiatedByVerifier = true;
  drift.lockSha256 = semanticDigest(drift);
  const fixture = await temporaryLock(drift);
  const empty = await mkdtemp(join(tmpdir(), "wmmr-empty-wheelhouse-"));
  try {
    await assert.rejects(
      run("scripts/verify-runtime-wheel-lock.py", ["--lock", fixture.path, "--lock-only"]),
      (error) => error.stderr.includes("normal_ci_boundary_invalid")
    );
    await assert.rejects(
      run("scripts/verify-runtime-wheel-lock.py", ["--wheelhouse", empty]),
      (error) => error.stderr.includes("wheelhouse_count_invalid")
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
    await rm(empty, { recursive: true, force: true });
  }
});

test("runtime dependency verifier rejects incompatible tags and an incomplete dependency closure", async (context) => {
  const original = await json("experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json");
  for (const [name, mutate, issue] of [
    ["incompatible tag", (lock) => { lock.wheelSet.wheels[0].tags = ["cp311-cp311-win_amd64"]; }, "wheel_filename_metadata_tags_mismatch"],
    ["missing transitive", (lock) => { lock.wheelSet.wheels[0].requiresDist.push("definitely-missing>=1"); lock.wheelSet.wheels[0].requiresDist.sort(); }, "transitive_requirement_missing"]
  ]) {
    await context.test(name, async () => {
      const lock = structuredClone(original);
      mutate(lock);
      lock.wheelSet.wheelInventorySha256 = createHash("sha256").update(stableJson(lock.wheelSet.wheels)).digest("hex");
      lock.lockSha256 = semanticDigest(lock);
      const fixture = await temporaryLock(lock);
      try {
        await assert.rejects(
          run("scripts/verify-runtime-wheel-lock.py", ["--lock", fixture.path, "--lock-only"]),
          (error) => error.stderr.includes(issue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("runtime qualification verifiers reject duplicate JSON keys", async (context) => {
  for (const [name, relative, script, key] of [
    ["dependency", "experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json", "scripts/verify-runtime-wheel-lock.py", "schemaVersion"],
    ["PyTorch", "experiment/warm-modern-meeting-room/patched-pytorch-qualification-lock.json", "scripts/verify-patched-pytorch-lock.py", "schemaVersion"],
    ["offline runtime", "experiment/warm-modern-meeting-room/offline-runtime-qualification-lock.json", "scripts/verify-offline-runtime-lock.py", "schemaVersion"]
  ]) {
    await context.test(name, async () => {
      const raw = await readFile(resolve(root, relative), "utf8");
      const fixture = await temporaryRawLock(raw.replace(`  "${key}": 1,`, `  "${key}": 1,\n  "${key}": 1,`));
      try {
        await assert.rejects(
          run(script, ["--lock", fixture.path, ...(script.endsWith("runtime-wheel-lock.py") ? ["--lock-only"] : [])]),
          (error) => error.stderr.includes(`duplicate_json_key:${key}`)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("patched PyTorch qualification is locked without runtime or model claims", async () => {
  const lock = await json("experiment/warm-modern-meeting-room/patched-pytorch-qualification-lock.json");
  const { stdout } = await run("scripts/verify-patched-pytorch-lock.py");
  const result = JSON.parse(stdout);
  assert.equal(result.status, "patched-pytorch-qualification-lock-verified");
  assert.equal(lock.advisory.cve, "CVE-2025-32434");
  assert.equal(lock.advisory.firstPatchedVersion, "2.6.0");
  assert.equal(lock.qualificationEnvironment.torchVersion, "2.7.1+cu118");
  assert.equal(lock.securityQualification.legacyTarRejectedBeforeUnpickling, true);
  assert.equal(lock.securityQualification.legacyTarSideEffectObserved, false);
  assert.deepEqual(lock.gateEffect.directlyResolvedGates, ["patchedPytorchQualification"]);
  assert.equal(lock.boundaries.modelArtifactsRead, false);
  assert.equal(lock.qualificationEnvironment.torchWheelInstalledFileCount, 11011);
  assert.match(lock.qualificationEnvironment.torchWheelInstalledFileSetSha256, /^[0-9a-f]{64}$/);
  assert.equal(lock.boundaries.generationAllowed, false);
});

test("patched PyTorch verifier rejects a false security result with a valid semantic digest", async () => {
  const lock = await json("experiment/warm-modern-meeting-room/patched-pytorch-qualification-lock.json");
  lock.securityQualification.legacyTarRejectedBeforeUnpickling = false;
  lock.lockSha256 = semanticDigest(lock);
  const fixture = await temporaryLock(lock);
  try {
    await assert.rejects(
      run("scripts/verify-patched-pytorch-lock.py", ["--lock", fixture.path]),
      (error) => error.stderr.includes("security_qualification_invalid")
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("patched PyTorch verifier requires complete boundaries and normal-CI policy", async (context) => {
  const original = await json("experiment/warm-modern-meeting-room/patched-pytorch-qualification-lock.json");
  for (const [name, mutate, issue] of [
    ["boundaries", (lock) => { lock.boundaries = { placeholder: false }; }, "boundary_claim_invalid"],
    ["normal CI", (lock) => { lock.normalCi.scope = "weakened"; }, "normal_ci_boundary_invalid"]
  ]) {
    await context.test(name, async () => {
      const lock = structuredClone(original);
      mutate(lock);
      lock.lockSha256 = semanticDigest(lock);
      const fixture = await temporaryLock(lock);
      try {
        await assert.rejects(
          run("scripts/verify-patched-pytorch-lock.py", ["--lock", fixture.path]),
          (error) => error.stderr.includes(issue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("offline runtime lock binds full imports and five strict state loads without inference", async () => {
  const lock = await json("experiment/warm-modern-meeting-room/offline-runtime-qualification-lock.json");
  const { stdout } = await run("scripts/verify-offline-runtime-lock.py");
  const result = JSON.parse(stdout);
  assert.equal(result.status, "offline-runtime-qualification-lock-verified");
  assert.equal(lock.imports.expectedModuleCount, 58);
  assert.equal(lock.imports.importedModuleCount, 58);
  assert.equal(lock.strictLoads.dino.missingKeyCount, 0);
  assert.equal(lock.strictLoads.dino.unexpectedKeyCount, 0);
  assert.equal(lock.strictLoads.trellis.length, 4);
  assert.ok(lock.strictLoads.trellis.every(({ missingKeyCount, unexpectedKeyCount }) => missingKeyCount === 0 && unexpectedKeyCount === 0));
  assert.equal(lock.imports.blockedCummNvccProbeAttempts, 1);
  assert.equal(lock.imports.everySourceModuleOriginVerified, true);
  assert.match(lock.imports.moduleOriginPlanSha256, /^[0-9a-f]{64}$/);
  assert.equal(lock.environment.pythonIsolatedMode, true);
  assert.equal(lock.environment.siteInitializationDisabled, true);
  assert.equal(lock.environment.pythonPathEnvironmentPresent, false);
  assert.equal(lock.imports.successfulAuditedProcessLaunchCount, 0);
  assert.equal(lock.boundaries.modelForwardCalls, 0);
  assert.equal(lock.boundaries.inferenceExecuted, false);
  assert.equal(lock.boundaries.generationAllowed, false);
  assert.deepEqual(lock.gateEffect.directlyResolvedGates, ["offlineImportRuntimeTest"]);
});

test("offline runtime verifier rejects side-effect and strict-load drift", async (context) => {
  const original = await json("experiment/warm-modern-meeting-room/offline-runtime-qualification-lock.json");
  for (const [name, mutate, issue] of [
    ["side effect", (lock) => { lock.imports.successfulAuditedProcessLaunchCount = 1; }, "runtime_side_effect_boundary_invalid"],
    ["strict load", (lock) => { lock.strictLoads.trellis[0].missingKeyCount = 1; }, "trellis_strict_load_set_invalid"]
  ]) {
    await context.test(name, async () => {
      const lock = structuredClone(original);
      mutate(lock);
      lock.lockSha256 = semanticDigest(lock);
      const fixture = await temporaryLock(lock);
      try {
        await assert.rejects(
          run("scripts/verify-offline-runtime-lock.py", ["--lock", fixture.path]),
          (error) => error.stderr.includes(issue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("offline runtime verifier rejects semantically unrelated import and model evidence", async (context) => {
  const original = await json("experiment/warm-modern-meeting-room/offline-runtime-qualification-lock.json");
  for (const [name, mutate, issue] of [
    ["module plan", (lock) => { lock.imports.modulePlanSha256 = "0".repeat(64); }, "source_module_origin_evidence_invalid"],
    ["DINO artifact", (lock) => { lock.strictLoads.dino.artifactSha256 = "0".repeat(64); }, "dino_strict_load_invalid"],
    ["TRELLIS structure", (lock) => { lock.strictLoads.trellis[0].structureSha256 = "0".repeat(64); }, "trellis_strict_load_set_invalid"]
  ]) {
    await context.test(name, async () => {
      const lock = structuredClone(original);
      mutate(lock);
      lock.lockSha256 = semanticDigest(lock);
      const fixture = await temporaryLock(lock);
      try {
        await assert.rejects(
          run("scripts/verify-offline-runtime-lock.py", ["--lock", fixture.path]),
          (error) => error.stderr.includes(issue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});
