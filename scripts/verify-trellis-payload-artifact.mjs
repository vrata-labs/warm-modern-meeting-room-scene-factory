import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, opendir, realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseCanonicalModelArtifactLock,
  stableJson,
  validateWmmrModelArtifactContract
} from "./verify-trellis-model-artifact.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const defaultLockPath = resolve(
  repositoryRoot,
  "experiment/warm-modern-meeting-room/trellis-payload-bytes-lock.json"
);
const modelLockPath = "experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json";
const defaultModelLockPath = resolve(repositoryRoot, modelLockPath);
const modelLockSha256 = "d0046a083406c02dd67fd508b917750bc52f8e893527b4e39fa71abda0a6baa9";
const payloadLockSha256 = "d140f277f756f845aa8ad5d83960fb1bb70d640dcb7aa2c43460901f6ab8839d";
const publisherRepository = "https://huggingface.co/microsoft/TRELLIS-image-large";
const publisherCommit = "25e0d31ffbebe4b5a97464dd851910efc3002d96";
const operatorRecordSha256 = "33f033da362875c9332613183ac8398ef886b7b7c0de768a739f71167e1306ab";
const lockStatus = "selected-raw-publisher-payload-identity-verified-restricted-retained-runtime-and-rights-blocked";
const normalCiScope = "canonical-public-lock-and-historical-relationship-only/no-payload-or-restricted-record-access";
const totalByteLength = 2664021360;
const maxPublicLockBytes = 1024 * 1024;
const payloadBufferBytes = 1024 * 1024;
const expectedPayloads = Object.freeze([
  {
    id: "slat_dec_mesh_swin8_B_64l8m256c_fp16",
    path: "ckpts/slat_dec_mesh_swin8_B_64l8m256c_fp16.safetensors",
    byteLength: 181903412,
    sha256: "3e87aba94b5786407eb06d0502c1ed0885a0027a3f2b8537bfe15b0a92c01859",
    etag: "\"90cbb9469e3bb19934ab40a8cec5331b88323c0636b89139383b632d396503cb\""
  },
  {
    id: "slat_flow_img_dit_L_64l8p2_fp16",
    path: "ckpts/slat_flow_img_dit_L_64l8p2_fp16.safetensors",
    byteLength: 1203755136,
    sha256: "693fb2a58ad497bd222007301eeec49d14d60f8c12d2f2f00c221fa747b4c66c",
    etag: "\"48327f38cd327356fd2fe0a413429b8f9dfc7cc1a9ca4564b2ec9291c73bfb76\""
  },
  {
    id: "ss_dec_conv3d_16l8_fp16",
    path: "ckpts/ss_dec_conv3d_16l8_fp16.safetensors",
    byteLength: 147591972,
    sha256: "1c76d4a40519aa2d711cc263a8404105231ac26db31d946bed48b84fee79009a",
    etag: "\"6ac386147a7d3c547af80d0f813e4d4a380e514ac0c1e3a9096ae60c94a497e1\""
  },
  {
    id: "ss_flow_img_dit_L_16l8_fp16",
    path: "ckpts/ss_flow_img_dit_L_16l8_fp16.safetensors",
    byteLength: 1130770840,
    sha256: "96dc6bfd4136fd950af564dd16b4ae533c9ba6af8f26c670646b2a9f2789b1db",
    etag: "\"2235ba5568195f3ac0ef7eb16f46e596a6a93c5cdf409004130a50cc1f032126\""
  }
]);
const falseBoundaryFields = Object.freeze([
  "deserialized",
  "generationAllowed",
  "humanSignoff",
  "modelCompatibilityTested",
  "modelInputUsed",
  "payloadBytesIncludedInPublicRepository",
  "payloadReadInNormalCi",
  "privateLocatorPublished",
  "restrictedOperatorRecordReadInNormalCi",
  "rightsApproved",
  "runtimeExecuted",
  "safetensorsParsed",
  "tensorEquivalenceTested"
]);
const expectedResolvedGates = Object.freeze([
  "dinoArtifactPayloadBytesVerification",
  "dinoSourceAndArtifactLock",
  "dinoSourceGitObjectLock",
  "patchedSourceTreeDigest",
  "trellisModelArtifactLock",
  "trellisModelPayloadBytesVerification"
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
  "thirdPartyNoticeBundle"
]);
const forbiddenPublicLocatorKeys = /^(?:accessKeyId|bucket|bucketId|bucketName|credential|endpoint|iamPrincipal|kmsId|kmsKeyId|objectKey|objectUrl|principal|privateLocator|resource|resourceId|resourceLocator|secretAccessKey)$/i;

