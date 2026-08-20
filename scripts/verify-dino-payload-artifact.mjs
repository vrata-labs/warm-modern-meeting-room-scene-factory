import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stableJson } from "./verify-trellis-model-artifact.mjs";
import { loadWmmrDinoSourceArtifactLock } from "./verify-dino-source-artifact.mjs";

const defaultLockPath = resolve(
  import.meta.dirname,
  "../experiment/warm-modern-meeting-room/dino-payload-bytes-lock.json"
);
const repositoryRoot = resolve(import.meta.dirname, "..");
const lockStatus = "raw-publisher-payload-identity-verified-restricted-retained-runtime-and-rights-blocked";
const normalCiScope = "canonical-public-lock-only/no-payload-or-restricted-record-access";
const sourceLockPath = "experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json";
const sourceLockSha256 = "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9";
const payloadSha256 = "36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51";
const operatorRecordSha256 = "55d6dcbe1321068ac82a4c2e2f07f2faabd803e86693ec809044724b5d6a91da";
const payloadByteLength = 1217607321;
const maxPublicLockBytes = 1024 * 1024;
const expectedGetHeaders = Object.freeze({
  "accept-ranges": "bytes",
  "content-length": "1217607321",
  "content-type": "binary/octet-stream",
  etag: "\"b6cbe2bf3ce2f370d5a67bcd465144b0-146\"",
  "last-modified": "Fri, 27 Oct 2023 10:37:32 GMT",
  "x-amz-server-side-encryption": "AES256",
  "x-amz-version-id": "HLmbhvcd2hPq9CNLwMvwswbRlzZRuOeA"
});
const expectedAbsentHeaders = Object.freeze([
  "content-encoding",
  "content-range",
  "location",
  "transfer-encoding"
]);
const falseBoundaryFields = Object.freeze([
  "derivedArtifactCreated",
  "deserialized",
  "generationAllowed",
  "humanSignoff",
  "modelInputUsed",
  "payloadBytesIncludedInPublicRepository",
  "payloadReadInNormalCi",
  "privateLocatorPublished",
  "pthInspected",
  "restrictedOperatorRecordReadInNormalCi",
  "rightsApproved",
  "runtimeExecuted",
  "sourceWeightCompatibilityTested",
  "tensorEquivalenceTested"
]);
const expectedResolvedGates = Object.freeze([
  "dinoArtifactPayloadBytesVerification",
  "dinoSourceAndArtifactLock",
  "dinoSourceGitObjectLock",
  "patchedSourceTreeDigest",
  "trellisModelArtifactLock"
]);
const expectedOpenGates = Object.freeze([
  "dependencyWheelHashLock",
  "dinoDerivedRuntimeArtifactLock",
  "gpuParityAndVramTest",
  "humanRightsSignoff",
  "ociImageDigest",
  "offlineImportRuntimeTest",
  "patchedPytorchQualification",
  "providerTermsSnapshot",
  "sbomAndVulnerabilityReport",
  "thirdPartyNoticeBundle",
  "trellisModelPayloadBytesVerification"
]);
const forbiddenPublicLocatorKeys = /^(?:bucket|bucketName|credential|iamPrincipal|kmsId|kmsKeyId|objectKey|objectUrl|privateLocator)$/i;

