import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DinoDerivedRuntimeArtifactError,
  canonicalDinoDerivedRuntimeArtifactLockDigest,
  canonicalDinoDerivedTensorManifestDigest,
  canonicalDinoTensorIdentityDigest,
  canonicalDinoTensorLayoutDigest,
  loadWmmrDinoDerivedRuntimeArtifactLock,
  parseCanonicalDinoDerivedRuntimeArtifactLock,
  parseCanonicalDinoDerivedTensorManifest,
  validateDinoDerivedRuntimeArtifactLock,
  validateDinoDerivedTensorManifest,
  validateWmmrDinoDerivedRuntimeArtifactContract
} from "../scripts/verify-dino-derived-runtime-artifact.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, "experiment/warm-modern-meeting-room/dino-derived-runtime-artifact-lock.json");
const manifestPath = resolve(root, "experiment/warm-modern-meeting-room/dino-derived-tensor-manifest.json");
const payloadLockPath = resolve(root, "experiment/warm-modern-meeting-room/dino-payload-bytes-lock.json");
const converterPath = resolve(root, "scripts/convert-dino-pth-to-safetensors.py");
const payloadLockRawSha256 = "60705aa7ec5b8fe654853ee5bc0ce33af9a817ca9410b499557a1a02206f9946";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sealLock(lock) {
  lock.lockSha256 = canonicalDinoDerivedRuntimeArtifactLockDigest(lock);
  return lock;
}

function sealManifest(manifest) {
  manifest.tensorIdentitySha256 = canonicalDinoTensorIdentityDigest(manifest.tensors);
  manifest.tensorLayoutSha256 = canonicalDinoTensorLayoutDigest(manifest.tensors);
  manifest.manifestSha256 = canonicalDinoDerivedTensorManifestDigest(manifest);
  return manifest;
}

function hasIssue(error, issue) {
  return error instanceof DinoDerivedRuntimeArtifactError && error.issues.includes(issue);
}

test("canonical DINO derived artifact lock binds exact conversion, tensor equivalence, and one gate transition", async () => {
  const lockText = await readFile(lockPath, "utf8");
  const manifestText = await readFile(manifestPath, "utf8");
  const { lock, manifest } = await loadWmmrDinoDerivedRuntimeArtifactLock();
  assert.deepEqual(parseCanonicalDinoDerivedRuntimeArtifactLock(lockText), lock);
  assert.deepEqual(parseCanonicalDinoDerivedTensorManifest(manifestText), manifest);
  assert.equal(lock.lockSha256, "947b7b7adb9bcde2d6c63948e789d6b8236045f05d3c8688a2062e20e60b8bb6");
  assert.equal(manifest.manifestSha256, "1b3d3e1878c99c5f271931e257961091a049af65b4b4ff5c7602bc72b6087a83");
  assert.equal(lock.payloadBytesLock.lockSha256, "72da7b8d42e33ba0f7632018cf9766e93ac5e62892b51023b755ce25db56f55b");
  assert.equal(lock.payloadBytesLock.payloadObservedSha256, "36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51");
  assert.equal(lock.conversion.converter.sourceSha256, "1b8d57d01b421a5a3448d87be05ab16c4cd8d2f1078cff8ef2d36986a1a4397b");
  assert.equal(lock.conversion.environment.pytorchVersion, "2.7.1+cpu");
  assert.equal(lock.conversion.environment.wheels.length, 12);
  assert.equal(lock.conversion.options.weightsOnly, true);
  assert.equal(lock.conversion.options.sealedInputCopy, true);
  assert.equal(lock.conversion.options.mapLocation, "cpu");
  assert.equal(lock.conversion.isolation.networkAllowed, false);
  assert.equal(lock.conversion.isolation.cloudCredentialsPassed, false);
  assert.equal(lock.conversion.reproducibility.runCount, 2);
  assert.equal(lock.conversion.reproducibility.artifactByteIdentical, true);
  assert.equal(lock.artifact.sha256, "30e20dce587ad621a8dfc20e4ed66198d2998974928d44f06a6baf7732503dcc");
  assert.equal(lock.artifact.byteLength, 1217523408);
  assert.equal(lock.artifact.metadata, "absent");
  assert.equal(lock.tensorManifest.tensorCount, 344);
  assert.equal(lock.tensorManifest.totalTensorByteLength, 1217490944);
  assert.equal(lock.tensorEquivalence.mismatchCount, 0);
  assert.equal(lock.tensorEquivalence.tensorBytesMatched, true);
  assert.equal(lock.restrictedStorage.fullReadback.matchedArtifactIdentity, true);
  assert.equal(lock.restrictedStorage.incompleteMultipartUploads, 0);
  assert.equal(lock.restrictedStorage.knownLocalModelByteCopiesDeleted, true);
  assert.deepEqual(lock.gateEffect.directlyResolvedGates, ["dinoDerivedRuntimeArtifactLock"]);
  assert.equal(lock.gateEffect.doesNotResolveOtherGates, true);
  assert.ok(lock.resolvedGates.includes("dinoDerivedRuntimeArtifactLock"));
  assert.ok(!lock.openGates.includes("dinoDerivedRuntimeArtifactLock"));
  assert.ok(lock.openGates.includes("patchedPytorchQualification"));
  assert.ok(lock.openGates.includes("humanRightsSignoff"));
  assert.ok(Object.values(lock.boundaries).every((value) => value === false));
});