export class TrellisPayloadArtifactError extends Error {
  constructor(issues) {
    const uniqueIssues = [...new Set(issues)];
    super(`trellis_payload_artifact_invalid:${uniqueIssues.join(",")}`);
    this.name = "TrellisPayloadArtifactError";
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

function isDenseArray(value) {
  return Array.isArray(value)
    && Object.keys(value).length === value.length
    && Object.keys(value).every((key, index) => key === String(index));
}

function requireExactKeys(value, expected, name, issues) {
  if (!isObject(value)) {
    issues.push(`${name}_invalid`);
    return;
  }
  if (!setEquals(new Set(Object.keys(value)), new Set(expected))) issues.push(`${name}_keys_invalid`);
}

function sortedUniqueStrings(value, name, issues) {
  if (!isDenseArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
    issues.push(`${name}_invalid`);
    return new Set();
  }
  const entries = new Set(value);
  if (entries.size !== value.length) issues.push(`${name}_duplicates`);
  if (value.some((entry, index) => index > 0 && asciiCompare(value[index - 1], entry) >= 0)) {
    issues.push(`${name}_not_ascii_sorted`);
  }
  return entries;
}

function safePublicPath(path) {
  return typeof path === "string"
    && path.length > 0
    && path !== "."
    && path !== ".."
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

export function canonicalTrellisPayloadLockDigest(lock) {
  const semantics = structuredClone(lock);
  delete semantics.lockSha256;
  return sha256(stableJson(semantics));
}

function validateModelArtifactReference(lock, issues) {
  const reference = lock?.modelArtifactLock;
  requireExactKeys(reference, [
    "lockSha256",
    "path",
    "publisherCommit",
    "publisherRepository",
    "selectedPayloadPointersTransitivelyBound"
  ], "model_artifact_lock", issues);
  if (!safePublicPath(reference?.path)) issues.push("model_artifact_lock_path_invalid");
  if (!/^[0-9a-f]{64}$/.test(reference?.lockSha256 ?? "")) issues.push("model_artifact_lock_digest_invalid");
  if (typeof reference?.publisherRepository !== "string" || !reference.publisherRepository.startsWith("https://")) {
    issues.push("publisher_repository_invalid");
  }
  if (!/^[0-9a-f]{40}$/.test(reference?.publisherCommit ?? "")) issues.push("publisher_commit_invalid");
  if (reference?.selectedPayloadPointersTransitivelyBound !== true) {
    issues.push("selected_payload_pointer_binding_invalid");
  }
}

function validatePayloadRecord(payload, previousId, pinnedCommit, issues) {
  requireExactKeys(payload, [
    "acquisition",
    "byteLength",
    "hashesMatch",
    "id",
    "observedSha256",
    "path",
    "publisherLfsOidSha256",
    "restrictedStorageReadback"
  ], `payload:${payload?.id ?? "missing"}`, issues);
  const id = payload?.id ?? "missing";
  if (typeof payload?.id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(payload.id)) issues.push(`payload_id_invalid:${id}`);
  if (previousId !== null && asciiCompare(previousId, payload?.id) >= 0) issues.push("payloads_not_ascii_sorted");
  if (!safePublicPath(payload?.path) || !payload.path.startsWith("ckpts/") || !payload.path.endsWith(".safetensors")) {
    issues.push(`payload_path_invalid:${id}`);
  }
  if (basename(payload?.path ?? "") !== `${payload?.id}.safetensors`) issues.push(`payload_id_path_mismatch:${id}`);
  if (!Number.isSafeInteger(payload?.byteLength) || payload.byteLength <= 0) issues.push(`payload_byte_length_invalid:${id}`);
  if (!/^[0-9a-f]{64}$/.test(payload?.publisherLfsOidSha256 ?? "")) issues.push(`publisher_lfs_oid_invalid:${id}`);
  if (!/^[0-9a-f]{64}$/.test(payload?.observedSha256 ?? "")) issues.push(`payload_observed_sha256_invalid:${id}`);
  if (payload?.publisherLfsOidSha256 !== payload?.observedSha256 || payload?.hashesMatch !== true) {
    issues.push(`publisher_observed_hash_mismatch:${id}`);
  }

  const acquisition = payload?.acquisition;
  requireExactKeys(acquisition, [
    "acceptEncoding",
    "finalResponse",
    "initialResponse",
    "method",
    "pinnedResolvePath",
    "rangeRequested",
    "redirectsFollowed",
    "responseStatuses"
  ], `payload_acquisition:${id}`, issues);
  if (acquisition?.method !== "GET") issues.push(`payload_get_method_invalid:${id}`);
  if (acquisition?.pinnedResolvePath !== `resolve/${pinnedCommit}/${payload?.path}`) {
    issues.push(`payload_pinned_resolve_path_invalid:${id}`);
  }
  if (!safePublicPath(acquisition?.pinnedResolvePath)) issues.push(`payload_pinned_resolve_path_unsafe:${id}`);
  if (acquisition?.acceptEncoding !== "identity") issues.push(`payload_accept_encoding_invalid:${id}`);
  if (acquisition?.rangeRequested !== false) issues.push(`payload_range_request_invalid:${id}`);
  if (acquisition?.redirectsFollowed !== 1) issues.push(`payload_redirect_count_invalid:${id}`);
  if (!isDenseArray(acquisition?.responseStatuses)
    || stableJson(acquisition.responseStatuses) !== stableJson([302, 200])) {
    issues.push(`payload_response_statuses_invalid:${id}`);
  }
  const initialResponse = acquisition?.initialResponse;
  requireExactKeys(initialResponse, ["headers", "status"], `payload_initial_response:${id}`, issues);
  if (initialResponse?.status !== 302) issues.push(`payload_initial_status_invalid:${id}`);
  requireExactKeys(
    initialResponse?.headers,
    ["x-linked-etag", "x-linked-size"],
    `payload_initial_response_headers:${id}`,
    issues
  );
  if (initialResponse?.headers?.["x-linked-size"] !== String(payload?.byteLength)) {
    issues.push(`payload_initial_linked_size_mismatch:${id}`);
  }
  if (initialResponse?.headers?.["x-linked-etag"] !== `"${payload?.publisherLfsOidSha256}"`) {
    issues.push(`payload_initial_linked_etag_mismatch:${id}`);
  }
  const finalResponse = acquisition?.finalResponse;
  requireExactKeys(finalResponse, [
    "acceptRanges",
    "contentLength",
    "contentType",
    "etag",
    "status"
  ], `payload_final_response:${id}`, issues);
  if (finalResponse?.status !== 200) issues.push(`payload_final_status_invalid:${id}`);
  if (finalResponse?.contentType !== "application/octet-stream") issues.push(`payload_content_type_invalid:${id}`);
  if (finalResponse?.acceptRanges !== "bytes") issues.push(`payload_accept_ranges_invalid:${id}`);
  if (finalResponse?.contentLength !== String(payload?.byteLength)) issues.push(`payload_content_length_mismatch:${id}`);
  if (!/^"[0-9a-f]{64}"$/.test(finalResponse?.etag ?? "")) issues.push(`payload_etag_invalid:${id}`);

  const readback = payload?.restrictedStorageReadback;
  requireExactKeys(readback, [
    "byteLength",
    "contentAddress",
    "matchedPayloadIdentity",
    "sha256"
  ], `payload_storage_readback:${id}`, issues);
  requireExactKeys(readback?.contentAddress, ["algorithm", "digest"], `payload_content_address:${id}`, issues);
  if (readback?.contentAddress?.algorithm !== "sha256") issues.push(`payload_content_address_algorithm_invalid:${id}`);
  if (readback?.contentAddress?.digest !== payload?.observedSha256
    || readback?.byteLength !== payload?.byteLength
    || readback?.sha256 !== payload?.observedSha256
    || readback?.matchedPayloadIdentity !== true) {
    issues.push(`payload_storage_readback_mismatch:${id}`);
  }
}

function validatePayloadSet(lock, issues) {
  const payloadSet = lock?.payloadSet;
  requireExactKeys(payloadSet, [
    "count",
    "independentHashTools",
    "payloads",
    "representation",
    "totalByteLength"
  ], "payload_set", issues);
  if (payloadSet?.representation !== "raw-opaque-safetensors-publisher-response-bodies") {
    issues.push("payload_set_representation_invalid");
  }
  const tools = sortedUniqueStrings(payloadSet?.independentHashTools, "payload_hash_tools", issues);
  if (!setEquals(tools, new Set(["openssl", "sha256sum"]))) issues.push("payload_hash_tools_invalid");
  if (!isDenseArray(payloadSet?.payloads) || payloadSet.payloads.length === 0) {
    issues.push("payload_records_invalid");
    return;
  }
  const ids = new Set();
  const paths = new Set();
  let total = 0n;
  let previousId = null;
  for (const payload of payloadSet.payloads) {
    if (!isObject(payload)) {
      issues.push("payload_record_not_object");
      continue;
    }
    validatePayloadRecord(payload, previousId, lock?.modelArtifactLock?.publisherCommit, issues);
    previousId = payload.id;
    if (ids.has(payload.id)) issues.push(`payload_id_duplicate:${payload.id}`);
    if (paths.has(payload.path)) issues.push(`payload_path_duplicate:${payload.path}`);
    ids.add(payload.id);
    paths.add(payload.path);
    if (Number.isSafeInteger(payload.byteLength) && payload.byteLength > 0) total += BigInt(payload.byteLength);
  }
  if (payloadSet.count !== payloadSet.payloads.length) issues.push("payload_count_mismatch");
  if (!Number.isSafeInteger(payloadSet.totalByteLength) || payloadSet.totalByteLength <= 0) {
    issues.push("payload_total_byte_length_invalid");
  } else if (BigInt(payloadSet.totalByteLength) !== total) {
    issues.push("payload_total_byte_length_mismatch");
  }
}

function validateRestrictedStorage(lock, issues) {
  const storage = lock?.restrictedStorage;
  requireExactKeys(storage, [
    "anonymousAccess",
    "bucketAclGrantsBeyondOwner",
    "contentAddressedObjectCount",
    "continuingPublicProof",
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
  if (storage?.continuingPublicProof !== false) issues.push("storage_continuing_proof_claim_invalid");
  if (storage?.retentionStatus !== "operator-attested-retained-at-record-time") issues.push("storage_retention_status_invalid");
  if (storage?.contentAddressedObjectCount !== lock?.payloadSet?.count) issues.push("storage_object_count_mismatch");
  requireExactKeys(storage?.encryption, ["algorithm", "mode"], "storage_encryption", issues);
  if (storage?.encryption?.mode !== "SSE-KMS" || storage?.encryption?.algorithm !== "AES-256") {
    issues.push("storage_encryption_invalid");
  }
  if (storage?.versioningEnabled !== false) issues.push("storage_versioning_claim_invalid");
  if (storage?.objectAcl !== "owner-only") issues.push("storage_object_acl_invalid");
  if (storage?.bucketAclGrantsBeyondOwner !== 0) issues.push("storage_bucket_acl_invalid");
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
  requireExactKeys(
    storage?.fullReadback,
    ["everyObjectMatchedPayloadIdentity", "objectCount", "totalByteLength"],
    "storage_full_readback",
    issues
  );
  if (storage?.fullReadback?.objectCount !== lock?.payloadSet?.count
    || storage?.fullReadback?.totalByteLength !== lock?.payloadSet?.totalByteLength
    || storage?.fullReadback?.everyObjectMatchedPayloadIdentity !== true) {
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
  if (storage?.operatorRecord?.schemaVersion !== 3) issues.push("operator_record_schema_invalid");
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
    "doesNotResolveCompositeGates",
    "doesNotResolveNonIdentityGates"
  ], "gate_effect", issues);
  const direct = sortedUniqueStrings(lock?.gateEffect?.directlyResolvedGates, "directly_resolved_gates", issues);
  if (!setEquals(direct, new Set(["trellisModelPayloadBytesVerification"]))) issues.push("direct_gate_effect_invalid");
  if (lock?.gateEffect?.doesNotResolveCompositeGates !== true) issues.push("composite_gate_effect_invalid");
  if (lock?.gateEffect?.doesNotResolveNonIdentityGates !== true) issues.push("non_identity_gate_effect_invalid");
  if (lock?.gateSnapshot !== "historical-at-trellis-payload-bytes-lock") issues.push("gate_snapshot_invalid");
}

export function validateTrellisPayloadArtifactLock(lock) {
  const issues = [];
  requireExactKeys(lock, [
    "boundaries",
    "gateEffect",
    "gateSnapshot",
    "lockSha256",
    "modelArtifactLock",
    "normalCi",
    "openGates",
    "payloadSet",
    "resolvedGates",
    "restrictedStorage",
    "schemaVersion",
    "status"
  ], "lock", issues);
  if (lock?.schemaVersion !== 1) issues.push("schema_version_invalid");
  if (lock?.status !== lockStatus) issues.push("status_invalid");
  if (!/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "")) issues.push("lock_digest_invalid");
  if (hasTimestampKey(lock)) issues.push("timestamp_in_digested_lock");
  collectForbiddenLocatorKeys(lock, "lock", issues);
  validateModelArtifactReference(lock, issues);
  validatePayloadSet(lock, issues);
  validateRestrictedStorage(lock, issues);
  requireExactKeys(lock?.normalCi, [
    "networkFallbackAllowedByVerifier",
    "networkRequestInitiatedByVerifier",
    "payloadAccessAllowed",
    "realPayloadHashesReproducible",
    "restrictedOperatorRecordAccessAllowed",
    "scope",
    "streamingVerificationCoverage"
  ], "normal_ci", issues);
  if (lock?.normalCi?.scope !== normalCiScope) issues.push("normal_ci_scope_invalid");
  for (const field of [
    "networkFallbackAllowedByVerifier",
    "networkRequestInitiatedByVerifier",
    "payloadAccessAllowed",
    "realPayloadHashesReproducible",
    "restrictedOperatorRecordAccessAllowed"
  ]) {
    if (lock?.normalCi?.[field] !== false) issues.push(`normal_ci_boundary_must_be_false:${field}`);
  }
  if (lock?.normalCi?.streamingVerificationCoverage !== "synthetic-fixtures-only") {
    issues.push("normal_ci_streaming_coverage_invalid");
  }
  requireExactKeys(lock?.boundaries, falseBoundaryFields, "boundaries", issues);
  for (const field of falseBoundaryFields) {
    if (lock?.boundaries?.[field] !== false) issues.push(`boundary_must_be_false:${field}`);
  }
  validateGates(lock, issues);
  if (/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "")
    && lock.lockSha256 !== canonicalTrellisPayloadLockDigest(lock)) {
    issues.push("lock_digest_mismatch");
  }
  if (issues.length > 0) throw new TrellisPayloadArtifactError(issues);
  return lock;
}

export function validateWmmrTrellisPayloadArtifactContract(lock) {
  validateTrellisPayloadArtifactLock(lock);
  const issues = [];
  if (lock.lockSha256 !== payloadLockSha256) issues.push("unexpected_lock_digest");
  if (lock.modelArtifactLock.path !== modelLockPath
    || lock.modelArtifactLock.lockSha256 !== modelLockSha256
    || lock.modelArtifactLock.publisherRepository !== publisherRepository
    || lock.modelArtifactLock.publisherCommit !== publisherCommit) {
    issues.push("unexpected_model_artifact_lock_reference");
  }
  if (lock.payloadSet.count !== expectedPayloads.length || lock.payloadSet.totalByteLength !== totalByteLength) {
    issues.push("unexpected_payload_summary");
  }
  if (lock.payloadSet.payloads.length === expectedPayloads.length) {
    for (const [index, expected] of expectedPayloads.entries()) {
      const payload = lock.payloadSet.payloads[index];
      if (payload.id !== expected.id
        || payload.path !== expected.path
        || payload.byteLength !== expected.byteLength
        || payload.publisherLfsOidSha256 !== expected.sha256
        || payload.observedSha256 !== expected.sha256
        || payload.acquisition.finalResponse.etag !== expected.etag) {
        issues.push(`unexpected_payload_identity:${expected.id}`);
      }
    }
  }
  if (lock.restrictedStorage.operatorRecord.rawRecordSha256 !== operatorRecordSha256) {
    issues.push("unexpected_operator_record_digest");
  }
  if (!setEquals(new Set(lock.resolvedGates), new Set(expectedResolvedGates))) issues.push("unexpected_resolved_gate_set");
  if (!setEquals(new Set(lock.openGates), new Set(expectedOpenGates))) issues.push("unexpected_open_gate_set");
  if (issues.length > 0) throw new TrellisPayloadArtifactError(issues);
  return lock;
}

export function parseCanonicalTrellisPayloadArtifactLock(text) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    throw new TrellisPayloadArtifactError(["lock_json_invalid"]);
  }
  const duplicate = firstDuplicateJsonKey(text);
  if (duplicate !== null) throw new TrellisPayloadArtifactError([`lock_json_duplicate_key:${duplicate}`]);
  if (`${JSON.stringify(lock, null, 2)}\n` !== text) {
    throw new TrellisPayloadArtifactError(["lock_json_not_canonical"]);
  }
  return lock;
}