export class DinoPayloadArtifactError extends Error {
  constructor(issues) {
    const uniqueIssues = [...new Set(issues)];
    super(`dino_payload_artifact_invalid:${uniqueIssues.join(",")}`);
    this.name = "DinoPayloadArtifactError";
    this.issues = uniqueIssues;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function requireExactKeys(value, expected, name, issues) {
  if (!isObject(value)) {
    issues.push(`${name}_invalid`);
    return;
  }
  if (!setEquals(new Set(Object.keys(value)), new Set(expected))) issues.push(`${name}_keys_invalid`);
}

function sortedUniqueStrings(value, name, issues) {
  const entries = Array.isArray(value) ? [...value] : [];
  if (!Array.isArray(value) || entries.some((entry) => typeof entry !== "string" || !entry)) {
    issues.push(`${name}_invalid`);
    return new Set();
  }
  const entrySet = new Set(entries);
  if (entrySet.size !== entries.length) issues.push(`${name}_duplicates`);
  if (entries.some((entry, index) => index > 0 && asciiCompare(entries[index - 1], entry) >= 0)) {
    issues.push(`${name}_not_ascii_sorted`);
  }
  return entrySet;
}

function safePublicPath(path) {
  return typeof path === "string"
    && path.length > 0
    && !isAbsolute(path)
    && !path.includes("\\")
    && !path.includes(":")
    && !path.includes("\0")
    && !path.startsWith("../")
    && !path.endsWith("/")
    && /^[\x20-\x7e]+$/.test(path)
    && posix.normalize(path) === path;
}

function hasTimestampKey(value) {
  if (Array.isArray(value)) return [...value].some(hasTimestampKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => (
    /(?:^asOf$|At$|Date$|Timestamp$)/.test(key) || hasTimestampKey(nested)
  ));
}

function collectForbiddenLocatorKeys(value, path = "lock", issues = []) {
  if (Array.isArray(value)) {
    [...value].forEach((entry, index) => collectForbiddenLocatorKeys(entry, `${path}:${index}`, issues));
    return issues;
  }
  if (!isObject(value)) return issues;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenPublicLocatorKeys.test(key)) issues.push(`private_locator_key_forbidden:${path}:${key}`);
    collectForbiddenLocatorKeys(nested, `${path}:${key}`, issues);
  }
  return issues;
}

function firstDuplicateJsonKey(text) {
  let index = 0;
  const skipWhitespace = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const scanString = () => {
    const start = index;
    index += 1;
    while (index < text.length) {
      if (text[index] === "\\") index += 2;
      else if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else index += 1;
    }
    return null;
  };
  const scanValue = () => {
    skipWhitespace();
    if (text[index] === '"') {
      scanString();
      return null;
    }
    if (text[index] === "{") {
      index += 1;
      skipWhitespace();
      const keys = new Set();
      if (text[index] === "}") {
        index += 1;
        return null;
      }
      while (index < text.length) {
        skipWhitespace();
        const key = scanString();
        if (keys.has(key)) return key;
        keys.add(key);
        skipWhitespace();
        index += 1;
        const duplicate = scanValue();
        if (duplicate !== null) return duplicate;
        skipWhitespace();
        if (text[index] === "}") {
          index += 1;
          return null;
        }
        index += 1;
      }
      return null;
    }
    if (text[index] === "[") {
      index += 1;
      skipWhitespace();
      if (text[index] === "]") {
        index += 1;
        return null;
      }
      while (index < text.length) {
        const duplicate = scanValue();
        if (duplicate !== null) return duplicate;
        skipWhitespace();
        if (text[index] === "]") {
          index += 1;
          return null;
        }
        index += 1;
      }
      return null;
    }
    const token = text.slice(index).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    index += token?.length ?? 0;
    return null;
  };
  return scanValue();
}

export function canonicalDinoPayloadLockDigest(lock) {
  const semantics = structuredClone(lock);
  delete semantics.lockSha256;
  return sha256(stableJson(semantics));
}

function validatePayload(lock, issues) {
  const payload = lock?.payload;
  requireExactKeys(payload, [
    "byteLength",
    "independentHashTools",
    "observedSha256",
    "publisherSha256",
    "representation"
  ], "payload", issues);
  if (payload?.representation !== "raw-opaque-pth-publisher-response-body") issues.push("payload_representation_invalid");
  if (!Number.isSafeInteger(payload?.byteLength) || payload.byteLength <= 0) issues.push("payload_byte_length_invalid");
  if (!/^[0-9a-f]{64}$/.test(payload?.observedSha256 ?? "")) issues.push("payload_observed_sha256_invalid");
  if (payload?.publisherSha256 !== null) issues.push("payload_publisher_sha256_must_be_null");
  const tools = sortedUniqueStrings(payload?.independentHashTools, "payload_hash_tools", issues);
  if (!setEquals(tools, new Set(["openssl", "sha256sum"]))) issues.push("payload_hash_tools_invalid");
}