test("public tensor manifest covers the complete safetensors data section and exact tensor identity", async () => {
  const manifest = await json(manifestPath);
  validateDinoDerivedTensorManifest(manifest);
  assert.equal(manifest.tensorCount, manifest.tensors.length);
  assert.equal(manifest.tensorIdentitySha256, "6423b9afd5bcdb42dc69123dcddf203d6534cab0b26d1c09a5d184d18efb3d63");
  assert.equal(manifest.tensorLayoutSha256, "ba5e1d272ac2691f269385976e9f33b84159d598de9233987aca302a5dcd33aa");
  assert.equal(canonicalDinoTensorIdentityDigest(manifest.tensors), manifest.tensorIdentitySha256);
  assert.equal(canonicalDinoTensorLayoutDigest(manifest.tensors), manifest.tensorLayoutSha256);
  assert.equal(canonicalDinoDerivedTensorManifestDigest(manifest), manifest.manifestSha256);
  assert.equal(manifest.tensors[0].name, "blocks.0.attn.proj.bias");
  assert.equal(manifest.tensors.at(-1).name, "register_tokens");
  const byOffset = [...manifest.tensors].sort((left, right) => left.dataOffsets[0] - right.dataOffsets[0]);
  let offset = 0;
  for (const tensor of byOffset) {
    assert.equal(tensor.dataOffsets[0], offset);
    offset = tensor.dataOffsets[1];
  }
  assert.equal(offset, manifest.artifact.dataByteLength);
  assert.equal(manifest.tensors.reduce((sum, tensor) => sum + tensor.byteLength, 0), manifest.totalTensorByteLength);
});

test("historical DINO raw payload lock remains byte-identical", async () => {
  const worktreeBytes = await readFile(payloadLockPath);
  const { stdout: committedBytes } = await execFileAsync(
    "git",
    ["-C", root, "show", "HEAD:experiment/warm-modern-meeting-room/dino-payload-bytes-lock.json"],
    { encoding: null, maxBuffer: 2 * 1024 * 1024 }
  );
  assert.equal(sha256(worktreeBytes), payloadLockRawSha256);
  assert.deepEqual(worktreeBytes, Buffer.from(committedBytes));
  assert.equal(JSON.parse(worktreeBytes).lockSha256, "72da7b8d42e33ba0f7632018cf9766e93ac5e62892b51023b755ce25db56f55b");
});