async function readBoundedCanonicalLock(path, expectedPath, label) {
  const resolvedPath = resolve(path);
  if (resolvedPath !== expectedPath) throw new TrellisPayloadArtifactError([`unexpected_${label}_path`]);
  let pathMetadata;
  try {
    pathMetadata = await lstat(resolvedPath, { bigint: true });
  } catch (error) {
    throw new TrellisPayloadArtifactError([`${label}_lstat_failed:${error?.code ?? "unknown"}`]);
  }
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile() || await realpath(resolvedPath) !== resolvedPath) {
    throw new TrellisPayloadArtifactError([`${label}_must_be_canonical_regular_file`]);
  }
  if (pathMetadata.size > BigInt(maxPublicLockBytes)) throw new TrellisPayloadArtifactError([`${label}_too_large`]);
  let handle;
  try {
    handle = await open(
      resolvedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== pathMetadata.dev || before.ino !== pathMetadata.ino) {
      throw new TrellisPayloadArtifactError([`${label}_changed_before_read`]);
    }
    if (before.size > BigInt(maxPublicLockBytes)) throw new TrellisPayloadArtifactError([`${label}_too_large`]);
    const bytes = Buffer.allocUnsafe(Number(before.size));
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
      throw new TrellisPayloadArtifactError([`${label}_path_changed_during_read`]);
    }
    if (offset !== bytes.length
      || extraBytesRead !== 0
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs
      || currentPathMetadata.isSymbolicLink()
      || !currentPathMetadata.isFile()
      || currentPathMetadata.dev !== before.dev
      || currentPathMetadata.ino !== before.ino
      || currentCanonicalPath !== resolvedPath) {
      throw new TrellisPayloadArtifactError([`${label}_changed_during_read`]);
    }
    return bytes.toString("utf8");
  } finally {
    await handle?.close();
  }
}

