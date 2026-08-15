import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { request as httpsRequest } from "node:https";
import { isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TrellisModelArtifactError,
  canonicalGitObjectGraphDigest,
  canonicalGitSourceDigest,
  readVerifiedGitRepositorySnapshot,
  stableJson
} from "./verify-trellis-model-artifact.mjs";

const defaultLockPath = resolve(
  import.meta.dirname,
  "../experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json"
);
const lockStatus = "source-git-object-locked-publisher-head-recorded-payload-unverified-runtime-blocked";
const sourceCanonicalization = "sort by ASCII path, then concatenate UTF-8 path, NUL, mode, NUL, decimal size, NUL, lowercase raw SHA-256, and LF";
const objectGraphCanonicalization = "sort by ASCII path, then concatenate UTF-8 path, NUL, mode, NUL, lowercase Git object OID, and LF";
const selectionCanonicalization = "sort by ASCII path, then concatenate UTF-8 path, NUL, lowercase raw SHA-256, and LF";
const publisherUrl = "https://dl.fbaipublicfiles.com/dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth";
const falseBoundaryFields = Object.freeze([
  "cloudResourcesCreated",
  "externalSourceVerificationInNormalCi",
  "generationAllowed",
  "modelInputsDownloaded",
  "payloadBytesDownloaded",
  "payloadBytesIndependentlyVerified",
  "publisherHeadVerificationInNormalCi",
  "runtimeExecuted",
  "sourceFilesIncluded",
  "torchHubInvoked",
  "weightsIncluded"
]);
const expectedRuntimePaths = Object.freeze([
  "dinov2/__init__.py",
  "dinov2/layers/__init__.py",
  "dinov2/layers/attention.py",
  "dinov2/layers/block.py",
  "dinov2/layers/dino_head.py",
  "dinov2/layers/drop_path.py",
  "dinov2/layers/layer_scale.py",
  "dinov2/layers/mlp.py",
  "dinov2/layers/patch_embed.py",
  "dinov2/layers/swiglu_ffn.py",
  "dinov2/models/__init__.py",
  "dinov2/models/vision_transformer.py"
]);
const expectedEvidencePaths = Object.freeze([
  "LICENSE",
  "MODEL_CARD.md",
  "README.md",
  "dinov2/hub/backbones.py",
  "dinov2/hub/utils.py",
  "dinov2/models/vision_transformer.py",
  "docs/README_CHANNEL_ADAPTIVE_DINO.md",
  "hubconf.py"
]);
const expectedOpenGates = Object.freeze([
  "dependencyWheelHashLock",
  "dinoArtifactPayloadBytesVerification",
  "dinoDerivedRuntimeArtifactLock",
  "dinoSourceAndArtifactLock",
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
const expectedHeadHeaders = Object.freeze({
  "accept-ranges": "bytes",
  "content-length": "1217607321",
  "content-type": "binary/octet-stream",
  etag: "\"b6cbe2bf3ce2f370d5a67bcd465144b0-146\"",
  "last-modified": "Fri, 27 Oct 2023 10:37:32 GMT",
  "x-amz-server-side-encryption": "AES256",
  "x-amz-version-id": "HLmbhvcd2hPq9CNLwMvwswbRlzZRuOeA"
});
const forbiddenHeadHeaders = Object.freeze([
  "content-encoding",
  "content-range",
  "location",
  "transfer-encoding"
]);
const wmmrExpected = Object.freeze({
  repository: "https://github.com/facebookresearch/dinov2.git",
  commit: "b8931f7bf91576930313be2c6d6af376033b35f0",
  treeOid: "39a04d481b50b484f72b1c43251efc0b2bcb5dd7",
  objectFormat: "sha1",
  sourceContentSha256: "8615fa3237c4123e4fe7fbb24511fa89ffc1bab74277f78134b6c27ee2971d57",
  sourceObjectGraphSha256: "e753c5e96b58032fa597d6d8b4e28163c376a244240fa793b2047a280b919848",
  runtimeSelectionSha256: "5d9fe22b05aad04a77e33b20faecf72a176fb0de5d977128127415196f87fd4d",
  evidenceSha256: "28da67862b8050424b7652602312ae989757029167a2ff2fc89dd1d19548cc97",
  licenseSha256: "600cc67cc4cb2f5ea317dcfc687ad1c74dc4bec8782bbe9db0afd83513b935b7",
  lockSha256: "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9"
});

export class DinoSourceArtifactError extends Error {
  constructor(issues) {
    const uniqueIssues = [...new Set(issues)];
    super(`dino_source_artifact_invalid:${uniqueIssues.join(",")}`);
    this.name = "DinoSourceArtifactError";
    this.issues = uniqueIssues;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function isSafeRelativePath(path) {
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

function sortedUniqueStrings(value, name, issues) {
  const entries = Array.isArray(value) ? [...value] : [];
  if (!Array.isArray(value) || entries.some((entry) => typeof entry !== "string" || !entry)) {
    issues.push(`${name}_invalid`);
    return new Set();
  }
  const uniqueEntries = new Set(entries);
  if (uniqueEntries.size !== entries.length) issues.push(`${name}_duplicates`);
  if (entries.some((entry, index) => index > 0 && asciiCompare(entries[index - 1], entry) >= 0)) {
    issues.push(`${name}_not_ascii_sorted`);
  }
  return uniqueEntries;
}

function hasVolatileTimestampKey(value) {
  if (Array.isArray(value)) return value.some(hasVolatileTimestampKey);
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => (
    new Set(["asOf", "observedAt", "recordedAt", "verifiedAt"]).has(key) || hasVolatileTimestampKey(nested)
  ));
}

function objectOidPattern(objectFormat) {
  if (objectFormat === "sha1") return /^[0-9a-f]{40}$/;
  if (objectFormat === "sha256") return /^[0-9a-f]{64}$/;
  return /$a/;
}

function hasDigestibleBlobRecords(files) {
  return Array.isArray(files) && [...files].every((file) => (
    isObject(file)
    && typeof file.path === "string"
    && isObject(file.gitBlob)
    && typeof file.gitBlob.sha256 === "string"
  ));
}

export function canonicalDinoSelectionDigest(files) {
  if (!hasDigestibleBlobRecords(files)) {
    throw new DinoSourceArtifactError(["selection_digest_records_invalid"]);
  }
  const hash = createHash("sha256");
  for (const file of [...files].sort((left, right) => asciiCompare(left.path, right.path))) {
    hash.update(file.path, "utf8");
    hash.update("\0", "ascii");
    hash.update(file.gitBlob.sha256, "ascii");
    hash.update("\n", "ascii");
  }
  return hash.digest("hex");
}

export function canonicalDinoLockDigest(lock) {
  const semantics = structuredClone(lock);
  delete semantics.lockSha256;
  return sha256(stableJson(semantics));
}

export function isAllOfGateResolved(composition, resolvedGates) {
  const members = Array.isArray(composition?.members) ? [...composition.members] : [];
  const resolvedEntries = Array.isArray(resolvedGates) ? [...resolvedGates] : [];
  if (!isObject(composition)
    || composition.operator !== "allOf"
    || !Array.isArray(composition.members)
    || members.length === 0
    || members.some((member) => typeof member !== "string" || !member)
    || new Set(members).size !== members.length
    || !Array.isArray(resolvedGates)
    || resolvedEntries.some((gate) => typeof gate !== "string" || !gate)) {
    throw new DinoSourceArtifactError(["gate_composition_evaluation_invalid"]);
  }
  const resolved = new Set(resolvedEntries);
  return members.every((member) => resolved.has(member));
}

function validateBlobRecords(records, name, objectFormat, issues, { withRoles = false } = {}) {
  const entries = Array.isArray(records) ? [...records] : [];
  if (!Array.isArray(records) || entries.length === 0 || entries.some((record) => !isObject(record))) {
    issues.push(`${name}_invalid`);
    return new Map();
  }
  const byPath = new Map();
  const oidRegex = objectOidPattern(objectFormat);
  for (const [index, record] of entries.entries()) {
    const path = record?.path;
    requireExactKeys(
      record,
      withRoles ? ["gitBlob", "mode", "path", "role"] : ["gitBlob", "mode", "path"],
      `${name}:${path ?? index}`,
      issues
    );
    if (!isSafeRelativePath(path)) {
      issues.push(`${name}_path_unsafe:${path ?? index}`);
    } else {
      if (byPath.has(path)) issues.push(`${name}_path_duplicate:${path}`);
      byPath.set(path, record);
      if (index > 0 && isSafeRelativePath(entries[index - 1]?.path)
        && asciiCompare(entries[index - 1].path, path) >= 0) {
        issues.push(`${name}_not_ascii_sorted`);
      }
    }
    if (record?.mode !== "100644") issues.push(`${name}_mode_invalid:${path ?? index}`);
    if (withRoles && (typeof record?.role !== "string" || !/^[a-z][a-z0-9-]*$/.test(record.role))) {
      issues.push(`${name}_role_invalid:${path ?? index}`);
    }
    requireExactKeys(record?.gitBlob, ["oid", "sha256", "size"], `${name}_git_blob:${path ?? index}`, issues);
    if (!oidRegex.test(record?.gitBlob?.oid ?? "")) issues.push(`${name}_blob_oid_invalid:${path ?? index}`);
    if (!Number.isSafeInteger(record?.gitBlob?.size) || record.gitBlob.size < 0) {
      issues.push(`${name}_blob_size_invalid:${path ?? index}`);
    }
    if (!/^[0-9a-f]{64}$/.test(record?.gitBlob?.sha256 ?? "")) {
      issues.push(`${name}_blob_sha256_invalid:${path ?? index}`);
    }
  }
  return byPath;
}

function validateSourceSnapshot(lock, issues) {
  const snapshot = lock?.sourceSnapshot;
  requireExactKeys(snapshot, [
    "blobObjectCount",
    "canonicalization",
    "commitObjectCount",
    "contentSha256",
    "directoryCount",
    "executablePaths",
    "fileCount",
    "modeCounts",
    "objectGraphCanonicalization",
    "objectGraphSha256",
    "treeObjectCount"
  ], "source_snapshot", issues);
  if (snapshot?.canonicalization !== sourceCanonicalization) issues.push("source_snapshot_canonicalization_invalid");
  if (snapshot?.objectGraphCanonicalization !== objectGraphCanonicalization) {
    issues.push("source_snapshot_object_graph_canonicalization_invalid");
  }
  for (const field of ["blobObjectCount", "commitObjectCount", "directoryCount", "fileCount", "treeObjectCount"]) {
    if (!Number.isSafeInteger(snapshot?.[field]) || snapshot[field] < 0) issues.push(`source_snapshot_${field}_invalid`);
  }
  if (snapshot?.commitObjectCount !== 1) issues.push("source_snapshot_commit_count_invalid");
  if (Number.isSafeInteger(snapshot?.directoryCount)
    && Number.isSafeInteger(snapshot?.treeObjectCount)
    && snapshot.treeObjectCount !== snapshot.directoryCount + 1) {
    issues.push("source_snapshot_tree_count_mismatch");
  }
  if (snapshot?.blobObjectCount !== snapshot?.fileCount) issues.push("source_snapshot_blob_count_mismatch");
  if (!/^[0-9a-f]{64}$/.test(snapshot?.contentSha256 ?? "")) issues.push("source_snapshot_digest_invalid");
  if (!/^[0-9a-f]{64}$/.test(snapshot?.objectGraphSha256 ?? "")) {
    issues.push("source_snapshot_object_graph_digest_invalid");
  }
  requireExactKeys(snapshot?.modeCounts, ["100644", "100755"], "source_snapshot_mode_counts", issues);
  const modeTotal = Object.values(snapshot?.modeCounts ?? {}).reduce((total, count) => (
    Number.isSafeInteger(count) && count >= 0 ? total + count : total
  ), 0);
  if (Object.values(snapshot?.modeCounts ?? {}).some((count) => !Number.isSafeInteger(count) || count < 0)) {
    issues.push("source_snapshot_mode_count_invalid");
  }
  if (modeTotal !== snapshot?.fileCount) issues.push("source_snapshot_mode_count_mismatch");
  const executablePaths = sortedUniqueStrings(snapshot?.executablePaths, "source_snapshot_executable_paths", issues);
  for (const path of executablePaths) {
    if (!isSafeRelativePath(path)) issues.push(`source_snapshot_executable_path_unsafe:${path}`);
  }
}

function validateRuntimeClosure(lock, issues) {
  const closure = lock?.runtimeSourceClosure;
  requireExactKeys(closure, [
    "canonicalization",
    "excludedNetworkLoaderPaths",
    "fileCount",
    "files",
    "purpose",
    "selectionSha256",
    "totalSize"
  ], "runtime_closure", issues);
  if (closure?.purpose !== "project-owned-offline-dinov2-vitl14-reg-constructor") {
    issues.push("runtime_closure_purpose_invalid");
  }
  if (closure?.canonicalization !== selectionCanonicalization) issues.push("runtime_closure_canonicalization_invalid");
  const byPath = validateBlobRecords(closure?.files, "runtime_closure_file", lock?.source?.objectFormat, issues);
  if (closure?.fileCount !== closure?.files?.length) issues.push("runtime_closure_file_count_mismatch");
  const totalSize = Array.isArray(closure?.files)
    ? closure.files.reduce((total, file) => total + (Number.isSafeInteger(file?.gitBlob?.size) ? file.gitBlob.size : 0), 0)
    : 0;
  if (!Number.isSafeInteger(closure?.totalSize) || closure.totalSize !== totalSize) {
    issues.push("runtime_closure_total_size_mismatch");
  }
  if (!/^[0-9a-f]{64}$/.test(closure?.selectionSha256 ?? "")) issues.push("runtime_closure_digest_invalid");
  if (hasDigestibleBlobRecords(closure?.files)
    && closure.selectionSha256 !== canonicalDinoSelectionDigest(closure.files)) {
    issues.push("runtime_closure_digest_mismatch");
  }
  const excluded = sortedUniqueStrings(closure?.excludedNetworkLoaderPaths, "runtime_closure_exclusions", issues);
  if (!setEquals(excluded, new Set(["dinov2/hub", "hubconf.py"]))) issues.push("runtime_closure_exclusions_invalid");
  for (const path of byPath.keys()) {
    if (path === "hubconf.py" || path === "dinov2/hub" || path.startsWith("dinov2/hub/")) {
      issues.push(`network_loader_in_runtime_closure:${path}`);
    }
  }
  return byPath;
}

function validateEvidence(lock, runtimeByPath, issues) {
  const evidence = lock?.evidence;
  requireExactKeys(
    evidence,
    ["canonicalization", "evidenceSha256", "fileCount", "files", "licenseEvidence"],
    "evidence",
    issues
  );
  if (evidence?.canonicalization !== selectionCanonicalization) issues.push("evidence_canonicalization_invalid");
  const byPath = validateBlobRecords(evidence?.files, "evidence_file", lock?.source?.objectFormat, issues, { withRoles: true });
  if (evidence?.fileCount !== evidence?.files?.length) issues.push("evidence_file_count_mismatch");
  if (!/^[0-9a-f]{64}$/.test(evidence?.evidenceSha256 ?? "")) issues.push("evidence_digest_invalid");
  if (hasDigestibleBlobRecords(evidence?.files)
    && evidence.evidenceSha256 !== canonicalDinoSelectionDigest(evidence.files)) {
    issues.push("evidence_digest_mismatch");
  }
  const visionPath = "dinov2/models/vision_transformer.py";
  if (runtimeByPath.has(visionPath)
    && byPath.has(visionPath)
    && stableJson(runtimeByPath.get(visionPath).gitBlob) !== stableJson(byPath.get(visionPath).gitBlob)) {
    issues.push("runtime_evidence_blob_mismatch:dinov2/models/vision_transformer.py");
  }

  const licenseEvidence = evidence?.licenseEvidence;
  requireExactKeys(licenseEvidence, [
    "approvalClaim",
    "modelCardDeclaredLicense",
    "modelCardPath",
    "repositoryScopeCaveat",
    "repositoryScopeCaveatPath",
    "repositoryScopeCaveatStatus",
    "rootLicensePath",
    "sourceDeclaredLicense"
  ], "license_evidence", issues);
  if (licenseEvidence?.rootLicensePath !== "LICENSE"
    || licenseEvidence?.sourceDeclaredLicense !== "Apache-2.0"
    || licenseEvidence?.modelCardPath !== "MODEL_CARD.md"
    || licenseEvidence?.modelCardDeclaredLicense !== "Apache License 2.0") {
    issues.push("license_evidence_declaration_invalid");
  }
  if (licenseEvidence?.repositoryScopeCaveatPath !== "docs/README_CHANNEL_ADAPTIVE_DINO.md"
    || licenseEvidence?.repositoryScopeCaveatStatus !== "unresolved-human-review"
    || typeof licenseEvidence?.repositoryScopeCaveat !== "string"
    || !licenseEvidence.repositoryScopeCaveat.includes("research use only")
    || !licenseEvidence.repositoryScopeCaveat.includes("code is coming soon")
    || !licenseEvidence.repositoryScopeCaveat.includes("CellDINO code is released")
    || !licenseEvidence.repositoryScopeCaveat.includes("CC by NC")
    || !licenseEvidence.repositoryScopeCaveat.includes("weights will be released under the FAIR Non-Commercial Research")
    || !licenseEvidence.repositoryScopeCaveat.includes("no referenced CellDINO license file")) {
    issues.push("license_scope_caveat_invalid");
  }
  if (licenseEvidence?.approvalClaim !== false) issues.push("license_approval_claim_invalid");
  for (const path of [
    licenseEvidence?.rootLicensePath,
    licenseEvidence?.modelCardPath,
    licenseEvidence?.repositoryScopeCaveatPath
  ]) {
    if (!byPath.has(path)) issues.push(`license_evidence_record_missing:${path ?? "missing"}`);
  }
  return byPath;
}

function validateOfflineConstructor(lock, issues) {
  const constructor = lock?.offlineConstructor;
  requireExactKeys(constructor, [
    "arguments",
    "callable",
    "modelId",
    "networkAllowed",
    "stateLoad",
    "torchHubAllowed"
  ], "offline_constructor", issues);
  if (constructor?.modelId !== "dinov2_vitl14_reg") issues.push("offline_constructor_model_id_invalid");
  if (constructor?.callable !== "dinov2.models.vision_transformer.vit_large") {
    issues.push("offline_constructor_callable_invalid");
  }
  requireExactKeys(constructor?.arguments, [
    "block_chunks",
    "ffn_layer",
    "img_size",
    "init_values",
    "interpolate_antialias",
    "interpolate_offset",
    "num_register_tokens",
    "patch_size"
  ], "offline_constructor_arguments", issues);
  const expectedArguments = {
    img_size: 518,
    patch_size: 14,
    init_values: 1,
    ffn_layer: "mlp",
    block_chunks: 0,
    num_register_tokens: 4,
    interpolate_antialias: true,
    interpolate_offset: 0
  };
  if (stableJson(constructor?.arguments) !== stableJson(expectedArguments)) {
    issues.push("offline_constructor_arguments_invalid");
  }
  requireExactKeys(constructor?.stateLoad, ["artifactSource", "strict"], "offline_constructor_state_load", issues);
  if (constructor?.stateLoad?.artifactSource !== "project-owned-local-file-only"
    || constructor?.stateLoad?.strict !== true) {
    issues.push("offline_constructor_state_load_invalid");
  }
  if (constructor?.torchHubAllowed !== false) issues.push("offline_constructor_torch_hub_not_blocked");
  if (constructor?.networkAllowed !== false) issues.push("offline_constructor_network_not_blocked");
}

function validatePublisherArtifact(lock, issues) {
  const artifact = lock?.publisherArtifact;
  requireExactKeys(
    artifact,
    ["head", "metadataInterpretation", "observedSha256", "publisherSha256", "url"],
    "publisher_artifact",
    issues
  );
  let parsedUrl;
  try {
    parsedUrl = new URL(artifact?.url);
  } catch {
    issues.push("publisher_url_invalid");
  }
  if (parsedUrl
    && (parsedUrl.protocol !== "https:"
      || parsedUrl.hostname !== "dl.fbaipublicfiles.com"
      || parsedUrl.port !== ""
      || parsedUrl.username !== ""
      || parsedUrl.password !== ""
      || parsedUrl.pathname !== "/dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth"
      || parsedUrl.search !== ""
      || parsedUrl.hash !== "")) {
    issues.push("publisher_url_boundary_invalid");
  }
  if (artifact?.publisherSha256 !== null) issues.push("publisher_sha256_must_be_null");
  if (artifact?.observedSha256 !== null) issues.push("observed_sha256_must_be_null");
  requireExactKeys(
    artifact?.head,
    ["headers", "method", "redirectsFollowed", "responseBodyBytesDelivered", "status"],
    "publisher_head",
    issues
  );
  if (artifact?.head?.method !== "HEAD") issues.push("publisher_head_method_invalid");
  if (artifact?.head?.status !== 200) issues.push("publisher_head_status_invalid");
  if (artifact?.head?.redirectsFollowed !== 0) issues.push("publisher_head_redirect_count_invalid");
  if (artifact?.head?.responseBodyBytesDelivered !== false) {
    issues.push("publisher_head_response_body_claim_invalid");
  }
  requireExactKeys(artifact?.head?.headers, Object.keys(expectedHeadHeaders), "publisher_head_headers", issues);
  for (const [name, expected] of Object.entries(expectedHeadHeaders)) {
    if (artifact?.head?.headers?.[name] !== expected) issues.push(`publisher_head_header_invalid:${name}`);
  }
  requireExactKeys(
    artifact?.metadataInterpretation,
    ["etag", "payloadIdentityVerified", "xAmzVersionId"],
    "publisher_metadata_interpretation",
    issues
  );
  if (artifact?.metadataInterpretation?.etag !== "multipart-non-sha256") {
    issues.push("publisher_etag_interpretation_invalid");
  }
  if (artifact?.metadataInterpretation?.xAmzVersionId !== "opaque-publisher-metadata") {
    issues.push("publisher_version_id_interpretation_invalid");
  }
  if (artifact?.metadataInterpretation?.payloadIdentityVerified !== false) {
    issues.push("publisher_payload_identity_claim_invalid");
  }
}

function validateGates(lock, issues) {
  const resolved = sortedUniqueStrings(lock?.resolvedGates, "resolved_gates", issues);
  const open = sortedUniqueStrings(lock?.openGates, "open_gates", issues);
  for (const gate of resolved) {
    if (open.has(gate)) issues.push(`gate_both_open_and_resolved:${gate}`);
  }
  if (!setEquals(resolved, new Set(["dinoSourceGitObjectLock"]))) issues.push("resolved_gate_set_invalid");
  if (!open.has("dinoArtifactPayloadBytesVerification")) issues.push("payload_gate_not_open");
  if (!open.has("dinoDerivedRuntimeArtifactLock")) issues.push("derived_runtime_artifact_gate_not_open");
  if (!open.has("dinoSourceAndArtifactLock")) issues.push("composite_gate_not_open");

  requireExactKeys(lock?.gateComposition, ["dinoSourceAndArtifactLock"], "gate_composition", issues);
  const composition = lock?.gateComposition?.dinoSourceAndArtifactLock;
  requireExactKeys(composition, ["members", "operator"], "dino_gate_composition", issues);
  if (composition?.operator !== "allOf") issues.push("dino_gate_operator_invalid");
  if (stableJson(composition?.members) !== stableJson([
    "dinoSourceGitObjectLock",
    "dinoArtifactPayloadBytesVerification"
  ])) {
    issues.push("dino_gate_members_invalid");
  }

  requireExactKeys(lock?.gateMeanings, [
    "dinoArtifactPayloadBytesVerification",
    "dinoDerivedRuntimeArtifactLock",
    "dinoSourceAndArtifactLock",
    "dinoSourceGitObjectLock"
  ], "gate_meanings", issues);
  for (const [gate, meaning] of Object.entries(lock?.gateMeanings ?? {})) {
    if (typeof meaning !== "string" || !meaning) issues.push(`gate_meaning_invalid:${gate}`);
  }
}

export function validateDinoSourceArtifactLock(lock) {
  const issues = [];
  requireExactKeys(lock, [
    "boundaries",
    "evidence",
    "gateComposition",
    "gateMeanings",
    "lockSha256",
    "offlineConstructor",
    "openGates",
    "publisherArtifact",
    "resolvedGates",
    "runtimeSourceClosure",
    "schemaVersion",
    "source",
    "sourceSnapshot",
    "status"
  ], "lock", issues);
  if (lock?.schemaVersion !== 1) issues.push("schema_version_invalid");
  if (lock?.status !== lockStatus) issues.push("status_invalid");
  if (!/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "")) issues.push("lock_digest_invalid");
  if (hasVolatileTimestampKey(lock)) issues.push("volatile_timestamp_in_lock");

  requireExactKeys(lock?.source, ["commit", "objectFormat", "repository", "treeOid"], "source", issues);
  if (typeof lock?.source?.repository !== "string" || !lock.source.repository) issues.push("source_repository_invalid");
  if (!new Set(["sha1", "sha256"]).has(lock?.source?.objectFormat)) issues.push("source_object_format_invalid");
  const oidRegex = objectOidPattern(lock?.source?.objectFormat);
  if (!oidRegex.test(lock?.source?.commit ?? "")) issues.push("source_commit_invalid");
  if (!oidRegex.test(lock?.source?.treeOid ?? "")) issues.push("source_tree_oid_invalid");

  validateSourceSnapshot(lock, issues);
  const runtimeByPath = validateRuntimeClosure(lock, issues);
  validateEvidence(lock, runtimeByPath, issues);
  validateOfflineConstructor(lock, issues);
  validatePublisherArtifact(lock, issues);
  requireExactKeys(lock?.boundaries, falseBoundaryFields, "boundaries", issues);
  for (const field of falseBoundaryFields) {
    if (lock?.boundaries?.[field] !== false) issues.push(`boundary_must_be_false:${field}`);
  }
  validateGates(lock, issues);
  if (/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "")
    && lock.lockSha256 !== canonicalDinoLockDigest(lock)) {
    issues.push("lock_digest_mismatch");
  }
  if (issues.length > 0) throw new DinoSourceArtifactError(issues);
  return lock;
}

export function validateWmmrDinoSourceArtifactContract(lock) {
  validateDinoSourceArtifactLock(lock);
  const issues = [];
  for (const field of ["repository", "commit", "treeOid", "objectFormat"]) {
    if (lock.source[field] !== wmmrExpected[field]) issues.push(`unexpected_source_${field}`);
  }
  if (lock.sourceSnapshot.commitObjectCount !== 1
    || lock.sourceSnapshot.treeObjectCount !== 58
    || lock.sourceSnapshot.blobObjectCount !== 174
    || lock.sourceSnapshot.directoryCount !== 57
    || lock.sourceSnapshot.fileCount !== 174
    || stableJson(lock.sourceSnapshot.modeCounts) !== stableJson({ "100644": 173, "100755": 1 })
    || stableJson(lock.sourceSnapshot.executablePaths) !== stableJson(["scripts/lint.sh"])
    || lock.sourceSnapshot.contentSha256 !== wmmrExpected.sourceContentSha256
    || lock.sourceSnapshot.objectGraphSha256 !== wmmrExpected.sourceObjectGraphSha256) {
    issues.push("unexpected_source_snapshot");
  }
  if (lock.runtimeSourceClosure.fileCount !== 12
    || lock.runtimeSourceClosure.totalSize !== 43510
    || lock.runtimeSourceClosure.selectionSha256 !== wmmrExpected.runtimeSelectionSha256
    || stableJson(lock.runtimeSourceClosure.files.map(({ path }) => path)) !== stableJson(expectedRuntimePaths)) {
    issues.push("unexpected_runtime_closure");
  }
  if (lock.evidence.fileCount !== 8
    || lock.evidence.evidenceSha256 !== wmmrExpected.evidenceSha256
    || stableJson(lock.evidence.files.map(({ path }) => path)) !== stableJson(expectedEvidencePaths)) {
    issues.push("unexpected_evidence");
  }
  const license = lock.evidence.files.find(({ path }) => path === "LICENSE");
  if (license?.gitBlob?.sha256 !== wmmrExpected.licenseSha256) issues.push("unexpected_license_digest");
  if (lock.publisherArtifact.url !== publisherUrl
    || stableJson(lock.publisherArtifact.head.headers) !== stableJson(expectedHeadHeaders)) {
    issues.push("unexpected_publisher_metadata");
  }
  if (!setEquals(new Set(lock.openGates), new Set(expectedOpenGates))) issues.push("unexpected_open_gate_set");
  if (lock.lockSha256 !== wmmrExpected.lockSha256) issues.push("unexpected_lock_digest");
  if (issues.length > 0) throw new DinoSourceArtifactError(issues);
  return lock;
}

export function parseCanonicalDinoSourceArtifactLock(text) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    throw new DinoSourceArtifactError(["lock_json_invalid"]);
  }
  if (`${JSON.stringify(lock, null, 2)}\n` !== text) {
    throw new DinoSourceArtifactError(["lock_json_not_canonical"]);
  }
  return lock;
}

