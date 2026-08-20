import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DinoPayloadArtifactError,
  canonicalDinoPayloadLockDigest,
  loadWmmrDinoPayloadArtifactLock,
  parseCanonicalDinoPayloadArtifactLock,
  validateDinoPayloadArtifactLock,
  validateWmmrDinoPayloadArtifactContract,
  verifyDinoPayloadFile
} from "../scripts/verify-dino-payload-artifact.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, "experiment/warm-modern-meeting-room/dino-payload-bytes-lock.json");
const sourceLockPath = resolve(root, "experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json");
const sourceLockRawSha256 = "5afeefa0cf4c89fe71ff207f3383c60c96b8d256ed0bb22407ed1c05369288e7";
const payloadSha256 = "36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function json(path = lockPath) {
  return JSON.parse(await readFile(path, "utf8"));
}

function seal(lock) {
  lock.lockSha256 = canonicalDinoPayloadLockDigest(lock);
  return lock;
}

function hasIssue(error, issue) {
  return error instanceof DinoPayloadArtifactError && error.issues.includes(issue);
}

function syntheticLock(original, bytes) {
  const lock = structuredClone(original);
  const digest = sha256(bytes);
  lock.payload.byteLength = bytes.byteLength;
  lock.payload.observedSha256 = digest;
  lock.acquisition.get.headers["content-length"] = String(bytes.byteLength);
  lock.restrictedStorage.contentAddress.digest = digest;
  lock.restrictedStorage.fullReadback.byteLength = bytes.byteLength;
  lock.restrictedStorage.fullReadback.sha256 = digest;
  return seal(lock);
}

test("canonical DINO raw payload lock binds byte identity, restricted retention, and blocked boundaries", async () => {
  const canonical = await readFile(lockPath, "utf8");
  const lock = await loadWmmrDinoPayloadArtifactLock();
  assert.deepEqual(parseCanonicalDinoPayloadArtifactLock(canonical), lock);
  assert.equal(lock.lockSha256, "72da7b8d42e33ba0f7632018cf9766e93ac5e62892b51023b755ce25db56f55b");
  assert.equal(canonicalDinoPayloadLockDigest(lock), lock.lockSha256);
  assert.equal(lock.sourceMetadataLock.lockSha256, "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9");
  assert.equal(lock.sourceMetadataLock.publisherUrlTransitivelyBound, true);
  assert.equal(lock.payload.byteLength, 1217607321);
  assert.equal(lock.payload.observedSha256, payloadSha256);
  assert.equal(lock.payload.publisherSha256, null);
  assert.deepEqual(lock.payload.independentHashTools, ["openssl", "sha256sum"]);
  assert.equal(lock.acquisition.preAcquisitionHead.matchedSourceMetadataLockExactly, true);
  assert.equal(lock.acquisition.get.method, "GET");
  assert.equal(lock.acquisition.get.status, 200);
  assert.equal(lock.acquisition.get.redirectsFollowed, 0);
  assert.equal(lock.acquisition.get.rangeRequested, false);
  assert.equal(lock.acquisition.get.acceptEncoding, "identity");
  assert.equal(lock.acquisition.get.responseBlockCount, 1);
  assert.equal(lock.acquisition.get.headers.etag, "\"b6cbe2bf3ce2f370d5a67bcd465144b0-146\"");
  assert.deepEqual(lock.acquisition.get.absentHeaders, [
    "content-encoding",
    "content-range",
    "location",
    "transfer-encoding"
  ]);
  assert.equal(lock.restrictedStorage.contentAddress.digest, payloadSha256);
  assert.equal(lock.restrictedStorage.evidenceScope, "operator-attested-point-in-time");
  assert.equal(lock.restrictedStorage.bucketAclEntryCount, 0);
  assert.equal(lock.restrictedStorage.fullReadback.matchedPayloadIdentity, true);
  assert.equal(lock.restrictedStorage.operatorRecord.rawRecordSha256, "55d6dcbe1321068ac82a4c2e2f07f2faabd803e86693ec809044724b5d6a91da");
  assert.equal(lock.normalCi.scope, "canonical-public-lock-only/no-payload-or-restricted-record-access");
  assert.ok(Object.values(lock.boundaries).every((value) => value === false));
  assert.deepEqual(lock.gateEffect.directlyResolvedGates, ["dinoArtifactPayloadBytesVerification"]);
  assert.deepEqual(lock.gateEffect.mechanicallyResolvedCompositeGates, ["dinoSourceAndArtifactLock"]);
  assert.deepEqual(lock.resolvedGates, [
    "dinoArtifactPayloadBytesVerification",
    "dinoSourceAndArtifactLock",
    "dinoSourceGitObjectLock",
    "patchedSourceTreeDigest",
    "trellisModelArtifactLock"
  ]);
  assert.ok(lock.openGates.includes("dinoDerivedRuntimeArtifactLock"));
  assert.ok(lock.openGates.includes("humanRightsSignoff"));
  assert.ok(lock.openGates.includes("trellisModelPayloadBytesVerification"));
});