function validateAcquisition(lock, issues) {
  const acquisition = lock?.acquisition;
  requireExactKeys(acquisition, ["get", "preAcquisitionHead"], "acquisition", issues);
  requireExactKeys(
    acquisition?.preAcquisitionHead,
    ["matchedSourceMetadataLockExactly", "method"],
    "pre_acquisition_head",
    issues
  );
  if (acquisition?.preAcquisitionHead?.method !== "HEAD") issues.push("pre_acquisition_head_method_invalid");
  if (acquisition?.preAcquisitionHead?.matchedSourceMetadataLockExactly !== true) {
    issues.push("pre_acquisition_head_match_invalid");
  }

  const get = acquisition?.get;
  requireExactKeys(get, [
    "absentHeaders",
    "acceptEncoding",
    "headers",
    "method",
    "rangeRequested",
    "redirectsFollowed",
    "responseBlockCount",
    "status"
  ], "acquisition_get", issues);
  if (get?.method !== "GET") issues.push("acquisition_get_method_invalid");
  if (get?.status !== 200) issues.push("acquisition_get_status_invalid");
  if (get?.redirectsFollowed !== 0) issues.push("acquisition_get_redirects_invalid");
  if (get?.rangeRequested !== false) issues.push("acquisition_get_range_claim_invalid");
  if (get?.acceptEncoding !== "identity") issues.push("acquisition_get_encoding_invalid");
  if (get?.responseBlockCount !== 1) issues.push("acquisition_get_response_block_count_invalid");
  requireExactKeys(get?.headers, Object.keys(expectedGetHeaders), "acquisition_get_headers", issues);
  for (const [name, expected] of Object.entries(expectedGetHeaders)) {
    const genericExpected = name === "content-length" && Number.isSafeInteger(lock?.payload?.byteLength)
      ? String(lock.payload.byteLength)
      : expected;
    if (get?.headers?.[name] !== genericExpected) issues.push(`acquisition_get_header_invalid:${name}`);
  }
  const absent = sortedUniqueStrings(get?.absentHeaders, "acquisition_get_absent_headers", issues);
  if (!setEquals(absent, new Set(expectedAbsentHeaders))) issues.push("acquisition_get_absent_headers_invalid");
  if (Number.isSafeInteger(lock?.payload?.byteLength)
    && get?.headers?.["content-length"] !== String(lock.payload.byteLength)) {
    issues.push("acquisition_get_content_length_mismatch");
  }
}

function validateRestrictedStorage(lock, issues) {
  const storage = lock?.restrictedStorage;
  requireExactKeys(storage, [
    "anonymousAccess",
    "bucketAclEntryCount",
    "contentAddress",
    "encryption",
    "evidenceScope",
    "fullReadback",
    "incompleteMultipartUploads",
    "knownLocalPayloadCopiesDeleted",
    "liveUnauthenticatedHttpStatus",
    "objectAcl",
    "operatorRecord",
    "retentionStatus",
    "staticKeyAuthEnabled",
    "versioningEnabled"
  ], "restricted_storage", issues);
  if (storage?.evidenceScope !== "operator-attested-point-in-time") issues.push("storage_evidence_scope_invalid");
  if (storage?.retentionStatus !== "operator-attested-retained-under-approved-policy") {
    issues.push("storage_retention_status_invalid");
  }
  requireExactKeys(storage?.contentAddress, ["algorithm", "digest"], "storage_content_address", issues);
  if (storage?.contentAddress?.algorithm !== "sha256") issues.push("storage_content_address_algorithm_invalid");
  if (storage?.contentAddress?.digest !== lock?.payload?.observedSha256) issues.push("storage_content_address_digest_mismatch");
  requireExactKeys(storage?.encryption, ["algorithm", "mode"], "storage_encryption", issues);
  if (storage?.encryption?.mode !== "SSE-KMS" || storage?.encryption?.algorithm !== "AES-256") {
    issues.push("storage_encryption_invalid");
  }
  if (storage?.versioningEnabled !== false) issues.push("storage_versioning_claim_invalid");
  if (storage?.objectAcl !== "owner-only") issues.push("storage_object_acl_invalid");
  if (storage?.bucketAclEntryCount !== 0) issues.push("storage_bucket_acl_invalid");
  if (storage?.staticKeyAuthEnabled !== false) issues.push("storage_static_key_auth_claim_invalid");
  requireExactKeys(storage?.anonymousAccess, ["configRead", "list", "read"], "storage_anonymous_access", issues);
  if (Object.values(storage?.anonymousAccess ?? {}).some((value) => value !== false)) {
    issues.push("storage_anonymous_access_must_be_false");
  }
  requireExactKeys(
    storage?.liveUnauthenticatedHttpStatus,
    ["configRead", "list", "read"],
    "storage_unauthenticated_status",
    issues
  );
  if (Object.values(storage?.liveUnauthenticatedHttpStatus ?? {}).some((value) => value !== 403)) {
    issues.push("storage_unauthenticated_status_invalid");
  }
  requireExactKeys(storage?.fullReadback, ["byteLength", "matchedPayloadIdentity", "sha256"], "storage_full_readback", issues);
  if (storage?.fullReadback?.byteLength !== lock?.payload?.byteLength
    || storage?.fullReadback?.sha256 !== lock?.payload?.observedSha256
    || storage?.fullReadback?.matchedPayloadIdentity !== true) {
    issues.push("storage_full_readback_mismatch");
  }
  if (storage?.incompleteMultipartUploads !== 0) issues.push("storage_incomplete_multipart_invalid");
  if (storage?.knownLocalPayloadCopiesDeleted !== true) issues.push("storage_local_copy_deletion_invalid");
  requireExactKeys(storage?.operatorRecord, [
    "fullReadbackVerified",
    "locatorPublished",
    "rawRecordSha256",
    "schemaVersion",
    "visibility"
  ], "storage_operator_record", issues);
  if (storage?.operatorRecord?.schemaVersion !== 2) issues.push("operator_record_schema_invalid");
  if (storage?.operatorRecord?.visibility !== "restricted-evidence-retention") issues.push("operator_record_visibility_invalid");
  if (!/^[0-9a-f]{64}$/.test(storage?.operatorRecord?.rawRecordSha256 ?? "")) issues.push("operator_record_digest_invalid");
  if (storage?.operatorRecord?.fullReadbackVerified !== true) issues.push("operator_record_readback_invalid");
  if (storage?.operatorRecord?.locatorPublished !== false) issues.push("operator_record_locator_claim_invalid");
}