export async function loadWmmrDinoSourceArtifactLock(path = defaultLockPath) {
  const text = await readFile(resolve(path), "utf8");
  return validateWmmrDinoSourceArtifactContract(parseCanonicalDinoSourceArtifactLock(text));
}

function plainBlobRecord(record) {
  return {
    path: record.path,
    mode: record.mode,
    gitBlob: record.gitBlob
  };
}

export function verifyDinoSourceSnapshot(lock, snapshot) {
  validateDinoSourceArtifactLock(lock);
  const issues = [];
  for (const field of ["repository", "objectFormat", "commit", "treeOid"]) {
    if (snapshot?.[field] !== lock.source[field]) issues.push(`snapshot_source_${field}_mismatch`);
  }
  for (const field of [
    "commitObjectCount",
    "treeObjectCount",
    "blobObjectCount",
    "directoryCount",
    "fileCount",
    "contentSha256",
    "objectGraphSha256"
  ]) {
    if (snapshot?.[field] !== lock.sourceSnapshot[field]) issues.push(`snapshot_${field}_mismatch`);
  }
  if (stableJson(snapshot?.modeCounts) !== stableJson(lock.sourceSnapshot.modeCounts)) {
    issues.push("snapshot_mode_counts_mismatch");
  }
  if (stableJson(snapshot?.executablePaths) !== stableJson(lock.sourceSnapshot.executablePaths)) {
    issues.push("snapshot_executable_paths_mismatch");
  }
  if (!Array.isArray(snapshot?.files) || snapshot.files.length !== lock.sourceSnapshot.fileCount) {
    issues.push("snapshot_file_records_incomplete");
  }
  const actualByPath = new Map();
  if (Array.isArray(snapshot?.files)) {
    const objectOidRegex = objectOidPattern(lock.source.objectFormat);
    for (const [index, file] of snapshot.files.entries()) {
      if (!isObject(file)) {
        issues.push(`snapshot_file_invalid:${index}`);
        continue;
      }
      requireExactKeys(file, ["gitBlob", "mode", "path"], `snapshot_file:${file.path ?? index}`, issues);
      requireExactKeys(file.gitBlob, ["oid", "sha256", "size"], `snapshot_file_blob:${file.path ?? index}`, issues);
      if (!isSafeRelativePath(file.path)) issues.push(`snapshot_file_path_unsafe:${file.path ?? index}`);
      if (!new Set(["100644", "100755"]).has(file.mode)) {
        issues.push(`snapshot_file_mode_invalid:${file.path ?? index}`);
      }
      if (!objectOidRegex.test(file.gitBlob?.oid ?? "")) {
        issues.push(`snapshot_file_oid_invalid:${file.path ?? index}`);
      }
      if (!Number.isSafeInteger(file.gitBlob?.size) || file.gitBlob.size < 0) {
        issues.push(`snapshot_file_size_invalid:${file.path ?? index}`);
      }
      if (!/^[0-9a-f]{64}$/.test(file.gitBlob?.sha256 ?? "")) {
        issues.push(`snapshot_file_sha256_invalid:${file.path ?? index}`);
      }
      if (actualByPath.has(file.path)) issues.push(`snapshot_path_duplicate:${file.path ?? index}`);
      actualByPath.set(file.path, file);
      if (index > 0 && asciiCompare(snapshot.files[index - 1]?.path, file?.path) >= 0) {
        issues.push("snapshot_files_not_ascii_sorted");
      }
    }
    const directories = new Set();
    const modeCounts = {};
    const executablePaths = [];
    for (const file of snapshot.files) {
      if (!isObject(file) || typeof file.path !== "string") continue;
      const segments = file.path.split("/");
      for (let index = 1; index < segments.length; index += 1) {
        directories.add(segments.slice(0, index).join("/"));
      }
      modeCounts[file.mode] = (modeCounts[file.mode] ?? 0) + 1;
      if (file.mode === "100755") executablePaths.push(file.path);
    }
    if (snapshot.fileCount !== snapshot.files.length || snapshot.blobObjectCount !== snapshot.files.length) {
      issues.push("snapshot_file_count_not_derived");
    }
    if (snapshot.directoryCount !== directories.size || snapshot.treeObjectCount !== directories.size + 1) {
      issues.push("snapshot_directory_count_not_derived");
    }
    if (stableJson(snapshot.modeCounts) !== stableJson(modeCounts)) issues.push("snapshot_mode_counts_not_derived");
    if (stableJson(snapshot.executablePaths) !== stableJson(executablePaths)) {
      issues.push("snapshot_executable_paths_not_derived");
    }
    const filesAreDigestible = [...snapshot.files].every((file) => (
      isObject(file)
      && typeof file.path === "string"
      && typeof file.mode === "string"
      && isObject(file.gitBlob)
      && typeof file.gitBlob.oid === "string"
      && Number.isSafeInteger(file.gitBlob.size)
      && typeof file.gitBlob.sha256 === "string"
    ));
    if (filesAreDigestible && snapshot.contentSha256 !== canonicalGitSourceDigest(snapshot.files)) {
      issues.push("snapshot_content_digest_not_derived");
    }
    if (filesAreDigestible && snapshot.objectGraphSha256 !== canonicalGitObjectGraphDigest(snapshot.files)) {
      issues.push("snapshot_object_graph_digest_not_derived");
    }
  }
  const compareRecords = (records, prefix) => {
    for (const expected of records) {
      const actual = actualByPath.get(expected.path);
      if (!actual) issues.push(`${prefix}_missing:${expected.path}`);
      else if (stableJson(plainBlobRecord(actual)) !== stableJson(plainBlobRecord(expected))) {
        issues.push(`${prefix}_mismatch:${expected.path}`);
      }
    }
  };
  compareRecords(lock.runtimeSourceClosure.files, "runtime_closure_record");
  compareRecords(lock.evidence.files, "evidence_record");
  if (issues.length > 0) throw new DinoSourceArtifactError(issues);
  return {
    schemaVersion: 1,
    status: lockStatus,
    repository: lock.source.repository,
    commit: lock.source.commit,
    treeOid: lock.source.treeOid,
    objectFormat: lock.source.objectFormat,
    commitObjectCount: snapshot.commitObjectCount,
    treeObjectCount: snapshot.treeObjectCount,
    blobObjectCount: snapshot.blobObjectCount,
    directoryCount: snapshot.directoryCount,
    fileCount: snapshot.fileCount,
    modeCounts: snapshot.modeCounts,
    executablePaths: snapshot.executablePaths,
    sourceContentSha256: snapshot.contentSha256,
    sourceObjectGraphSha256: snapshot.objectGraphSha256,
    runtimeClosureFileCount: lock.runtimeSourceClosure.fileCount,
    runtimeClosureTotalSize: lock.runtimeSourceClosure.totalSize,
    runtimeSelectionSha256: lock.runtimeSourceClosure.selectionSha256,
    evidenceFileCount: lock.evidence.fileCount,
    evidenceSha256: lock.evidence.evidenceSha256,
    lockSha256: lock.lockSha256,
    payloadBytesReadByVerifier: false,
    networkFallbackAllowed: false,
    networkProtocolsAllowedByVerifier: [],
    runtimeExecutedByVerifier: false,
    generationAllowed: false,
    resolvedGates: lock.resolvedGates,
    openGates: lock.openGates
  };
}

