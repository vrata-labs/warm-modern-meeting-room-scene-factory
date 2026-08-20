import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  TrellisPayloadArtifactError,
  canonicalTrellisPayloadLockDigest,
  loadWmmrTrellisPayloadArtifactLock,
  parseCanonicalTrellisPayloadArtifactLock,
  validateTrellisPayloadArtifactLock,
  validateWmmrTrellisPayloadArtifactContract,
  verifyTrellisPayloadDirectory
} from "../scripts/verify-trellis-payload-artifact.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, "experiment/warm-modern-meeting-room/trellis-payload-bytes-lock.json");
const modelLockPath = resolve(root, "experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json");
const lockSha256 = "d140f277f756f845aa8ad5d83960fb1bb70d640dcb7aa2c43460901f6ab8839d";
const modelLockRawSha256 = "9249eef8b00b2a286f30726318651b0a70bd5817fa27b3743eb5fb4a09c52b59";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function json() {
  return JSON.parse(await readFile(lockPath, "utf8"));
}

function seal(lock) {
  lock.lockSha256 = canonicalTrellisPayloadLockDigest(lock);
  return lock;
}

function hasIssue(error, issue) {
  return error instanceof TrellisPayloadArtifactError && error.issues.includes(issue);
}

function syntheticLock(original, bytesById) {
  const lock = structuredClone(original);
  let total = 0;
  for (const payload of lock.payloadSet.payloads) {
    const bytes = bytesById.get(payload.id);
    const digest = sha256(bytes);
    payload.byteLength = bytes.byteLength;
    payload.publisherLfsOidSha256 = digest;
    payload.observedSha256 = digest;
    payload.acquisition.initialResponse.headers["x-linked-etag"] = `"${digest}"`;
    payload.acquisition.initialResponse.headers["x-linked-size"] = String(bytes.byteLength);
    payload.acquisition.finalResponse.contentLength = String(bytes.byteLength);
    payload.restrictedStorageReadback.contentAddress.digest = digest;
    payload.restrictedStorageReadback.byteLength = bytes.byteLength;
    payload.restrictedStorageReadback.sha256 = digest;
    total += bytes.byteLength;
  }
  lock.payloadSet.totalByteLength = total;
  lock.restrictedStorage.fullReadback.totalByteLength = total;
  return seal(lock);
}

function syntheticBytes(lock) {
  return new Map(lock.payloadSet.payloads.map(({ id }, index) => [
    id,
    Buffer.from(`synthetic opaque payload ${index}\n`)
  ]));
}

async function writePayloadFixture(directory, lock, bytesById, { omitId = null } = {}) {
  const ckpts = join(directory, "ckpts");
  await mkdir(ckpts);
  for (const payload of lock.payloadSet.payloads) {
    if (payload.id !== omitId) await writeFile(join(ckpts, basename(payload.path)), bytesById.get(payload.id));
  }
  return ckpts;
}