export async function loadWmmrTrellisPayloadArtifactLock(path = defaultLockPath) {
  const lock = validateWmmrTrellisPayloadArtifactContract(
    parseCanonicalTrellisPayloadArtifactLock(
      await readBoundedCanonicalLock(path, defaultLockPath, "payload_lock_file")
    )
  );
  const historicalText = await readBoundedCanonicalLock(
    resolve(repositoryRoot, lock.modelArtifactLock.path),
    defaultModelLockPath,
    "model_lock_file"
  );
  const historical = validateWmmrModelArtifactContract(parseCanonicalModelArtifactLock(historicalText));
  const issues = [];
  if (historical.lockSha256 !== lock.modelArtifactLock.lockSha256
    || historical.source.repository !== lock.modelArtifactLock.publisherRepository
    || historical.source.commit !== lock.modelArtifactLock.publisherCommit) {
    issues.push("historical_model_lock_reference_mismatch");
  }
  const historicalPayloads = historical.selectedPayloads.payloads.map((payload) => ({
    id: payload.id,
    path: payload.path,
    byteLength: payload.payloadSize,
    publisherLfsOidSha256: payload.oidSha256
  }));
  const currentPointers = lock.payloadSet.payloads.map((payload) => ({
    id: payload.id,
    path: payload.path,
    byteLength: payload.byteLength,
    publisherLfsOidSha256: payload.publisherLfsOidSha256
  }));
  if (stableJson(historicalPayloads) !== stableJson(currentPointers)) {
    issues.push("historical_selected_payload_pointer_mismatch");
  }
  if (issues.length > 0) throw new TrellisPayloadArtifactError(issues);
  return lock;
}