export async function verifyDinoSourceRepository(
  lock,
  repositoryDirectory,
  { execFileImpl } = {}
) {
  validateWmmrDinoSourceArtifactContract(lock);
  let snapshot;
  try {
    snapshot = await readVerifiedGitRepositorySnapshot(
      lock.source,
      resolve(repositoryDirectory),
      execFileImpl ? { execFileImpl } : {}
    );
  } catch (error) {
    if (error instanceof TrellisModelArtifactError) throw new DinoSourceArtifactError(error.issues);
    throw error;
  }
  return verifyDinoSourceSnapshot(lock, snapshot);
}

function defaultHeadRequest(url, { headers, method, timeoutMs }) {
  if (method !== "HEAD") return Promise.reject(new DinoSourceArtifactError(["publisher_request_method_not_head"]));
  return new Promise((resolvePromise, rejectPromise) => {
    let settled = false;
    let timer;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const request = httpsRequest(url, { agent: false, headers, method: "HEAD" }, (response) => {
      const result = {
        statusCode: response.statusCode,
        headers: response.headers,
        rawHeaders: response.rawHeaders,
        bodyBytesReceived: 0,
        requestMethod: "HEAD",
        redirectsFollowed: 0
      };
      settle(resolvePromise, result);
      response.destroy();
      request.destroy();
    });
    timer = setTimeout(() => request.destroy(new Error("publisher HEAD timeout")), timeoutMs);
    request.once("error", (error) => settle(rejectPromise, error));
    request.end();
  });
}

