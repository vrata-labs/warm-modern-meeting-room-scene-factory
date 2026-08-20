import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { isAbsolute, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { stableJson } from "./verify-trellis-model-artifact.mjs";
import { loadWmmrDinoPayloadArtifactLock } from "./verify-dino-payload-artifact.mjs";

const repositoryRoot = resolve(import.meta.dirname, "..");
const defaultLockPath = resolve(
  repositoryRoot,
  "experiment/warm-modern-meeting-room/dino-derived-runtime-artifact-lock.json"
);
const defaultManifestPath = resolve(
  repositoryRoot,
  "experiment/warm-modern-meeting-room/dino-derived-tensor-manifest.json"
);
const payloadLockPath = "experiment/warm-modern-meeting-room/dino-payload-bytes-lock.json";
const manifestPath = "experiment/warm-modern-meeting-room/dino-derived-tensor-manifest.json";
const converterPath = "scripts/convert-dino-pth-to-safetensors.py";
const status = "derived-safetensors-artifact-identity-and-tensor-equivalence-locked-runtime-and-rights-blocked";
const manifestStatus = "dino-derived-safetensors-public-tensor-manifest";
const normalCiScope = "canonical-public-lock-manifest-and-historical-relationships-only/no-model-bytes-or-restricted-record-access";
const maxPublicRecordBytes = 1024 * 1024;
const sha256Pattern = /^[0-9a-f]{64}$/;
const forbiddenPublicLocatorKeys = /^(?:accessKeyId|bucket|bucketId|bucketName|credential|endpoint|iamPrincipal|kmsId|kmsKeyId|objectKey|objectUrl|principal|privateLocator|resource|resourceId|resourceLocator|secretAccessKey)$/i;
const forbiddenPublicLocatorValue = /(?:s3:\/\/|gs:\/\/|az:\/\/|file:\/\/|storage\.yandexcloud\.net|amazonaws\.com|\/(?:home|tmp|root|srv|var|mnt)\/|\\\\|accepted\/[0-9a-f]{64}|evidence\/model-artifacts)/i;
const allowedPublicRepositoryUrl = "https://github.com/vrata-labs/warm-modern-meeting-room-scene-factory";
const identityCanonicalization = "SHA-256 of stable JSON for tensors sorted by ASCII name with fields name,dtype,shape,elementCount,byteLength,dataSha256";
const layoutCanonicalization = "SHA-256 of stable JSON for tensors sorted by ASCII name with identity fields plus safetensors dataOffsets";
const dtypeBytes = new Map([
  ["BF16", 2],
  ["BOOL", 1],
  ["F16", 2],
  ["F32", 4],
  ["F64", 8],
  ["I16", 2],
  ["I32", 4],
  ["I64", 8],
  ["I8", 1],
  ["U8", 1]
]);
const expectedResolvedGates = Object.freeze([
  "dinoArtifactPayloadBytesVerification",
  "dinoDerivedRuntimeArtifactLock",
  "dinoSourceAndArtifactLock",
  "dinoSourceGitObjectLock",
  "patchedSourceTreeDigest",
  "trellisModelArtifactLock",
  "trellisModelPayloadBytesVerification"
]);
const expectedOpenGates = Object.freeze([
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
const falseBoundaryFields = Object.freeze([
  "artifactBytesIncludedInPublicRepository",
  "artifactReadInNormalCi",
  "generationAllowed",
  "humanSignoff",
  "modelInputUsed",
  "modelRuntimeExecuted",
  "offlineImportRuntimeExecuted",
  "privateLocatorPublished",
  "rawPayloadReadInNormalCi",
  "restrictedOperatorRecordReadInNormalCi",
  "rightsApproved",
  "runtimeApproved",
  "strictStateDictLoadExecuted",
  "torchHubInvoked"
]);
const expected = Object.freeze({
  lockSha256: "947b7b7adb9bcde2d6c63948e789d6b8236045f05d3c8688a2062e20e60b8bb6",
  manifestSha256: "1b3d3e1878c99c5f271931e257961091a049af65b4b4ff5c7602bc72b6087a83",
  payloadLockSha256: "72da7b8d42e33ba0f7632018cf9766e93ac5e62892b51023b755ce25db56f55b",
  payloadByteLength: 1217607321,
  payloadSha256: "36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51",
  converterSha256: "1b8d57d01b421a5a3448d87be05ab16c4cd8d2f1078cff8ef2d36986a1a4397b",
  conversionImageDigest: "sha256:d1fca38316e82fb61c19eefa6587900f12c5b675c723ce6472568f84af59c7c2",
  baseImageDigest: "sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7",
  pythonVersion: "3.12.11",
  pytorchVersion: "2.7.1+cpu",
  safetensorsVersion: "0.5.3",
  numpyVersion: "2.2.6",
  wheelInventorySha256: "a31ca9307f2485aa379b52403b22a9229899bc8a3c7a2a0f83fb5fa29e28a2a0",
  artifactByteLength: 1217523408,
  artifactSha256: "30e20dce587ad621a8dfc20e4ed66198d2998974928d44f06a6baf7732503dcc",
  headerByteLength: 32456,
  headerSha256: "5769bfb92118023630e6c2eccc5f7099a2ddb9b0514e5f4a3cf32db955e1466a",
  dataByteLength: 1217490944,
  tensorCount: 344,
  tensorIdentitySha256: "6423b9afd5bcdb42dc69123dcddf203d6534cab0b26d1c09a5d184d18efb3d63",
  tensorLayoutSha256: "ba5e1d272ac2691f269385976e9f33b84159d598de9233987aca302a5dcd33aa",
  operatorRecordSha256: "f1485bb09f93a7fa1bf13f04710d74b2c5d142b76305c482b9154ffcee0f28c4",
  conversionEvidenceSha256: Object.freeze([
    "6e9df78f556d780fb325660ee0c0a47abd0eaa1cca506617ff7323409ef54ea2",
    "c8c6246aad8bdaca7af6a43d02b87df0c26865f16d0afe579004279bc97544a2"
  ])
});

export class DinoDerivedRuntimeArtifactError extends Error {
  constructor(issues) {
    const uniqueIssues = [...new Set(issues)];
    super(`dino_derived_runtime_artifact_invalid:${uniqueIssues.join(",")}`);
    this.name = "DinoDerivedRuntimeArtifactError";
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

function denseArray(value) {
  return Array.isArray(value) && Object.keys(value).length === value.length;
}

function requireExactKeys(value, expectedKeys, name, issues) {
  if (!isObject(value)) {
    issues.push(`${name}_invalid`);
    return;
  }
  if (!setEquals(new Set(Object.keys(value)), new Set(expectedKeys))) issues.push(`${name}_keys_invalid`);
}

function sortedUniqueStrings(value, name, issues) {
  if (!denseArray(value) || value.some((entry) => typeof entry !== "string" || !entry)) {
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

function collectForbiddenLocators(value, path = "record", issues = []) {
  if (Array.isArray(value)) {
    [...value].forEach((entry, index) => collectForbiddenLocators(entry, `${path}:${index}`, issues));
    return issues;
  }
  if (typeof value === "string") {
    if (forbiddenPublicLocatorValue.test(value)) issues.push(`private_locator_value_forbidden:${path}`);
    if (/^[A-Za-z]:[\\/]/.test(value)) issues.push(`private_locator_value_forbidden:${path}`);
    if (/^https?:\/\//i.test(value) && value !== allowedPublicRepositoryUrl) {
      issues.push(`unapproved_public_url_value:${path}`);
    }
    return issues;
  }
  if (!isObject(value)) return issues;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenPublicLocatorKeys.test(key)) issues.push(`private_locator_key_forbidden:${path}:${key}`);
    collectForbiddenLocators(nested, `${path}:${key}`, issues);
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

function parseCanonicalRecord(text, name) {
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DinoDerivedRuntimeArtifactError([`${name}_json_invalid`]);
  }
  const duplicate = firstDuplicateJsonKey(text);
  if (duplicate !== null) {
    throw new DinoDerivedRuntimeArtifactError([`${name}_json_duplicate_key:${duplicate}`]);
  }
  if (`${JSON.stringify(value, null, 2)}\n` !== text) {
    throw new DinoDerivedRuntimeArtifactError([`${name}_json_not_canonical`]);
  }
  return value;
}

export function canonicalDinoDerivedRuntimeArtifactLockDigest(lock) {
  const semantics = structuredClone(lock);
  delete semantics.lockSha256;
  return sha256(stableJson(semantics));
}

export function canonicalDinoDerivedTensorManifestDigest(manifest) {
  const semantics = structuredClone(manifest);
  delete semantics.manifestSha256;
  return sha256(stableJson(semantics));
}

export function canonicalDinoTensorIdentityDigest(tensors) {
  const fields = ["name", "dtype", "shape", "elementCount", "byteLength", "dataSha256"];
  const projection = [...tensors].map((tensor) => Object.fromEntries(fields.map((field) => [field, tensor[field]])));
  return sha256(stableJson(projection));
}

export function canonicalDinoTensorLayoutDigest(tensors) {
  return sha256(stableJson([...tensors]));
}

function validateArtifact(artifact, issues) {
  requireExactKeys(artifact, [
    "byteLength",
    "dataByteLength",
    "format",
    "headerByteLength",
    "headerSha256",
    "metadata",
    "modelId",
    "sha256"
  ], "artifact", issues);
  if (artifact?.modelId !== "dinov2_vitl14_reg") issues.push("artifact_model_id_invalid");
  if (artifact?.format !== "safetensors") issues.push("artifact_format_invalid");
  for (const field of ["byteLength", "dataByteLength", "headerByteLength"]) {
    if (!Number.isSafeInteger(artifact?.[field]) || artifact[field] <= 0) issues.push(`artifact_${field}_invalid`);
  }
  if (Number.isSafeInteger(artifact?.byteLength)
    && Number.isSafeInteger(artifact?.headerByteLength)
    && Number.isSafeInteger(artifact?.dataByteLength)
    && artifact.byteLength !== 8 + artifact.headerByteLength + artifact.dataByteLength) {
    issues.push("artifact_section_lengths_mismatch");
  }
  if (!sha256Pattern.test(artifact?.sha256 ?? "")) issues.push("artifact_sha256_invalid");
  if (!sha256Pattern.test(artifact?.headerSha256 ?? "")) issues.push("artifact_header_sha256_invalid");
  if (artifact?.metadata !== "absent") issues.push("artifact_metadata_invalid");
}

function validateTensorManifest(manifest, issues) {
  requireExactKeys(manifest, [
    "artifact",
    "identityCanonicalization",
    "layoutCanonicalization",
    "manifestSha256",
    "schemaVersion",
    "status",
    "tensorCount",
    "tensorIdentitySha256",
    "tensorLayoutSha256",
    "tensors",
    "totalTensorByteLength"
  ], "manifest", issues);
  if (manifest?.schemaVersion !== 1) issues.push("manifest_schema_version_invalid");
  if (manifest?.status !== manifestStatus) issues.push("manifest_status_invalid");
  if (!sha256Pattern.test(manifest?.manifestSha256 ?? "")) issues.push("manifest_digest_invalid");
  if (hasTimestampKey(manifest)) issues.push("timestamp_in_manifest");
  collectForbiddenLocators(manifest, "manifest", issues);
  validateArtifact(manifest?.artifact, issues);
  if (manifest?.identityCanonicalization !== identityCanonicalization) issues.push("identity_canonicalization_invalid");
  if (manifest?.layoutCanonicalization !== layoutCanonicalization) issues.push("layout_canonicalization_invalid");
  if (!denseArray(manifest?.tensors) || manifest.tensors.length === 0) {
    issues.push("tensors_invalid");
    return;
  }
  if (manifest.tensorCount !== manifest.tensors.length) issues.push("tensor_count_mismatch");
  const names = new Set();
  let totalBytes = 0;
  const offsetRecords = [];
  for (const [index, tensor] of manifest.tensors.entries()) {
    requireExactKeys(tensor, [
      "byteLength",
      "dataOffsets",
      "dataSha256",
      "dtype",
      "elementCount",
      "name",
      "shape"
    ], `tensor:${index}`, issues);
    const name = tensor?.name;
    if (typeof name !== "string" || !/^[A-Za-z0-9_.]+$/.test(name)) issues.push(`tensor_name_invalid:${index}`);
    if (names.has(name)) issues.push(`tensor_name_duplicate:${name}`);
    names.add(name);
    if (index > 0 && asciiCompare(manifest.tensors[index - 1]?.name, name) >= 0) issues.push("tensor_names_not_ascii_sorted");
    const bytesPerElement = dtypeBytes.get(tensor?.dtype);
    if (bytesPerElement === undefined) issues.push(`tensor_dtype_invalid:${name}`);
    if (!denseArray(tensor?.shape)
      || tensor.shape.some((dimension) => !Number.isSafeInteger(dimension) || dimension < 0)) {
      issues.push(`tensor_shape_invalid:${name}`);
    }
    let elementCount = 1;
    if (denseArray(tensor?.shape)) {
      for (const dimension of tensor.shape) elementCount *= dimension;
    }
    if (!Number.isSafeInteger(elementCount) || tensor?.elementCount !== elementCount) {
      issues.push(`tensor_element_count_invalid:${name}`);
    }
    if (!Number.isSafeInteger(tensor?.byteLength)
      || tensor.byteLength < 0
      || bytesPerElement === undefined
      || tensor.byteLength !== elementCount * bytesPerElement) {
      issues.push(`tensor_byte_length_invalid:${name}`);
    } else totalBytes += tensor.byteLength;
    if (!sha256Pattern.test(tensor?.dataSha256 ?? "")) issues.push(`tensor_data_sha256_invalid:${name}`);
    if (!denseArray(tensor?.dataOffsets)
      || tensor.dataOffsets.length !== 2
      || tensor.dataOffsets.some((offset) => !Number.isSafeInteger(offset) || offset < 0)
      || tensor.dataOffsets[1] < tensor.dataOffsets[0]
      || tensor.dataOffsets[1] - tensor.dataOffsets[0] !== tensor.byteLength) {
      issues.push(`tensor_offsets_invalid:${name}`);
    } else offsetRecords.push({ name, start: tensor.dataOffsets[0], end: tensor.dataOffsets[1] });
  }
  if (manifest?.totalTensorByteLength !== totalBytes) issues.push("tensor_total_byte_length_mismatch");
  let expectedOffset = 0;
  for (const record of offsetRecords.sort((left, right) => left.start - right.start)) {
    if (record.start !== expectedOffset) issues.push(`tensor_offset_coverage_invalid:${record.name}`);
    expectedOffset = record.end;
  }
  if (expectedOffset !== manifest?.artifact?.dataByteLength) issues.push("tensor_data_section_coverage_mismatch");
  const identityDigest = canonicalDinoTensorIdentityDigest(manifest.tensors);
  const layoutDigest = canonicalDinoTensorLayoutDigest(manifest.tensors);
  if (manifest?.tensorIdentitySha256 !== identityDigest) issues.push("tensor_identity_digest_mismatch");
  if (manifest?.tensorLayoutSha256 !== layoutDigest) issues.push("tensor_layout_digest_mismatch");
  if (manifest?.manifestSha256 !== canonicalDinoDerivedTensorManifestDigest(manifest)) {
    issues.push("manifest_digest_mismatch");
  }
}

function validateWheelInventory(environment, issues) {
  if (!denseArray(environment?.wheels) || environment.wheels.length === 0) {
    issues.push("wheel_inventory_invalid");
    return;
  }
  const filenames = new Set();
  for (const [index, wheel] of environment.wheels.entries()) {
    requireExactKeys(wheel, ["byteLength", "filename", "sha256"], `wheel:${index}`, issues);
    if (typeof wheel?.filename !== "string" || !/^[A-Za-z0-9_.+-]+\.whl$/.test(wheel.filename)) {
      issues.push(`wheel_filename_invalid:${index}`);
    }
    if (filenames.has(wheel?.filename)) issues.push(`wheel_filename_duplicate:${wheel?.filename}`);
    filenames.add(wheel?.filename);
    if (index > 0 && asciiCompare(environment.wheels[index - 1]?.filename, wheel?.filename) >= 0) {
      issues.push("wheel_filenames_not_ascii_sorted");
    }
    if (!Number.isSafeInteger(wheel?.byteLength) || wheel.byteLength <= 0) issues.push(`wheel_byte_length_invalid:${index}`);
    if (!sha256Pattern.test(wheel?.sha256 ?? "")) issues.push(`wheel_sha256_invalid:${index}`);
  }
  if (environment?.wheelInventorySha256 !== sha256(stableJson(environment.wheels))) {
    issues.push("wheel_inventory_digest_mismatch");
  }
}

function validateConversion(lock, issues) {
  const conversion = lock?.conversion;
  requireExactKeys(conversion, ["converter", "environment", "isolation", "options", "reproducibility"], "conversion", issues);
  requireExactKeys(conversion?.converter, ["path", "repository", "sourceSha256"], "converter", issues);
  if (conversion?.converter?.repository !== "https://github.com/vrata-labs/warm-modern-meeting-room-scene-factory") {
    issues.push("converter_repository_invalid");
  }
  if (!safePublicPath(conversion?.converter?.path)) issues.push("converter_path_invalid");
  if (!sha256Pattern.test(conversion?.converter?.sourceSha256 ?? "")) issues.push("converter_sha256_invalid");
  requireExactKeys(conversion?.environment, [
    "baseImageDigest",
    "byteOrder",
    "conversionImageDigest",
    "numpyVersion",
    "platform",
    "pythonVersion",
    "pytorchVersion",
    "safetensorsVersion",
    "wheelInventorySha256",
    "wheels"
  ], "conversion_environment", issues);
  for (const field of ["baseImageDigest", "conversionImageDigest"]) {
    if (!/^sha256:[0-9a-f]{64}$/.test(conversion?.environment?.[field] ?? "")) issues.push(`${field}_invalid`);
  }
  if (conversion?.environment?.byteOrder !== "little") issues.push("conversion_byte_order_invalid");
  if (conversion?.environment?.platform !== "linux-amd64") issues.push("conversion_platform_invalid");
  for (const field of ["numpyVersion", "pythonVersion", "pytorchVersion", "safetensorsVersion"]) {
    if (typeof conversion?.environment?.[field] !== "string" || !conversion.environment[field]) {
      issues.push(`${field}_invalid`);
    }
  }
  if (!sha256Pattern.test(conversion?.environment?.wheelInventorySha256 ?? "")) issues.push("wheel_inventory_sha256_invalid");
  validateWheelInventory(conversion?.environment, issues);
  requireExactKeys(conversion?.options, [
    "dtypeTransformation",
    "keyTransformation",
    "layoutTransformation",
    "mapLocation",
    "outputMetadata",
    "sealedInputCopy",
    "weightsOnly"
  ], "conversion_options", issues);
  if (stableJson(conversion?.options) !== stableJson({
    dtypeTransformation: "identity",
    keyTransformation: "identity",
    layoutTransformation: "contiguous-c-order",
    mapLocation: "cpu",
    outputMetadata: "absent",
    sealedInputCopy: true,
    weightsOnly: true
  })) issues.push("conversion_options_invalid");
  requireExactKeys(conversion?.isolation, [
    "capabilitiesDropped",
    "cloudCredentialsPassed",
    "cpuLimit",
    "inputMountReadOnly",
    "memoryLimitBytes",
    "networkAllowed",
    "noNewPrivileges",
    "outputDirectoryMode",
    "pidsLimit",
    "rootFilesystemReadOnly",
    "runAsRoot",
    "seccompProfile",
    "singleInputFileMounted"
  ], "conversion_isolation", issues);
  if (conversion?.isolation?.capabilitiesDropped !== "all"
    || conversion?.isolation?.cloudCredentialsPassed !== false
    || conversion?.isolation?.cpuLimit !== 4
    || conversion?.isolation?.inputMountReadOnly !== true
    || conversion?.isolation?.memoryLimitBytes !== 12884901888
    || conversion?.isolation?.networkAllowed !== false
    || conversion?.isolation?.noNewPrivileges !== true
    || conversion?.isolation?.outputDirectoryMode !== "0700"
    || conversion?.isolation?.pidsLimit !== 128
    || conversion?.isolation?.rootFilesystemReadOnly !== true
    || conversion?.isolation?.runAsRoot !== false
    || conversion?.isolation?.seccompProfile !== "docker-default"
    || conversion?.isolation?.singleInputFileMounted !== true) {
    issues.push("conversion_isolation_invalid");
  }
  requireExactKeys(conversion?.reproducibility, ["artifactByteIdentical", "reports", "runCount"], "conversion_reproducibility", issues);
  if (conversion?.reproducibility?.runCount !== 2 || conversion?.reproducibility?.artifactByteIdentical !== true) {
    issues.push("conversion_reproducibility_invalid");
  }
  if (!denseArray(conversion?.reproducibility?.reports) || conversion.reproducibility.reports.length !== 2) {
    issues.push("conversion_reports_invalid");
  } else {
    const reportDigests = [];
    for (const [index, report] of conversion.reproducibility.reports.entries()) {
      requireExactKeys(report, ["fullReadbackVerified", "rawRecordSha256", "schemaVersion"], `conversion_report:${index}`, issues);
      if (report?.schemaVersion !== 1) issues.push(`conversion_report_schema_invalid:${index}`);
      if (!sha256Pattern.test(report?.rawRecordSha256 ?? "")) issues.push(`conversion_report_digest_invalid:${index}`);
      if (report?.fullReadbackVerified !== true) issues.push(`conversion_report_readback_invalid:${index}`);
      reportDigests.push(report?.rawRecordSha256);
    }
    sortedUniqueStrings(reportDigests, "conversion_report_digests", issues);
  }
}

function validateStorage(lock, issues) {
  const storage = lock?.restrictedStorage;
  requireExactKeys(storage, [
    "anonymousAccess",
    "bucketAclEntryCount",
    "contentAddress",
    "encryption",
    "evidenceScope",
    "fullReadback",
    "incompleteMultipartUploads",
    "knownLocalModelByteCopiesDeleted",
    "liveUnauthenticatedHttpStatus",
    "objectAcl",
    "operatorRecord",
    "retentionStatus",
    "staticKeyAuthEnabled",
    "versioningEnabled"
  ], "restricted_storage", issues);
  if (storage?.evidenceScope !== "operator-attested-point-in-time") issues.push("storage_evidence_scope_invalid");
  if (storage?.retentionStatus !== "operator-attested-retained-under-approved-policy") issues.push("storage_retention_status_invalid");
  requireExactKeys(storage?.contentAddress, ["algorithm", "digest"], "storage_content_address", issues);
  if (storage?.contentAddress?.algorithm !== "sha256" || storage?.contentAddress?.digest !== lock?.artifact?.sha256) {
    issues.push("storage_content_address_invalid");
  }
  requireExactKeys(storage?.encryption, ["algorithm", "mode"], "storage_encryption", issues);
  if (storage?.encryption?.mode !== "SSE-KMS" || storage?.encryption?.algorithm !== "AES-256") {
    issues.push("storage_encryption_invalid");
  }
  if (storage?.versioningEnabled !== false) issues.push("storage_versioning_invalid");
  if (storage?.objectAcl !== "owner-only-empty-grant-list") issues.push("storage_object_acl_invalid");
  if (storage?.bucketAclEntryCount !== 0) issues.push("storage_bucket_acl_invalid");
  if (storage?.staticKeyAuthEnabled !== false) issues.push("storage_static_key_auth_invalid");
  requireExactKeys(storage?.anonymousAccess, ["configRead", "list", "read"], "storage_anonymous_access", issues);
  if (Object.values(storage?.anonymousAccess ?? {}).some((entry) => entry !== false)) issues.push("storage_anonymous_access_invalid");
  requireExactKeys(storage?.liveUnauthenticatedHttpStatus, ["configRead", "list", "read"], "storage_http_status", issues);
  if (Object.values(storage?.liveUnauthenticatedHttpStatus ?? {}).some((entry) => entry !== 403)) issues.push("storage_http_status_invalid");
  requireExactKeys(storage?.fullReadback, ["byteLength", "matchedArtifactIdentity", "sha256"], "storage_full_readback", issues);
  if (storage?.fullReadback?.byteLength !== lock?.artifact?.byteLength
    || storage?.fullReadback?.sha256 !== lock?.artifact?.sha256
    || storage?.fullReadback?.matchedArtifactIdentity !== true) {
    issues.push("storage_full_readback_invalid");
  }
  if (storage?.incompleteMultipartUploads !== 0) issues.push("storage_incomplete_multipart_invalid");
  if (storage?.knownLocalModelByteCopiesDeleted !== true) issues.push("storage_local_copy_deletion_invalid");
  requireExactKeys(storage?.operatorRecord, [
    "fullReadbackVerified",
    "locatorPublished",
    "rawRecordSha256",
    "schemaVersion",
    "visibility"
  ], "storage_operator_record", issues);
  if (storage?.operatorRecord?.schemaVersion !== 2) issues.push("operator_record_schema_invalid");
  if (storage?.operatorRecord?.visibility !== "restricted-evidence-retention") issues.push("operator_record_visibility_invalid");
  if (!sha256Pattern.test(storage?.operatorRecord?.rawRecordSha256 ?? "")) issues.push("operator_record_digest_invalid");
  if (storage?.operatorRecord?.fullReadbackVerified !== true) issues.push("operator_record_readback_invalid");
  if (storage?.operatorRecord?.locatorPublished !== false) issues.push("operator_record_locator_invalid");
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
    "doesNotResolveOtherGates"
  ], "gate_effect", issues);
  const direct = sortedUniqueStrings(lock?.gateEffect?.directlyResolvedGates, "directly_resolved_gates", issues);
  if (!setEquals(direct, new Set(["dinoDerivedRuntimeArtifactLock"]))) issues.push("direct_gate_effect_invalid");
  if (lock?.gateEffect?.doesNotResolveCompositeGates !== true) issues.push("composite_gate_effect_invalid");
  if (lock?.gateEffect?.doesNotResolveOtherGates !== true) issues.push("other_gate_effect_invalid");
  if (lock?.gateSnapshot !== "historical-at-dino-derived-runtime-artifact-lock") issues.push("gate_snapshot_invalid");
  if (Object.hasOwn(lock ?? {}, "gateComposition")) issues.push("gate_composition_forbidden");
}

export function validateDinoDerivedTensorManifest(manifest) {
  const issues = [];
  validateTensorManifest(manifest, issues);
  if (issues.length > 0) throw new DinoDerivedRuntimeArtifactError(issues);
  return manifest;
}

export function validateDinoDerivedRuntimeArtifactLock(lock) {
  const issues = [];
  requireExactKeys(lock, [
    "artifact",
    "boundaries",
    "conversion",
    "gateEffect",
    "gateSnapshot",
    "lockSha256",
    "normalCi",
    "openGates",
    "payloadBytesLock",
    "resolvedGates",
    "restrictedStorage",
    "schemaVersion",
    "status",
    "tensorEquivalence",
    "tensorManifest"
  ], "lock", issues);
  if (lock?.schemaVersion !== 1) issues.push("schema_version_invalid");
  if (lock?.status !== status) issues.push("status_invalid");
  if (!sha256Pattern.test(lock?.lockSha256 ?? "")) issues.push("lock_digest_invalid");
  if (hasTimestampKey(lock)) issues.push("timestamp_in_lock");
  collectForbiddenLocators(lock, "lock", issues);
  requireExactKeys(lock?.payloadBytesLock, [
    "lockSha256",
    "path",
    "payloadByteLength",
    "payloadIdentityTransitivelyBound",
    "payloadObservedSha256"
  ], "payload_bytes_lock", issues);
  if (!safePublicPath(lock?.payloadBytesLock?.path)) issues.push("payload_lock_path_invalid");
  if (!sha256Pattern.test(lock?.payloadBytesLock?.lockSha256 ?? "")) issues.push("payload_lock_digest_invalid");
  if (!Number.isSafeInteger(lock?.payloadBytesLock?.payloadByteLength) || lock.payloadBytesLock.payloadByteLength <= 0) {
    issues.push("payload_byte_length_invalid");
  }
  if (!sha256Pattern.test(lock?.payloadBytesLock?.payloadObservedSha256 ?? "")) issues.push("payload_sha256_invalid");
  if (lock?.payloadBytesLock?.payloadIdentityTransitivelyBound !== true) issues.push("payload_transitive_binding_invalid");
  validateConversion(lock, issues);
  validateArtifact(lock?.artifact, issues);
  requireExactKeys(lock?.tensorManifest, [
    "manifestSha256",
    "path",
    "tensorCount",
    "tensorIdentitySha256",
    "tensorLayoutSha256",
    "totalTensorByteLength"
  ], "tensor_manifest_reference", issues);
  if (!safePublicPath(lock?.tensorManifest?.path)) issues.push("tensor_manifest_path_invalid");
  for (const field of ["manifestSha256", "tensorIdentitySha256", "tensorLayoutSha256"]) {
    if (!sha256Pattern.test(lock?.tensorManifest?.[field] ?? "")) issues.push(`tensor_manifest_${field}_invalid`);
  }
  if (!Number.isSafeInteger(lock?.tensorManifest?.tensorCount) || lock.tensorManifest.tensorCount <= 0) {
    issues.push("tensor_manifest_count_invalid");
  }
  if (!Number.isSafeInteger(lock?.tensorManifest?.totalTensorByteLength)
    || lock.tensorManifest.totalTensorByteLength <= 0) {
    issues.push("tensor_manifest_total_invalid");
  }
  requireExactKeys(lock?.tensorEquivalence, [
    "comparison",
    "derivedTensorIdentitySha256",
    "dtypeMatched",
    "extraTensorCount",
    "keySetMatched",
    "mismatchCount",
    "missingTensorCount",
    "nonTensorEntryCount",
    "shapeMatched",
    "sourceTensorIdentitySha256",
    "tensorBytesMatched"
  ], "tensor_equivalence", issues);
  if (lock?.tensorEquivalence?.comparison !== "exact-key-dtype-shape-and-canonical-byte-sha256") {
    issues.push("tensor_equivalence_comparison_invalid");
  }
  for (const field of ["keySetMatched", "dtypeMatched", "shapeMatched", "tensorBytesMatched"]) {
    if (lock?.tensorEquivalence?.[field] !== true) issues.push(`tensor_equivalence_${field}_invalid`);
  }
  for (const field of ["missingTensorCount", "extraTensorCount", "nonTensorEntryCount", "mismatchCount"]) {
    if (lock?.tensorEquivalence?.[field] !== 0) issues.push(`tensor_equivalence_${field}_invalid`);
  }
  if (lock?.tensorEquivalence?.sourceTensorIdentitySha256 !== lock?.tensorManifest?.tensorIdentitySha256
    || lock?.tensorEquivalence?.derivedTensorIdentitySha256 !== lock?.tensorManifest?.tensorIdentitySha256) {
    issues.push("tensor_equivalence_digest_mismatch");
  }
  validateStorage(lock, issues);
  requireExactKeys(lock?.normalCi, [
    "artifactAccessAllowed",
    "converterExecutionCoverage",
    "networkRequestInitiatedByVerifier",
    "payloadAccessAllowed",
    "realModelHashesReproducible",
    "restrictedOperatorRecordAccessAllowed",
    "scope"
  ], "normal_ci", issues);
  if (lock?.normalCi?.scope !== normalCiScope) issues.push("normal_ci_scope_invalid");
  for (const field of [
    "artifactAccessAllowed",
    "networkRequestInitiatedByVerifier",
    "payloadAccessAllowed",
    "realModelHashesReproducible",
    "restrictedOperatorRecordAccessAllowed"
  ]) {
    if (lock?.normalCi?.[field] !== false) issues.push(`normal_ci_boundary_invalid:${field}`);
  }
  if (lock?.normalCi?.converterExecutionCoverage !== "operator-only-no-normal-ci-execution") {
    issues.push("normal_ci_fixture_scope_invalid");
  }
  requireExactKeys(lock?.boundaries, falseBoundaryFields, "boundaries", issues);
  for (const field of falseBoundaryFields) {
    if (lock?.boundaries?.[field] !== false) issues.push(`boundary_must_be_false:${field}`);
  }
  validateGates(lock, issues);
  if (lock?.lockSha256 !== canonicalDinoDerivedRuntimeArtifactLockDigest(lock)) issues.push("lock_digest_mismatch");
  if (issues.length > 0) throw new DinoDerivedRuntimeArtifactError(issues);
  return lock;
}

export function validateWmmrDinoDerivedRuntimeArtifactContract(lock, manifest) {
  validateDinoDerivedRuntimeArtifactLock(lock);
  validateDinoDerivedTensorManifest(manifest);
  const issues = [];
  if (lock.lockSha256 !== expected.lockSha256 || manifest.manifestSha256 !== expected.manifestSha256) {
    issues.push("unexpected_public_record_digest");
  }
  if (lock.payloadBytesLock.path !== payloadLockPath
    || lock.payloadBytesLock.lockSha256 !== expected.payloadLockSha256
    || lock.payloadBytesLock.payloadByteLength !== expected.payloadByteLength
    || lock.payloadBytesLock.payloadObservedSha256 !== expected.payloadSha256) {
    issues.push("unexpected_payload_lock_reference");
  }
  if (lock.conversion.converter.path !== converterPath
    || lock.conversion.converter.sourceSha256 !== expected.converterSha256
    || lock.conversion.environment.baseImageDigest !== expected.baseImageDigest
    || lock.conversion.environment.conversionImageDigest !== expected.conversionImageDigest
    || lock.conversion.environment.pythonVersion !== expected.pythonVersion
    || lock.conversion.environment.pytorchVersion !== expected.pytorchVersion
    || lock.conversion.environment.safetensorsVersion !== expected.safetensorsVersion
    || lock.conversion.environment.numpyVersion !== expected.numpyVersion
    || lock.conversion.environment.wheelInventorySha256 !== expected.wheelInventorySha256) {
    issues.push("unexpected_converter_identity");
  }
  if (stableJson(lock.artifact) !== stableJson({
    byteLength: expected.artifactByteLength,
    dataByteLength: expected.dataByteLength,
    format: "safetensors",
    headerByteLength: expected.headerByteLength,
    headerSha256: expected.headerSha256,
    metadata: "absent",
    modelId: "dinov2_vitl14_reg",
    sha256: expected.artifactSha256
  })) issues.push("unexpected_artifact_identity");
  if (lock.tensorManifest.path !== manifestPath
    || lock.tensorManifest.manifestSha256 !== manifest.manifestSha256
    || lock.tensorManifest.tensorCount !== expected.tensorCount
    || lock.tensorManifest.totalTensorByteLength !== expected.dataByteLength
    || lock.tensorManifest.tensorIdentitySha256 !== expected.tensorIdentitySha256
    || lock.tensorManifest.tensorLayoutSha256 !== expected.tensorLayoutSha256) {
    issues.push("unexpected_tensor_manifest_reference");
  }
  if (stableJson(manifest.artifact) !== stableJson(lock.artifact)
    || manifest.tensorCount !== lock.tensorManifest.tensorCount
    || manifest.totalTensorByteLength !== lock.tensorManifest.totalTensorByteLength
    || manifest.tensorIdentitySha256 !== lock.tensorManifest.tensorIdentitySha256
    || manifest.tensorLayoutSha256 !== lock.tensorManifest.tensorLayoutSha256) {
    issues.push("manifest_lock_relationship_invalid");
  }
  if (lock.restrictedStorage.operatorRecord.rawRecordSha256 !== expected.operatorRecordSha256) {
    issues.push("unexpected_operator_record_digest");
  }
  const reports = lock.conversion.reproducibility.reports.map(({ rawRecordSha256 }) => rawRecordSha256);
  if (stableJson(reports) !== stableJson(expected.conversionEvidenceSha256)) {
    issues.push("unexpected_conversion_evidence_digests");
  }
  if (!setEquals(new Set(lock.resolvedGates), new Set(expectedResolvedGates))) issues.push("unexpected_resolved_gates");
  if (!setEquals(new Set(lock.openGates), new Set(expectedOpenGates))) issues.push("unexpected_open_gates");
  if (issues.length > 0) throw new DinoDerivedRuntimeArtifactError(issues);
  return lock;
}

export function parseCanonicalDinoDerivedRuntimeArtifactLock(text) {
  return parseCanonicalRecord(text, "lock");
}

export function parseCanonicalDinoDerivedTensorManifest(text) {
  return parseCanonicalRecord(text, "manifest");
}

async function readBoundedCanonicalFile(path, expectedPath, name) {
  const resolvedPath = resolve(path);
  if (resolvedPath !== expectedPath) throw new DinoDerivedRuntimeArtifactError([`unexpected_${name}_path`]);
  let pathMetadata;
  try {
    pathMetadata = await lstat(resolvedPath, { bigint: true });
  } catch (error) {
    throw new DinoDerivedRuntimeArtifactError([`${name}_file_lstat_failed:${error?.code ?? "unknown"}`]);
  }
  if (pathMetadata.isSymbolicLink() || !pathMetadata.isFile() || await realpath(resolvedPath) !== resolvedPath) {
    throw new DinoDerivedRuntimeArtifactError([`${name}_file_must_be_canonical_regular_file`]);
  }
  if (pathMetadata.size > BigInt(maxPublicRecordBytes)) {
    throw new DinoDerivedRuntimeArtifactError([`${name}_file_too_large`]);
  }
  let handle;
  try {
    handle = await open(
      resolvedPath,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0) | (fsConstants.O_NONBLOCK ?? 0)
    );
    const before = await handle.stat({ bigint: true });
    if (!before.isFile() || before.dev !== pathMetadata.dev || before.ino !== pathMetadata.ino) {
      throw new DinoDerivedRuntimeArtifactError([`${name}_file_changed_before_read`]);
    }
    if (before.size > BigInt(maxPublicRecordBytes)) {
      throw new DinoDerivedRuntimeArtifactError([`${name}_file_too_large`]);
    }
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
    const currentPathMetadata = await lstat(resolvedPath, { bigint: true });
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
      || await realpath(resolvedPath) !== resolvedPath) {
      throw new DinoDerivedRuntimeArtifactError([`${name}_file_changed_during_read`]);
    }
    return bytes.toString("utf8");
  } finally {
    await handle?.close();
  }
}

export async function loadWmmrDinoDerivedRuntimeArtifactLock(path = defaultLockPath) {
  const lockText = await readBoundedCanonicalFile(path, defaultLockPath, "lock");
  const lock = parseCanonicalDinoDerivedRuntimeArtifactLock(lockText);
  const manifestText = await readBoundedCanonicalFile(defaultManifestPath, defaultManifestPath, "manifest");
  const manifest = parseCanonicalDinoDerivedTensorManifest(manifestText);
  validateWmmrDinoDerivedRuntimeArtifactContract(lock, manifest);
  const payloadLock = await loadWmmrDinoPayloadArtifactLock(resolve(repositoryRoot, lock.payloadBytesLock.path));
  if (payloadLock.lockSha256 !== lock.payloadBytesLock.lockSha256
    || payloadLock.payload.byteLength !== lock.payloadBytesLock.payloadByteLength
    || payloadLock.payload.observedSha256 !== lock.payloadBytesLock.payloadObservedSha256) {
    throw new DinoDerivedRuntimeArtifactError(["payload_lock_relationship_invalid"]);
  }
  const resolvedConverterPath = resolve(repositoryRoot, lock.conversion.converter.path);
  const converterText = await readBoundedCanonicalFile(
    resolvedConverterPath,
    resolvedConverterPath,
    "converter"
  );
  if (sha256(Buffer.from(converterText, "utf8")) !== lock.conversion.converter.sourceSha256) {
    throw new DinoDerivedRuntimeArtifactError(["converter_source_digest_mismatch"]);
  }
  return { lock, manifest };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] !== "--lock-only") {
    throw new DinoDerivedRuntimeArtifactError(["cli_arguments_invalid"]);
  }
  const { lock, manifest } = await loadWmmrDinoDerivedRuntimeArtifactLock();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    status: "canonical-public-derived-artifact-lock-and-manifest-verified-without-model-byte-access",
    lockSha256: lock.lockSha256,
    manifestSha256: manifest.manifestSha256,
    tensorCount: manifest.tensorCount,
    normalCiScope: lock.normalCi.scope,
    payloadFileRead: false,
    derivedArtifactFileRead: false,
    restrictedOperatorRecordRead: false,
    networkRequestInitiatedByVerifier: false
  }, null, 2)}\n`);
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