function payloadIssue(code) {
  return new TrellisPayloadArtifactError([code]);
}

function descriptorPath(directory, entry = null) {
  if (process.platform !== "linux"
    || !Number.isInteger(directory?.handle?.fd)
    || directory.handle.fd < 0) {
    throw payloadIssue("descriptor_relative_access_unavailable");
  }
  if (entry !== null && (typeof entry !== "string" || !/^[A-Za-z0-9_.-]+$/.test(entry))) {
    throw payloadIssue("descriptor_relative_entry_invalid");
  }
  return entry === null
    ? `/proc/self/fd/${directory.handle.fd}`
    : `/proc/self/fd/${directory.handle.fd}/${entry}`;
}

async function assertDescriptorTarget(directory) {
  let current;
  try {
    current = await stat(descriptorPath(directory), { bigint: true });
  } catch {
    throw payloadIssue("descriptor_relative_access_unavailable");
  }
  if (!current.isDirectory()
    || current.dev !== directory.before.dev
    || current.ino !== directory.before.ino) {
    throw payloadIssue(`${directory.label}_descriptor_changed`);
  }
}

async function boundedDirectoryEntries(directory, expectedNames) {
  await assertDescriptorTarget(directory);
  const expected = new Set(expectedNames);
  const names = new Set();
  let iterator;
  try {
    iterator = await opendir(descriptorPath(directory));
    for (let count = 0; count < expectedNames.length + 1; count += 1) {
      const entry = await iterator.read();
      if (entry === null) break;
      if (!expected.has(entry.name) || names.has(entry.name)) {
        throw payloadIssue("payload_selection_extra");
      }
      names.add(entry.name);
      if (count === expectedNames.length) throw payloadIssue("payload_selection_extra");
    }
  } catch (error) {
    if (error instanceof TrellisPayloadArtifactError) throw error;
    throw payloadIssue("descriptor_relative_access_unavailable");
  } finally {
    try {
      await iterator?.close();
    } catch (error) {
      if (error?.code !== "ERR_DIR_CLOSED") throw error;
    }
  }
  for (const name of expectedNames) {
    if (!names.has(name)) throw payloadIssue(`payload_selection_missing:${directory.label}`);
  }
}

