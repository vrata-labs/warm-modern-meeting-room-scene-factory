import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";
import { TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const defaultLockPath = resolve(
  import.meta.dirname,
  "../experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json"
);
const lockStatus = "publisher-git-lfs-identity-locked-payload-unverified-runtime-blocked";
const inventoryCanonicalization = "SHA-256 of stable JSON for complete inventory records sorted by ASCII path";
const lfsVersion = "https://git-lfs.github.com/spec/v1";
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const roles = new Set([
  "lfs-rules",
  "model-card",
  "model-config",
  "model-payload-pointer",
  "pipeline-manifest"
]);
const dispositions = new Set([
  "evidence-only",
  "ignored-appearance",
  "ignored-unreferenced",
  "selected"
]);
const falseBoundaryFields = Object.freeze([
  "cloudResourcesCreated",
  "generationAllowed",
  "lfsPayloadBytesIndependentlyVerified",
  "lfsPayloadsDownloaded",
  "modelInputsDownloaded",
  "runtimeExecuted",
  "weightsIncluded"
]);
const wmmrOpenGates = Object.freeze([
  "dependencyWheelHashLock",
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
const wmmrPipelineModels = Object.freeze([
  {
    key: "slat_decoder_gs",
    stem: "ckpts/slat_dec_gs_swin8_B_64l8gs32_fp16",
    className: "SLatGaussianDecoder",
    disposition: "ignored-appearance"
  },
  {
    key: "slat_decoder_mesh",
    stem: "ckpts/slat_dec_mesh_swin8_B_64l8m256c_fp16",
    className: "SLatMeshDecoder",
    disposition: "selected"
  },
  {
    key: "slat_decoder_rf",
    stem: "ckpts/slat_dec_rf_swin8_B_64l8r16_fp16",
    className: "SLatRadianceFieldDecoder",
    disposition: "ignored-appearance"
  },
  {
    key: "slat_flow_model",
    stem: "ckpts/slat_flow_img_dit_L_64l8p2_fp16",
    className: "SLatFlowModel",
    disposition: "selected"
  },
  {
    key: "sparse_structure_decoder",
    stem: "ckpts/ss_dec_conv3d_16l8_fp16",
    className: "SparseStructureDecoder",
    disposition: "selected"
  },
  {
    key: "sparse_structure_flow_model",
    stem: "ckpts/ss_flow_img_dit_L_16l8_fp16",
    className: "SparseStructureFlowModel",
    disposition: "selected"
  }
]);
const artifactGateMeaning = "Publisher repository, commit, tree, raw Git blobs, configs, and canonical Git LFS pointer identity only; LFS payload bytes and runtime compatibility are not verified.";
const payloadGateMeaning = "Ingest the four selected LFS payloads into restricted storage, independently verify each payload SHA-256 and size against its publisher pointer, and retain that evidence before launch.";
const wmmrExpected = Object.freeze({
  repository: "https://huggingface.co/microsoft/TRELLIS-image-large",
  commit: "25e0d31ffbebe4b5a97464dd851910efc3002d96",
  treeOid: "867a6b9c2f0ddd5e72f999640bba55421655c2f9",
  objectFormat: "sha1",
  fileCount: 19,
  normalBlobCount: 11,
  lfsPointerCount: 8,
  selectedPayloadCount: 4,
  selectedPayloadTotalSize: 2664021360,
  inventorySha256: "e3d5763cedba5e2b9680ad4f57af044928a07d8d82fb93f25b27d5eabf2143f1",
  lockSha256: "d0046a083406c02dd67fd508b917750bc52f8e893527b4e39fa71abda0a6baa9"
});

export class TrellisModelArtifactError extends Error {
  constructor(issues) {
    const uniqueIssues = [...new Set(issues)];
    super(`trellis_model_artifact_invalid:${uniqueIssues.join(",")}`);
    this.name = "TrellisModelArtifactError";
    this.issues = uniqueIssues;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function setEquals(left, right) {
  return left.size === right.size && [...left].every((entry) => right.has(entry));
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function isSafeModelStem(stem) {
  return isSafeRelativePath(stem)
    && /^ckpts\/[A-Za-z0-9_.-]+$/.test(stem)
    && !stem.endsWith(".json")
    && !stem.endsWith(".safetensors");
}

function isSafePipelineKey(key) {
  return typeof key === "string" && /^[a-z][a-z0-9_]*$/.test(key);
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
  if (!isObject(value)) return false;
  return Object.entries(value).some(([key, nested]) => (
    /(?:^asOf$|At$|Date$|Timestamp$)/.test(key) || hasTimestampKey(nested)
  ));
}

function oidPattern(objectFormat) {
  if (objectFormat === "sha1") return /^[0-9a-f]{40}$/;
  if (objectFormat === "sha256") return /^[0-9a-f]{64}$/;
  return /$a/;
}

export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.keys(value).sort(asciiCompare).map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalInventoryDigest(files) {
  return sha256(stableJson([...files].sort((left, right) => asciiCompare(left.path, right.path))));
}

export function canonicalLockDigest(lock) {
  const semantics = structuredClone(lock);
  delete semantics.lockSha256;
  return sha256(stableJson(semantics));
}

export function canonicalLfsPointerBytes(lfs) {
  return Buffer.from(
    `version ${lfs.version}\noid sha256:${lfs.oidSha256}\nsize ${lfs.payloadSize}\n`,
    "ascii"
  );
}

export function parseCanonicalLfsPointer(bytes) {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new TrellisModelArtifactError(["lfs_pointer_not_canonical"]);
  }
  let text;
  try {
    text = utf8.decode(bytes);
  } catch {
    throw new TrellisModelArtifactError(["lfs_pointer_not_utf8"]);
  }
  const match = /^version https:\/\/git-lfs\.github\.com\/spec\/v1\noid sha256:([0-9a-f]{64})\nsize (0|[1-9][0-9]*)\n$/.exec(text);
  if (!match) throw new TrellisModelArtifactError(["lfs_pointer_not_canonical"]);
  const payloadSize = Number(match[2]);
  if (!Number.isSafeInteger(payloadSize) || payloadSize <= 0) {
    throw new TrellisModelArtifactError(["lfs_pointer_size_invalid"]);
  }
  return { version: lfsVersion, oidSha256: match[1], payloadSize };
}

export function gitObjectOid(type, bytes, objectFormat) {
  if (!new Set(["blob", "commit", "tree"]).has(type)) {
    throw new TrellisModelArtifactError([`git_object_type_invalid:${type}`]);
  }
  const header = Buffer.from(`${type} ${bytes.byteLength}\0`, "ascii");
  return createHash(objectFormat).update(header).update(bytes).digest("hex");
}

function validateInventory(lock, issues) {
  const inventory = lock?.inventory;
  requireExactKeys(inventory, [
    "canonicalization",
    "fileCount",
    "files",
    "inventorySha256",
    "lfsPointerCount",
    "normalBlobCount"
  ], "inventory", issues);
  if (inventory?.canonicalization !== inventoryCanonicalization) issues.push("inventory_canonicalization_invalid");
  if (!/^[0-9a-f]{64}$/.test(inventory?.inventorySha256 ?? "")) issues.push("inventory_digest_invalid");

  const files = inventory?.files;
  if (!Array.isArray(files) || files.length === 0) {
    issues.push("inventory_files_invalid");
    return { byPath: new Map(), configsByStem: new Map(), pointersByStem: new Map() };
  }
  if (!files.every(isObject)) {
    for (const [index, file] of files.entries()) {
      if (!isObject(file)) issues.push(`inventory_file_not_object:${index}`);
    }
    return { byPath: new Map(), configsByStem: new Map(), pointersByStem: new Map() };
  }

  const byPath = new Map();
  const configsByStem = new Map();
  const pointersByStem = new Map();
  const objectOidRegex = oidPattern(lock?.source?.objectFormat);
  for (const [index, file] of files.entries()) {
    const path = file?.path;
    if (!isSafeRelativePath(path)) issues.push(`inventory_path_unsafe:${path ?? "missing"}`);
    if (byPath.has(path)) issues.push(`inventory_path_duplicate:${path}`);
    byPath.set(path, file);
    if (index > 0 && asciiCompare(files[index - 1]?.path, path) >= 0) issues.push("inventory_not_ascii_sorted");
    if (file?.mode !== "100644") issues.push(`inventory_mode_invalid:${path ?? "missing"}`);
    if (!roles.has(file?.role)) issues.push(`inventory_role_invalid:${path ?? "missing"}`);
    if (!dispositions.has(file?.disposition)) issues.push(`inventory_disposition_invalid:${path ?? "missing"}`);

    const expectedKeys = ["disposition", "gitBlob", "mode", "path", "role"];
    if (file?.role === "model-config") expectedKeys.push("modelClass");
    if (file?.role === "model-payload-pointer") expectedKeys.push("lfs");
    requireExactKeys(file, expectedKeys, `inventory_file:${path ?? "missing"}`, issues);
    requireExactKeys(file?.gitBlob, ["oid", "sha256", "size"], `git_blob:${path ?? "missing"}`, issues);
    if (!objectOidRegex.test(file?.gitBlob?.oid ?? "")) issues.push(`git_blob_oid_invalid:${path ?? "missing"}`);
    if (!Number.isSafeInteger(file?.gitBlob?.size) || file.gitBlob.size < 0) issues.push(`git_blob_size_invalid:${path ?? "missing"}`);
    if (!/^[0-9a-f]{64}$/.test(file?.gitBlob?.sha256 ?? "")) issues.push(`git_blob_sha256_invalid:${path ?? "missing"}`);

    if (file?.role === "lfs-rules" || file?.role === "model-card") {
      if (file.disposition !== "evidence-only") issues.push(`evidence_disposition_invalid:${path}`);
    } else if (file?.role === "pipeline-manifest") {
      if (file.disposition !== "selected") issues.push(`pipeline_disposition_invalid:${path}`);
    } else if (!["ignored-appearance", "ignored-unreferenced", "selected"].includes(file?.disposition)) {
      issues.push(`model_disposition_invalid:${path ?? "missing"}`);
    }

    if (file?.role === "model-config") {
      if (!path?.endsWith(".json")) issues.push(`model_config_path_invalid:${path ?? "missing"}`);
      if (typeof file?.modelClass !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(file.modelClass)) {
        issues.push(`model_config_class_invalid:${path ?? "missing"}`);
      }
      const stem = path?.slice(0, -".json".length);
      if (configsByStem.has(stem)) issues.push(`model_config_stem_duplicate:${stem}`);
      configsByStem.set(stem, file);
    }

    if (file?.role === "model-payload-pointer") {
      if (!path?.endsWith(".safetensors")) issues.push(`model_pointer_path_invalid:${path ?? "missing"}`);
      requireExactKeys(file?.lfs, ["oidSha256", "payloadSize", "version"], `lfs:${path ?? "missing"}`, issues);
      if (file?.lfs?.version !== lfsVersion) issues.push(`lfs_version_invalid:${path ?? "missing"}`);
      if (!/^[0-9a-f]{64}$/.test(file?.lfs?.oidSha256 ?? "")) issues.push(`lfs_oid_invalid:${path ?? "missing"}`);
      if (!Number.isSafeInteger(file?.lfs?.payloadSize) || file.lfs.payloadSize <= 0) {
        issues.push(`lfs_payload_size_invalid:${path ?? "missing"}`);
      }
      if (isObject(file?.lfs)
        && file.lfs.version === lfsVersion
        && /^[0-9a-f]{64}$/.test(file.lfs.oidSha256 ?? "")
        && Number.isSafeInteger(file.lfs.payloadSize)
        && file.lfs.payloadSize > 0
        && new Set(["sha1", "sha256"]).has(lock?.source?.objectFormat)) {
        const pointerBytes = canonicalLfsPointerBytes(file.lfs);
        if (file?.gitBlob?.size !== pointerBytes.byteLength) issues.push(`lfs_raw_size_mismatch:${path}`);
        if (file?.gitBlob?.sha256 !== sha256(pointerBytes)) issues.push(`lfs_raw_sha256_mismatch:${path}`);
        if (file?.gitBlob?.oid !== gitObjectOid("blob", pointerBytes, lock.source.objectFormat)) {
          issues.push(`lfs_git_blob_oid_mismatch:${path}`);
        }
      }
      const stem = path?.slice(0, -".safetensors".length);
      if (pointersByStem.has(stem)) issues.push(`model_pointer_stem_duplicate:${stem}`);
      pointersByStem.set(stem, file);
    }
  }

  const pointerCount = files.filter(({ role }) => role === "model-payload-pointer").length;
  if (inventory.fileCount !== files.length) issues.push("inventory_file_count_mismatch");
  if (inventory.lfsPointerCount !== pointerCount) issues.push("inventory_lfs_pointer_count_mismatch");
  if (inventory.normalBlobCount !== files.length - pointerCount) issues.push("inventory_normal_blob_count_mismatch");
  if (inventory.inventorySha256 !== canonicalInventoryDigest(files)) issues.push("inventory_digest_mismatch");
  const lfsRuleFiles = files.filter(({ role }) => role === "lfs-rules");
  const modelCardFiles = files.filter(({ role }) => role === "model-card");
  const pipelineFiles = files.filter(({ role }) => role === "pipeline-manifest");
  if (lfsRuleFiles.length !== 1 || lfsRuleFiles[0]?.path !== ".gitattributes") issues.push("lfs_rules_record_invalid");
  if (modelCardFiles.length !== 1) issues.push("model_card_record_count_invalid");
  if (pipelineFiles.length !== 1) issues.push("pipeline_record_count_invalid");
  if (!setEquals(new Set(configsByStem.keys()), new Set(pointersByStem.keys()))) issues.push("model_config_pointer_stems_mismatch");
  for (const [stem, config] of configsByStem) {
    const pointer = pointersByStem.get(stem);
    if (pointer && config.disposition !== pointer.disposition) issues.push(`model_pair_disposition_mismatch:${stem}`);
  }
  return { byPath, configsByStem, pointersByStem };
}

function validatePipeline(lock, inventoryState, issues) {
  const pipeline = lock?.pipeline;
  requireExactKeys(pipeline, ["className", "imageConditioning", "models", "path"], "pipeline", issues);
  if (!isSafeRelativePath(pipeline?.path)) issues.push("pipeline_path_invalid");
  const pipelineFile = inventoryState.byPath.get(pipeline?.path);
  if (pipelineFile?.role !== "pipeline-manifest" || pipelineFile?.disposition !== "selected") {
    issues.push("pipeline_inventory_record_invalid");
  }
  if (typeof pipeline?.className !== "string" || !/^[A-Za-z][A-Za-z0-9]*$/.test(pipeline.className)) {
    issues.push("pipeline_class_invalid");
  }
  requireExactKeys(
    pipeline?.imageConditioning,
    ["model", "normalizationMeanLength", "normalizationStdLength"],
    "pipeline_image_conditioning",
    issues
  );
  if (typeof pipeline?.imageConditioning?.model !== "string" || !pipeline.imageConditioning.model) {
    issues.push("pipeline_image_conditioning_model_invalid");
  }
  for (const field of ["normalizationMeanLength", "normalizationStdLength"]) {
    if (!Number.isSafeInteger(pipeline?.imageConditioning?.[field]) || pipeline.imageConditioning[field] <= 0) {
      issues.push(`pipeline_${field}_invalid`);
    }
  }

  if (!Array.isArray(pipeline?.models) || pipeline.models.length === 0) {
    issues.push("pipeline_models_invalid");
    return;
  }
  const keys = new Set();
  const stems = new Set();
  for (const [index, model] of pipeline.models.entries()) {
    requireExactKeys(model, ["className", "disposition", "key", "stem"], `pipeline_model:${model?.key ?? "missing"}`, issues);
    if (!isSafePipelineKey(model?.key)) issues.push(`pipeline_model_key_invalid:${model?.key ?? "missing"}`);
    if (keys.has(model?.key)) issues.push(`pipeline_model_key_duplicate:${model.key}`);
    keys.add(model?.key);
    if (index > 0 && asciiCompare(pipeline.models[index - 1]?.key, model?.key) >= 0) issues.push("pipeline_models_not_ascii_sorted");
    if (!isSafeModelStem(model?.stem)) issues.push(`pipeline_model_stem_invalid:${model?.key ?? "missing"}`);
    if (stems.has(model?.stem)) issues.push(`pipeline_model_stem_duplicate:${model?.stem ?? "missing"}`);
    stems.add(model?.stem);
    if (!["ignored-appearance", "selected"].includes(model?.disposition)) {
      issues.push(`pipeline_model_disposition_invalid:${model?.key ?? "missing"}`);
    }
    const config = inventoryState.configsByStem.get(model?.stem);
    const pointer = inventoryState.pointersByStem.get(model?.stem);
    if (!config || !pointer) issues.push(`pipeline_model_pair_missing:${model?.key ?? "missing"}`);
    if (config?.modelClass !== model?.className) issues.push(`pipeline_model_class_mismatch:${model?.key ?? "missing"}`);
    if (config?.disposition !== model?.disposition || pointer?.disposition !== model?.disposition) {
      issues.push(`pipeline_model_inventory_disposition_mismatch:${model?.key ?? "missing"}`);
    }
  }
  const expectedPipelineStems = new Set(
    [...inventoryState.configsByStem]
      .filter(([, config]) => config.disposition !== "ignored-unreferenced")
      .map(([stem]) => stem)
  );
  if (!setEquals(stems, expectedPipelineStems)) issues.push("pipeline_model_stem_set_invalid");
}

function validateSelectedPayloads(lock, inventoryState, issues) {
  const selectedPayloads = lock?.selectedPayloads;
  requireExactKeys(selectedPayloads, ["count", "payloads", "totalSize"], "selected_payloads", issues);
  const payloads = selectedPayloads?.payloads;
  if (!Array.isArray(payloads) || payloads.length === 0) {
    issues.push("selected_payload_records_invalid");
    return;
  }
  const paths = new Set();
  let totalSize = 0n;
  if (!Number.isSafeInteger(selectedPayloads?.totalSize) || selectedPayloads.totalSize <= 0) {
    issues.push("selected_payload_total_invalid");
  }
  for (const [index, payload] of payloads.entries()) {
    requireExactKeys(payload, ["id", "oidSha256", "path", "payloadSize"], `selected_payload:${payload?.id ?? "missing"}`, issues);
    if (typeof payload?.id !== "string" || !/^[A-Za-z0-9_.-]+$/.test(payload.id)) {
      issues.push(`selected_payload_id_invalid:${payload?.id ?? "missing"}`);
    }
    if (index > 0 && asciiCompare(payloads[index - 1]?.id, payload?.id) >= 0) issues.push("selected_payloads_not_ascii_sorted");
    if (!isSafeRelativePath(payload?.path)) issues.push(`selected_payload_path_invalid:${payload?.id ?? "missing"}`);
    if (paths.has(payload?.path)) issues.push(`selected_payload_path_duplicate:${payload?.path ?? "missing"}`);
    paths.add(payload?.path);
    if (!/^[0-9a-f]{64}$/.test(payload?.oidSha256 ?? "")) issues.push(`selected_payload_oid_invalid:${payload?.id ?? "missing"}`);
    if (!Number.isSafeInteger(payload?.payloadSize) || payload.payloadSize <= 0) {
      issues.push(`selected_payload_size_invalid:${payload?.id ?? "missing"}`);
    } else {
      totalSize += BigInt(payload.payloadSize);
    }
    const pointer = inventoryState.byPath.get(payload?.path);
    if (pointer?.role !== "model-payload-pointer" || pointer?.disposition !== "selected") {
      issues.push(`selected_payload_inventory_record_invalid:${payload?.id ?? "missing"}`);
    }
    if (pointer?.lfs?.oidSha256 !== payload?.oidSha256 || pointer?.lfs?.payloadSize !== payload?.payloadSize) {
      issues.push(`selected_payload_pointer_mismatch:${payload?.id ?? "missing"}`);
    }
    const expectedId = payload?.path?.split("/").at(-1)?.replace(/\.safetensors$/, "");
    if (payload?.id !== expectedId) issues.push(`selected_payload_id_path_mismatch:${payload?.id ?? "missing"}`);
  }
  const selectedPointerPaths = new Set(
    [...inventoryState.byPath.values()]
      .filter(({ role, disposition }) => role === "model-payload-pointer" && disposition === "selected")
      .map(({ path }) => path)
  );
  if (!setEquals(paths, selectedPointerPaths)) issues.push("selected_payload_path_set_invalid");
  if (selectedPayloads.count !== payloads.length) issues.push("selected_payload_count_mismatch");
  if (Number.isSafeInteger(selectedPayloads.totalSize)
    && BigInt(selectedPayloads.totalSize) !== totalSize) {
    issues.push("selected_payload_total_mismatch");
  }
}

export function validateModelArtifactLock(lock) {
  const issues = [];
  requireExactKeys(lock, [
    "boundaries",
    "gateMeanings",
    "inventory",
    "lockSha256",
    "modelCardEvidence",
    "openGates",
    "pipeline",
    "resolvedGates",
    "schemaVersion",
    "selectedPayloads",
    "source",
    "status"
  ], "lock", issues);
  if (lock?.schemaVersion !== 1) issues.push("schema_version_invalid");
  if (lock?.status !== lockStatus) issues.push("status_invalid");
  if (!/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "")) issues.push("lock_digest_invalid");
  if (hasTimestampKey(lock)) issues.push("timestamp_in_digested_lock");

  requireExactKeys(lock?.source, ["commit", "objectFormat", "repository", "treeOid"], "source", issues);
  if (typeof lock?.source?.repository !== "string" || !lock.source.repository) issues.push("source_repository_invalid");
  if (!new Set(["sha1", "sha256"]).has(lock?.source?.objectFormat)) issues.push("source_object_format_invalid");
  const sourceOidRegex = oidPattern(lock?.source?.objectFormat);
  if (!sourceOidRegex.test(lock?.source?.commit ?? "")) issues.push("source_commit_invalid");
  if (!sourceOidRegex.test(lock?.source?.treeOid ?? "")) issues.push("source_tree_oid_invalid");

  requireExactKeys(
    lock?.modelCardEvidence,
    ["caveat", "frontMatterLicense", "normalizedLicense", "path", "standaloneLicenseFileAbsent"],
    "model_card_evidence",
    issues
  );
  if (!isSafeRelativePath(lock?.modelCardEvidence?.path)) issues.push("model_card_path_invalid");
  if (typeof lock?.modelCardEvidence?.frontMatterLicense !== "string" || !lock.modelCardEvidence.frontMatterLicense) {
    issues.push("model_card_front_matter_license_invalid");
  }
  if (typeof lock?.modelCardEvidence?.normalizedLicense !== "string" || !lock.modelCardEvidence.normalizedLicense) {
    issues.push("model_card_normalized_license_invalid");
  }
  if (lock?.modelCardEvidence?.standaloneLicenseFileAbsent !== true) issues.push("standalone_license_absence_not_recorded");
  if (typeof lock?.modelCardEvidence?.caveat !== "string" || !lock.modelCardEvidence.caveat) issues.push("model_card_caveat_missing");

  const inventoryState = validateInventory(lock, issues);
  const modelCardFile = inventoryState.byPath.get(lock?.modelCardEvidence?.path);
  if (modelCardFile?.role !== "model-card" || modelCardFile?.disposition !== "evidence-only") {
    issues.push("model_card_inventory_record_invalid");
  }
  validatePipeline(lock, inventoryState, issues);
  validateSelectedPayloads(lock, inventoryState, issues);

  requireExactKeys(lock?.boundaries, falseBoundaryFields, "boundaries", issues);
  for (const field of falseBoundaryFields) {
    if (lock?.boundaries?.[field] !== false) issues.push(`boundary_must_be_false:${field}`);
  }

  const resolvedGates = sortedUniqueStrings(lock?.resolvedGates, "resolved_gates", issues);
  const openGates = sortedUniqueStrings(lock?.openGates, "open_gates", issues);
  for (const gate of resolvedGates) {
    if (openGates.has(gate)) issues.push(`gate_both_open_and_resolved:${gate}`);
  }
  if (!isObject(lock?.gateMeanings) || Object.keys(lock.gateMeanings).length === 0) {
    issues.push("gate_meanings_invalid");
  } else {
    const allGates = new Set([...resolvedGates, ...openGates]);
    for (const [gate, meaning] of Object.entries(lock.gateMeanings)) {
      if (!allGates.has(gate)) issues.push(`gate_meaning_without_gate:${gate}`);
      if (typeof meaning !== "string" || !meaning) issues.push(`gate_meaning_invalid:${gate}`);
    }
    for (const gate of resolvedGates) {
      if (!Object.hasOwn(lock.gateMeanings, gate)) issues.push(`resolved_gate_meaning_missing:${gate}`);
    }
  }

  if (/^[0-9a-f]{64}$/.test(lock?.lockSha256 ?? "") && lock.lockSha256 !== canonicalLockDigest(lock)) {
    issues.push("lock_digest_mismatch");
  }
  if (issues.length > 0) throw new TrellisModelArtifactError(issues);
  return lock;
}

export function validateWmmrModelArtifactContract(lock) {
  validateModelArtifactLock(lock);
  const issues = [];
  for (const field of ["repository", "commit", "treeOid", "objectFormat"]) {
    if (lock.source[field] !== wmmrExpected[field]) issues.push(`unexpected_source_${field}`);
  }
  for (const field of ["fileCount", "normalBlobCount", "lfsPointerCount", "inventorySha256"]) {
    if (lock.inventory[field] !== wmmrExpected[field]) issues.push(`unexpected_inventory_${field}`);
  }
  if (lock.lockSha256 !== wmmrExpected.lockSha256) issues.push("unexpected_lock_digest");
  if (lock.modelCardEvidence.path !== "README.md"
    || lock.modelCardEvidence.frontMatterLicense !== "mit"
    || lock.modelCardEvidence.normalizedLicense !== "MIT"
    || lock.modelCardEvidence.standaloneLicenseFileAbsent !== true) {
    issues.push("unexpected_model_card_evidence");
  }
  if (lock.pipeline.path !== "pipeline.json"
    || lock.pipeline.className !== "TrellisImageTo3DPipeline"
    || lock.pipeline.imageConditioning.model !== "dinov2_vitl14_reg"
    || lock.pipeline.imageConditioning.normalizationMeanLength !== 8
    || lock.pipeline.imageConditioning.normalizationStdLength !== 8
    || stableJson(lock.pipeline.models) !== stableJson(wmmrPipelineModels)) {
    issues.push("unexpected_pipeline_contract");
  }
  if (lock.selectedPayloads.count !== wmmrExpected.selectedPayloadCount
    || lock.selectedPayloads.totalSize !== wmmrExpected.selectedPayloadTotalSize) {
    issues.push("unexpected_selected_payload_summary");
  }
  if (!setEquals(new Set(lock.resolvedGates), new Set(["trellisModelArtifactLock"]))) {
    issues.push("unexpected_resolved_gate_set");
  }
  if (!setEquals(new Set(lock.openGates), new Set(wmmrOpenGates))) issues.push("unexpected_open_gate_set");
  if (!setEquals(new Set(Object.keys(lock.gateMeanings)), new Set([
    "trellisModelArtifactLock",
    "trellisModelPayloadBytesVerification"
  ]))) {
    issues.push("unexpected_gate_meaning_set");
  }
  if (lock.gateMeanings.trellisModelArtifactLock !== artifactGateMeaning
    || lock.gateMeanings.trellisModelPayloadBytesVerification !== payloadGateMeaning) {
    issues.push("unexpected_gate_meaning");
  }
  if (issues.length > 0) throw new TrellisModelArtifactError(issues);
  return lock;
}

export function parseCanonicalModelArtifactLock(text) {
  let lock;
  try {
    lock = JSON.parse(text);
  } catch {
    throw new TrellisModelArtifactError(["lock_json_invalid"]);
  }
  if (`${JSON.stringify(lock, null, 2)}\n` !== text) {
    throw new TrellisModelArtifactError(["lock_json_not_canonical"]);
  }
  return lock;
}

export async function loadWmmrModelArtifactLock(path = defaultLockPath) {
  return validateWmmrModelArtifactContract(parseCanonicalModelArtifactLock(await readFile(resolve(path), "utf8")));
}

function allowedGitObjectCommand(args) {
  if (stableJson(args) === stableJson(["config", "--local", "--includes", "--null", "--get-all", "remote.origin.url"])) return true;
  if (stableJson(args) === stableJson(["rev-parse", "--show-object-format"])) return true;
  if (args.length === 3 && args[0] === "cat-file" && new Set(["-t", "-s", "blob", "commit", "tree"]).has(args[1])) return true;
  return false;
}

function runExecFile(execFileImpl, file, args, options) {
  return new Promise((resolvePromise, rejectPromise) => {
    execFileImpl(file, args, options, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        rejectPromise(error);
      } else {
        resolvePromise({ stdout, stderr });
      }
    });
  });
}

async function gitBytes(repositoryDirectory, args, execFileImpl) {
  if (!allowedGitObjectCommand(args)) throw new TrellisModelArtifactError([`git_command_not_allowed:${args[0] ?? "missing"}`]);
  const inheritedEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !/^GIT_/i.test(name))
  );
  const environment = {
    ...inheritedEnvironment,
    GIT_ALLOW_PROTOCOL: "",
    GIT_CONFIG_COUNT: "0",
    GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_LFS_SKIP_SMUDGE: "1",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_PROTOCOL_FROM_USER: "0",
    GIT_TERMINAL_PROMPT: "0"
  };
  try {
    const { stdout } = await runExecFile(
      execFileImpl,
      "git",
      ["-C", repositoryDirectory, ...args],
      { encoding: null, env: environment, maxBuffer: 16 * 1024 * 1024, timeout: 30_000 }
    );
    return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
  } catch (error) {
    const detail = String(error?.stderr ?? error?.message ?? "unknown").trim().replaceAll(",", ";");
    throw new TrellisModelArtifactError([`git_command_failed:${args[0]}:${detail || "no-detail"}`]);
  }
}