test("historical DINO source lock remains byte-identical to its committed public record", async () => {
  const worktreeBytes = await readFile(sourceLockPath);
  const { stdout: committedBytes } = await execFileAsync(
    "git",
    ["-C", root, "show", "HEAD:experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json"],
    { encoding: null, maxBuffer: 2 * 1024 * 1024 }
  );
  assert.equal(sha256(worktreeBytes), sourceLockRawSha256);
  assert.deepEqual(worktreeBytes, Buffer.from(committedBytes));
  assert.equal(JSON.parse(worktreeBytes).lockSha256, "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9");
});

test("WMMR payload lock loader rejects alternate paths before reading", async () => {
  await assert.rejects(
    loadWmmrDinoPayloadArtifactLock("/dev/zero"),
    (error) => hasIssue(error, "unexpected_lock_path")
  );
});

test("DINO payload lock parser rejects duplicate keys, malformed JSON, and non-canonical JSON", async (context) => {
  const canonical = await readFile(lockPath, "utf8");
  const cases = [
    [
      "duplicate top-level key",
      canonical.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,'),
      "lock_json_duplicate_key:schemaVersion"
    ],
    [
      "duplicate nested key",
      canonical.replace('    "representation":', '    "byteLength": 1217607321,\n    "representation":'),
      "lock_json_duplicate_key:byteLength"
    ],
    ["malformed", canonical.slice(0, -2), "lock_json_invalid"],
    ["non-canonical spacing", canonical.replace('  "schemaVersion": 1,', '  "schemaVersion" : 1,'), "lock_json_not_canonical"]
  ];
  for (const [name, contents, expectedIssue] of cases) {
    await context.test(name, () => {
      assert.throws(
        () => parseCanonicalDinoPayloadArtifactLock(contents),
        (error) => hasIssue(error, expectedIssue)
      );
    });
  }
});

