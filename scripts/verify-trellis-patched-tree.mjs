import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { loadSelectionPolicy } from "./verify-trellis-source-selection.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const defaultExperimentDirectory = resolve(repositoryRoot, "experiment/warm-modern-meeting-room");
const defaultArtifactLockPath = resolve(defaultExperimentDirectory, "artifact-lock.json");
const defaultArtifactRevisionLockPath = resolve(defaultExperimentDirectory, "artifact-revision-lock.json");
const defaultSourcePolicyPath = resolve(defaultExperimentDirectory, "trellis-source-selection-lock.json");
const defaultTreeDirectory = resolve(defaultExperimentDirectory, "trellis-patched-tree");
const scannerPath = resolve(import.meta.dirname, "scan-trellis-patched-tree.py");
const treeCanonicalization = "sort by ASCII path, then concatenate UTF-8 path, NUL, mode, NUL, decimal size, NUL, lowercase SHA-256, and LF";
const sourceMapCanonicalization = "sort by ASCII source path, then concatenate source path, NUL, source SHA-256, NUL, disposition, NUL, artifact path or empty, NUL, artifact SHA-256 or empty, and LF";
const expectedArtifactPath = "experiment/warm-modern-meeting-room/trellis-patched-tree";
const expectedBaseArtifactLockPath = "experiment/warm-modern-meeting-room/artifact-lock.json";
const expectedLockPath = "experiment/warm-modern-meeting-room/trellis-source-selection-lock.json";
const expectedOmissions = new Set([
  ".gitmodules",
  "README.md",
  "trellis/modules/sparse/attention/serialized_attn.py",
  "trellis/representations/mesh/flexicubes/DCO.txt",
  "trellis/representations/mesh/flexicubes/README.md"
]);
const expectedAuthoredPaths = new Set([
  "THIRD_PARTY_NOTICES.txt",
  "third_party/openai-glide/LICENSE.txt"
]);
const expectedOpenGates = new Set([
  "dinoSourceAndArtifactLock",
  "trellisModelArtifactLock",
  "dependencyWheelHashLock",
  "patchedPytorchQualification",
  "ociImageDigest",
  "sbomAndVulnerabilityReport",
  "offlineImportRuntimeTest",
  "gpuParityAndVramTest",
  "providerTermsSnapshot",
  "thirdPartyNoticeBundle",
  "humanRightsSignoff"
]);
const expectedCurrentOpenGates = new Set([
  "dependencyWheelHashLock",
  "gpuParityAndVramTest",
  "humanRightsSignoff",
  "ociImageDigest",
  "offlineImportRuntimeTest",
  "patchedPytorchQualification",
  "providerTermsSnapshot",
  "sbomAndVulnerabilityReport",
  "thirdPartyNoticeBundle"
]);
const expectedCurrentResolvedGates = new Set([
  "dinoArtifactPayloadBytesVerification",
  "dinoDerivedRuntimeArtifactLock",
  "dinoSourceAndArtifactLock",
  "dinoSourceGitObjectLock",
  "patchedSourceTreeDigest",
  "trellisModelArtifactLock",
  "trellisModelPayloadBytesVerification"
]);
const glideOrigin = Object.freeze({
  repository: "https://github.com/openai/glide-text2im.git",
  commit: "69b530740eb6cef69442d6180579ef5ba9ef063e",
  sourcePath: "LICENSE",
  sourceSha256: "86bbb73e855821d7c401912fd4bf82e34313e6e3b6fd6f909f2b6cc9e209a53b"
});

