import assert from "node:assert/strict";
import { appendFile, chmod, cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  PatchedTreeError,
  canonicalArtifactDigest,
  canonicalSourceToArtifactDigest,
  canonicalTreeDigest,
  runStaticPolicyScan,
  validateArtifactLock,
  verifyPatchedTree,
  verifyTreeBytes
} from "../scripts/verify-trellis-patched-tree.mjs";
import { loadSelectionPolicy } from "../scripts/verify-trellis-source-selection.mjs";

const root = resolve(import.meta.dirname, "..");
const artifactLockPath = resolve(root, "experiment/warm-modern-meeting-room/artifact-lock.json");
const sourcePolicyPath = resolve(root, "experiment/warm-modern-meeting-room/trellis-source-selection-lock.json");
const sourceTree = resolve(root, "experiment/warm-modern-meeting-room/trellis-patched-tree");

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function temporaryTree() {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-patched-"));
  const tree = join(directory, "tree");
  await cp(sourceTree, tree, { recursive: true });
  return { directory, tree };
}

test("materialized TRELLIS tree passes byte, provenance, syntax, and static policy verification", async () => {
  const lock = await json(artifactLockPath);
  const sourcePolicy = await loadSelectionPolicy(sourcePolicyPath);
  const result = await verifyPatchedTree();
  assert.equal(lock.artifact.fileCount, 50);
  assert.equal(lock.artifact.files.filter(({ path }) => path.endsWith(".py")).length, 46);
  assert.equal(canonicalTreeDigest([...lock.artifact.files].reverse()), lock.artifact.treeSha256);
  assert.equal(canonicalArtifactDigest(lock), lock.artifactSha256);
  assert.equal(
    canonicalSourceToArtifactDigest(lock.sourceInputDispositions, sourcePolicy, lock.artifact.files),
    lock.sourceToArtifact.sha256
  );
  assert.equal(result.artifactSha256, lock.artifactSha256);
  assert.equal(result.treeSha256, lock.artifact.treeSha256);
  assert.equal(result.staticVerification.verificationKind, "static-policy-and-syntax");
  assert.equal(result.staticVerification.runtimeImportsExecuted, false);
  assert.deepEqual(result.staticVerification.externalImportRoots, [
    "PIL",
    "numpy",
    "safetensors",
    "spconv",
    "torch",
    "xformers"
  ]);
  assert.equal(result.generationAllowed, false);
  assert.ok(result.openGates.includes("offlineImportRuntimeTest"));
});

test("tree verifier rejects hash drift and extra files", async () => {
  const lock = await json(artifactLockPath);
  const first = await temporaryTree();
  try {
    await appendFile(join(first.tree, "trellis/__init__.py"), "# tamper\n");
    await assert.rejects(
      verifyTreeBytes(lock, first.tree),
      (error) => error instanceof PatchedTreeError
        && error.issues.includes("hash_drift:trellis/__init__.py")
        && error.issues.includes("size_drift:trellis/__init__.py")
    );
  } finally {
    await rm(first.directory, { recursive: true, force: true });
  }

  const second = await temporaryTree();
  try {
    await writeFile(join(second.tree, "unexpected.py"), "safe = True\n");
    await assert.rejects(
      verifyTreeBytes(lock, second.tree),
      (error) => error instanceof PatchedTreeError && error.issues.includes("extra_artifact_file:unexpected.py")
    );
  } finally {
    await rm(second.directory, { recursive: true, force: true });
  }
});