test("DINO payload lock rejects identity, acquisition, storage, CI, boundary, and gate drift", async (context) => {
  const original = await json();
  const cases = [
    ["status", (lock) => { lock.status = "changed"; }, "status_invalid", false],
    ["self digest", (lock) => { lock.lockSha256 = "0".repeat(64); }, "lock_digest_mismatch", false],
    ["extra key", (lock) => { lock.unexpected = false; }, "lock_keys_invalid", true],
    ["timestamp", (lock) => { lock.verifiedAt = "2026-08-20T09:04:22Z"; }, "timestamp_in_digested_lock", true],
    ["source path", (lock) => { lock.sourceMetadataLock.path = "elsewhere.json"; }, "unexpected_source_metadata_lock_reference", true, true],
    ["source digest", (lock) => { lock.sourceMetadataLock.lockSha256 = "0".repeat(64); }, "unexpected_source_metadata_lock_reference", true, true],
    ["publisher transitive binding", (lock) => { lock.sourceMetadataLock.publisherUrlTransitivelyBound = false; }, "publisher_url_transitive_binding_invalid", true],
    ["payload representation", (lock) => { lock.payload.representation = "safetensors"; }, "payload_representation_invalid", true],
    ["payload size", (lock) => { lock.payload.byteLength = 1; }, "acquisition_get_content_length_mismatch", true],
    ["payload observed hash", (lock) => { lock.payload.observedSha256 = "0".repeat(64); }, "storage_content_address_digest_mismatch", true],
    ["publisher hash claim", (lock) => { lock.payload.publisherSha256 = "0".repeat(64); }, "payload_publisher_sha256_must_be_null", true],
    ["hash tools", (lock) => { lock.payload.independentHashTools = ["sha256sum"]; }, "payload_hash_tools_invalid", true],
    ["HEAD method", (lock) => { lock.acquisition.preAcquisitionHead.method = "GET"; }, "pre_acquisition_head_method_invalid", true],
    ["HEAD mismatch", (lock) => { lock.acquisition.preAcquisitionHead.matchedSourceMetadataLockExactly = false; }, "pre_acquisition_head_match_invalid", true],
    ["GET method", (lock) => { lock.acquisition.get.method = "POST"; }, "acquisition_get_method_invalid", true],
    ["GET status", (lock) => { lock.acquisition.get.status = 206; }, "acquisition_get_status_invalid", true],
    ["GET redirect", (lock) => { lock.acquisition.get.redirectsFollowed = 1; }, "acquisition_get_redirects_invalid", true],
    ["GET range", (lock) => { lock.acquisition.get.rangeRequested = true; }, "acquisition_get_range_claim_invalid", true],
    ["GET encoding", (lock) => { lock.acquisition.get.acceptEncoding = "gzip"; }, "acquisition_get_encoding_invalid", true],
    ["GET response blocks", (lock) => { lock.acquisition.get.responseBlockCount = 2; }, "acquisition_get_response_block_count_invalid", true],
    ["GET exact header", (lock) => { lock.acquisition.get.headers.etag = "changed"; }, "acquisition_get_header_invalid:etag", true],
    ["GET absent header set", (lock) => { lock.acquisition.get.absentHeaders.pop(); }, "acquisition_get_absent_headers_invalid", true],
    ["storage content address", (lock) => { lock.restrictedStorage.contentAddress.digest = "0".repeat(64); }, "storage_content_address_digest_mismatch", true],
    ["storage evidence scope", (lock) => { lock.restrictedStorage.evidenceScope = "continuously-proven"; }, "storage_evidence_scope_invalid", true],
    ["storage encryption", (lock) => { lock.restrictedStorage.encryption.mode = "SSE-S3"; }, "storage_encryption_invalid", true],
    ["storage versioning", (lock) => { lock.restrictedStorage.versioningEnabled = true; }, "storage_versioning_claim_invalid", true],
    ["storage ACL", (lock) => { lock.restrictedStorage.objectAcl = "public-read"; }, "storage_object_acl_invalid", true],
    ["storage bucket ACL", (lock) => { lock.restrictedStorage.bucketAclEntryCount = 1; }, "storage_bucket_acl_invalid", true],
    ["storage static key", (lock) => { lock.restrictedStorage.staticKeyAuthEnabled = true; }, "storage_static_key_auth_claim_invalid", true],
    ["storage anonymous read", (lock) => { lock.restrictedStorage.anonymousAccess.read = true; }, "storage_anonymous_access_must_be_false", true],
    ["storage live status", (lock) => { lock.restrictedStorage.liveUnauthenticatedHttpStatus.read = 200; }, "storage_unauthenticated_status_invalid", true],
    ["storage readback", (lock) => { lock.restrictedStorage.fullReadback.matchedPayloadIdentity = false; }, "storage_full_readback_mismatch", true],
    ["storage multipart", (lock) => { lock.restrictedStorage.incompleteMultipartUploads = 1; }, "storage_incomplete_multipart_invalid", true],
    ["storage local copies", (lock) => { lock.restrictedStorage.knownLocalPayloadCopiesDeleted = false; }, "storage_local_copy_deletion_invalid", true],
    ["operator record version", (lock) => { lock.restrictedStorage.operatorRecord.schemaVersion = 1; }, "operator_record_schema_invalid", true],
    ["operator record digest", (lock) => { lock.restrictedStorage.operatorRecord.rawRecordSha256 = "0".repeat(64); }, "unexpected_operator_record_digest", true, true],
    ["operator record locator", (lock) => { lock.restrictedStorage.operatorRecord.locatorPublished = true; }, "operator_record_locator_claim_invalid", true],
    ["normal CI scope", (lock) => { lock.normalCi.scope = "payload-access"; }, "normal_ci_scope_invalid", true],
    ["normal CI network", (lock) => { lock.normalCi.networkRequestInitiatedByVerifier = true; }, "normal_ci_boundary_must_be_false:networkRequestInitiatedByVerifier", true],
    ["sparse hash tools", (lock) => {
      lock.payload.independentHashTools = Array(2);
      lock.payload.independentHashTools[1] = "sha256sum";
    }, "payload_hash_tools_invalid", true],
    ["direct gate", (lock) => { lock.gateEffect.directlyResolvedGates = []; }, "direct_gate_effect_invalid", true],
    ["mechanical gate", (lock) => { lock.gateEffect.mechanicallyResolvedCompositeGates = []; }, "mechanical_gate_effect_invalid", true],
    ["non-identity effect", (lock) => { lock.gateEffect.doesNotResolveNonIdentityGates = false; }, "non_identity_gate_effect_invalid", true],
    ["allOf operator", (lock) => { lock.gateComposition.dinoSourceAndArtifactLock.operator = "anyOf"; }, "dino_gate_operator_invalid", true],
    ["allOf member", (lock) => { lock.gateComposition.dinoSourceAndArtifactLock.members.pop(); }, "dino_gate_members_invalid", true],
    ["resolved payload gate", (lock) => {
      lock.resolvedGates = lock.resolvedGates.filter((gate) => gate !== "dinoArtifactPayloadBytesVerification");
    }, "dino_composite_member_not_resolved", true],
    ["sparse resolved gates", (lock) => { delete lock.resolvedGates[0]; }, "resolved_gates_invalid", true],
    ["open derived gate", (lock) => {
      lock.openGates = lock.openGates.filter((gate) => gate !== "dinoDerivedRuntimeArtifactLock");
    }, "open_gate_set_invalid", true]
  ];
  for (const [name, mutate, expectedIssue, reseal, wmmrOnly] of cases) {
    await context.test(name, () => {
      const lock = structuredClone(original);
      mutate(lock);
      if (reseal) seal(lock);
      assert.throws(
        () => wmmrOnly ? validateWmmrDinoPayloadArtifactContract(lock) : validateDinoPayloadArtifactLock(lock),
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
        () => validateDinoPayloadArtifactLock(lock),
        (error) => hasIssue(error, `boundary_must_be_false:${boundary}`)
      );
    });
  }
});

