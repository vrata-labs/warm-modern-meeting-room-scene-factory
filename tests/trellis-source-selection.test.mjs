import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  SourceSelectionError,
  canonicalPolicyDigest,
  canonicalSelectionDigest,
  validateSelectionPolicy,
  validateWmmrSelectionContract,
  verifySelectedFiles,
  verifySourceSelection
} from "../scripts/verify-trellis-source-selection.mjs";

const root = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function git(directory, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", directory, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function commitAll(directory, message) {
  await git(directory, "add", ".");
  await git(
    directory,
    "-c", "user.name=Selection Test",
    "-c", "user.email=selection-test@example.invalid",
    "commit", "-q", "-m", message
  );
}

function fixturePolicy(files) {
  const policy = {
    schemaVersion: 1,
    policySha256: "0".repeat(64),
    status: "selection-locked-runtime-blocked",
    generationAllowed: false,
    source: {
      repository: "https://example.invalid/source.git",
      commit: "a".repeat(40),
      declaredLicense: "MIT",
      submodules: [{
        path: "vendor/submodule",
        repository: "https://example.invalid/submodule.git",
        commit: "b".repeat(40),
        declaredLicense: "Apache-2.0"
      }]
    },
    selection: {
      purpose: "candidate-upstream-files-for-image-to-raw-mesh-prune",
      canonicalization: "sort by ASCII path, then concatenate UTF-8 path, NUL, lowercase SHA-256, and LF",
      fileCount: files.length,
      selectionSha256: canonicalSelectionDigest(files),
      files
    },
    licenseCoverage: [
      { scope: "fixture source", license: "MIT", licensePath: "LICENSE" },
      { scope: "fixture submodule", license: "Apache-2.0", licensePath: "vendor/submodule/LICENSE" },
      { scope: "fixture DCO", classification: "provenance-only-non-shipping", modificationAllowed: false }
    ],
    requiredPatches: [{ path: files[0].path, requirements: ["replace unsafe import"] }],
    requiredExclusions: ["unsafe.module"],
    prohibitedRuntimeDependencies: ["unsafe-package"],
    openGates: ["patchedSourceTreeDigest"],
    evidenceBoundary: {
      weightsDownloaded: false,
      modelInputsDownloaded: false,
      generationRun: false,
      cloudResourcesCreated: false,
      localVerificationCiReproducible: false,
      claim: "fixture remains blocked"
    }
  };
  policy.policySha256 = canonicalPolicyDigest(policy);
  return policy;
}

test("TRELLIS source selection lock remains blocked and internally consistent", async () => {
  const policy = validateWmmrSelectionContract(JSON.parse(await readFile(
    resolve(root, "experiment/warm-modern-meeting-room/trellis-source-selection-lock.json"),
    "utf8"
  )));
  assert.equal(policy.source.commit, "442aa1e1afb9014e80681d3bf604e8d728a86ee7");
  assert.equal(policy.source.submodules[0].commit, "815e075a2a400d06c48d94c347674344ed6ae5c5");
  assert.equal(policy.selection.fileCount, 53);
  assert.equal(policy.policySha256, "9d41db04bbec3977c797751e671377df073b642726d2d1ca554ed5c7c385443c");
  assert.equal(policy.generationAllowed, false);
  assert.ok(policy.openGates.includes("humanRightsSignoff"));
  assert.ok(policy.openGates.includes("ociImageDigest"));
  assert.ok(policy.openGates.includes("thirdPartyNoticeBundle"));
  for (const path of [
    "trellis/models/sparse_structure_flow.py",
    "trellis/modules/attention/__init__.py",
    "trellis/modules/attention/full_attn.py",
    "trellis/modules/sparse/attention/full_attn.py",
    "trellis/modules/sparse/attention/windowed_attn.py",
    "trellis/pipelines/samplers/flow_euler.py",
    "trellis/representations/mesh/utils_cube.py"
  ]) {
    assert.ok(policy.requiredPatches.some((patch) => patch.path === path));
  }
  for (const dependency of ["easydict", "flash_attn", "torchvision", "tqdm"]) {
    assert.ok(policy.prohibitedRuntimeDependencies.includes(dependency));
  }
  assert.ok(policy.knownAttributionQuestions.some(({ path, status, noticePath }) => (
    path === "trellis/models/sparse_structure_flow.py"
      && status === "required-for-materialized-patched-tree"
      && noticePath === "third_party/openai-glide/LICENSE.txt"
  )));
  assert.equal(
    policy.licenseCoverage.find(({ scope }) => scope === "trellis/representations/mesh/flexicubes/DCO.txt").classification,
    "provenance-only-non-shipping"
  );
});