async function gitText(repositoryDirectory, args, execFileImpl) {
  let value;
  try {
    value = utf8.decode(await gitBytes(repositoryDirectory, args, execFileImpl));
  } catch (error) {
    if (error instanceof TrellisModelArtifactError) throw error;
    throw new TrellisModelArtifactError([`git_output_not_utf8:${args[0]}`]);
  }
  return value.endsWith("\n") ? value.slice(0, -1) : value;
}

function parseNulTerminatedUtf8(output, issuePrefix) {
  let text;
  try {
    text = utf8.decode(output);
  } catch {
    throw new TrellisModelArtifactError([`${issuePrefix}_not_utf8`]);
  }
  const records = text.split("\0");
  if (records.at(-1) !== "") throw new TrellisModelArtifactError([`${issuePrefix}_not_nul_terminated`]);
  records.pop();
  return records;
}

function verifyCommitStructure(bytes, expectedTreeOid, objectFormat, issues) {
  const text = decodeBlob(bytes, "commit", issues);
  if (text === null) return;
  if (text.includes("\0") || text.includes("\r")) {
    issues.push("commit_format_invalid");
    return;
  }
  const separator = text.indexOf("\n\n");
  if (separator < 0) {
    issues.push("commit_header_terminator_missing");
    return;
  }
  const lines = text.slice(0, separator).split("\n");
  const headers = [];
  const multilineHeaders = new Set(["gpgsig", "gpgsig-sha256", "mergetag"]);
  for (const line of lines) {
    if (line.startsWith(" ")) {
      if (headers.length === 0 || !multilineHeaders.has(headers.at(-1).key)) {
        issues.push("commit_header_continuation_invalid");
      }
      continue;
    }
    const space = line.indexOf(" ");
    if (space <= 0) {
      issues.push("commit_header_invalid");
      continue;
    }
    headers.push({ key: line.slice(0, space), value: line.slice(space + 1) });
  }
  let index = 0;
  if (headers[index]?.key !== "tree" || headers[index]?.value !== expectedTreeOid) {
    issues.push("commit_tree_header_mismatch");
  }
  index += 1;
  const objectOidRegex = oidPattern(objectFormat);
  while (headers[index]?.key === "parent") {
    if (!objectOidRegex.test(headers[index].value)) issues.push("commit_parent_header_invalid");
    index += 1;
  }
  const identityPattern = /^[^<>\n]+ <[^<>\n]+> -?[0-9]+ [+-][0-9]{4}$/;
  for (const key of ["author", "committer"]) {
    if (headers[index]?.key !== key || !identityPattern.test(headers[index]?.value ?? "")) {
      issues.push(`commit_${key}_header_invalid`);
    }
    index += 1;
  }
  const optionalHeaders = new Set(["encoding", ...multilineHeaders]);
  for (; index < headers.length; index += 1) {
    if (!optionalHeaders.has(headers[index].key)) issues.push(`commit_optional_header_invalid:${headers[index].key}`);
  }
}