test("converter source is content-addressed and keeps the approved safety boundary", async () => {
  const source = await readFile(converterPath, "utf8");
  const lock = await json(lockPath);
  assert.equal(sha256(source), lock.conversion.converter.sourceSha256);
  assert.match(source, /torch\.load\(sealed_input, map_location="cpu", weights_only=True\)/);
  assert.match(source, /fcntl\.F_ADD_SEALS/);
  assert.match(source, /os\.O_EXCL/);
  assert.match(source, /save_file\(tensors, temp_output\)/);
  assert.doesNotMatch(source, /torch\.hub|subprocess|requests|urllib|socket|eval\(|exec\(/);
  assert.equal(lock.boundaries.modelRuntimeExecuted, false);
  assert.equal(lock.boundaries.strictStateDictLoadExecuted, false);
  assert.equal(lock.boundaries.generationAllowed, false);
});

test("lock-only verifier bounds reopened records and reads converter through the hardened path", async () => {
  const source = await readFile(
    resolve(root, "scripts/verify-dino-derived-runtime-artifact.mjs"),
    "utf8"
  );
  assert.match(source, /if \(before\.size > BigInt\(maxPublicRecordBytes\)\)/);
  assert.match(source, /readBoundedCanonicalFile\(\s*resolvedConverterPath,/);
  assert.doesNotMatch(source, /readFile\(resolve\(repositoryRoot, lock\.conversion\.converter\.path\)/);
});

test("derived artifact parsers reject duplicate keys, malformed JSON, and non-canonical JSON", async (context) => {
  const lockText = await readFile(lockPath, "utf8");
  const manifestText = await readFile(manifestPath, "utf8");
  const cases = [
    ["lock duplicate", () => parseCanonicalDinoDerivedRuntimeArtifactLock(lockText.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,')), "lock_json_duplicate_key:schemaVersion"],
    ["lock malformed", () => parseCanonicalDinoDerivedRuntimeArtifactLock(lockText.slice(0, -2)), "lock_json_invalid"],
    ["lock spacing", () => parseCanonicalDinoDerivedRuntimeArtifactLock(lockText.replace('  "schemaVersion": 1,', '  "schemaVersion" : 1,')), "lock_json_not_canonical"],
    ["manifest duplicate", () => parseCanonicalDinoDerivedTensorManifest(manifestText.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,')), "manifest_json_duplicate_key:schemaVersion"],
    ["manifest malformed", () => parseCanonicalDinoDerivedTensorManifest(manifestText.slice(0, -2)), "manifest_json_invalid"],
    ["manifest spacing", () => parseCanonicalDinoDerivedTensorManifest(manifestText.replace('  "schemaVersion": 1,', '  "schemaVersion" : 1,')), "manifest_json_not_canonical"]
  ];
  for (const [name, action, issue] of cases) {
    await context.test(name, () => assert.throws(action, (error) => hasIssue(error, issue)));
  }
});

test("DINO derived lock rejects conversion, artifact, storage, boundary, and gate drift", async (context) => {
  const original = await json(lockPath);
  const manifest = await json(manifestPath);
  const cases = [
    ["status", (lock) => { lock.status = "changed"; }, "status_invalid"],
    ["extra top-level key", (lock) => { lock.unexpected = false; }, "lock_keys_invalid"],
    ["timestamp", (lock) => { lock.verifiedAt = "2026-08-20T20:00:00Z"; }, "timestamp_in_lock"],
    ["payload lock path", (lock) => { lock.payloadBytesLock.path = "elsewhere.json"; }, "unexpected_payload_lock_reference", true],
    ["payload hash", (lock) => { lock.payloadBytesLock.payloadObservedSha256 = "0".repeat(64); }, "unexpected_payload_lock_reference", true],
    ["converter hash", (lock) => { lock.conversion.converter.sourceSha256 = "0".repeat(64); }, "unexpected_converter_identity", true],
    ["PyTorch version", (lock) => { lock.conversion.environment.pytorchVersion = "2.4.0"; }, "unexpected_converter_identity", true],
    ["wheel hash", (lock) => { lock.conversion.environment.wheels[0].sha256 = "0".repeat(64); }, "wheel_inventory_digest_mismatch"],
    ["weights-only", (lock) => { lock.conversion.options.weightsOnly = false; }, "conversion_options_invalid"],
    ["sealed input", (lock) => { lock.conversion.options.sealedInputCopy = false; }, "conversion_options_invalid"],
    ["map location", (lock) => { lock.conversion.options.mapLocation = "cuda"; }, "conversion_options_invalid"],
    ["network", (lock) => { lock.conversion.isolation.networkAllowed = true; }, "conversion_isolation_invalid"],
    ["credentials", (lock) => { lock.conversion.isolation.cloudCredentialsPassed = true; }, "conversion_isolation_invalid"],
    ["memory limit", (lock) => { lock.conversion.isolation.memoryLimitBytes = 0; }, "conversion_isolation_invalid"],
    ["PID limit", (lock) => { lock.conversion.isolation.pidsLimit = 0; }, "conversion_isolation_invalid"],
    ["output directory mode", (lock) => { lock.conversion.isolation.outputDirectoryMode = "0777"; }, "conversion_isolation_invalid"],
    ["single run", (lock) => { lock.conversion.reproducibility.runCount = 1; }, "conversion_reproducibility_invalid"],
    ["report readback", (lock) => { lock.conversion.reproducibility.reports[0].fullReadbackVerified = false; }, "conversion_report_readback_invalid:0"],
    ["artifact hash", (lock) => { lock.artifact.sha256 = "0".repeat(64); }, "storage_content_address_invalid"],
    ["artifact metadata", (lock) => { lock.artifact.metadata = "timestamped"; }, "artifact_metadata_invalid"],
    ["manifest path", (lock) => { lock.tensorManifest.path = "manifest.json"; }, "unexpected_tensor_manifest_reference", true],
    ["equivalence mismatch", (lock) => { lock.tensorEquivalence.mismatchCount = 1; }, "tensor_equivalence_mismatchCount_invalid"],
    ["equivalence digest", (lock) => { lock.tensorEquivalence.sourceTensorIdentitySha256 = "0".repeat(64); }, "tensor_equivalence_digest_mismatch"],
    ["storage encryption", (lock) => { lock.restrictedStorage.encryption.mode = "SSE-S3"; }, "storage_encryption_invalid"],
    ["storage ACL", (lock) => { lock.restrictedStorage.objectAcl = "public-read"; }, "storage_object_acl_invalid"],
    ["anonymous read", (lock) => { lock.restrictedStorage.anonymousAccess.read = true; }, "storage_anonymous_access_invalid"],
    ["readback", (lock) => { lock.restrictedStorage.fullReadback.matchedArtifactIdentity = false; }, "storage_full_readback_invalid"],
    ["multipart", (lock) => { lock.restrictedStorage.incompleteMultipartUploads = 1; }, "storage_incomplete_multipart_invalid"],
    ["local copies", (lock) => { lock.restrictedStorage.knownLocalModelByteCopiesDeleted = false; }, "storage_local_copy_deletion_invalid"],
    ["normal CI artifact access", (lock) => { lock.normalCi.artifactAccessAllowed = true; }, "normal_ci_boundary_invalid:artifactAccessAllowed"],
    ["direct gate", (lock) => { lock.gateEffect.directlyResolvedGates = []; }, "direct_gate_effect_invalid"],
    ["unrelated resolved gate", (lock) => { lock.resolvedGates.push("humanRightsSignoff"); lock.resolvedGates.sort(); }, "resolved_gate_set_invalid"],
    ["derived gate still open", (lock) => { lock.openGates.push("dinoDerivedRuntimeArtifactLock"); lock.openGates.sort(); }, "gate_both_open_and_resolved:dinoDerivedRuntimeArtifactLock"]
  ];
  for (const [name, mutate, issue, wmmrOnly] of cases) {
    await context.test(name, () => {
      const lock = structuredClone(original);
      mutate(lock);
      sealLock(lock);
      assert.throws(
        () => wmmrOnly
          ? validateWmmrDinoDerivedRuntimeArtifactContract(lock, manifest)
          : validateDinoDerivedRuntimeArtifactLock(lock),
        (error) => hasIssue(error, issue)
      );
    });
  }
  for (const boundary of Object.keys(original.boundaries)) {
    await context.test(`false boundary ${boundary}`, () => {
      const lock = structuredClone(original);
      lock.boundaries[boundary] = true;
      sealLock(lock);
      assert.throws(
        () => validateDinoDerivedRuntimeArtifactLock(lock),
        (error) => hasIssue(error, `boundary_must_be_false:${boundary}`)
      );
    });
  }
});

test("DINO tensor manifest rejects tensor identity and layout drift", async (context) => {
  const original = await json(manifestPath);
  const cases = [
    ["status", (manifest) => { manifest.status = "changed"; }, "manifest_status_invalid", false],
    ["timestamp", (manifest) => { manifest.createdAt = "2026-08-20T20:00:00Z"; }, "timestamp_in_manifest", false],
    ["artifact section length", (manifest) => { manifest.artifact.dataByteLength -= 1; }, "artifact_section_lengths_mismatch", false],
    ["duplicate name", (manifest) => { manifest.tensors[1].name = manifest.tensors[0].name; }, `tensor_name_duplicate:${original.tensors[0].name}`, true],
    ["locator-shaped tensor name", (manifest) => { manifest.tensors[0].name = "/etc/private-model-location"; }, "tensor_name_invalid:0", true],
    ["unsorted name", (manifest) => { [manifest.tensors[0], manifest.tensors[1]] = [manifest.tensors[1], manifest.tensors[0]]; }, "tensor_names_not_ascii_sorted", true],
    ["dtype", (manifest) => { manifest.tensors[0].dtype = "F128"; }, `tensor_dtype_invalid:${original.tensors[0].name}`, true],
    ["shape", (manifest) => { manifest.tensors[0].shape[0] += 1; }, `tensor_element_count_invalid:${original.tensors[0].name}`, true],
    ["byte length", (manifest) => { manifest.tensors[0].byteLength += 1; }, `tensor_byte_length_invalid:${original.tensors[0].name}`, true],
    ["tensor hash", (manifest) => { manifest.tensors[0].dataSha256 = "0".repeat(64); }, "manifest_digest_mismatch", false],
    ["overlapping offset", (manifest) => { manifest.tensors[0].dataOffsets[0] += 1; }, `tensor_offsets_invalid:${original.tensors[0].name}`, true],
    ["tensor count", (manifest) => { manifest.tensorCount -= 1; }, "tensor_count_mismatch", false],
    ["total bytes", (manifest) => { manifest.totalTensorByteLength -= 1; }, "tensor_total_byte_length_mismatch", false]
  ];
  for (const [name, mutate, issue, reseal] of cases) {
    await context.test(name, () => {
      const manifest = structuredClone(original);
      mutate(manifest);
      if (reseal) sealManifest(manifest);
      assert.throws(
        () => validateDinoDerivedTensorManifest(manifest),
        (error) => hasIssue(error, issue)
      );
    });
  }
});

test("public derived records reject private locator keys and values", async () => {
  const lockText = await readFile(lockPath, "utf8");
  const manifestText = await readFile(manifestPath, "utf8");
  assert.doesNotMatch(lockText, /(?:s3:\/\/|storage\.yandexcloud\.net|\/home\/|\/tmp\/)/i);
  assert.doesNotMatch(manifestText, /(?:s3:\/\/|storage\.yandexcloud\.net|\/home\/|\/tmp\/)/i);
  const lock = await json(lockPath);
  lock.restrictedStorage.objectKey = "private-object";
  sealLock(lock);
  assert.throws(
    () => validateDinoDerivedRuntimeArtifactLock(lock),
    (error) => hasIssue(error, "private_locator_key_forbidden:lock:restrictedStorage:objectKey")
  );
  const valueLeak = await json(lockPath);
  valueLeak.normalCi.scope = "s3://private-bucket/private-object";
  sealLock(valueLeak);
  assert.throws(
    () => validateDinoDerivedRuntimeArtifactLock(valueLeak),
    (error) => hasIssue(error, "private_locator_value_forbidden:lock:normalCi:scope")
  );
  const customEndpoint = await json(lockPath);
  customEndpoint.normalCi.scope = "https://private-storage.example/internal";
  sealLock(customEndpoint);
  assert.throws(
    () => validateDinoDerivedRuntimeArtifactLock(customEndpoint),
    (error) => hasIssue(error, "unapproved_public_url_value:lock:normalCi:scope")
  );
});

test("derived lock loader rejects alternate paths before reading", async () => {
  await assert.rejects(
    loadWmmrDinoDerivedRuntimeArtifactLock("/dev/zero"),
    (error) => hasIssue(error, "unexpected_lock_path")
  );
});

test("derived verifier CLI is explicit lock-only and reports no private access", async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    [resolve(root, "scripts/verify-dino-derived-runtime-artifact.mjs"), "--lock-only"],
    { encoding: "utf8" }
  );
  const result = JSON.parse(stdout);
  assert.equal(result.lockSha256, "947b7b7adb9bcde2d6c63948e789d6b8236045f05d3c8688a2062e20e60b8bb6");
  assert.equal(result.manifestSha256, "1b3d3e1878c99c5f271931e257961091a049af65b4b4ff5c7602bc72b6087a83");
  assert.equal(result.tensorCount, 344);
  assert.equal(result.payloadFileRead, false);
  assert.equal(result.derivedArtifactFileRead, false);
  assert.equal(result.restrictedOperatorRecordRead, false);
  assert.equal(result.networkRequestInitiatedByVerifier, false);
  await assert.rejects(
    execFileAsync(process.execPath, [resolve(root, "scripts/verify-dino-derived-runtime-artifact.mjs")], { encoding: "utf8" }),
    (error) => error.code === 1 && error.stderr.includes("cli_arguments_invalid")
  );
  await assert.rejects(
    execFileAsync(process.execPath, [resolve(root, "scripts/verify-dino-derived-runtime-artifact.mjs"), "--artifact", "/tmp/model"], { encoding: "utf8" }),
    (error) => error.code === 1 && error.stderr.includes("cli_arguments_invalid")
  );
});