function normalizedHeaders(headers, rawHeaders, issues) {
  const normalized = new Map();
  const append = (rawName, rawValue) => {
    if (typeof rawName !== "string" || typeof rawValue !== "string") {
      issues.push("publisher_head_response_raw_headers_invalid");
      return;
    }
    const name = rawName.toLowerCase();
    if (normalized.has(name)) issues.push(`publisher_head_response_header_duplicate:${name}`);
    normalized.set(name, rawValue.trim());
  };
  if (rawHeaders !== undefined) {
    if (!Array.isArray(rawHeaders) || rawHeaders.length % 2 !== 0) {
      issues.push("publisher_head_response_raw_headers_invalid");
      return normalized;
    }
    for (let index = 0; index < rawHeaders.length; index += 2) {
      append(rawHeaders[index], rawHeaders[index + 1]);
    }
    return normalized;
  }
  if (!isObject(headers)) {
    issues.push("publisher_head_response_headers_invalid");
    return normalized;
  }
  for (const [rawName, rawValue] of Object.entries(headers)) {
    if (Array.isArray(rawValue)) {
      if (rawValue.length !== 1) issues.push(`publisher_head_response_header_ambiguous:${rawName.toLowerCase()}`);
      if (rawValue.length > 0) append(rawName, String(rawValue[0]));
    } else {
      append(rawName, String(rawValue));
    }
  }
  return normalized;
}