async function openCanonicalDirectory(path, label) {
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw payloadIssue(`${label}_lstat_failed:${error?.code ?? "unknown"}`);
  }
  if (metadata.isSymbolicLink()) throw payloadIssue(`${label}_symlink_forbidden`);
  if (!metadata.isDirectory()) throw payloadIssue(`${label}_not_directory`);
  let canonicalPath;
  try {
    canonicalPath = await realpath(path);
  } catch (error) {
    throw payloadIssue(`${label}_realpath_failed:${error?.code ?? "unknown"}`);
  }
  if (canonicalPath !== path) throw payloadIssue(`${label}_symlinked_path_forbidden`);
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0)
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isDirectory() || before.dev !== metadata.dev || before.ino !== metadata.ino) {
      throw payloadIssue(`${label}_changed_before_read`);
    }
    const directory = { path, label, handle, before, parent: null, entry: null };
    await assertDescriptorTarget(directory);
    return directory;
  } catch (error) {
    await handle?.close();
    if (error instanceof TrellisPayloadArtifactError) throw error;
    if (error?.code === "ELOOP") throw payloadIssue(`${label}_symlink_forbidden`);
    throw payloadIssue(`${label}_open_failed:${error?.code ?? "unknown"}`);
  }
}

async function openAnchoredDirectory(parent, entry, label) {
  await assertDescriptorTarget(parent);
  const path = descriptorPath(parent, entry);
  let metadata;
  try {
    metadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw payloadIssue(`${label}_lstat_failed:${error?.code ?? "unknown"}`);
  }
  if (metadata.isSymbolicLink()) throw payloadIssue(`${label}_symlink_forbidden`);
  if (!metadata.isDirectory()) throw payloadIssue(`${label}_not_directory`);
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY
        | (fsConstants.O_DIRECTORY ?? 0)
        | (fsConstants.O_NOFOLLOW ?? 0)
        | (fsConstants.O_NONBLOCK ?? 0)
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isDirectory() || before.dev !== metadata.dev || before.ino !== metadata.ino) {
      throw payloadIssue(`${label}_changed_before_read`);
    }
    const directory = { path: null, label, handle, before, parent, entry };
    await assertDescriptorTarget(directory);
    return directory;
  } catch (error) {
    await handle?.close();
    if (error instanceof TrellisPayloadArtifactError) throw error;
    if (error?.code === "ELOOP") throw payloadIssue(`${label}_symlink_forbidden`);
    throw payloadIssue(`${label}_open_failed:${error?.code ?? "unknown"}`);
  }
}