function validateGates(lock, issues) {
  const resolved = sortedUniqueStrings(lock?.resolvedGates, "resolved_gates", issues);
  const openGates = sortedUniqueStrings(lock?.openGates, "open_gates", issues);
  for (const gate of resolved) {
    if (openGates.has(gate)) issues.push(`gate_both_open_and_resolved:${gate}`);
  }
  if (!setEquals(resolved, new Set(expectedResolvedGates))) issues.push("resolved_gate_set_invalid");
  if (!setEquals(openGates, new Set(expectedOpenGates))) issues.push("open_gate_set_invalid");
  requireExactKeys(lock?.gateEffect, [
    "directlyResolvedGates",
    "doesNotResolveNonIdentityGates",
    "mechanicallyResolvedCompositeGates"
  ], "gate_effect", issues);
  const direct = sortedUniqueStrings(lock?.gateEffect?.directlyResolvedGates, "directly_resolved_gates", issues);
  const mechanical = sortedUniqueStrings(
    lock?.gateEffect?.mechanicallyResolvedCompositeGates,
    "mechanically_resolved_composite_gates",
    issues
  );
  if (!setEquals(direct, new Set(["dinoArtifactPayloadBytesVerification"]))) issues.push("direct_gate_effect_invalid");
  if (!setEquals(mechanical, new Set(["dinoSourceAndArtifactLock"]))) issues.push("mechanical_gate_effect_invalid");
  if (lock?.gateEffect?.doesNotResolveNonIdentityGates !== true) issues.push("non_identity_gate_effect_invalid");
  requireExactKeys(lock?.gateComposition, ["dinoSourceAndArtifactLock"], "gate_composition", issues);
  const composition = lock?.gateComposition?.dinoSourceAndArtifactLock;
  requireExactKeys(composition, ["members", "operator"], "dino_gate_composition", issues);
  if (composition?.operator !== "allOf") issues.push("dino_gate_operator_invalid");
  if (stableJson(composition?.members) !== stableJson([
    "dinoSourceGitObjectLock",
    "dinoArtifactPayloadBytesVerification"
  ])) issues.push("dino_gate_members_invalid");
  if (Array.isArray(composition?.members)
    && !composition.members.every((member) => resolved.has(member))) {
    issues.push("dino_composite_member_not_resolved");
  }
  if (!resolved.has("dinoSourceAndArtifactLock")) issues.push("dino_composite_not_resolved");
  if (lock?.gateSnapshot !== "historical-at-dino-payload-bytes-lock") issues.push("gate_snapshot_invalid");
}