function compareGitTreeEntries(left, right) {
  const commonLength = Math.min(left.nameBytes.byteLength, right.nameBytes.byteLength);
  for (let index = 0; index < commonLength; index += 1) {
    if (left.nameBytes[index] !== right.nameBytes[index]) return left.nameBytes[index] - right.nameBytes[index];
  }
  const leftTerminator = left.nameBytes.byteLength > commonLength
    ? left.nameBytes[commonLength]
    : left.mode === "40000" ? 0x2f : 0;
  const rightTerminator = right.nameBytes.byteLength > commonLength
    ? right.nameBytes[commonLength]
    : right.mode === "40000" ? 0x2f : 0;
  return leftTerminator - rightTerminator;
}

function parseGitTreeObject(output, objectFormat, prefix) {
  const oidByteLength = objectFormat === "sha1" ? 20 : 32;
  const entries = [];
  const names = new Set();
  let offset = 0;
  while (offset < output.byteLength) {
    const modeEnd = output.indexOf(0x20, offset);
    const nameEnd = modeEnd < 0 ? -1 : output.indexOf(0, modeEnd + 1);
    const oidEnd = nameEnd < 0 ? -1 : nameEnd + 1 + oidByteLength;
    if (modeEnd <= offset || nameEnd <= modeEnd + 1 || oidEnd > output.byteLength) {
      throw new TrellisModelArtifactError([`tree_record_invalid:${prefix || "."}`]);
    }
    const modeBytes = output.subarray(offset, modeEnd);
    if ([...modeBytes].some((byte) => byte < 0x30 || byte > 0x37)) {
      throw new TrellisModelArtifactError([`tree_mode_invalid:${prefix || "."}`]);
    }
    const mode = modeBytes.toString("ascii");
    if (!new Set(["40000", "100644", "100755", "120000", "160000"]).has(mode)) {
      throw new TrellisModelArtifactError([`tree_mode_invalid:${prefix || "."}`]);
    }
    const nameBytes = output.subarray(modeEnd + 1, nameEnd);
    let name;
    try {
      name = utf8.decode(nameBytes);
    } catch {
      throw new TrellisModelArtifactError([`tree_name_not_utf8:${prefix || "."}`]);
    }
    const path = prefix ? `${prefix}/${name}` : name;
    if (!name || name === "." || name === ".." || name.includes("/") || !isSafeRelativePath(path)) {
      throw new TrellisModelArtifactError([`tree_path_unsafe:${path}`]);
    }
    if (names.has(name)) throw new TrellisModelArtifactError([`tree_name_duplicate:${path}`]);
    names.add(name);
    const entry = { mode, name, nameBytes, oid: output.subarray(nameEnd + 1, oidEnd).toString("hex"), path };
    if (entries.length > 0 && compareGitTreeEntries(entries.at(-1), entry) >= 0) {
      throw new TrellisModelArtifactError([`tree_entries_not_sorted:${prefix || "."}`]);
    }
    entries.push(entry);
    offset = oidEnd;
  }
  return entries;
}