export class PatchedTreeError extends Error {
  constructor(issues) {
    super(`trellis_patched_tree_invalid:${issues.join(",")}`);
    this.name = "PatchedTreeError";
    this.issues = issues;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isSafeRelativePath(path) {
  return typeof path === "string"
    && path.length > 0
    && path !== "."
    && path !== ".."
    && !isAbsolute(path)
    && !path.includes("\\")
    && !path.includes("\0")
    && !path.startsWith("../")
    && /^[\x20-\x7e]+$/.test(path)
    && posix.normalize(path) === path;
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function requireExactKeys(value, expected, name, issues) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    issues.push(`${name}_invalid`);
    return;
  }
  if (!setEquals(new Set(Object.keys(value)), new Set(expected))) issues.push(`${name}_keys_invalid`);
}

function sortedUniqueStrings(value, name, issues) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
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

function hasTimestampKey(value) {
  if (Array.isArray(value)) return value.some(hasTimestampKey);
  if (value === null || typeof value !== "object") return false;
  return Object.entries(value).some(([key, nested]) => (
    /(?:^asOf$|At$|Date$|Timestamp$)/.test(key) || hasTimestampKey(nested)
  ));
}

function allowedArtifactPath(path) {
  if (typeof path !== "string") return false;
  if (path.split("/").some((component) => component.startsWith("."))) return false;
  return path === "LICENSE"
    || path === "THIRD_PARTY_NOTICES.txt"
    || path === "third_party/openai-glide/LICENSE.txt"
    || path === "trellis/representations/mesh/flexicubes/LICENSE.txt"
    || (path.startsWith("trellis/") && path.endsWith(".py"));
}

export function canonicalTreeDigest(files) {
  const canonical = [...files]
    .sort((left, right) => asciiCompare(left.path, right.path))
    .map(({ path, mode, size, sha256: digest }) => `${path}\0${mode}\0${size}\0${digest}\n`)
    .join("");
  return sha256(canonical);
}

export function canonicalArtifactDigest(lock) {
  const semantics = structuredClone(lock);
  delete semantics.artifactSha256;
  return sha256(stableJson(semantics));
}

export function canonicalArtifactRevisionDigest(lock) {
  const semantics = structuredClone(lock);
  delete semantics.artifactSha256;
  return sha256(stableJson(semantics));
}

export function canonicalSourceToArtifactDigest(dispositions, sourcePolicy, artifactFiles) {
  const sourceByPath = new Map(sourcePolicy.selection.files.map((file) => [file.path, file]));
  const artifactByPath = new Map(artifactFiles.map((file) => [file.path, file]));
  const canonical = [...dispositions]
    .sort((left, right) => asciiCompare(left.sourcePath, right.sourcePath))
    .map((disposition) => {
      const sourceHash = sourceByPath.get(disposition.sourcePath)?.sha256 ?? "";
      const artifactPath = disposition.artifactPath ?? "";
      const artifactHash = artifactPath ? artifactByPath.get(artifactPath)?.sha256 ?? "" : "";
      return `${disposition.sourcePath}\0${sourceHash}\0${disposition.disposition}\0${artifactPath}\0${artifactHash}\n`;
    })
    .join("");
  return sha256(canonical);
}

export function validateArtifactLock(lock, sourcePolicy) {
  const issues = [];
  requireExactKeys(lock, [
    "artifact",
    "artifactSha256",
    "authoredFiles",
    "boundaries",
    "openGates",
    "resolvedGates",
    "schemaVersion",
    "source",
    "sourceInputDispositions",
    "sourceToArtifact",
    "status"
  ], "artifact_lock", issues);
  if (lock?.schemaVersion !== 1) issues.push("invalid_schema_version");
  if (lock?.status !== "materialized-static-verified-runtime-blocked") issues.push("invalid_status");
  if (!/^[0-9a-f]{64}$/.test(lock?.artifactSha256 ?? "")) issues.push("invalid_artifact_digest");
  else if (lock.artifactSha256 !== canonicalArtifactDigest(lock)) issues.push("artifact_digest_mismatch");
  if (hasTimestampKey(lock)) issues.push("timestamp_in_digested_semantics");

  requireExactKeys(lock?.source, [
    "commit",
    "policySha256",
    "repository",
    "selectionLockPath",
    "selectionSha256",
    "submodules"
  ], "artifact_source", issues);
  if (lock?.source?.repository !== sourcePolicy.source.repository) issues.push("source_repository_mismatch");
  if (lock?.source?.commit !== sourcePolicy.source.commit) issues.push("source_commit_mismatch");
  if (lock?.source?.selectionLockPath !== expectedLockPath) issues.push("source_lock_path_mismatch");
  if (lock?.source?.selectionSha256 !== sourcePolicy.selection.selectionSha256) issues.push("source_selection_digest_mismatch");
  if (lock?.source?.policySha256 !== sourcePolicy.policySha256) issues.push("source_policy_digest_mismatch");
  if (stableJson(lock?.source?.submodules) !== stableJson(sourcePolicy.source.submodules)) {
    issues.push("source_submodules_mismatch");
  }

  requireExactKeys(lock?.artifact, [
    "canonicalization",
    "fileCount",
    "files",
    "path",
    "treeSha256"
  ], "artifact_tree", issues);
  if (lock?.artifact?.path !== expectedArtifactPath) issues.push("artifact_path_mismatch");
  if (lock?.artifact?.canonicalization !== treeCanonicalization) issues.push("tree_canonicalization_mismatch");
  if (!/^[0-9a-f]{64}$/.test(lock?.artifact?.treeSha256 ?? "")) issues.push("tree_digest_invalid");
  const files = lock?.artifact?.files;
  const artifactPaths = new Set();
  if (!Array.isArray(files) || files.length === 0) {
    issues.push("artifact_files_invalid");
  } else {
    for (const [index, file] of files.entries()) {
      const path = file?.path;
      requireExactKeys(file, ["mode", "path", "sha256", "size"], `artifact_file:${path ?? "missing"}`, issues);
      if (!isSafeRelativePath(path)) issues.push(`unsafe_artifact_path:${path ?? "missing"}`);
      if (artifactPaths.has(path)) issues.push(`duplicate_artifact_path:${path}`);
      artifactPaths.add(path);
      if (index > 0 && asciiCompare(files[index - 1].path, path) >= 0) issues.push("artifact_files_not_ascii_sorted");
      if (file?.mode !== "100644") issues.push(`artifact_mode_invalid:${path ?? "missing"}`);
      if (!Number.isSafeInteger(file?.size) || file.size < 0) issues.push(`artifact_size_invalid:${path ?? "missing"}`);
      if (!/^[0-9a-f]{64}$/.test(file?.sha256 ?? "")) issues.push(`artifact_hash_invalid:${path ?? "missing"}`);
      if (!allowedArtifactPath(path)) issues.push(`forbidden_artifact_class:${path ?? "missing"}`);
    }
    if (lock.artifact.fileCount !== files.length) issues.push("artifact_file_count_mismatch");
    if (files.length !== 50) issues.push(`unexpected_artifact_file_count:${files.length}`);
    if (lock.artifact.treeSha256 !== canonicalTreeDigest(files)) issues.push("tree_digest_mismatch");
  }

  const dispositions = lock?.sourceInputDispositions;
  const selectedByPath = new Map(sourcePolicy.selection.files.map((entry) => [entry.path, entry]));
  const dispositionBySource = new Map();
  const dispositionArtifactPaths = new Set();
  if (!Array.isArray(dispositions) || dispositions.length !== sourcePolicy.selection.fileCount) {
    issues.push("source_dispositions_count_mismatch");
  } else {
    for (const [index, disposition] of dispositions.entries()) {
      const sourcePath = disposition?.sourcePath;
      if (!selectedByPath.has(sourcePath)) issues.push(`disposition_source_not_selected:${sourcePath ?? "missing"}`);
      if (dispositionBySource.has(sourcePath)) issues.push(`duplicate_source_disposition:${sourcePath}`);
      dispositionBySource.set(sourcePath, disposition);
      if (index > 0 && asciiCompare(dispositions[index - 1].sourcePath, sourcePath) >= 0) {
        issues.push("source_dispositions_not_ascii_sorted");
      }
      if (!new Set(["copy", "omit", "patch"]).has(disposition?.disposition)) {
        issues.push(`invalid_source_disposition:${sourcePath ?? "missing"}`);
        continue;
      }
      requireExactKeys(
        disposition,
        disposition.disposition === "omit"
          ? ["disposition", "reason", "sourcePath"]
          : ["artifactPath", "disposition", "reason", "sourcePath"],
        `source_disposition:${sourcePath ?? "missing"}`,
        issues
      );
      if (typeof disposition?.reason !== "string" || !disposition.reason) {
        issues.push(`source_disposition_reason_missing:${sourcePath ?? "missing"}`);
      }
      if (disposition.disposition === "omit") {
        if (Object.hasOwn(disposition, "artifactPath")) issues.push(`omission_has_artifact_path:${sourcePath}`);
        if (artifactPaths.has(sourcePath)) issues.push(`omitted_source_shipped:${sourcePath}`);
        continue;
      }
      if (!isSafeRelativePath(disposition?.artifactPath)) issues.push(`invalid_disposition_artifact_path:${sourcePath}`);
      if (disposition.artifactPath !== sourcePath) issues.push(`source_path_remapped:${sourcePath}`);
      if (!artifactPaths.has(disposition.artifactPath)) issues.push(`disposition_artifact_missing:${sourcePath}`);
      if (dispositionArtifactPaths.has(disposition.artifactPath)) issues.push(`duplicate_disposition_artifact:${disposition.artifactPath}`);
      dispositionArtifactPaths.add(disposition.artifactPath);
      const artifactRecord = files?.find(({ path }) => path === disposition.artifactPath);
      const sourceRecord = selectedByPath.get(sourcePath);
      if (disposition.disposition === "copy" && artifactRecord?.sha256 !== sourceRecord?.sha256) {
        issues.push(`copy_hash_differs_from_source:${sourcePath}`);
      }
      if (disposition.disposition === "patch" && artifactRecord?.sha256 === sourceRecord?.sha256) {
        issues.push(`patch_hash_unchanged:${sourcePath}`);
      }
    }
  }
  for (const sourcePath of selectedByPath.keys()) {
    if (!dispositionBySource.has(sourcePath)) issues.push(`source_disposition_missing:${sourcePath}`);
  }
  const actualOmissions = new Set(
    [...dispositionBySource.values()]
      .filter(({ disposition }) => disposition === "omit")
      .map(({ sourcePath }) => sourcePath)
  );
  if (!setEquals(actualOmissions, expectedOmissions)) issues.push("omitted_source_set_invalid");
  for (const { path } of sourcePolicy.requiredPatches) {
    const expectedDisposition = path === "trellis/modules/sparse/attention/serialized_attn.py" ? "omit" : "patch";
    if (dispositionBySource.get(path)?.disposition !== expectedDisposition) {
      issues.push(`required_patch_disposition_invalid:${path}`);
    }
  }
  requireExactKeys(lock?.sourceToArtifact, ["canonicalization", "sha256"], "source_to_artifact", issues);
  if (lock?.sourceToArtifact?.canonicalization !== sourceMapCanonicalization) {
    issues.push("source_to_artifact_canonicalization_mismatch");
  }
  if (!/^[0-9a-f]{64}$/.test(lock?.sourceToArtifact?.sha256 ?? "")) {
    issues.push("source_to_artifact_digest_invalid");
  } else if (lock.sourceToArtifact.sha256 !== canonicalSourceToArtifactDigest(
    Array.isArray(dispositions) ? dispositions : [],
    sourcePolicy,
    Array.isArray(files) ? files : []
  )) {
    issues.push("source_to_artifact_digest_mismatch");
  }

  const authoredFiles = lock?.authoredFiles;
  const authoredPaths = new Set();
  if (!Array.isArray(authoredFiles)) {
    issues.push("authored_files_invalid");
  } else {
    for (const [index, authored] of authoredFiles.entries()) {
      requireExactKeys(authored, ["origin", "path"], `authored_file:${authored?.path ?? "missing"}`, issues);
      if (!isSafeRelativePath(authored?.path)) issues.push(`authored_path_invalid:${authored?.path ?? "missing"}`);
      if (authoredPaths.has(authored?.path)) issues.push(`duplicate_authored_path:${authored.path}`);
      authoredPaths.add(authored?.path);
      if (index > 0 && asciiCompare(authoredFiles[index - 1].path, authored.path) >= 0) issues.push("authored_files_not_ascii_sorted");
      if (!artifactPaths.has(authored?.path)) issues.push(`authored_artifact_missing:${authored?.path ?? "missing"}`);
      if (typeof authored?.origin?.kind !== "string" || !authored.origin.kind) {
        issues.push(`authored_origin_missing:${authored?.path ?? "missing"}`);
      }
    }
  }
  if (!setEquals(authoredPaths, expectedAuthoredPaths)) issues.push("authored_file_set_invalid");
  const notices = authoredFiles?.find(({ path }) => path === "THIRD_PARTY_NOTICES.txt");
  requireExactKeys(notices?.origin, ["description", "kind"], "third_party_notices_origin", issues);
  if (notices?.origin?.kind !== "project-authored-notice" || typeof notices.origin.description !== "string") {
    issues.push("third_party_notices_origin_invalid");
  }
  const glide = authoredFiles?.find(({ path }) => path === "third_party/openai-glide/LICENSE.txt");
  requireExactKeys(
    glide?.origin,
    ["commit", "kind", "repository", "sourcePath", "sourceSha256"],
    "glide_license_origin",
    issues
  );
  if (glide?.origin?.kind !== "verbatim-upstream-copy"
    || glide.origin.repository !== glideOrigin.repository
    || glide.origin.commit !== glideOrigin.commit
    || glide.origin.sourcePath !== glideOrigin.sourcePath
    || glide.origin.sourceSha256 !== glideOrigin.sourceSha256) {
    issues.push("glide_license_origin_invalid");
  }
  if (files?.find(({ path }) => path === "third_party/openai-glide/LICENSE.txt")?.sha256 !== glideOrigin.sourceSha256) {
    issues.push("glide_license_artifact_hash_invalid");
  }
  const coveredArtifactPaths = new Set([...dispositionArtifactPaths, ...authoredPaths]);
  if (!setEquals(coveredArtifactPaths, artifactPaths)) issues.push("artifact_origin_coverage_incomplete");

  const boundaries = lock?.boundaries;
  requireExactKeys(boundaries, [
    "cloudResourcesCreated",
    "generatedOutputsIncluded",
    "generationAllowed",
    "generationRun",
    "modelInputsDownloaded",
    "modelInputsIncluded",
    "runtimeImportGateClosed",
    "staticPolicySyntaxVerificationCiReproducible",
    "weightsDownloaded",
    "weightsIncluded"
  ], "artifact_boundaries", issues);
  for (const field of [
    "cloudResourcesCreated",
    "generatedOutputsIncluded",
    "generationAllowed",
    "generationRun",
    "modelInputsDownloaded",
    "modelInputsIncluded",
    "runtimeImportGateClosed",
    "weightsDownloaded",
    "weightsIncluded"
  ]) {
    if (boundaries?.[field] !== false) issues.push(`boundary_must_be_false:${field}`);
  }
  if (boundaries?.staticPolicySyntaxVerificationCiReproducible !== true) {
    issues.push("static_verification_ci_claim_missing");
  }
  if (boundaries?.runtimeImportGateClosed !== false) issues.push("runtime_import_gate_must_remain_open");
  const openGates = sortedUniqueStrings(lock?.openGates, "artifact_open_gates", issues);
  if (!setEquals(openGates, expectedOpenGates)) issues.push("artifact_open_gate_set_invalid");
  const resolvedGates = sortedUniqueStrings(lock?.resolvedGates, "artifact_resolved_gates", issues);
  if (!setEquals(resolvedGates, new Set(["patchedSourceTreeDigest"]))) issues.push("artifact_resolved_gate_set_invalid");
  if (!sourcePolicy.openGates.includes("patchedSourceTreeDigest")) issues.push("historical_source_tree_gate_missing");
  for (const gate of openGates) {
    if (!sourcePolicy.openGates.includes(gate)) issues.push(`artifact_gate_not_in_source_policy:${gate}`);
  }

  if (issues.length > 0) throw new PatchedTreeError([...new Set(issues)]);
  return lock;
}

export function validateArtifactRevisionLock(lock, baseLock, sourcePolicy) {
  const issues = [];
  requireExactKeys(lock, [
    "artifact",
    "artifactSha256",
    "baseArtifactLock",
    "boundaries",
    "gateEffect",
    "gateSnapshot",
    "openGates",
    "replacements",
    "resolvedGates",
    "schemaVersion",
    "sourceToArtifact",
    "status"
  ], "artifact_revision_lock", issues);
  if (lock?.schemaVersion !== 1) issues.push("artifact_revision_schema_invalid");
  if (lock?.status !== "materialized-static-verified-constructor-allocation-deferred-runtime-blocked") {
    issues.push("artifact_revision_status_invalid");
  }
  if (!/^[0-9a-f]{64}$/.test(lock?.artifactSha256 ?? "")) issues.push("artifact_revision_digest_invalid");
  else if (lock.artifactSha256 !== canonicalArtifactRevisionDigest(lock)) issues.push("artifact_revision_digest_mismatch");
  if (hasTimestampKey(lock)) issues.push("artifact_revision_timestamp_forbidden");

  requireExactKeys(lock?.baseArtifactLock, ["artifactSha256", "path", "treeSha256"], "artifact_revision_base", issues);
  if (lock?.baseArtifactLock?.path !== expectedBaseArtifactLockPath) issues.push("artifact_revision_base_path_invalid");
  if (lock?.baseArtifactLock?.artifactSha256 !== baseLock.artifactSha256) issues.push("artifact_revision_base_digest_mismatch");
  if (lock?.baseArtifactLock?.treeSha256 !== baseLock.artifact.treeSha256) issues.push("artifact_revision_base_tree_mismatch");

  requireExactKeys(lock?.artifact, ["fileCount", "path", "revision", "treeSha256"], "artifact_revision_tree", issues);
  if (lock?.artifact?.path !== expectedArtifactPath) issues.push("artifact_revision_path_invalid");
  if (lock?.artifact?.revision !== 2) issues.push("artifact_revision_number_invalid");
  if (lock?.artifact?.fileCount !== baseLock.artifact.fileCount) issues.push("artifact_revision_file_count_invalid");

  const replacements = lock?.replacements;
  const replacementPaths = new Set();
  const files = structuredClone(baseLock.artifact.files);
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  if (!Array.isArray(replacements) || replacements.length !== 1) {
    issues.push("artifact_replacements_invalid");
  } else {
    for (const [index, replacement] of replacements.entries()) {
      requireExactKeys(
        replacement,
        ["path", "previousSha256", "previousSize", "reason", "sha256", "size"],
        `artifact_replacement:${replacement?.path ?? "missing"}`,
        issues
      );
      if (!isSafeRelativePath(replacement?.path) || !allowedArtifactPath(replacement.path)) {
        issues.push(`artifact_replacement_path_invalid:${replacement?.path ?? "missing"}`);
      }
      if (replacementPaths.has(replacement?.path)) issues.push(`artifact_replacement_duplicate:${replacement.path}`);
      replacementPaths.add(replacement?.path);
      if (index > 0 && asciiCompare(replacements[index - 1].path, replacement.path) >= 0) {
        issues.push("artifact_replacements_not_ascii_sorted");
      }
      const previous = filesByPath.get(replacement?.path);
      if (!previous) issues.push(`artifact_replacement_base_missing:${replacement?.path ?? "missing"}`);
      if (replacement?.previousSize !== previous?.size) issues.push(`artifact_replacement_previous_size_mismatch:${replacement?.path ?? "missing"}`);
      if (replacement?.previousSha256 !== previous?.sha256) issues.push(`artifact_replacement_previous_hash_mismatch:${replacement?.path ?? "missing"}`);
      if (!Number.isSafeInteger(replacement?.size) || replacement.size < 0) issues.push(`artifact_replacement_size_invalid:${replacement?.path ?? "missing"}`);
      if (!/^[0-9a-f]{64}$/.test(replacement?.sha256 ?? "")) issues.push(`artifact_replacement_hash_invalid:${replacement?.path ?? "missing"}`);
      if (replacement?.sha256 === previous?.sha256) issues.push(`artifact_replacement_unchanged:${replacement?.path ?? "missing"}`);
      if (typeof replacement?.reason !== "string" || !replacement.reason) issues.push(`artifact_replacement_reason_missing:${replacement?.path ?? "missing"}`);
      if (previous) Object.assign(previous, { size: replacement.size, sha256: replacement.sha256 });
    }
  }
  if (!replacementPaths.has("trellis/representations/mesh/cube2mesh.py")) {
    issues.push("artifact_mesh_revision_missing");
  }
  if (lock?.artifact?.treeSha256 !== canonicalTreeDigest(files)) issues.push("artifact_revision_tree_digest_mismatch");

  requireExactKeys(lock?.sourceToArtifact, ["canonicalization", "sha256"], "artifact_revision_source_map", issues);
  if (lock?.sourceToArtifact?.canonicalization !== sourceMapCanonicalization) {
    issues.push("artifact_revision_source_map_canonicalization_invalid");
  }
  if (lock?.sourceToArtifact?.sha256 !== canonicalSourceToArtifactDigest(baseLock.sourceInputDispositions, sourcePolicy, files)) {
    issues.push("artifact_revision_source_map_digest_mismatch");
  }

  requireExactKeys(lock?.boundaries, [
    "constructorDeviceAllocationDeferred",
    "generationAllowed",
    "runtimeImportGateClosed",
    "staticPolicySyntaxVerificationCiReproducible",
    "strictStateDictLoadExecuted",
    "weightsIncluded"
  ], "artifact_revision_boundaries", issues);
  if (lock?.boundaries?.constructorDeviceAllocationDeferred !== true) issues.push("artifact_revision_deferred_allocation_claim_missing");
  if (lock?.boundaries?.staticPolicySyntaxVerificationCiReproducible !== true) issues.push("artifact_revision_static_verification_claim_missing");
  for (const field of ["generationAllowed", "runtimeImportGateClosed", "strictStateDictLoadExecuted", "weightsIncluded"]) {
    if (lock?.boundaries?.[field] !== false) issues.push(`artifact_revision_boundary_must_be_false:${field}`);
  }
  if (lock?.gateSnapshot !== "historical-at-artifact-revision") issues.push("artifact_revision_gate_snapshot_invalid");
  const openGates = sortedUniqueStrings(lock?.openGates, "artifact_revision_open_gates", issues);
  if (!setEquals(openGates, expectedCurrentOpenGates)) issues.push("artifact_revision_open_gate_set_invalid");
  const resolvedGates = sortedUniqueStrings(lock?.resolvedGates, "artifact_revision_resolved_gates", issues);
  if (!setEquals(resolvedGates, expectedCurrentResolvedGates)) issues.push("artifact_revision_resolved_gate_set_invalid");
  requireExactKeys(lock?.gateEffect, [
    "directlyResolvedGates",
    "doesNotResolveCompositeGates",
    "doesNotResolveOtherGates"
  ], "artifact_revision_gate_effect", issues);
  if (stableJson(lock?.gateEffect?.directlyResolvedGates) !== stableJson(["patchedSourceTreeDigest"])) {
    issues.push("artifact_revision_direct_gate_effect_invalid");
  }
  if (lock?.gateEffect?.doesNotResolveCompositeGates !== true || lock?.gateEffect?.doesNotResolveOtherGates !== true) {
    issues.push("artifact_revision_gate_boundary_invalid");
  }
  if (issues.length > 0) throw new PatchedTreeError([...new Set(issues)]);
  return {
    ...structuredClone(baseLock),
    artifactSha256: lock.artifactSha256,
    status: lock.status,
    artifact: {
      ...structuredClone(baseLock.artifact),
      treeSha256: lock.artifact.treeSha256,
      files
    },
    sourceToArtifact: structuredClone(lock.sourceToArtifact),
    boundaries: structuredClone(lock.boundaries),
    openGates: structuredClone(lock.openGates),
    resolvedGates: structuredClone(lock.resolvedGates)
  };
}

export async function loadCurrentPatchedTreeLock({
  artifactLockPath = defaultArtifactLockPath,
  artifactRevisionLockPath = defaultArtifactRevisionLockPath,
  sourcePolicyPath = defaultSourcePolicyPath
} = {}) {
  const sourcePolicy = await loadSelectionPolicy(resolve(sourcePolicyPath));
  const baseLock = JSON.parse(await readFile(resolve(artifactLockPath), "utf8"));
  validateArtifactLock(baseLock, sourcePolicy);
  const revisionLock = JSON.parse(await readFile(resolve(artifactRevisionLockPath), "utf8"));
  const effectiveLock = validateArtifactRevisionLock(revisionLock, baseLock, sourcePolicy);
  return { baseLock, effectiveLock, revisionLock, sourcePolicy };
}

async function walkTree(root) {
  const files = [];
  const directories = [];
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => asciiCompare(left.name, right.name));
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      const metadata = await lstat(path);
      const relativePath = relative(root, path).split(sep).join("/");
      if (!isSafeRelativePath(relativePath)) throw new PatchedTreeError([`unsafe_actual_path:${relativePath}`]);
      if (metadata.isSymbolicLink()) throw new PatchedTreeError([`symlink_rejected:${relativePath}`]);
      if (metadata.isDirectory()) {
        directories.push({ path: relativePath, metadata });
        await walk(path);
      }
      else if (metadata.isFile()) files.push({ path: relativePath, metadata });
      else throw new PatchedTreeError([`unsafe_actual_file_type:${relativePath}`]);
    }
  }
  await walk(root);
  return { directories, files };
}