export function validateDinoPayloadArtifactLock(lock) {
  const issues = [];
  requireExactKeys(lock, [
    "acquisition",
    "boundaries",
    "gateComposition",
    "gateEffect",
    "gateSnapshot",
    "lockSha256",
    "normalCi",
    "openGates",
    "payload",
    "resolvedGates",
    "restrictedStorage",
    "schemaVersion",
    "sourceMetadataLock",
    "status"
  ], "lock", issues);
  if (lock?.schemaVersion !== 1) issues.push("schema_version_invalid");
  if (lock?.status !== lockStatus) issues.push("status_invalid");
  if (!/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "")) issues.push("lock_digest_invalid");
  if (hasTimestampKey(lock)) issues.push("timestamp_in_digested_lock");
  collectForbiddenLocatorKeys(lock, "lock", issues);

  requireExactKeys(
    lock?.sourceMetadataLock,
    ["lockSha256", "path", "publisherUrlTransitivelyBound"],
    "source_metadata_lock",
    issues
  );
  if (!safePublicPath(lock?.sourceMetadataLock?.path)) issues.push("source_metadata_lock_path_invalid");
  if (!/^[0-9a-f]{64}$/.test(lock?.sourceMetadataLock?.lockSha256 ?? "")) issues.push("source_metadata_lock_digest_invalid");
  if (lock?.sourceMetadataLock?.publisherUrlTransitivelyBound !== true) issues.push("publisher_url_transitive_binding_invalid");
  validatePayload(lock, issues);
  validateAcquisition(lock, issues);
  validateRestrictedStorage(lock, issues);

  requireExactKeys(
    lock?.normalCi,
    ["networkRequestInitiatedByVerifier", "payloadAccessAllowed", "restrictedOperatorRecordAccessAllowed", "scope"],
    "normal_ci",
    issues
  );
  if (lock?.normalCi?.scope !== normalCiScope) issues.push("normal_ci_scope_invalid");
  for (const field of ["networkRequestInitiatedByVerifier", "payloadAccessAllowed", "restrictedOperatorRecordAccessAllowed"]) {
    if (lock?.normalCi?.[field] !== false) issues.push(`normal_ci_boundary_must_be_false:${field}`);
  }
  requireExactKeys(lock?.boundaries, falseBoundaryFields, "boundaries", issues);
  for (const field of falseBoundaryFields) {
    if (lock?.boundaries?.[field] !== false) issues.push(`boundary_must_be_false:${field}`);
  }
  validateGates(lock, issues);
  if (/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "")
    && lock.lockSha256 !== canonicalDinoPayloadLockDigest(lock)) {
    issues.push("lock_digest_mismatch");
  }
  if (issues.length > 0) throw new DinoPayloadArtifactError(issues);
  return lock;
}

export function validateWmmrDinoPayloadArtifactContract(lock) {
  validateDinoPayloadArtifactLock(lock);
  const issues = [];
  if (lock.sourceMetadataLock.path !== sourceLockPath
    || lock.sourceMetadataLock.lockSha256 !== sourceLockSha256) {
    issues.push("unexpected_source_metadata_lock_reference");
  }
  if (lock.payload.byteLength !== payloadByteLength
    || lock.payload.observedSha256 !== payloadSha256
    || lock.payload.publisherSha256 !== null) {
    issues.push("unexpected_payload_identity");
  }
  if (stableJson(lock.acquisition.get.headers) !== stableJson(expectedGetHeaders)
    || stableJson(lock.acquisition.get.absentHeaders) !== stableJson(expectedAbsentHeaders)) {
    issues.push("unexpected_get_metadata");
  }
  if (lock.restrictedStorage.operatorRecord.rawRecordSha256 !== operatorRecordSha256) {
    issues.push("unexpected_operator_record_digest");
  }
  if (!setEquals(new Set(lock.resolvedGates), new Set(expectedResolvedGates))) issues.push("unexpected_resolved_gate_set");
  if (!setEquals(new Set(lock.openGates), new Set(expectedOpenGates))) issues.push("unexpected_open_gate_set");
  if (issues.length > 0) throw new DinoPayloadArtifactError(issues);
  return lock;
}