async function assertDirectoryUnchanged(directory) {
  const after = await directory.handle.stat({ bigint: true });
  let current;
  try {
    if (directory.parent === null) {
      current = await lstat(directory.path, { bigint: true });
    } else {
      await assertDescriptorTarget(directory.parent);
      current = await lstat(descriptorPath(directory.parent, directory.entry), { bigint: true });
    }
  } catch {
    throw payloadIssue(`${directory.label}_path_changed_during_read`);
  }
  if (!after.isDirectory()
    || after.dev !== directory.before.dev
    || after.ino !== directory.before.ino
    || after.mtimeNs !== directory.before.mtimeNs
    || after.ctimeNs !== directory.before.ctimeNs
    || current.isSymbolicLink()
    || !current.isDirectory()
    || current.dev !== directory.before.dev
    || current.ino !== directory.before.ino) {
    throw payloadIssue(`${directory.label}_changed_during_read`);
  }
  if (directory.parent === null) {
    let canonical;
    try {
      canonical = await realpath(directory.path);
    } catch {
      throw payloadIssue(`${directory.label}_path_changed_during_read`);
    }
    if (canonical !== directory.path) throw payloadIssue(`${directory.label}_changed_during_read`);
  }
  await assertDescriptorTarget(directory);
}

async function verifyPayloadFile(payload, directory) {
  await assertDescriptorTarget(directory);
  const path = descriptorPath(directory, basename(payload.path));
  let pathMetadata;
  try {
    pathMetadata = await lstat(path, { bigint: true });
  } catch (error) {
    throw payloadIssue(`payload_file_lstat_failed:${payload.id}:${error?.code ?? "unknown"}`);
  }
  if (pathMetadata.isSymbolicLink()) throw payloadIssue(`payload_file_symlink_forbidden:${payload.id}`);
  if (!pathMetadata.isFile()) throw payloadIssue(`payload_file_not_regular:${payload.id}`);
  const expectedSize = BigInt(payload.byteLength);
  if (pathMetadata.size > expectedSize) throw payloadIssue(`payload_file_too_large:${payload.id}`);
  if (pathMetadata.size < expectedSize) throw payloadIssue(`payload_file_too_small:${payload.id}`);
  let handle;
  try {
    handle = await open(
      path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    );
  } catch (error) {
    if (error?.code === "ELOOP") throw payloadIssue(`payload_file_symlink_forbidden:${payload.id}`);
    throw payloadIssue(`payload_file_open_failed:${payload.id}:${error?.code ?? "unknown"}`);
  }
  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw payloadIssue(`payload_file_not_regular:${payload.id}`);
    if (before.dev !== pathMetadata.dev || before.ino !== pathMetadata.ino) {
      throw payloadIssue(`payload_file_changed_before_read:${payload.id}`);
    }
    if (before.size > expectedSize) throw payloadIssue(`payload_file_too_large:${payload.id}`);
    if (before.size < expectedSize) throw payloadIssue(`payload_file_too_small:${payload.id}`);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(payloadBufferBytes);
    let total = 0n;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, null);
      if (bytesRead === 0) break;
      total += BigInt(bytesRead);
      if (total > expectedSize) throw payloadIssue(`payload_file_too_large:${payload.id}`);
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (total < expectedSize) throw payloadIssue(`payload_file_too_small:${payload.id}`);
    const observedSha256 = hash.digest("hex");
    if (observedSha256 !== payload.observedSha256) throw payloadIssue(`payload_file_sha256_mismatch:${payload.id}`);
    const after = await handle.stat({ bigint: true });
    if (after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || after.mtimeNs !== before.mtimeNs
      || after.ctimeNs !== before.ctimeNs) {
      throw payloadIssue(`payload_file_changed_during_read:${payload.id}`);
    }
    let currentPathMetadata;
    try {
      await assertDescriptorTarget(directory);
      currentPathMetadata = await lstat(path, { bigint: true });
    } catch {
      throw payloadIssue(`payload_file_path_changed_during_read:${payload.id}`);
    }
    if (currentPathMetadata.isSymbolicLink()
      || !currentPathMetadata.isFile()
      || currentPathMetadata.dev !== before.dev
      || currentPathMetadata.ino !== before.ino) {
      throw payloadIssue(`payload_file_path_changed_during_read:${payload.id}`);
    }
    return { id: payload.id, path: payload.path, byteLength: Number(total), observedSha256 };
  } finally {
    await handle.close();
  }
}