async function readRepositoryTree(
  repositoryDirectory,
  treeOid,
  objectFormat,
  execFileImpl,
  issues,
  prefix = "",
  ancestry = new Set()
) {
  if (ancestry.has(treeOid)) throw new TrellisModelArtifactError([`tree_cycle_detected:${prefix || "."}`]);
  if (ancestry.size > 64) throw new TrellisModelArtifactError([`tree_depth_exceeded:${prefix || "."}`]);
  const objectType = await gitText(repositoryDirectory, ["cat-file", "-t", treeOid], execFileImpl);
  if (objectType !== "tree") throw new TrellisModelArtifactError([`tree_object_type_invalid:${prefix || "."}`]);
  const bytes = await gitBytes(repositoryDirectory, ["cat-file", "tree", treeOid], execFileImpl);
  if (gitObjectOid("tree", bytes, objectFormat) !== treeOid) {
    throw new TrellisModelArtifactError([`tree_object_oid_mismatch:${prefix || "."}`]);
  }
  const files = [];
  const directories = new Set();
  const nextAncestry = new Set(ancestry).add(treeOid);
  for (const entry of parseGitTreeObject(bytes, objectFormat, prefix)) {
    if (entry.mode === "40000") {
      directories.add(entry.path);
      const nested = await readRepositoryTree(
        repositoryDirectory,
        entry.oid,
        objectFormat,
        execFileImpl,
        issues,
        entry.path,
        nextAncestry
      );
      files.push(...nested.files);
      for (const path of nested.directories) directories.add(path);
    } else {
      files.push(entry);
    }
  }
  return { directories, files };
}