export function parseCanonicalDinoPayloadArtifactLock(text) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    throw new DinoPayloadArtifactError(["lock_json_invalid"]);
  }
  const duplicate = firstDuplicateJsonKey(text);
  if (duplicate !== null) throw new DinoPayloadArtifactError([`lock_json_duplicate_key:${duplicate}`]);
  if (`${JSON.stringify(lock, null, 2)}\n` !== text) {
    throw new DinoPayloadArtifactError(["lock_json_not_canonical"]);
  }
  return lock;
}

export async function loadWmmrDinoPayloadArtifactLock(path = defaultLockPath) {
  const resolvedPath = resolve(path);
  if (resolvedPath !== defaultLockPath) throw new DinoPayloadArtifactError(["unexpected_lock_path"]);
  let pathMetadata;
  try {
    pathMetadata = await lstat(resolvedPath, { bigint: true });
  } catch (error) {
    throw new DinoPayloadArtifactError([`lock_file_lstat_failed:${error?.code ?? "unknown"}`]);
  }
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile() || await realpath(resolvedPath) !== resolvedPath) {
    throw new DinoPayloadArtifactError(["lock_file_must_be_canonical_regular_file"]);
  }
  if (pathMetadata.size > BigInt(maxPublicLockBytes)) {
    throw new DinoPayloadArtifactError(["lock_file_too_large"]);
  }
  let handle;
  let text;
  try {
    handle = await open(
      resolvedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    );
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.dev !== pathMetadata.dev || metadata.ino !== pathMetadata.ino) {
      throw new DinoPayloadArtifactError(["lock_file_changed_before_read"]);
    }
    if (metadata.size > BigInt(maxPublicLockBytes)) throw new DinoPayloadArtifactError(["lock_file_too_large"]);
    const bytes = Buffer.allocUnsafe(Number(metadata.size));
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, null);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    const extra = Buffer.allocUnsafe(1);
    const { bytesRead: extraBytesRead } = await handle.read(extra, 0, 1, null);
    const after = await handle.stat({ bigint: true });
    let currentPathMetadata;
    let currentCanonicalPath;
    try {
      currentPathMetadata = await lstat(resolvedPath, { bigint: true });
      currentCanonicalPath = await realpath(resolvedPath);
    } catch {
      throw new DinoPayloadArtifactError(["lock_file_path_changed_during_read"]);
    }
    if (offset !== bytes.length
      || extraBytesRead !== 0
      || after.dev !== metadata.dev
      || after.ino !== metadata.ino
      || after.size !== metadata.size
      || after.mtimeNs !== metadata.mtimeNs
      || after.ctimeNs !== metadata.ctimeNs
      || currentPathMetadata.isSymbolicLink()
      || !currentPathMetadata.isFile()
      || currentPathMetadata.dev !== metadata.dev
      || currentPathMetadata.ino !== metadata.ino
      || currentCanonicalPath !== resolvedPath) {
      throw new DinoPayloadArtifactError(["lock_file_changed_during_read"]);
    }
    text = bytes.toString("utf8");
  } finally {
    await handle?.close();
  }
  const lock = validateWmmrDinoPayloadArtifactContract(
    parseCanonicalDinoPayloadArtifactLock(text)
  );
  const sourceLock = await loadWmmrDinoSourceArtifactLock(resolve(repositoryRoot, lock.sourceMetadataLock.path));
  if (sourceLock.lockSha256 !== lock.sourceMetadataLock.lockSha256) {
    throw new DinoPayloadArtifactError(["source_metadata_lock_digest_mismatch"]);
  }
  if (sourceLock.publisherArtifact.url.length === 0
    || sourceLock.publisherArtifact.head.headers["content-length"] !== lock.acquisition.get.headers["content-length"]
    || stableJson(sourceLock.publisherArtifact.head.headers) !== stableJson(lock.acquisition.get.headers)) {
    throw new DinoPayloadArtifactError(["get_metadata_source_lock_mismatch"]);
  }
  return lock;
}

function payloadFileIssue(code) {
  return new DinoPayloadArtifactError([code]);
}