test("tree verifier rejects symlinks and executable mode drift", async (context) => {
  const lock = await json(artifactLockPath);
  const first = await temporaryTree();
  try {
    try {
      await symlink("LICENSE", join(first.tree, "linked-license"));
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await assert.rejects(
      verifyTreeBytes(lock, first.tree),
      (error) => error instanceof PatchedTreeError && error.issues.includes("symlink_rejected:linked-license")
    );
  } finally {
    await rm(first.directory, { recursive: true, force: true });
  }

  const second = await temporaryTree();
  try {
    await chmod(join(second.tree, "trellis/__init__.py"), 0o755);
    await assert.rejects(
      verifyTreeBytes(lock, second.tree),
      (error) => error instanceof PatchedTreeError && error.issues.includes("mode_drift:trellis/__init__.py")
    );
  } finally {
    await rm(second.directory, { recursive: true, force: true });
  }
});

test("tree verifier rejects special mode bits and unexpected empty directories", async () => {
  const lock = await json(artifactLockPath);
  const first = await temporaryTree();
  try {
    await chmod(join(first.tree, "trellis/__init__.py"), 0o4644);
    await assert.rejects(
      verifyTreeBytes(lock, first.tree),
      (error) => error instanceof PatchedTreeError && error.issues.includes("mode_drift:trellis/__init__.py")
    );
  } finally {
    await rm(first.directory, { recursive: true, force: true });
  }

  const second = await temporaryTree();
  try {
    await mkdir(join(second.tree, "unexpected-empty"));
    await assert.rejects(
      verifyTreeBytes(lock, second.tree),
      (error) => error instanceof PatchedTreeError
        && error.issues.includes("extra_artifact_directory:unexpected-empty")
    );
  } finally {
    await rm(second.directory, { recursive: true, force: true });
  }
});

test("tree verifier rejects root directory mode drift", async () => {
  const lock = await json(artifactLockPath);
  const fixture = await temporaryTree();
  try {
    await chmod(fixture.tree, 0o777);
    await assert.rejects(
      verifyTreeBytes(lock, fixture.tree),
      (error) => error instanceof PatchedTreeError && error.issues.includes("tree_root_mode_drift")
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("static scanner rejects a forbidden import without executing runtime imports", async () => {
  const fixture = await temporaryTree();
  try {
    await appendFile(join(fixture.tree, "trellis/__init__.py"), "import requests\n");
    await assert.rejects(
      runStaticPolicyScan(fixture.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("denied_import:trellis/__init__.py"))
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("static scanner resolves aliases and rejects protected binding replacement", async () => {
  const first = await temporaryTree();
  try {
    await appendFile(
      join(first.tree, "trellis/__init__.py"),
      "from torch import hub as hidden_hub\nhidden_hub.load('untrusted')\n"
    );
    await assert.rejects(
      runStaticPolicyScan(first.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("torch.hub"))
    );
  } finally {
    await rm(first.directory, { recursive: true, force: true });
  }

  const second = await temporaryTree();
  try {
    await appendFile(join(second.tree, "trellis/models/__init__.py"), "MODEL_CLASSES = {}\n");
    await assert.rejects(
      runStaticPolicyScan(second.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("protected_binding_assignment_count"))
    );
  } finally {
    await rm(second.directory, { recursive: true, force: true });
  }

  const third = await temporaryTree();
  try {
    await appendFile(
      join(third.tree, "trellis/models/__init__.py"),
      "if True:\n    MODEL_CLASSES = MappingProxyType({})\n"
    );
    await assert.rejects(
      runStaticPolicyScan(third.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("protected_binding_assignment_count"))
    );
  } finally {
    await rm(third.directory, { recursive: true, force: true });
  }

  const fourth = await temporaryTree();
  try {
    await appendFile(
      join(fourth.tree, "trellis/models/__init__.py"),
      "if (MODEL_CLASSES := MappingProxyType({})):\n    pass\n"
    );
    await assert.rejects(
      runStaticPolicyScan(fourth.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("protected_binding_assignment_count"))
    );
  } finally {
    await rm(fourth.directory, { recursive: true, force: true });
  }
});

test("static scanner rejects aliases of dynamic execution and incomplete notices", async () => {
  const first = await temporaryTree();
  try {
    await appendFile(join(first.tree, "trellis/__init__.py"), "_runtime = eval\n_runtime('1 + 1')\n");
    await assert.rejects(
      runStaticPolicyScan(first.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("dynamic_execution_alias"))
    );
  } finally {
    await rm(first.directory, { recursive: true, force: true });
  }

  const walrus = await temporaryTree();
  try {
    await appendFile(join(walrus.tree, "trellis/__init__.py"), "if (_runtime := eval):\n    _runtime('1 + 1')\n");
    await assert.rejects(
      runStaticPolicyScan(walrus.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("dynamic_execution_alias"))
    );
  } finally {
    await rm(walrus.directory, { recursive: true, force: true });
  }

  const second = await temporaryTree();
  try {
    await writeFile(
      join(second.tree, "THIRD_PARTY_NOTICES.txt"),
      "OpenAI GLIDE 69b530740eb6cef69442d6180579ef5ba9ef063e FlexiCubes "
        + "815e075a2a400d06c48d94c347674344ed6ae5c5 "
        + "trellis/representations/mesh/flexicubes/LICENSE.txt prominent modification notice\n"
    );
    await assert.rejects(
      runStaticPolicyScan(second.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("third_party_notice_not_exact"))
    );
  } finally {
    await rm(second.directory, { recursive: true, force: true });
  }
});

test("static scanner rejects missing imported symbols and truncated patched modules", async () => {
  const first = await temporaryTree();
  try {
    const decoderPath = join(first.tree, "trellis/models/structured_latent_vae/decoder_mesh.py");
    const decoder = await readFile(decoderPath, "utf8");
    await writeFile(decoderPath, decoder.replace("MeshExtractResult", "MeshExtractTypo"));
    await assert.rejects(
      runStaticPolicyScan(first.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("missing_internal_symbol"))
    );
  } finally {
    await rm(first.directory, { recursive: true, force: true });
  }

  const second = await temporaryTree();
  try {
    await writeFile(join(second.tree, "trellis/modules/sparse/transformer/blocks.py"), "SAFE = True\n");
    await assert.rejects(
      runStaticPolicyScan(second.tree, sourcePolicyPath),
      (error) => error instanceof PatchedTreeError
        && error.issues.some((issue) => issue.includes("missing_internal_symbol"))
    );
  } finally {
    await rm(second.directory, { recursive: true, force: true });
  }
});

test("artifact lock rejects removed gates, false runtime claims, and incomplete dispositions", async () => {
  const sourcePolicy = await loadSelectionPolicy(sourcePolicyPath);
  const lock = await json(artifactLockPath);

  const removedGate = structuredClone(lock);
  removedGate.openGates = removedGate.openGates.filter((gate) => gate !== "offlineImportRuntimeTest");
  removedGate.artifactSha256 = canonicalArtifactDigest(removedGate);
  assert.throws(
    () => validateArtifactLock(removedGate, sourcePolicy),
    (error) => error instanceof PatchedTreeError && error.issues.includes("artifact_open_gate_set_invalid")
  );

  const falseClaim = structuredClone(lock);
  falseClaim.boundaries.runtimeImportGateClosed = true;
  falseClaim.artifactSha256 = canonicalArtifactDigest(falseClaim);
  assert.throws(
    () => validateArtifactLock(falseClaim, sourcePolicy),
    (error) => error instanceof PatchedTreeError
      && error.issues.includes("runtime_import_gate_must_remain_open")
  );

  const missingDisposition = structuredClone(lock);
  missingDisposition.sourceInputDispositions.pop();
  missingDisposition.artifactSha256 = canonicalArtifactDigest(missingDisposition);
  assert.throws(
    () => validateArtifactLock(missingDisposition, sourcePolicy),
    (error) => error instanceof PatchedTreeError
      && error.issues.includes("source_dispositions_count_mismatch")
  );
});

test("artifact lock rejects semantic digest and source policy drift", async () => {
  const sourcePolicy = await loadSelectionPolicy(sourcePolicyPath);
  const lock = await json(artifactLockPath);

  const semanticDrift = structuredClone(lock);
  semanticDrift.status = "approved";
  assert.throws(
    () => validateArtifactLock(semanticDrift, sourcePolicy),
    (error) => error instanceof PatchedTreeError && error.issues.includes("artifact_digest_mismatch")
  );

  const sourceDrift = structuredClone(lock);
  sourceDrift.source.policySha256 = "0".repeat(64);
  sourceDrift.artifactSha256 = canonicalArtifactDigest(sourceDrift);
  assert.throws(
    () => validateArtifactLock(sourceDrift, sourcePolicy),
    (error) => error instanceof PatchedTreeError && error.issues.includes("source_policy_digest_mismatch")
  );

  const mappingDrift = structuredClone(lock);
  mappingDrift.sourceToArtifact.sha256 = "0".repeat(64);
  mappingDrift.artifactSha256 = canonicalArtifactDigest(mappingDrift);
  assert.throws(
    () => validateArtifactLock(mappingDrift, sourcePolicy),
    (error) => error instanceof PatchedTreeError && error.issues.includes("source_to_artifact_digest_mismatch")
  );
});