function decodeBlob(bytes, path, issues) {
  try {
    return utf8.decode(bytes);
  } catch {
    issues.push(`blob_not_utf8:${path}`);
    return null;
  }
}

function verifyModelCard(bytes, lock, actualPaths, issues) {
  const text = decodeBlob(bytes, lock.modelCardEvidence.path, issues);
  if (text === null) return;
  if (!text.startsWith("---\n")) {
    issues.push("model_card_front_matter_missing");
  } else {
    const end = text.indexOf("\n---\n", 4);
    if (end < 0) {
      issues.push("model_card_front_matter_unterminated");
    } else {
      const licenseLines = text.slice(4, end).split("\n").filter((line) => /^license:/.test(line));
      if (licenseLines.length !== 1 || licenseLines[0] !== `license: ${lock.modelCardEvidence.frontMatterLicense}`) {
        issues.push("model_card_front_matter_license_mismatch");
      }
    }
  }
  if ([...actualPaths].some((path) => /^(?:LICENSE|LICENCE)(?:\.[A-Za-z0-9]+)?$/i.test(path))) {
    issues.push("standalone_license_file_present");
  }
}

function verifyLfsRules(bytes, issues) {
  const text = decodeBlob(bytes, ".gitattributes", issues);
  if (text === null) return;
  const expected = "*.safetensors filter=lfs diff=lfs merge=lfs -text";
  if (text.split("\n").filter((line) => line === expected).length !== 1) {
    issues.push("safetensors_lfs_rule_missing_or_duplicate");
  }
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
      if (text[index] === "\\") {
        index += 2;
      } else if (text[index] === '"') {
        index += 1;
        return JSON.parse(text.slice(start, index));
      } else {
        index += 1;
      }
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

function parseJsonBlob(bytes, path, issues) {
  const text = decodeBlob(bytes, path, issues);
  if (text === null) return null;
  try {
    const parsed = JSON.parse(text);
    if (firstDuplicateJsonKey(text) !== null) issues.push(`repository_json_duplicate_key:${path}`);
    return parsed;
  } catch {
    issues.push(`json_blob_invalid:${path}`);
    return null;
  }
}

function verifyPipelineAndConfigs(blobs, lock, issues) {
  const pipeline = parseJsonBlob(blobs.get(lock.pipeline.path), lock.pipeline.path, issues);
  if (!isObject(pipeline) || !isObject(pipeline?.args)) {
    issues.push("pipeline_json_shape_invalid");
    return;
  }
  if (pipeline.name !== lock.pipeline.className) issues.push("pipeline_class_mismatch");
  const actualModels = pipeline.args.models;
  if (!isObject(actualModels)) {
    issues.push("pipeline_models_object_invalid");
  } else {
    const actualKeys = Object.keys(actualModels).sort(asciiCompare);
    const expectedKeys = lock.pipeline.models.map(({ key }) => key);
    if (stableJson(actualKeys) !== stableJson(expectedKeys)) issues.push("pipeline_model_keys_mismatch");
    for (const key of actualKeys) {
      if (!isSafePipelineKey(key)) issues.push(`pipeline_actual_key_unsafe:${key}`);
    }
    for (const expected of lock.pipeline.models) {
      if (actualModels[expected.key] !== expected.stem) issues.push(`pipeline_model_stem_mismatch:${expected.key}`);
      if (typeof actualModels[expected.key] === "string" && !isSafeModelStem(actualModels[expected.key])) {
        issues.push(`pipeline_actual_stem_unsafe:${expected.key}`);
      }
    }
  }
  if (pipeline.args.image_cond_model !== lock.pipeline.imageConditioning.model) {
    issues.push("pipeline_image_conditioning_model_mismatch");
  }
  const normalization = pipeline.args.slat_normalization;
  if (!isObject(normalization)
    || !Array.isArray(normalization.mean)
    || normalization.mean.length !== lock.pipeline.imageConditioning.normalizationMeanLength) {
    issues.push("pipeline_normalization_mean_mismatch");
  }
  if (!isObject(normalization)
    || !Array.isArray(normalization.std)
    || normalization.std.length !== lock.pipeline.imageConditioning.normalizationStdLength) {
    issues.push("pipeline_normalization_std_mismatch");
  }

  for (const file of lock.inventory.files.filter(({ role }) => role === "model-config")) {
    const config = parseJsonBlob(blobs.get(file.path), file.path, issues);
    if (!isObject(config) || config.name !== file.modelClass) issues.push(`config_class_mismatch:${file.path}`);
  }
}

async function verifyRepositoryObjects(lock, repositoryDirectory, execFileImpl) {
  const issues = [];
  const repositories = parseNulTerminatedUtf8(await gitBytes(
    repositoryDirectory,
    ["config", "--local", "--includes", "--null", "--get-all", "remote.origin.url"],
    execFileImpl
  ), "repository_origin");
  if (repositories.length !== 1) throw new TrellisModelArtifactError([`repository_origin_count_invalid:${repositories.length}`]);
  const [repository] = repositories;
  if (repository !== lock.source.repository) throw new TrellisModelArtifactError(["repository_remote_mismatch"]);
  const objectFormat = await gitText(repositoryDirectory, ["rev-parse", "--show-object-format"], execFileImpl);
  if (objectFormat !== lock.source.objectFormat) throw new TrellisModelArtifactError(["repository_object_format_mismatch"]);
  const commitType = await gitText(repositoryDirectory, ["cat-file", "-t", lock.source.commit], execFileImpl);
  if (commitType !== "commit") throw new TrellisModelArtifactError(["source_object_not_commit"]);
  const commitBytes = await gitBytes(repositoryDirectory, ["cat-file", "commit", lock.source.commit], execFileImpl);
  if (gitObjectOid("commit", commitBytes, lock.source.objectFormat) !== lock.source.commit) {
    throw new TrellisModelArtifactError(["commit_object_oid_mismatch"]);
  }
  verifyCommitStructure(commitBytes, lock.source.treeOid, lock.source.objectFormat, issues);
  if (issues.length > 0) throw new TrellisModelArtifactError(issues);
  const tree = await readRepositoryTree(
    repositoryDirectory,
    lock.source.treeOid,
    lock.source.objectFormat,
    execFileImpl,
    issues
  );
  const entries = tree.files;
  const expectedByPath = new Map(lock.inventory.files.map((file) => [file.path, file]));
  const actualByPath = new Map(entries.map((entry) => [entry.path, entry]));
  if (entries.length !== lock.inventory.fileCount) issues.push(`repository_entry_count_mismatch:${entries.length}`);
  for (const path of expectedByPath.keys()) {
    if (!actualByPath.has(path)) issues.push(`repository_entry_missing:${path}`);
  }
  for (const path of actualByPath.keys()) {
    if (!expectedByPath.has(path)) issues.push(`repository_entry_extra:${path}`);
  }
  const expectedDirectories = new Set();
  for (const path of expectedByPath.keys()) {
    const segments = path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      expectedDirectories.add(segments.slice(0, index).join("/"));
    }
  }
  for (const path of expectedDirectories) {
    if (!tree.directories.has(path)) issues.push(`repository_directory_missing:${path}`);
  }
  for (const path of tree.directories) {
    if (!expectedDirectories.has(path)) issues.push(`repository_directory_extra:${path}`);
  }
  for (const entry of entries) {
    const expected = expectedByPath.get(entry.path);
    if (entry.mode !== "100644") issues.push(`repository_entry_mode_invalid:${entry.path}`);
    if (expected && entry.oid !== expected.gitBlob.oid) issues.push(`repository_blob_oid_mismatch:${entry.path}`);
  }
  if (issues.length > 0) throw new TrellisModelArtifactError(issues);

  const blobs = new Map();
  for (const entry of entries) {
    const expected = expectedByPath.get(entry.path);
    if (!expected) continue;
    let objectType;
    let objectSizeText;
    let bytes;
    try {
      objectType = await gitText(repositoryDirectory, ["cat-file", "-t", entry.oid], execFileImpl);
    } catch (error) {
      if (error instanceof TrellisModelArtifactError) {
        throw new TrellisModelArtifactError([`repository_blob_object_unreadable:${entry.path}`]);
      }
      throw error;
    }
    if (objectType !== "blob") throw new TrellisModelArtifactError([`repository_entry_not_blob:${entry.path}`]);
    try {
      objectSizeText = await gitText(repositoryDirectory, ["cat-file", "-s", entry.oid], execFileImpl);
      bytes = await gitBytes(repositoryDirectory, ["cat-file", "blob", entry.oid], execFileImpl);
    } catch (error) {
      if (error instanceof TrellisModelArtifactError) {
        throw new TrellisModelArtifactError([`repository_blob_object_unreadable:${entry.path}`]);
      }
      throw error;
    }
    if (!/^(0|[1-9][0-9]*)$/.test(objectSizeText)) {
      throw new TrellisModelArtifactError([`repository_object_size_invalid:${entry.path}`]);
    }
    if (Number(objectSizeText) !== expected.gitBlob.size) {
      throw new TrellisModelArtifactError([`repository_blob_size_mismatch:${entry.path}`]);
    }
    if (bytes.byteLength !== expected.gitBlob.size) {
      throw new TrellisModelArtifactError([`repository_blob_byte_length_mismatch:${entry.path}`]);
    }
    if (gitObjectOid("blob", bytes, lock.source.objectFormat) !== entry.oid) {
      throw new TrellisModelArtifactError([`repository_blob_object_oid_mismatch:${entry.path}`]);
    }
    if (sha256(bytes) !== expected.gitBlob.sha256) {
      throw new TrellisModelArtifactError([`repository_blob_sha256_mismatch:${entry.path}`]);
    }
    blobs.set(entry.path, bytes);
    if (expected.role === "model-payload-pointer") {
      try {
        const pointer = parseCanonicalLfsPointer(bytes);
        if (stableJson(pointer) !== stableJson(expected.lfs)) issues.push(`repository_lfs_metadata_mismatch:${entry.path}`);
      } catch (error) {
        if (error instanceof TrellisModelArtifactError) issues.push(`repository_lfs_pointer_not_canonical:${entry.path}`);
        else throw error;
      }
    }
  }

  const modelCardBytes = blobs.get(lock.modelCardEvidence.path);
  if (modelCardBytes) verifyModelCard(modelCardBytes, lock, new Set(actualByPath.keys()), issues);
  else issues.push("model_card_blob_unavailable");
  const lfsRulesBytes = blobs.get(".gitattributes");
  if (lfsRulesBytes) verifyLfsRules(lfsRulesBytes, issues);
  else issues.push("lfs_rules_blob_unavailable");
  if (blobs.has(lock.pipeline.path)) verifyPipelineAndConfigs(blobs, lock, issues);
  else issues.push("pipeline_blob_unavailable");

  if (issues.length > 0) throw new TrellisModelArtifactError(issues);
  return {
    repository,
    objectFormat,
    commit: lock.source.commit,
    treeOid: lock.source.treeOid,
    fileCount: entries.length,
    lfsPointerCount: lock.inventory.lfsPointerCount
  };
}