function expectedTreeDirectories(files) {
  const directories = new Set();
  for (const { path } of files) {
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index += 1) {
      directories.add(parts.slice(0, index).join("/"));
    }
  }
  return directories;
}

export async function verifyTreeBytes(lock, treeDirectory) {
  const issues = [];
  const rootMetadata = await lstat(treeDirectory);
  const root = await realpath(treeDirectory);
  if (!rootMetadata.isDirectory() || rootMetadata.isSymbolicLink() || root !== resolve(treeDirectory)) {
    throw new PatchedTreeError(["unsafe_tree_root"]);
  }
  if ((rootMetadata.mode & 0o7777) !== 0o755) {
    throw new PatchedTreeError(["tree_root_mode_drift"]);
  }
  const expectedByPath = new Map(lock.artifact.files.map((file) => [file.path, file]));
  const { directories, files: actual } = await walkTree(root);
  const actualPaths = new Set(actual.map(({ path }) => path));
  const expectedDirectories = expectedTreeDirectories(lock.artifact.files);
  const actualDirectories = new Set(directories.map(({ path }) => path));
  for (const directory of expectedDirectories) {
    if (!actualDirectories.has(directory)) issues.push(`missing_artifact_directory:${directory}`);
  }
  for (const { path, metadata } of directories) {
    if (!expectedDirectories.has(path)) issues.push(`extra_artifact_directory:${path}`);
    if ((metadata.mode & 0o7777) !== 0o755) issues.push(`directory_mode_drift:${path}`);
  }
  for (const expectedPath of expectedByPath.keys()) {
    if (!actualPaths.has(expectedPath)) issues.push(`missing_artifact_file:${expectedPath}`);
  }
  for (const { path } of actual) {
    if (!expectedByPath.has(path)) issues.push(`extra_artifact_file:${path}`);
  }

  const actualRecords = [];
  for (const { path, metadata } of actual) {
    if ((metadata.mode & 0o7777) !== 0o644) issues.push(`mode_drift:${path}`);
    const bytes = await readFile(resolve(root, path));
    const record = { path, mode: "100644", size: bytes.byteLength, sha256: sha256(bytes) };
    actualRecords.push(record);
    const expected = expectedByPath.get(path);
    if (!expected) continue;
    if (record.size !== expected.size) issues.push(`size_drift:${path}`);
    if (record.sha256 !== expected.sha256) issues.push(`hash_drift:${path}`);
  }
  if (actualRecords.length === lock.artifact.fileCount
    && canonicalTreeDigest(actualRecords) !== lock.artifact.treeSha256) {
    issues.push("actual_tree_digest_mismatch");
  }
  if (issues.length > 0) throw new PatchedTreeError(issues);
  return { fileCount: actualRecords.length, treeSha256: lock.artifact.treeSha256 };
}