export async function verifyDinoPayloadFile(lock, payloadPath) {
  validateDinoPayloadArtifactLock(lock);
  if (typeof payloadPath !== "string" || payloadPath.length === 0 || payloadPath.includes("\0")) {
    throw payloadFileIssue("payload_file_path_invalid");
  }
  const path = resolve(payloadPath);
  let pathMetadata;
  try {
    pathMetadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw payloadFileIssue(`payload_file_lstat_failed:${error?.code ?? "unknown"}`);
  }
  if (pathMetadata.isSymbolicLink()) throw payloadFileIssue("payload_file_symlink_forbidden");
  if (!pathMetadata.isFile()) throw payloadFileIssue("payload_file_not_regular");
  let canonicalPath;
  try {
    canonicalPath = await realpath(path);
  } catch (error) {
    throw payloadFileIssue(`payload_file_realpath_failed:${error?.code ?? "unknown"}`);
  }
  if (canonicalPath !== path) throw payloadFileIssue("payload_file_symlinked_path_forbidden");
  const expectedSize = BigInt(lock.payload.byteLength);
  if (pathMetadata.size > expectedSize) throw payloadFileIssue("payload_file_too_large");
  if (pathMetadata.size < expectedSize) throw payloadFileIssue("payload_file_too_small");

  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    );
  } catch (error) {
    if (error?.code === "ELOOP") throw payloadFileIssue("payload_file_symlink_forbidden");
    throw payloadFileIssue(`payload_file_open_failed:${error?.code ?? "unknown"}`);
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw payloadFileIssue("payload_file_not_regular");
    if (before.dev !== pathMetadata.dev || before.ino !== pathMetadata.ino) {
      throw payloadFileIssue("payload_file_changed_before_read");
    }
    if (before.size > expectedSize) throw payloadFileIssue("payload_file_too_large");
    if (before.size < expectedSize) throw payloadFileIssue("payload_file_too_small");
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let total = 0n;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      total += BigInt(bytesRead);
      if (total > expectedSize) throw payloadFileIssue("payload_file_too_large");
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (total < expectedSize) throw payloadFileIssue("payload_file_too_small");
    const observedSha256 = hash.digest("hex");
    if (observedSha256 !== lock.payload.observedSha256) throw payloadFileIssue("payload_file_sha256_mismatch");
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs) {
      throw payloadFileIssue("payload_file_changed_during_read");
    }
    let currentPathMetadata;
    let currentCanonicalPath;
    try {
      currentPathMetadata = await lstat(path, { bigint: true });
      currentCanonicalPath = await realpath(path);
    } catch {
      throw payloadFileIssue("payload_file_path_changed_during_read");
    }
    if (currentPathMetadata.isSymbolicLink()
      || !currentPathMetadata.isFile()
      || currentCanonicalPath !== canonicalPath
      || currentPathMetadata.dev !== before.dev
      || currentPathMetadata.ino !== before.ino) {
      throw payloadFileIssue("payload_file_path_changed_during_read");
    }
    return {
      schemaVersion: 1,
      status: "raw-payload-file-byte-identity-verified-no-deserialization",
      byteLength: Number(total),
      observedSha256,
      publisherSha256: null,
      deserialized: false,
      pthInspected: false,
      runtimeExecuted: false,
      networkRequestInitiatedByVerifier: false,
      generationAllowed: false
    };
  } finally {
    await handle.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const lockOnly = args.length === 1 && args[0] === "--lock-only";
  const payloadMode = args.length === 2 && args[0] === "--payload" && Boolean(args[1]);
  if (!lockOnly && !payloadMode) {
    throw new DinoPayloadArtifactError(["cli_arguments_invalid"]);
  }
  const lock = await loadWmmrDinoPayloadArtifactLock();
  const result = lockOnly
    ? {
        schemaVersion: 1,
        status: "canonical-public-lock-verified-without-payload-read",
        lockSha256: lock.lockSha256,
        normalCiScope: lock.normalCi.scope,
        payloadFileRead: false,
        restrictedOperatorRecordRead: false,
        networkRequestInitiatedByVerifier: false
      }
    : await verifyDinoPayloadFile(lock, args[1]);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

let invokedAsMain = false;
if (process.argv[1]) {
  try {
    invokedAsMain = await realpath(process.argv[1]) === await realpath(fileURLToPath(import.meta.url));
  } catch {
    invokedAsMain = false;
  }
}

if (invokedAsMain) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