test("DINO payload public lock rejects private locator fields and contains no locator value", async () => {
  const lock = await json();
  const publicText = await readFile(lockPath, "utf8");
  assert.doesNotMatch(publicText, /(?:s3:\/\/|storage\.yandexcloud\.net|amazonaws\.com)/i);
  assert.doesNotMatch(publicText, /"(?:bucket|bucketName|credential|iamPrincipal|kmsId|kmsKeyId|objectKey|objectUrl|privateLocator)"\s*:/i);
  const changed = structuredClone(lock);
  changed.restrictedStorage.objectKey = "private-object-name";
  seal(changed);
  assert.throws(
    () => validateDinoPayloadArtifactLock(changed),
    (error) => hasIssue(error, "private_locator_key_forbidden:lock:restrictedStorage:objectKey")
  );
});

test("streaming verifier accepts exact regular bytes without deserializing", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-dino-payload-"));
  const payloadPath = join(directory, "fixture.payload");
  const bytes = Buffer.from("synthetic opaque bytes for streaming identity\n");
  try {
    await writeFile(payloadPath, bytes);
    const lock = syntheticLock(await json(), bytes);
    const result = await verifyDinoPayloadFile(lock, payloadPath);
    assert.equal(result.byteLength, bytes.byteLength);
    assert.equal(result.observedSha256, sha256(bytes));
    assert.equal(result.publisherSha256, null);
    assert.equal(result.deserialized, false);
    assert.equal(result.pthInspected, false);
    assert.equal(result.runtimeExecuted, false);
    assert.equal(result.networkRequestInitiatedByVerifier, false);
    assert.equal(result.generationAllowed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("streaming verifier rejects too-large, too-small, hash-mismatched, symlink, and non-regular input", async (context) => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-dino-payload-negative-"));
  const exactBytes = Buffer.from("0123456789abcdef");
  const lock = syntheticLock(await json(), exactBytes);
  try {
    const cases = [
      ["too large", Buffer.concat([exactBytes, Buffer.from("x")]), "payload_file_too_large"],
      ["too small", exactBytes.subarray(0, -1), "payload_file_too_small"],
      ["hash mismatch", Buffer.from("fedcba9876543210"), "payload_file_sha256_mismatch"]
    ];
    for (const [name, bytes, expectedIssue] of cases) {
      await context.test(name, async () => {
        const path = join(directory, `${name.replaceAll(" ", "-")}.payload`);
        await writeFile(path, bytes);
        await assert.rejects(
          verifyDinoPayloadFile(lock, path),
          (error) => hasIssue(error, expectedIssue)
        );
      });
    }
    await context.test("symlink", async () => {
      const target = join(directory, "target.payload");
      const link = join(directory, "link.payload");
      await writeFile(target, exactBytes);
      await symlink(target, link);
      await assert.rejects(
        verifyDinoPayloadFile(lock, link),
        (error) => hasIssue(error, "payload_file_symlink_forbidden")
      );
    });
    await context.test("symlinked parent directory", async () => {
      const targetDirectory = join(directory, "target-directory");
      const linkedDirectory = join(directory, "linked-directory");
      await mkdir(targetDirectory);
      await writeFile(join(targetDirectory, "payload"), exactBytes);
      await symlink(targetDirectory, linkedDirectory);
      await assert.rejects(
        verifyDinoPayloadFile(lock, join(linkedDirectory, "payload")),
        (error) => hasIssue(error, "payload_file_symlinked_path_forbidden")
      );
    });
    await context.test("directory", async () => {
      const path = join(directory, "directory.payload");
      await mkdir(path);
      await assert.rejects(
        verifyDinoPayloadFile(lock, path),
        (error) => hasIssue(error, "payload_file_not_regular")
      );
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("streaming verifier hashes logical bytes independently of physical allocation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-dino-payload-sparse-"));
  const payloadPath = join(directory, "sparse.payload");
  const byteLength = 1024 * 1024;
  const bytes = Buffer.alloc(byteLength);
  const lock = syntheticLock(await json(), bytes);
  let handle;
  try {
    handle = await open(payloadPath, "w");
    await handle.truncate(byteLength);
    await handle.close();
    handle = undefined;
    const result = await verifyDinoPayloadFile(lock, payloadPath);
    assert.equal(result.byteLength, byteLength);
    assert.equal(result.observedSha256, sha256(bytes));
  } finally {
    if (handle) await handle.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("DINO payload verifier CLI requires an explicit lock-only or payload mode", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-dino-payload-cli-"));
  const link = join(directory, "verify-dino-payload.mjs");
  const tinyPayload = join(directory, "tiny.payload");
  try {
    await symlink(resolve(root, "scripts/verify-dino-payload-artifact.mjs"), link);
    await writeFile(tinyPayload, "not the retained payload");
    const { stdout } = await execFileAsync(process.execPath, [link, "--lock-only"], { encoding: "utf8" });
    const result = JSON.parse(stdout);
    assert.equal(result.lockSha256, "72da7b8d42e33ba0f7632018cf9766e93ac5e62892b51023b755ce25db56f55b");
    assert.equal(result.payloadFileRead, false);
    assert.equal(result.restrictedOperatorRecordRead, false);
    assert.equal(result.status, "canonical-public-lock-verified-without-payload-read");
    assert.equal(result.networkRequestInitiatedByVerifier, false);
    await assert.rejects(
      execFileAsync(process.execPath, [link], { encoding: "utf8" }),
      (error) => error.code === 1 && error.stderr.includes("cli_arguments_invalid")
    );
    await assert.rejects(
      execFileAsync(process.execPath, [link, "--payload", tinyPayload], { encoding: "utf8" }),
      (error) => error.code === 1 && error.stderr.includes("payload_file_too_small")
    );
    await assert.rejects(
      execFileAsync(process.execPath, [link, "--skip-payload"], { encoding: "utf8" }),
      (error) => error.code === 1 && error.stderr.includes("cli_arguments_invalid")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