export async function runStaticPolicyScan(
  treeDirectory,
  sourcePolicyPath = defaultSourcePolicyPath,
  { pythonExecutable = process.env.PYTHON ?? "python3" } = {}
) {
  try {
    const { stdout } = await execFileAsync(
      pythonExecutable,
      [scannerPath, resolve(treeDirectory), resolve(sourcePolicyPath)],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024 }
    );
    return JSON.parse(stdout);
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? "unknown").trim().replaceAll(",", ";");
    throw new PatchedTreeError([`static_policy_scan_failed:${detail}`]);
  }
}

export async function verifyPatchedTree({
  artifactLockPath = defaultArtifactLockPath,
  artifactRevisionLockPath = defaultArtifactRevisionLockPath,
  sourcePolicyPath = defaultSourcePolicyPath,
  treeDirectory = defaultTreeDirectory,
  pythonExecutable
} = {}) {
  const { effectiveLock: lock } = await loadCurrentPatchedTreeLock({
    artifactLockPath,
    artifactRevisionLockPath,
    sourcePolicyPath
  });
  const tree = await verifyTreeBytes(lock, resolve(treeDirectory));
  const staticScan = await runStaticPolicyScan(treeDirectory, sourcePolicyPath, { pythonExecutable });
  return {
    schemaVersion: 1,
    status: lock.status,
    artifactSha256: lock.artifactSha256,
    treeSha256: tree.treeSha256,
    fileCount: tree.fileCount,
    staticVerification: staticScan,
    generationAllowed: false,
    openGates: lock.openGates
  };
}

async function main() {
  const treeDirectory = process.argv[2] ? resolve(process.argv[2]) : defaultTreeDirectory;
  const artifactLockPath = process.argv[3] ? resolve(process.argv[3]) : defaultArtifactLockPath;
  const sourcePolicyPath = process.argv[4] ? resolve(process.argv[4]) : defaultSourcePolicyPath;
  process.stdout.write(`${JSON.stringify(await verifyPatchedTree({ treeDirectory, artifactLockPath, sourcePolicyPath }), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