export async function verifyTrellisPayloadDirectory(lock, payloadDirectory) {
  validateTrellisPayloadArtifactLock(lock);
  if (typeof payloadDirectory !== "string" || payloadDirectory.length === 0 || payloadDirectory.includes("\0")) {
    throw payloadIssue("payload_directory_path_invalid");
  }
  const rootPath = resolve(payloadDirectory);
  const rootDirectory = await openCanonicalDirectory(rootPath, "payload_directory");
  let ckptsDirectory;
  try {
    await boundedDirectoryEntries(rootDirectory, ["ckpts"]);
    ckptsDirectory = await openAnchoredDirectory(rootDirectory, "ckpts", "payload_parent_directory");
    const expectedNames = lock.payloadSet.payloads.map(({ path }) => basename(path)).sort(asciiCompare);
    await boundedDirectoryEntries(ckptsDirectory, expectedNames);
    const payloads = [];
    for (const payload of lock.payloadSet.payloads) {
      if (dirname(payload.path) !== "ckpts") throw payloadIssue(`payload_path_parent_invalid:${payload.id}`);
      payloads.push(await verifyPayloadFile(payload, ckptsDirectory));
    }
    await assertDirectoryUnchanged(ckptsDirectory);
    await assertDirectoryUnchanged(rootDirectory);
    return {
      schemaVersion: 1,
      status: "selected-raw-payload-byte-identities-verified-no-safetensors-parsing",
      count: payloads.length,
      totalByteLength: payloads.reduce((total, payload) => total + payload.byteLength, 0),
      payloads,
      safetensorsParsed: false,
      deserialized: false,
      runtimeExecuted: false,
      modelInputUsed: false,
      networkFallbackAllowedByVerifier: false,
      networkRequestInitiatedByVerifier: false,
      generationAllowed: false
    };
  } finally {
    await ckptsDirectory?.handle.close();
    await rootDirectory.handle.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const lockOnly = args.length === 1 && args[0] === "--lock-only";
  const payloadMode = args.length === 2 && args[0] === "--payload-dir" && Boolean(args[1]);
  if (!lockOnly && !payloadMode) throw new TrellisPayloadArtifactError(["cli_arguments_invalid"]);
  const lock = await loadWmmrTrellisPayloadArtifactLock();
  const result = lockOnly
    ? {
        schemaVersion: 1,
        status: "canonical-public-lock-and-historical-relationship-verified-without-payload-read",
        lockSha256: lock.lockSha256,
        normalCiScope: lock.normalCi.scope,
        payloadFilesRead: false,
        restrictedOperatorRecordRead: false,
        networkFallbackAllowedByVerifier: false,
        networkRequestInitiatedByVerifier: false
      }
    : await verifyTrellisPayloadDirectory(lock, args[1]);
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