test("canonical TRELLIS payload lock binds four exact publisher payload identities and blocked boundaries", async () => {
  const canonical = await readFile(lockPath, "utf8");
  const lock = await loadWmmrTrellisPayloadArtifactLock();
  assert.deepEqual(parseCanonicalTrellisPayloadArtifactLock(canonical), lock);
  assert.equal(lock.lockSha256, lockSha256);
  assert.equal(canonicalTrellisPayloadLockDigest(lock), lock.lockSha256);
  assert.deepEqual(lock.modelArtifactLock, {
    path: "experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json",
    lockSha256: "d0046a083406c02dd67fd508b917750bc52f8e893527b4e39fa71abda0a6baa9",
    publisherRepository: "https://huggingface.co/microsoft/TRELLIS-image-large",
    publisherCommit: "25e0d31ffbebe4b5a97464dd851910efc3002d96",
    selectedPayloadPointersTransitivelyBound: true
  });
  assert.equal(lock.payloadSet.count, 4);
  assert.equal(lock.payloadSet.totalByteLength, 2664021360);
  assert.deepEqual(lock.payloadSet.independentHashTools, ["openssl", "sha256sum"]);
  assert.deepEqual(lock.payloadSet.payloads.map(({ acquisition }) => acquisition.finalResponse.etag), [
    "\"90cbb9469e3bb19934ab40a8cec5331b88323c0636b89139383b632d396503cb\"",
    "\"48327f38cd327356fd2fe0a413429b8f9dfc7cc1a9ca4564b2ec9291c73bfb76\"",
    "\"6ac386147a7d3c547af80d0f813e4d4a380e514ac0c1e3a9096ae60c94a497e1\"",
    "\"2235ba5568195f3ac0ef7eb16f46e596a6a93c5cdf409004130a50cc1f032126\""
  ]);
  assert.ok(lock.payloadSet.payloads.every((payload) => (
    payload.publisherLfsOidSha256 === payload.observedSha256
      && payload.hashesMatch
      && payload.acquisition.method === "GET"
      && payload.acquisition.acceptEncoding === "identity"
      && payload.acquisition.rangeRequested === false
      && payload.acquisition.redirectsFollowed === 1
      && JSON.stringify(payload.acquisition.responseStatuses) === JSON.stringify([302, 200])
      && payload.acquisition.initialResponse.status === 302
      && payload.acquisition.initialResponse.headers["x-linked-size"] === String(payload.byteLength)
      && payload.acquisition.initialResponse.headers["x-linked-etag"] === `"${payload.publisherLfsOidSha256}"`
      && payload.acquisition.finalResponse.status === 200
      && payload.acquisition.finalResponse.contentType === "application/octet-stream"
      && payload.acquisition.finalResponse.acceptRanges === "bytes"
      && /^"[0-9a-f]{64}"$/.test(payload.acquisition.finalResponse.etag)
      && payload.restrictedStorageReadback.matchedPayloadIdentity === true
  )));
  assert.equal(lock.restrictedStorage.evidenceScope, "operator-attested-point-in-time");
  assert.equal(lock.restrictedStorage.continuingPublicProof, false);
  assert.equal(lock.restrictedStorage.operatorRecord.schemaVersion, 3);
  assert.equal(lock.restrictedStorage.operatorRecord.rawRecordSha256, "33f033da362875c9332613183ac8398ef886b7b7c0de768a739f71167e1306ab");
  assert.equal(lock.normalCi.realPayloadHashesReproducible, false);
  assert.equal(lock.normalCi.networkFallbackAllowedByVerifier, false);
  assert.equal(lock.normalCi.streamingVerificationCoverage, "synthetic-fixtures-only");
  assert.ok(Object.values(lock.boundaries).every((value) => value === false));
  assert.deepEqual(lock.gateEffect.directlyResolvedGates, ["trellisModelPayloadBytesVerification"]);
  assert.equal(lock.gateEffect.doesNotResolveCompositeGates, true);
  assert.deepEqual(lock.resolvedGates, [
    "dinoArtifactPayloadBytesVerification",
    "dinoSourceAndArtifactLock",
    "dinoSourceGitObjectLock",
    "patchedSourceTreeDigest",
    "trellisModelArtifactLock",
    "trellisModelPayloadBytesVerification"
  ]);
  assert.deepEqual(lock.openGates, [
    "dependencyWheelHashLock",
    "dinoDerivedRuntimeArtifactLock",
    "gpuParityAndVramTest",
    "humanRightsSignoff",
    "ociImageDigest",
    "offlineImportRuntimeTest",
    "patchedPytorchQualification",
    "providerTermsSnapshot",
    "sbomAndVulnerabilityReport",
    "thirdPartyNoticeBundle"
  ]);
});

test("historical TRELLIS model lock remains raw-byte identical to HEAD", async () => {
  const worktreeBytes = await readFile(modelLockPath);
  const { stdout: committedBytes } = await execFileAsync(
    "git",
    ["-C", root, "show", "HEAD:experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json"],
    { encoding: null, maxBuffer: 2 * 1024 * 1024 }
  );
  assert.equal(sha256(worktreeBytes), modelLockRawSha256);
  assert.deepEqual(worktreeBytes, Buffer.from(committedBytes));
  assert.equal(JSON.parse(worktreeBytes).lockSha256, "d0046a083406c02dd67fd508b917750bc52f8e893527b4e39fa71abda0a6baa9");
});