export async function verifyDinoPublisherHead(
  lock,
  { requestImpl = defaultHeadRequest, timeoutMs = 10_000 } = {}
) {
  validateWmmrDinoSourceArtifactContract(lock);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 30_000) {
    throw new DinoSourceArtifactError(["publisher_head_timeout_invalid"]);
  }
  let response;
  try {
    response = await requestImpl(lock.publisherArtifact.url, {
      method: "HEAD",
      timeoutMs,
      maxRedirects: 0,
      headers: {
        "accept-encoding": "identity"
      }
    });
  } catch (error) {
    if (error instanceof DinoSourceArtifactError) throw error;
    const detail = String(error?.message ?? "unknown").trim().replaceAll(",", ";");
    throw new DinoSourceArtifactError([`publisher_head_request_failed:${detail || "no-detail"}`]);
  }
  const issues = [];
  if (response?.requestMethod !== "HEAD") issues.push("publisher_head_response_method_invalid");
  if (response?.redirectsFollowed !== 0) issues.push("publisher_head_redirect_followed");
  if (response?.bodyBytesReceived !== 0) issues.push("publisher_head_unexpected_body");
  if (Number.isInteger(response?.statusCode) && response.statusCode >= 300 && response.statusCode < 400) {
    issues.push("publisher_head_redirect_forbidden");
  } else if (response?.statusCode !== lock.publisherArtifact.head.status) {
    issues.push("publisher_head_status_mismatch");
  }
  const headers = normalizedHeaders(response?.headers, response?.rawHeaders, issues);
  for (const name of forbiddenHeadHeaders) {
    if (headers.has(name)) issues.push(`publisher_head_forbidden_header:${name}`);
  }
  for (const [name, expected] of Object.entries(lock.publisherArtifact.head.headers)) {
    if (headers.get(name) !== expected) issues.push(`publisher_head_header_mismatch:${name}`);
  }
  if (issues.length > 0) throw new DinoSourceArtifactError(issues);
  return {
    schemaVersion: 1,
    status: "publisher-head-metadata-verified-payload-unverified-runtime-blocked",
    url: lock.publisherArtifact.url,
    requestMethod: "HEAD",
    statusCode: response.statusCode,
    redirectsFollowed: 0,
    observedHeaders: lock.publisherArtifact.head.headers,
    publisherSha256: null,
    observedSha256: null,
    responseBodyBytesDeliveredToVerifier: false,
    getFallbackAllowed: false,
    rangeFallbackAllowed: false,
    runtimeExecutedByVerifier: false,
    generationAllowed: false,
    openGates: lock.openGates
  };
}

async function main() {
  if (process.argv[2] === "--head") {
    if (process.argv.length > 4) throw new DinoSourceArtifactError(["head_cli_arguments_invalid"]);
    const lock = await loadWmmrDinoSourceArtifactLock(
      process.argv[3] ? resolve(process.argv[3]) : defaultLockPath
    );
    const result = await verifyDinoPublisherHead(lock);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  const repositoryDirectory = process.argv[2];
  if (!repositoryDirectory) {
    throw new Error("usage: node scripts/verify-dino-source-artifact.mjs <no-checkout-source-repository> [lock-path] | --head [lock-path]");
  }
  if (process.argv.length > 4) throw new DinoSourceArtifactError(["source_cli_arguments_invalid"]);
  const lock = await loadWmmrDinoSourceArtifactLock(
    process.argv[3] ? resolve(process.argv[3]) : defaultLockPath
  );
  const result = await verifyDinoSourceRepository(lock, resolve(repositoryDirectory));
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