export async function verifyModelArtifactRepository(
  lock,
  repositoryDirectory,
  { execFileImpl = execFile } = {}
) {
  validateModelArtifactLock(lock);
  const repository = await verifyRepositoryObjects(lock, repositoryDirectory, execFileImpl);
  return {
    schemaVersion: 1,
    status: lockStatus,
    ...repository,
    inventorySha256: lock.inventory.inventorySha256,
    lockSha256: lock.lockSha256,
    selectedPayloadCount: lock.selectedPayloads.count,
    selectedPayloadTotalSize: lock.selectedPayloads.totalSize,
    lfsPayloadBytesReadByVerifier: false,
    gitLfsInvokedByVerifier: false,
    networkFallbackAllowed: false,
    networkProtocolsAllowedByVerifier: [],
    runtimeExecutedByVerifier: false,
    generationAllowed: false,
    openGates: lock.openGates
  };
}

export async function verifyWmmrModelArtifactRepository(
  lock,
  repositoryDirectory,
  { execFileImpl = execFile } = {}
) {
  validateWmmrModelArtifactContract(lock);
  return verifyModelArtifactRepository(lock, repositoryDirectory, { execFileImpl });
}

async function main() {
  const repositoryDirectory = process.argv[2];
  if (!repositoryDirectory) {
    throw new Error("usage: node scripts/verify-trellis-model-artifact.mjs <no-checkout-model-repository> [lock-path]");
  }
  const lock = await loadWmmrModelArtifactLock(process.argv[3] ? resolve(process.argv[3]) : defaultLockPath);
  const result = await verifyWmmrModelArtifactRepository(lock, resolve(repositoryDirectory));
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