test("TRELLIS contract rejects stripped gates and traversal paths", async () => {
  const policy = JSON.parse(await readFile(
    resolve(root, "experiment/warm-modern-meeting-room/trellis-source-selection-lock.json"),
    "utf8"
  ));
  const stripped = structuredClone(policy);
  stripped.openGates = stripped.openGates.filter((gate) => gate !== "sbomAndVulnerabilityReport");
  stripped.policySha256 = canonicalPolicyDigest(stripped);
  assert.throws(
    () => validateWmmrSelectionContract(stripped),
    (error) => error instanceof SourceSelectionError && error.issues.includes("open_gates_missing:sbomAndVulnerabilityReport")
  );

  const traversal = fixturePolicy([{ path: "package/module.py", sha256: digest("safe = True\n") }]);
  traversal.source.submodules[0].path = "..";
  traversal.policySha256 = canonicalPolicyDigest(traversal);
  assert.throws(
    () => validateSelectionPolicy(traversal),
    (error) => error instanceof SourceSelectionError && error.issues.includes("invalid_submodule_path")
  );

  assert.equal(
    canonicalSelectionDigest([...policy.selection.files].reverse()),
    policy.selection.selectionSha256
  );
});

test("selected file verifier rejects content drift and symlinks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-selection-"));
  try {
    await mkdir(join(directory, "package"), { recursive: true });
    await writeFile(join(directory, "package", "module.py"), "safe = True\n");
    const files = [{ path: "package/module.py", sha256: digest("safe = True\n") }];
    const policy = fixturePolicy(files);
    assert.deepEqual(await verifySelectedFiles(policy, directory), {
      fileCount: 1,
      selectionSha256: policy.selection.selectionSha256
    });

    await writeFile(join(directory, "package", "module.py"), "safe = False\n");
    await assert.rejects(
      verifySelectedFiles(policy, directory),
      (error) => error instanceof SourceSelectionError && error.issues.includes("hash_mismatch:package/module.py")
    );

    await rm(join(directory, "package", "module.py"));
    await symlink("missing.py", join(directory, "package", "module.py"));
    await assert.rejects(
      verifySelectedFiles(policy, directory),
      (error) => error instanceof SourceSelectionError && error.issues.includes("unsafe_file_type:package/module.py")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Git provenance verifier rejects untracked blobs, remote drift, and external submodules", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-git-selection-"));
  const submoduleOrigin = join(directory, "submodule-origin");
  const source = join(directory, "source");
  try {
    await mkdir(submoduleOrigin);
    await git(submoduleOrigin, "init", "-q");
    await writeFile(join(submoduleOrigin, "code.py"), "submodule = True\n");
    await commitAll(submoduleOrigin, "Add submodule source");
    const submoduleCommit = await git(submoduleOrigin, "rev-parse", "HEAD");

    await mkdir(source);
    await git(source, "init", "-q");
    await git(source, "remote", "add", "origin", "https://example.invalid/source.git");
    await mkdir(join(source, "package"));
    await writeFile(join(source, "package", "module.py"), "source = True\n");
    await git(
      source,
      "-c", "protocol.file.allow=always",
      "submodule", "add", "-q", submoduleOrigin, "vendor/submodule"
    );
    await git(
      join(source, "vendor/submodule"),
      "remote", "set-url", "origin", "https://example.invalid/submodule.git"
    );
    await commitAll(source, "Add source selection fixture");
    const sourceCommit = await git(source, "rev-parse", "HEAD");

    const files = [
      { path: "package/module.py", sha256: digest("source = True\n") },
      { path: "vendor/submodule/code.py", sha256: digest("submodule = True\n") }
    ];
    const policy = fixturePolicy(files);
    policy.source.commit = sourceCommit;
    policy.source.submodules[0].commit = submoduleCommit;
    policy.policySha256 = canonicalPolicyDigest(policy);

    const result = await verifySourceSelection(policy, source, { verifiedAt: "2026-08-14T00:00:00Z" });
    assert.equal(result.repository, "https://example.invalid/source.git");
    assert.equal(result.commit, sourceCommit);
    assert.equal(result.submodules[0].commit, submoduleCommit);
    assert.equal(result.policySha256, policy.policySha256);

    await writeFile(join(source, "package", "untracked.py"), "untracked = True\n");
    const untracked = structuredClone(policy);
    untracked.selection.files.push({ path: "package/untracked.py", sha256: digest("untracked = True\n") });
    untracked.selection.fileCount = untracked.selection.files.length;
    untracked.selection.selectionSha256 = canonicalSelectionDigest(untracked.selection.files);
    untracked.policySha256 = canonicalPolicyDigest(untracked);
    await assert.rejects(
      verifySourceSelection(untracked, source),
      (error) => error instanceof SourceSelectionError
        && error.issues.includes("source_checkout_dirty")
        && error.issues.includes("file_not_regular_blob_at_commit:package/untracked.py")
    );
    await rm(join(source, "package", "untracked.py"));

    await git(source, "remote", "set-url", "origin", "https://example.invalid/wrong.git");
    await assert.rejects(
      verifySourceSelection(policy, source),
      (error) => error instanceof SourceSelectionError && error.issues.includes("source_remote_mismatch")
    );
    await git(source, "remote", "set-url", "origin", "https://example.invalid/source.git");

    const externalSubmodule = join(directory, "external-submodule");
    await mkdir(externalSubmodule);
    await symlink(externalSubmodule, join(source, "external-link"));
    const external = structuredClone(policy);
    external.source.submodules[0].path = "external-link";
    external.policySha256 = canonicalPolicyDigest(external);
    await assert.rejects(
      verifySourceSelection(external, source),
      (error) => error instanceof SourceSelectionError && error.issues.includes("unsafe_submodule_path:external-link")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