test("TRELLIS payload lock parser rejects duplicate, malformed, and noncanonical JSON", async (context) => {
  const canonical = await readFile(lockPath, "utf8");
  const cases = [
    [
      "duplicate top-level key",
      canonical.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,'),
      "lock_json_duplicate_key:schemaVersion"
    ],
    [
      "duplicate nested key",
      canonical.replace('    "representation":', '    "count": 4,\n    "representation":'),
      "lock_json_duplicate_key:count"
    ],
    ["malformed", canonical.slice(0, -2), "lock_json_invalid"],
    ["noncanonical", canonical.replace('  "schemaVersion": 1,', '  "schemaVersion" : 1,'), "lock_json_not_canonical"]
  ];
  for (const [name, contents, expectedIssue] of cases) {
    await context.test(name, () => {
      assert.throws(
        () => parseCanonicalTrellisPayloadArtifactLock(contents),
        (error) => hasIssue(error, expectedIssue)
      );
    });
  }
});

test("TRELLIS payload lock rejects identity, acquisition, storage, boundary, and gate drift", async (context) => {
  const original = await json();
  const cases = [
    ["status", (lock) => { lock.status = "changed"; }, "status_invalid", false],
    ["self digest", (lock) => { lock.lockSha256 = "0".repeat(64); }, "lock_digest_mismatch", false],
    ["extra key", (lock) => { lock.unexpected = false; }, "lock_keys_invalid", true],
    ["timestamp", (lock) => { lock.verifiedAt = "2026-08-20T12:46:45Z"; }, "timestamp_in_digested_lock", true],
    ["historical path", (lock) => { lock.modelArtifactLock.path = "other.json"; }, "unexpected_model_artifact_lock_reference", true, true],
    ["historical digest", (lock) => { lock.modelArtifactLock.lockSha256 = "0".repeat(64); }, "unexpected_model_artifact_lock_reference", true, true],
    ["publisher repository", (lock) => { lock.modelArtifactLock.publisherRepository = "https://example.invalid/model"; }, "unexpected_model_artifact_lock_reference", true, true],
    ["publisher commit", (lock) => {
      const previous = lock.modelArtifactLock.publisherCommit;
      lock.modelArtifactLock.publisherCommit = "0".repeat(40);
      for (const payload of lock.payloadSet.payloads) {
        payload.acquisition.pinnedResolvePath = payload.acquisition.pinnedResolvePath.replace(
          previous,
          lock.modelArtifactLock.publisherCommit
        );
      }
    }, "unexpected_model_artifact_lock_reference", true, true],
    ["pointer binding", (lock) => { lock.modelArtifactLock.selectedPayloadPointersTransitivelyBound = false; }, "selected_payload_pointer_binding_invalid", true],
    ["payload representation", (lock) => { lock.payloadSet.representation = "parsed-safetensors"; }, "payload_set_representation_invalid", true],
    ["payload count", (lock) => { lock.payloadSet.count = 3; }, "payload_count_mismatch", true],
    ["payload total", (lock) => { lock.payloadSet.totalByteLength += 1; }, "payload_total_byte_length_mismatch", true],
    ["hash tools", (lock) => { lock.payloadSet.independentHashTools = ["sha256sum"]; }, "payload_hash_tools_invalid", true],
    ["publisher hash differs", (lock) => { lock.payloadSet.payloads[0].publisherLfsOidSha256 = "0".repeat(64); }, "publisher_observed_hash_mismatch:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["hash match flag", (lock) => { lock.payloadSet.payloads[0].hashesMatch = false; }, "publisher_observed_hash_mismatch:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["unsafe payload path", (lock) => { lock.payloadSet.payloads[0].path = "../payload.safetensors"; }, "payload_path_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["GET method", (lock) => { lock.payloadSet.payloads[0].acquisition.method = "HEAD"; }, "payload_get_method_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["pinned resolve path", (lock) => { lock.payloadSet.payloads[0].acquisition.pinnedResolvePath = "resolve/latest/file"; }, "payload_pinned_resolve_path_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["encoding", (lock) => { lock.payloadSet.payloads[0].acquisition.acceptEncoding = "gzip"; }, "payload_accept_encoding_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["range", (lock) => { lock.payloadSet.payloads[0].acquisition.rangeRequested = true; }, "payload_range_request_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["redirect count", (lock) => { lock.payloadSet.payloads[0].acquisition.redirectsFollowed = 0; }, "payload_redirect_count_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["response sequence", (lock) => { lock.payloadSet.payloads[0].acquisition.responseStatuses = [200]; }, "payload_response_statuses_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["initial status", (lock) => { lock.payloadSet.payloads[0].acquisition.initialResponse.status = 301; }, "payload_initial_status_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["initial linked size", (lock) => { lock.payloadSet.payloads[0].acquisition.initialResponse.headers["x-linked-size"] = "1"; }, "payload_initial_linked_size_mismatch:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["initial linked etag", (lock) => { lock.payloadSet.payloads[0].acquisition.initialResponse.headers["x-linked-etag"] = `"${"0".repeat(64)}"`; }, "payload_initial_linked_etag_mismatch:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["initial response extra header", (lock) => { lock.payloadSet.payloads[0].acquisition.initialResponse.headers.location = "hidden"; }, "payload_initial_response_headers:slat_dec_mesh_swin8_B_64l8m256c_fp16_keys_invalid", true],
    ["final content type", (lock) => { lock.payloadSet.payloads[0].acquisition.finalResponse.contentType = "text/plain"; }, "payload_content_type_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["final ranges", (lock) => { lock.payloadSet.payloads[0].acquisition.finalResponse.acceptRanges = "none"; }, "payload_accept_ranges_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["final etag", (lock) => { lock.payloadSet.payloads[0].acquisition.finalResponse.etag = "changed"; }, "payload_etag_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["final etag exact WMMR value", (lock) => { lock.payloadSet.payloads[0].acquisition.finalResponse.etag = `"${"0".repeat(64)}"`; }, "unexpected_payload_identity:slat_dec_mesh_swin8_B_64l8m256c_fp16", true, true],
    ["storage readback", (lock) => { lock.payloadSet.payloads[0].restrictedStorageReadback.matchedPayloadIdentity = false; }, "payload_storage_readback_mismatch:slat_dec_mesh_swin8_B_64l8m256c_fp16", true],
    ["storage evidence", (lock) => { lock.restrictedStorage.evidenceScope = "continuously-proven"; }, "storage_evidence_scope_invalid", true],
    ["continuing proof", (lock) => { lock.restrictedStorage.continuingPublicProof = true; }, "storage_continuing_proof_claim_invalid", true],
    ["storage encryption", (lock) => { lock.restrictedStorage.encryption.mode = "SSE-S3"; }, "storage_encryption_invalid", true],
    ["storage versioning", (lock) => { lock.restrictedStorage.versioningEnabled = true; }, "storage_versioning_claim_invalid", true],
    ["storage object ACL", (lock) => { lock.restrictedStorage.objectAcl = "public-read"; }, "storage_object_acl_invalid", true],
    ["storage bucket ACL", (lock) => { lock.restrictedStorage.bucketAclGrantsBeyondOwner = 1; }, "storage_bucket_acl_invalid", true],
    ["storage static key", (lock) => { lock.restrictedStorage.staticKeyAuthEnabled = true; }, "storage_static_key_auth_claim_invalid", true],
    ["storage anonymous read", (lock) => { lock.restrictedStorage.anonymousAccess.read = true; }, "storage_anonymous_access_must_be_false", true],
    ["storage HTTP status", (lock) => { lock.restrictedStorage.liveUnauthenticatedHttpStatus.read = 200; }, "storage_unauthenticated_status_invalid", true],
    ["storage full readback", (lock) => { lock.restrictedStorage.fullReadback.everyObjectMatchedPayloadIdentity = false; }, "storage_full_readback_mismatch", true],
    ["storage multipart", (lock) => { lock.restrictedStorage.incompleteMultipartUploads = 1; }, "storage_incomplete_multipart_invalid", true],
    ["local deletion", (lock) => { lock.restrictedStorage.knownLocalPayloadCopiesDeleted = false; }, "storage_local_copy_deletion_invalid", true],
    ["operator version", (lock) => { lock.restrictedStorage.operatorRecord.schemaVersion = 2; }, "operator_record_schema_invalid", true],
    ["operator digest", (lock) => { lock.restrictedStorage.operatorRecord.rawRecordSha256 = "0".repeat(64); }, "unexpected_operator_record_digest", true, true],
    ["operator locator", (lock) => { lock.restrictedStorage.operatorRecord.locatorPublished = true; }, "operator_record_locator_claim_invalid", true],
    ["normal CI scope", (lock) => { lock.normalCi.scope = "payload-access"; }, "normal_ci_scope_invalid", true],
    ["normal CI network fallback", (lock) => { lock.normalCi.networkFallbackAllowedByVerifier = true; }, "normal_ci_boundary_must_be_false:networkFallbackAllowedByVerifier", true],
    ["normal CI payload", (lock) => { lock.normalCi.payloadAccessAllowed = true; }, "normal_ci_boundary_must_be_false:payloadAccessAllowed", true],
    ["direct gate", (lock) => { lock.gateEffect.directlyResolvedGates = []; }, "direct_gate_effect_invalid", true],
    ["composite claim", (lock) => { lock.gateEffect.doesNotResolveCompositeGates = false; }, "composite_gate_effect_invalid", true],
    ["nonidentity claim", (lock) => { lock.gateEffect.doesNotResolveNonIdentityGates = false; }, "non_identity_gate_effect_invalid", true],
    ["resolved set", (lock) => { lock.resolvedGates.pop(); }, "resolved_gate_set_invalid", true],
    ["open set", (lock) => { lock.openGates.push("trellisModelPayloadBytesVerification"); }, "open_gate_set_invalid", true]
  ];
  for (const [name, mutate, expectedIssue, reseal, wmmrOnly] of cases) {
    await context.test(name, () => {
      const lock = structuredClone(original);
      mutate(lock);
      if (reseal) seal(lock);
      assert.throws(
        () => wmmrOnly ? validateWmmrTrellisPayloadArtifactContract(lock) : validateTrellisPayloadArtifactLock(lock),
        (error) => hasIssue(error, expectedIssue)
      );
    });
  }
  for (const boundary of Object.keys(original.boundaries)) {
    await context.test(`false boundary ${boundary}`, () => {
      const lock = structuredClone(original);
      lock.boundaries[boundary] = true;
      seal(lock);
      assert.throws(
        () => validateTrellisPayloadArtifactLock(lock),
        (error) => hasIssue(error, `boundary_must_be_false:${boundary}`)
      );
    });
  }
});

test("TRELLIS payload lock rejects sparse arrays and private locator fields", async (context) => {
  const original = await json();
  const sparseCases = [
    ["payloads", (lock) => { delete lock.payloadSet.payloads[0]; }, "payload_records_invalid"],
    ["hash tools", (lock) => { delete lock.payloadSet.independentHashTools[0]; }, "payload_hash_tools_invalid"],
    ["statuses", (lock) => { delete lock.payloadSet.payloads[0].acquisition.responseStatuses[0]; }, "payload_response_statuses_invalid:slat_dec_mesh_swin8_B_64l8m256c_fp16"],
    ["resolved gates", (lock) => { delete lock.resolvedGates[0]; }, "resolved_gates_invalid"]
  ];
  for (const [name, mutate, expectedIssue] of sparseCases) {
    await context.test(`sparse ${name}`, () => {
      const lock = structuredClone(original);
      mutate(lock);
      seal(lock);
      assert.throws(
        () => validateTrellisPayloadArtifactLock(lock),
        (error) => hasIssue(error, expectedIssue)
      );
    });
  }
  const publicText = await readFile(lockPath, "utf8");
  assert.doesNotMatch(publicText, /(?:s3:\/\/|storage\.yandexcloud\.net|amazonaws\.com)/i);
  assert.doesNotMatch(publicText, /"(?:bucket|bucketId|bucketName|kmsId|kmsKeyId|objectKey|objectUrl|principal|resourceLocator)"\s*:/i);
  const changed = structuredClone(original);
  changed.restrictedStorage.objectKey = "private-object-name";
  seal(changed);
  assert.throws(
    () => validateTrellisPayloadArtifactLock(changed),
    (error) => hasIssue(error, "private_locator_key_forbidden:lock:restrictedStorage:objectKey")
  );
});

test("streaming directory verifier accepts the exact four synthetic logical byte streams", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-"));
  const original = await json();
  const bytesById = syntheticBytes(original);
  const lock = syntheticLock(original, bytesById);
  try {
    await writePayloadFixture(directory, lock, bytesById);
    const result = await verifyTrellisPayloadDirectory(lock, directory);
    assert.equal(result.count, 4);
    assert.equal(result.totalByteLength, lock.payloadSet.totalByteLength);
    assert.deepEqual(result.payloads.map(({ id }) => id), lock.payloadSet.payloads.map(({ id }) => id));
    assert.ok(result.payloads.every((payload) => payload.observedSha256 === sha256(bytesById.get(payload.id))));
    assert.equal(result.safetensorsParsed, false);
    assert.equal(result.deserialized, false);
    assert.equal(result.runtimeExecuted, false);
    assert.equal(result.modelInputUsed, false);
    assert.equal(result.networkFallbackAllowedByVerifier, false);
    assert.equal(result.networkRequestInitiatedByVerifier, false);
    assert.equal(result.generationAllowed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("streaming directory verifier rejects missing, extra, wrong-size, and wrong-hash selections", async (context) => {
  const original = await json();
  const bytesById = syntheticBytes(original);
  const lock = syntheticLock(original, bytesById);
  const first = lock.payloadSet.payloads[0];
  for (const [name, arrange, expectedIssue, forbiddenText = null] of [
    ["missing", async (directory) => {
      await writePayloadFixture(directory, lock, bytesById, { omitId: first.id });
    }, "payload_selection_missing:payload_parent_directory", null],
    ["extra root", async (directory) => {
      await writePayloadFixture(directory, lock, bytesById);
      await writeFile(join(directory, "sensitive-root-record"), "extra");
    }, "payload_selection_extra", "sensitive-root-record"],
    ["extra child", async (directory) => {
      const ckpts = await writePayloadFixture(directory, lock, bytesById);
      for (let index = 0; index < 32; index += 1) {
        await writeFile(join(ckpts, `sensitive-object-${String(index).padStart(2, "0")}`), "extra");
      }
    }, "payload_selection_extra", "sensitive-object-"],
    ["too large", async (directory) => {
      const ckpts = await writePayloadFixture(directory, lock, bytesById);
      await writeFile(join(ckpts, basename(first.path)), Buffer.concat([bytesById.get(first.id), Buffer.from("x")]));
    }, `payload_file_too_large:${first.id}`],
    ["too small", async (directory) => {
      const ckpts = await writePayloadFixture(directory, lock, bytesById);
      await writeFile(join(ckpts, basename(first.path)), bytesById.get(first.id).subarray(0, -1));
    }, `payload_file_too_small:${first.id}`],
    ["hash mismatch", async (directory) => {
      const ckpts = await writePayloadFixture(directory, lock, bytesById);
      const changed = Buffer.from(bytesById.get(first.id));
      changed[0] ^= 1;
      await writeFile(join(ckpts, basename(first.path)), changed);
    }, `payload_file_sha256_mismatch:${first.id}`]
  ]) {
    await context.test(name, async () => {
      const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-negative-"));
      try {
        await arrange(directory);
        await assert.rejects(
          verifyTrellisPayloadDirectory(lock, directory),
          (error) => hasIssue(error, expectedIssue)
            && (forbiddenText === null || !error.message.includes(forbiddenText))
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

test("streaming directory verifier rejects final and parent symlinks and nonregular payload input", async (context) => {
  const original = await json();
  const bytesById = syntheticBytes(original);
  const lock = syntheticLock(original, bytesById);
  const first = lock.payloadSet.payloads[0];
  await context.test("final symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-link-"));
    const targetDirectory = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-link-target-"));
    try {
      const ckpts = await writePayloadFixture(directory, lock, bytesById, { omitId: first.id });
      const target = join(targetDirectory, "target.payload");
      await writeFile(target, bytesById.get(first.id));
      await symlink(target, join(ckpts, basename(first.path)));
      await assert.rejects(
        verifyTrellisPayloadDirectory(lock, directory),
        (error) => hasIssue(error, `payload_file_symlink_forbidden:${first.id}`)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(targetDirectory, { recursive: true, force: true });
    }
  });
  await context.test("parent symlink", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-parent-link-"));
    const targetRoot = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-parent-target-"));
    try {
      const targetCkpts = await writePayloadFixture(targetRoot, lock, bytesById);
      await symlink(targetCkpts, join(directory, "ckpts"));
      await assert.rejects(
        verifyTrellisPayloadDirectory(lock, directory),
        (error) => hasIssue(error, "payload_parent_directory_symlink_forbidden")
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
      await rm(targetRoot, { recursive: true, force: true });
    }
  });
  await context.test("nonregular payload", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-directory-"));
    try {
      const ckpts = await writePayloadFixture(directory, lock, bytesById, { omitId: first.id });
      await mkdir(join(ckpts, basename(first.path)));
      await assert.rejects(
        verifyTrellisPayloadDirectory(lock, directory),
        (error) => hasIssue(error, `payload_file_not_regular:${first.id}`)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

test("TRELLIS payload verifier CLI requires explicit lock-only or payload-dir mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-payload-cli-"));
  const link = join(directory, "verify-trellis-payload.mjs");
  const fixture = join(directory, "fixture");
  try {
    await symlink(resolve(root, "scripts/verify-trellis-payload-artifact.mjs"), link);
    const { stdout } = await execFileAsync(process.execPath, [link, "--lock-only"], { encoding: "utf8" });
    const result = JSON.parse(stdout);
    assert.equal(result.lockSha256, lockSha256);
    assert.equal(result.payloadFilesRead, false);
    assert.equal(result.restrictedOperatorRecordRead, false);
    assert.equal(result.networkFallbackAllowedByVerifier, false);
    assert.equal(result.networkRequestInitiatedByVerifier, false);
    await mkdir(fixture);
    const publicLock = await json();
    const bytesById = syntheticBytes(publicLock);
    await writePayloadFixture(fixture, publicLock, bytesById);
    await assert.rejects(
      execFileAsync(process.execPath, [link, "--payload-dir", fixture], { encoding: "utf8" }),
      (error) => error.code === 1 && error.stderr.includes("payload_file_too_small")
    );
    const unexpectedName = "sensitive-cli-record";
    await writeFile(join(fixture, unexpectedName), "extra");
    await assert.rejects(
      execFileAsync(process.execPath, [link, "--payload-dir", fixture], { encoding: "utf8" }),
      (error) => error.code === 1
        && error.stderr.includes("payload_selection_extra")
        && !error.stderr.includes(unexpectedName)
    );
    for (const args of [[], ["--payload", fixture], ["--skip-payload"], ["--lock-only", "extra"]]) {
      await assert.rejects(
        execFileAsync(process.execPath, [link, ...args], { encoding: "utf8" }),
        (error) => error.code === 1 && error.stderr.includes("cli_arguments_invalid")
      );
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
