import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { link, lstat, mkdtemp, open, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { inflateSync } from "node:zlib";
import gltfValidator from "gltf-validator";

import {
  parseCanonicalJsonText,
  parseComponentConstructionContract,
  parseExteriorConstructionContract,
  parseLightingConstructionContract,
  parseMediaSurfaceConstructionContract,
  parseSceneContract
} from "./scene-contract.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const adapterPath = resolve(import.meta.dirname, "blender-room-shell.py");
const candidateLockPath = resolve(repositoryRoot, "experiment/warm-modern-meeting-room/candidate-lock.json");
const fixturePaths = Object.freeze({
  scene: resolve(repositoryRoot, "tests/fixtures/stage3/scene-spec.valid.json"),
  assetLedger: resolve(repositoryRoot, "tests/fixtures/stage3/asset-ledger.valid.json"),
  generationLedger: resolve(repositoryRoot, "tests/fixtures/stage3/generation-ledger.valid.json")
});
const candidatePaths = Object.freeze({
  scene: "source/scene-spec.json",
  assetLedger: "provenance/asset-ledger.json",
  generationLedger: "provenance/generation-ledger.json",
  conceptSelection: "source/concept-selection.json",
  componentConstruction: "source/component-constructions.json",
  mediaSurfaceConstruction: "source/media-surface-constructions.json",
  exteriorConstruction: "source/exterior-constructions.json",
  lightingConstruction: "source/lighting-constructions.json"
});
const candidateArchitecturePaths = Object.freeze([
  candidatePaths.scene,
  candidatePaths.assetLedger,
  candidatePaths.generationLedger,
  candidatePaths.conceptSelection
]);
const candidateComponentPaths = Object.freeze([...candidateArchitecturePaths, candidatePaths.componentConstruction]);
const candidateMediaSurfacePaths = Object.freeze([...candidateComponentPaths, candidatePaths.mediaSurfaceConstruction]);
const candidateExteriorPaths = Object.freeze([...candidateMediaSurfacePaths, candidatePaths.exteriorConstruction]);
const candidateLightingPaths = Object.freeze([...candidateExteriorPaths, candidatePaths.lightingConstruction]);
export const compilerSourceAttestationPaths = Object.freeze([
  "compiler/blender-room-shell.py",
  "compiler/compile-room-shell.mjs",
  "compiler/scene-contract.mjs",
  "compiler/verify-room-reproducibility.mjs",
  "schemas/asset-ledger.schema.json",
  "schemas/component-constructions.schema.json",
  "schemas/exterior-constructions.schema.json",
  "schemas/generation-ledger.schema.json",
  "schemas/lighting-constructions.schema.json",
  "schemas/media-surface-constructions.schema.json",
  "schemas/scene-spec.schema.json",
  "experiment/warm-modern-meeting-room/candidate-lock.json",
  "experiment/warm-modern-meeting-room/style-bible.json",
  "package.json",
  "pnpm-lock.yaml"
]);
const expectedBlenderBinarySha256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880";
const blenderTimeoutMs = 1_200_000;
const syntheticInputKind = "synthetic-fixture";
const candidateArchitectureInputKind = "approved-candidate-architecture";
const candidateComponentInputKind = "approved-candidate-components";
const candidateMediaSurfaceInputKind = "approved-candidate-media-surfaces";
const candidateExteriorInputKind = "approved-candidate-exterior";
const candidateLightingInputKind = "approved-candidate-lighting";
export const mediaSurfaceOutputFaultInjection = Symbol("mediaSurfaceOutputFaultInjection");
const publishedMediaSurfaceOutputs = Symbol("publishedMediaSurfaceOutputs");
export const roomOutputFaultInjection = Symbol("roomOutputFaultInjection");
const publishedRoomOutputs = Symbol("publishedRoomOutputs");
const gitProtocolDenyArguments = Object.freeze(["file", "git", "http", "https", "ssh"].flatMap((protocol) => ["-c", `protocol.${protocol}.allow=never`]));
const gitEnvironmentNames = Object.freeze(process.platform === "win32"
  ? ["COMSPEC", "PATH", "PATHEXT", "SYSTEMROOT", "TEMP", "TMP", "WINDIR"]
  : ["PATH", "TEMP", "TMP", "TMPDIR"]);
const expectedArchitectureNodeNames = Object.freeze([
  "opening.main-door.frame.head",
  "opening.main-door.frame.left",
  "opening.main-door.frame.right",
  "opening.main-window.frame.bottom",
  "opening.main-window.frame.head",
  "opening.main-window.frame.left",
  "opening.main-window.frame.right",
  "opening.main-window.reveal.head",
  "opening.main-window.reveal.left",
  "opening.main-window.reveal.right",
  "opening.main-window.sill",
  "profile.east-baseboard.segment-01",
  "profile.north-baseboard.segment-01",
  "profile.south-baseboard.segment-01",
  "profile.south-baseboard.segment-02",
  "profile.west-baseboard.segment-01",
  "shell.ceiling",
  "shell.floor",
  "shell.walls"
]);
const expectedArchitectureMaterials = Object.freeze({
  "material.graphite-metal": Object.freeze({ recipeId: "graphite-metal", baseColorSrgb: "#343A3C", roughness: 0.35, metalness: 0.7, textureScaleM: 0.2 }),
  "material.mineral-plaster": Object.freeze({ recipeId: "mineral-plaster", baseColorSrgb: "#DDD6C8", roughness: 0.84, metalness: 0, textureScaleM: 0.5 }),
  "material.warm-oak": Object.freeze({ recipeId: "warm-oak", baseColorSrgb: "#A87543", roughness: 0.46, metalness: 0, textureScaleM: 0.18 })
});
const expectedComponentMaterials = Object.freeze({
  ...expectedArchitectureMaterials,
  "material.muted-grey-green-fabric": Object.freeze({ recipeId: "muted-grey-green-fabric", baseColorSrgb: "#77877B", roughness: 0.8, metalness: 0, textureScaleM: 0.003 }),
  "material.sand-fabric": Object.freeze({ recipeId: "sand-fabric", baseColorSrgb: "#B9A98E", roughness: 0.72, metalness: 0, textureScaleM: 0.003 })
});
const allowedArchitectureMaterialSourceIds = new Set(["asset-layout-project", "asset-material-project"]);
const accessorComponentTypes = Object.freeze({
  5120: Object.freeze({ byteLength: 1, read: "readInt8" }),
  5121: Object.freeze({ byteLength: 1, read: "readUInt8" }),
  5122: Object.freeze({ byteLength: 2, read: "readInt16LE" }),
  5123: Object.freeze({ byteLength: 2, read: "readUInt16LE" }),
  5125: Object.freeze({ byteLength: 4, read: "readUInt32LE" }),
  5126: Object.freeze({ byteLength: 4, read: "readFloatLE" })
});
const accessorTypeLengths = Object.freeze({ SCALAR: 1, VEC2: 2, VEC3: 3 });
const geometryTolerance = 1e-5;
const normalLengthTolerance = 1e-4;
const expectedGltfValidatorVersion = "2.0.0-dev.3.10";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

async function exactRegularFile(path, label) {
  if (typeof path !== "string" || path.length === 0) throw new Error(`${label}_invalid`);
  const resolved = resolve(path);
  const metadata = await lstat(resolved).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || await realpath(resolved) !== resolved) throw new Error(`${label}_invalid`);
  return resolved;
}

async function newExternalOutput(path, extension, label, forbiddenRoots = [repositoryRoot]) {
  if (typeof path !== "string" || path.length === 0) throw new Error(`${label}_invalid`);
  const resolved = resolve(path);
  if (forbiddenRoots.some((root) => inside(root, resolved)) || extname(resolved) !== extension) throw new Error(`${label}_invalid`);
  const parent = resolve(dirname(resolved));
  const parentMetadata = await lstat(parent).catch(() => null);
  if (!parentMetadata?.isDirectory() || parentMetadata.isSymbolicLink() || await realpath(parent) !== parent) throw new Error(`${label}_parent_invalid`);
  if (await lstat(resolved).catch(() => null) !== null) throw new Error(`${label}_exists`);
  return resolved;
}

async function externalDirectory(path, label) {
  if (typeof path !== "string" || path.length === 0) throw new Error(`${label}_invalid`);
  const resolved = resolve(path);
  const metadata = await lstat(resolved).catch(() => null);
  if (inside(repositoryRoot, resolved) || !metadata?.isDirectory() || metadata.isSymbolicLink() || await realpath(resolved) !== resolved) {
    throw new Error(`${label}_invalid`);
  }
  return resolved;
}

async function externalOutputDirectory(path, label, forbiddenRoots) {
  if (typeof path !== "string" || path.length === 0) throw new Error(`${label}_invalid`);
  const resolved = resolve(path);
  const metadata = await lstat(resolved).catch(() => null);
  if (forbiddenRoots.some((root) => inside(root, resolved))
    || !metadata?.isDirectory()
    || metadata.isSymbolicLink()
    || await realpath(resolved) !== resolved) throw new Error(`${label}_invalid`);
  return resolved;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function mediaSurfaceOutputFault(options, artifact) {
  const value = options?.[mediaSurfaceOutputFaultInjection];
  if (value === undefined) return null;
  if (!exactKeys(value, ["artifact", "phase"])
    || !["manifest", "compile-report", "reproducibility-report"].includes(value.artifact)
    || !["after-partial-write", "after-write", "before-link", "after-link"].includes(value.phase)) {
    throw new Error("media_surface_output_fault_injection_invalid");
  }
  return value.artifact === artifact ? value.phase : null;
}

function roomOutputFault(options, artifact) {
  const value = options?.[roomOutputFaultInjection];
  if (value === undefined) return null;
  if (!exactKeys(value, ["artifact", "phase"])
    || !["blend", "glb", "first-view", "compile-report", "reproducibility-report"].includes(value.artifact)
    || !["after-partial-write", "after-write", "before-link", "replace-before-link", "after-link"].includes(value.phase)) {
    throw new Error("room_output_fault_injection_invalid");
  }
  return value.artifact === artifact ? value.phase : null;
}

async function removePublishedMediaSurfaceOutput(record) {
  let metadata;
  try {
    metadata = await lstat(record.path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (metadata?.isFile() && !metadata.isSymbolicLink() && metadata.dev === record.dev && metadata.ino === record.ino) {
    await rm(record.path, { force: true });
  }
}

async function removePublishedMediaSurfaceOutputs(records) {
  const results = await Promise.allSettled(records.map(removePublishedMediaSurfaceOutput));
  const failures = results.filter(({ status }) => status === "rejected").map(({ reason }) => reason);
  if (failures.length !== 0) throw new AggregateError(failures, "media_surface_output_cleanup_failed");
}

async function publishMediaSurfaceOutputAtomically({ finalPath, bytes, label, validate, faultPhase }) {
  const parent = dirname(finalPath);
  let temporaryPath;
  let temporaryHandle;
  let temporaryOwned = false;
  let finalCreated = false;
  let finalRecord;
  try {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      temporaryPath = resolve(parent, `.${basename(finalPath)}.${randomBytes(16).toString("hex")}.tmp`);
      try {
        temporaryHandle = await open(temporaryPath, "wx", 0o600);
        temporaryOwned = true;
        break;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
      }
    }
    if (!temporaryHandle) throw new Error(`${label}_temporary_name_exhausted`);
    if (faultPhase === "after-partial-write") {
      await temporaryHandle.writeFile(bytes.subarray(0, Math.max(1, Math.floor(bytes.length / 2))));
      await temporaryHandle.sync();
      throw new Error(`${label}_fault_after_partial_write`);
    }
    await temporaryHandle.writeFile(bytes);
    await temporaryHandle.sync();
    if (faultPhase === "after-write") throw new Error(`${label}_fault_after_write`);
    await temporaryHandle.close();
    temporaryHandle = null;

    const temporaryBytes = await readFile(temporaryPath);
    if (!temporaryBytes.equals(bytes)) throw new Error(`${label}_temporary_bytes_mismatch`);
    await validate(temporaryBytes);
    if (faultPhase === "before-link") throw new Error(`${label}_fault_before_link`);
    if (faultPhase === "replace-before-link") await writeFile(finalPath, "external-race\n", { flag: "wx", mode: 0o600 });
    const temporaryMetadata = await lstat(temporaryPath);
    await link(temporaryPath, finalPath);
    finalRecord = Object.freeze({ path: finalPath, dev: temporaryMetadata.dev, ino: temporaryMetadata.ino });
    finalCreated = true;
    const finalMetadata = await lstat(finalPath);
    if (!finalMetadata.isFile() || finalMetadata.isSymbolicLink() || await realpath(finalPath) !== finalPath
      || finalMetadata.dev !== finalRecord.dev || finalMetadata.ino !== finalRecord.ino) {
      throw new Error(`${label}_published_file_invalid`);
    }
    if (faultPhase === "after-link") throw new Error(`${label}_fault_after_link`);
    await rm(temporaryPath, { force: true });
    temporaryOwned = false;
    return finalRecord;
  } catch (error) {
    const failures = [];
    if (temporaryHandle) {
      try {
        await temporaryHandle.close();
      } catch (closeError) {
        failures.push(closeError);
      }
    }
    const cleanup = [];
    if (temporaryOwned && temporaryPath) cleanup.push(rm(temporaryPath, { force: true }));
    if (finalCreated) cleanup.push(removePublishedMediaSurfaceOutput(finalRecord));
    const results = await Promise.allSettled(cleanup);
    failures.push(...results.filter(({ status }) => status === "rejected").map(({ reason }) => reason));
    if (failures.length !== 0) throw new AggregateError([error, ...failures], `${label}_cleanup_failed`);
    throw error;
  }
}

function validateMediaSurfaceReportBytes(bytes, report, label) {
  const text = bytes.toString("utf8");
  const parsed = parseCanonicalJsonText(text, label);
  if (text !== `${stableJson(report)}\n` || stableJson(parsed) !== stableJson(report)) throw new Error(`${label}_invalid`);
}

async function loadTrustedMediaSurfaceSource(options) {
  const candidateRepositoryPath = await externalDirectory(
    options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR,
    "approved_candidate_repository"
  );
  const source = await loadApprovedCandidateMediaSurfaceSource({
    candidateRepositoryPath,
    candidateCommit: options.candidateCommit
  });
  return Object.freeze({ source, candidateRepositoryPath });
}

async function readFixture(path, expected, label) {
  const resolved = await exactRegularFile(path, label);
  if (resolved !== expected) throw new Error(`${label}_must_be_synthetic_fixture`);
  return readFile(resolved);
}

async function gitOutput(repositoryPath, arguments_, encoding = null) {
  const inheritedEnvironment = Object.fromEntries(gitEnvironmentNames.flatMap((name) => (
    process.env[name] === undefined ? [] : [[name, process.env[name]]]
  )));
  const nullDevice = process.platform === "win32" ? "NUL" : "/dev/null";
  const { stdout } = await execFileAsync("git", [...gitProtocolDenyArguments, "-C", repositoryPath, ...arguments_], {
    encoding,
    env: {
      ...inheritedEnvironment,
      GIT_ALLOW_PROTOCOL: "",
      GIT_CONFIG_COUNT: "0",
      GIT_CONFIG_GLOBAL: nullDevice,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_SYSTEM: nullDevice,
      GIT_LFS_SKIP_SMUDGE: "1",
      GIT_NO_LAZY_FETCH: "1",
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_PROTOCOL_FROM_USER: "0",
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C"
    },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000
  });
  return stdout;
}

async function readGitBlob(repositoryPath, commit, path) {
  let oid;
  let bytes;
  try {
    const record = String(await gitOutput(repositoryPath, ["ls-tree", commit, "--", path], "utf8")).trim();
    const match = record.match(/^100644 blob ([0-9a-f]{40})\t([^\n]+)$/);
    if (!match || match[2] !== path) throw new Error("invalid_blob");
    oid = match[1];
    bytes = Buffer.from(await gitOutput(repositoryPath, ["cat-file", "blob", oid]));
  } catch {
    throw new Error(`approved_candidate_blob_invalid:${path}`);
  }
  return Object.freeze({ path, gitBlobOid: oid, rawSha256: sha256(bytes), byteLength: bytes.length, bytes });
}

export function parseCandidateLockText(text) {
  const lock = parseCanonicalJsonText(text, "candidate_lock");
  const candidate = lock?.candidates?.candidate01;
  const candidate02 = lock?.candidates?.candidate02;
  const architectureBaseline = candidate?.architectureBaseline;
  const componentBaseline = candidate?.componentBaseline;
  const mediaSurfaceBaseline = candidate?.mediaSurfaceBaseline;
  const exteriorBaseline = candidate?.exteriorBaseline;
  const hashFieldsValid = (value, fields) => fields.every((field) => /^[0-9a-f]{64}$/.test(value?.[field] ?? ""));
  const inputBlobsValid = (value, paths) => value && typeof value === "object"
    && Object.keys(value).sort().join(",") === [...paths].sort().join(",")
    && Object.values(value).every((blob) => /^[0-9a-f]{40}$/.test(blob?.gitBlobOid ?? "")
      && /^[0-9a-f]{64}$/.test(blob?.rawSha256 ?? "")
      && Number.isSafeInteger(blob?.byteLength) && blob.byteLength > 0);
  const semanticEvidenceValid = (value) => value?.schemaVersion === 1
    && exactKeys(value, ["contract", "materialCount", "objectCount", "schemaVersion", "sha256"])
    && value?.contract === "f1-architecture-objects-materials-v1"
    && /^[0-9a-f]{64}$/.test(value?.sha256 ?? "")
    && value?.objectCount === 19
    && value?.materialCount === 3;
  const componentGlbEvidence = componentBaseline?.componentGlbEvidence;
  const khronosEvidence = componentGlbEvidence?.khronosValidator;
  const khronosEvidenceKeys = ["errors", "hints", "infos", "package", "version", "warnings"];
  const componentGlbEvidenceValid = exactKeys(componentGlbEvidence, ["architectureSemanticSha256", "byteLength", "decodedNormalCount", "khronosValidator", "materialCount", "meshCount", "reopenInspectionSha256", "sha256"])
    && exactKeys(khronosEvidence, khronosEvidenceKeys)
    && /^[0-9a-f]{64}$/.test(componentGlbEvidence?.sha256 ?? "")
    && Number.isSafeInteger(componentGlbEvidence?.byteLength) && componentGlbEvidence.byteLength > 0
    && /^[0-9a-f]{64}$/.test(componentGlbEvidence?.reopenInspectionSha256 ?? "")
    && componentGlbEvidence?.meshCount === 57
    && componentGlbEvidence?.materialCount === 5
    && componentGlbEvidence?.decodedNormalCount === 15120
    && /^[0-9a-f]{64}$/.test(componentGlbEvidence?.architectureSemanticSha256 ?? "")
    && khronosEvidence?.package === "gltf-validator"
    && khronosEvidence?.version === expectedGltfValidatorVersion
    && khronosEvidence?.errors === 0
    && khronosEvidence?.warnings === 0
    && Number.isSafeInteger(khronosEvidence?.infos) && khronosEvidence.infos >= 0
    && Number.isSafeInteger(khronosEvidence?.hints) && khronosEvidence.hints >= 0;
  const exteriorGlbEvidence = exteriorBaseline?.exteriorGlbEvidence;
  const exteriorKhronosEvidence = exteriorGlbEvidence?.khronosValidator;
  const exteriorGlbEvidenceKeys = ["architectureMeshCount", "architectureSemanticSha256", "binaryByteLength", "blendByteIdentical", "blendByteLength", "byteLength", "componentMeshCount", "decodedIndexCount", "decodedNormalCount", "decodedTriangleCount", "decodedVertexCount", "distinctPositionCount", "exteriorMeshCount", "khronosValidator", "materialCount", "maximumNormalLength", "meshCount", "minimumNormalLength", "objectFaceCount", "objectVertexCount", "observedBlendSha256", "reopenInspectionSha256", "sha256"];
  const exteriorGlbEvidenceValid = exactKeys(exteriorGlbEvidence, exteriorGlbEvidenceKeys)
    && exactKeys(exteriorKhronosEvidence, khronosEvidenceKeys)
    && /^[0-9a-f]{64}$/.test(exteriorGlbEvidence?.sha256 ?? "")
    && Number.isSafeInteger(exteriorGlbEvidence?.byteLength) && exteriorGlbEvidence.byteLength > 0
    && Number.isSafeInteger(exteriorGlbEvidence?.blendByteLength) && exteriorGlbEvidence.blendByteLength > 0
    && Array.isArray(exteriorGlbEvidence?.observedBlendSha256) && exteriorGlbEvidence.observedBlendSha256.length === 2
    && exteriorGlbEvidence.observedBlendSha256.every((digest) => /^[0-9a-f]{64}$/.test(digest))
    && exteriorGlbEvidence?.blendByteIdentical === false
    && /^[0-9a-f]{64}$/.test(exteriorGlbEvidence?.reopenInspectionSha256 ?? "")
    && exteriorGlbEvidence?.meshCount === 61
    && exteriorGlbEvidence?.architectureMeshCount === 19
    && exteriorGlbEvidence?.componentMeshCount === 38
    && exteriorGlbEvidence?.exteriorMeshCount === 4
    && exteriorGlbEvidence?.materialCount === 8
    && Number.isSafeInteger(exteriorGlbEvidence?.binaryByteLength) && exteriorGlbEvidence.binaryByteLength > 0
    && Number.isSafeInteger(exteriorGlbEvidence?.decodedVertexCount) && exteriorGlbEvidence.decodedVertexCount > 0
    && Number.isSafeInteger(exteriorGlbEvidence?.decodedIndexCount) && exteriorGlbEvidence.decodedIndexCount > 0
    && Number.isSafeInteger(exteriorGlbEvidence?.decodedTriangleCount) && exteriorGlbEvidence.decodedTriangleCount > 0
    && Number.isSafeInteger(exteriorGlbEvidence?.distinctPositionCount) && exteriorGlbEvidence.distinctPositionCount > 0
    && Number.isSafeInteger(exteriorGlbEvidence?.decodedNormalCount) && exteriorGlbEvidence.decodedNormalCount > 0
    && Number.isFinite(exteriorGlbEvidence?.minimumNormalLength) && Math.abs(exteriorGlbEvidence.minimumNormalLength - 1) <= normalLengthTolerance
    && Number.isFinite(exteriorGlbEvidence?.maximumNormalLength) && Math.abs(exteriorGlbEvidence.maximumNormalLength - 1) <= normalLengthTolerance
    && Number.isSafeInteger(exteriorGlbEvidence?.objectVertexCount) && exteriorGlbEvidence.objectVertexCount > 0
    && Number.isSafeInteger(exteriorGlbEvidence?.objectFaceCount) && exteriorGlbEvidence.objectFaceCount > 0
    && /^[0-9a-f]{64}$/.test(exteriorGlbEvidence?.architectureSemanticSha256 ?? "")
    && exteriorKhronosEvidence?.package === "gltf-validator"
    && exteriorKhronosEvidence?.version === expectedGltfValidatorVersion
    && exteriorKhronosEvidence?.errors === 0
    && exteriorKhronosEvidence?.warnings === 0
    && Number.isSafeInteger(exteriorKhronosEvidence?.infos) && exteriorKhronosEvidence.infos >= 0
    && Number.isSafeInteger(exteriorKhronosEvidence?.hints) && exteriorKhronosEvidence.hints >= 0;
  const lightingGlbEvidence = candidate?.lightingGlbEvidence;
  const lightingKhronosEvidence = lightingGlbEvidence?.khronosValidator;
  const lightingGlbEvidenceValid = exactKeys(lightingGlbEvidence, ["architectureMeshCount", "architectureSemanticSha256", "binaryByteLength", "blendByteIdentical", "blendByteLength", "byteLength", "componentMeshCount", "decodedIndexCount", "decodedNormalCount", "decodedTriangleCount", "decodedVertexCount", "distinctPositionCount", "exteriorMeshCount", "firstViewByteLength", "firstViewDarkPixelCount", "firstViewDecodedRgbSha256", "firstViewPixelCount", "firstViewSha256", "firstViewWeightedLuminanceSum", "khronosValidator", "lightCount", "materialCount", "maximumNormalLength", "meshCount", "minimumNormalLength", "nodeCount", "objectFaceCount", "objectVertexCount", "observedBlendSha256", "reopenInspectionSha256", "sha256"])
    && exactKeys(lightingKhronosEvidence, khronosEvidenceKeys)
    && /^[0-9a-f]{64}$/.test(lightingGlbEvidence?.sha256 ?? "")
    && Number.isSafeInteger(lightingGlbEvidence?.byteLength) && lightingGlbEvidence.byteLength > 0
    && Number.isSafeInteger(lightingGlbEvidence?.blendByteLength) && lightingGlbEvidence.blendByteLength > 0
    && Array.isArray(lightingGlbEvidence?.observedBlendSha256) && lightingGlbEvidence.observedBlendSha256.length === 2
    && lightingGlbEvidence.observedBlendSha256.every((digest) => /^[0-9a-f]{64}$/.test(digest))
    && lightingGlbEvidence?.blendByteIdentical === false
    && /^[0-9a-f]{64}$/.test(lightingGlbEvidence?.firstViewSha256 ?? "")
    && Number.isSafeInteger(lightingGlbEvidence?.firstViewByteLength) && lightingGlbEvidence.firstViewByteLength > 0
    && /^[0-9a-f]{64}$/.test(lightingGlbEvidence?.firstViewDecodedRgbSha256 ?? "")
    && lightingGlbEvidence?.firstViewPixelCount === 960 * 540
    && Number.isSafeInteger(lightingGlbEvidence?.firstViewWeightedLuminanceSum) && lightingGlbEvidence.firstViewWeightedLuminanceSum >= 40 * 10000 * lightingGlbEvidence.firstViewPixelCount
    && Number.isSafeInteger(lightingGlbEvidence?.firstViewDarkPixelCount) && lightingGlbEvidence.firstViewDarkPixelCount * 10 <= lightingGlbEvidence.firstViewPixelCount * 7
    && /^[0-9a-f]{64}$/.test(lightingGlbEvidence?.reopenInspectionSha256 ?? "")
    && lightingGlbEvidence?.meshCount === 61
    && lightingGlbEvidence?.architectureMeshCount === 19
    && lightingGlbEvidence?.componentMeshCount === 38
    && lightingGlbEvidence?.exteriorMeshCount === 4
    && lightingGlbEvidence?.lightCount === 3
    && lightingGlbEvidence?.materialCount === 8
    && lightingGlbEvidence?.nodeCount === 64
    && Number.isSafeInteger(lightingGlbEvidence?.binaryByteLength) && lightingGlbEvidence.binaryByteLength > 0
    && Number.isSafeInteger(lightingGlbEvidence?.decodedVertexCount) && lightingGlbEvidence.decodedVertexCount > 0
    && Number.isSafeInteger(lightingGlbEvidence?.decodedIndexCount) && lightingGlbEvidence.decodedIndexCount > 0
    && Number.isSafeInteger(lightingGlbEvidence?.decodedTriangleCount) && lightingGlbEvidence.decodedTriangleCount > 0
    && Number.isSafeInteger(lightingGlbEvidence?.distinctPositionCount) && lightingGlbEvidence.distinctPositionCount > 0
    && Number.isSafeInteger(lightingGlbEvidence?.decodedNormalCount) && lightingGlbEvidence.decodedNormalCount > 0
    && Number.isFinite(lightingGlbEvidence?.minimumNormalLength) && Math.abs(lightingGlbEvidence.minimumNormalLength - 1) <= normalLengthTolerance
    && Number.isFinite(lightingGlbEvidence?.maximumNormalLength) && Math.abs(lightingGlbEvidence.maximumNormalLength - 1) <= normalLengthTolerance
    && Number.isSafeInteger(lightingGlbEvidence?.objectVertexCount) && lightingGlbEvidence.objectVertexCount > 0
    && Number.isSafeInteger(lightingGlbEvidence?.objectFaceCount) && lightingGlbEvidence.objectFaceCount > 0
    && /^[0-9a-f]{64}$/.test(lightingGlbEvidence?.architectureSemanticSha256 ?? "")
    && lightingKhronosEvidence?.package === "gltf-validator"
    && lightingKhronosEvidence?.version === expectedGltfValidatorVersion
    && lightingKhronosEvidence?.errors === 0
    && lightingKhronosEvidence?.warnings === 0
    && Number.isSafeInteger(lightingKhronosEvidence?.infos) && lightingKhronosEvidence.infos >= 0
    && Number.isSafeInteger(lightingKhronosEvidence?.hints) && lightingKhronosEvidence.hints >= 0;
  const componentCountsValid = stableJson(componentBaseline?.counts) === stableJson({
    assetRecordCount: 2,
    generationRecordCount: 0,
    familyCount: 4,
    partCount: 38,
    overrideCount: 2,
    componentCount: 11,
    resolvedComponentCount: 11,
    materialCount: 5,
    resolvedMaterialCount: 4,
    seatCount: 8
  });
  const mediaSurfaceCountsValid = stableJson(mediaSurfaceBaseline?.counts) === stableJson({
    assetRecordCount: 3,
    generationRecordCount: 0,
    familyCount: 4,
    partCount: 38,
    overrideCount: 2,
    componentCount: 11,
    resolvedComponentCount: 11,
    materialCount: 5,
    resolvedMaterialCount: 4,
    seatCount: 8,
    surfaceCount: 2,
    resolvedSurfaceCount: 2
  });
  const exteriorCountsValid = stableJson(exteriorBaseline?.counts) === stableJson({
    assetRecordCount: 4,
    generationRecordCount: 0,
    familyCount: 4,
    partCount: 38,
    overrideCount: 2,
    componentCount: 11,
    resolvedComponentCount: 11,
    materialCount: 5,
    resolvedMaterialCount: 4,
    seatCount: 8,
    surfaceCount: 2,
    resolvedSurfaceCount: 2,
    exteriorObjectCount: 4,
    exteriorResolvedObjectCount: 4,
    exteriorMaterialCount: 3,
    exteriorRoleCount: 4
  });
  const lightingCountsValid = stableJson(candidate?.counts) === stableJson({
    assetRecordCount: 5,
    generationRecordCount: 0,
    familyCount: 4,
    partCount: 38,
    overrideCount: 2,
    componentCount: 11,
    resolvedComponentCount: 11,
    materialCount: 5,
    resolvedMaterialCount: 4,
    seatCount: 8,
    surfaceCount: 2,
    resolvedSurfaceCount: 2,
    exteriorObjectCount: 4,
    exteriorResolvedObjectCount: 4,
    exteriorMaterialCount: 3,
    exteriorRoleCount: 4,
    lightCount: 3,
    resolvedLightCount: 3
  });
  const priorPhaseHashesValid = candidate?.componentConstructionSha256 === exteriorBaseline?.componentConstructionSha256
    && candidate?.componentConstructionRawSha256 === exteriorBaseline?.componentConstructionRawSha256
    && candidate?.mediaSurfaceConstructionSha256 === exteriorBaseline?.mediaSurfaceConstructionSha256
    && candidate?.mediaSurfaceConstructionRawSha256 === exteriorBaseline?.mediaSurfaceConstructionRawSha256
    && candidate?.exteriorConstructionSha256 === exteriorBaseline?.exteriorConstructionSha256
    && candidate?.exteriorConstructionRawSha256 === exteriorBaseline?.exteriorConstructionRawSha256
    && stableJson(candidate?.acceptedInputSha256?.slice(0, 4)) === stableJson(exteriorBaseline?.acceptedInputSha256)
    && exteriorBaseline?.componentConstructionSha256 === componentBaseline?.componentConstructionSha256
    && candidate?.componentConstructionRawSha256 === componentBaseline?.componentConstructionRawSha256
    && exteriorBaseline?.mediaSurfaceConstructionSha256 === mediaSurfaceBaseline?.mediaSurfaceConstructionSha256
    && exteriorBaseline?.mediaSurfaceConstructionRawSha256 === mediaSurfaceBaseline?.mediaSurfaceConstructionRawSha256
    && stableJson(exteriorBaseline?.acceptedInputSha256?.slice(0, 3)) === stableJson(mediaSurfaceBaseline?.acceptedInputSha256)
    && stableJson(exteriorBaseline?.acceptedInputSha256?.slice(0, 2)) === stableJson(componentBaseline?.acceptedInputSha256);
  const mediaSurfaceBoundariesValid = stableJson(mediaSurfaceBaseline?.boundaries) === stableJson({
    mediaSurfacesCompiled: false,
    exteriorCompiled: false,
    lightingCompiled: false,
    finalCandidateGlbVerified: false,
    releaseArtifactsCreated: false,
    publicationReady: false,
    artifactBytesIncludedInRepository: false
  });
  const exteriorBoundariesValid = stableJson(exteriorBaseline?.boundaries) === stableJson({
    componentsCompiled: false,
    mediaSurfacesCompiled: false,
    exteriorCompiled: false,
    lightingCompiled: false,
    finalCandidateGlbVerified: false,
    releaseArtifactsCreated: false,
    publicationReady: false,
    artifactBytesIncludedInRepository: false
  });
  const lightingBoundariesValid = stableJson(candidate?.boundaries) === stableJson({
    componentsCompiled: true,
    mediaSurfacesCompiled: false,
    exteriorCompiled: true,
    lightingCompiled: true,
    lightingGlbByteIdentical: true,
    firstViewRendered: true,
    firstViewAcceptanceVerified: true,
    firstViewPngByteIdentical: true,
    byteIdenticalExportsVerified: false,
    finalCandidateGlbVerified: false,
    releaseArtifactsCreated: false,
    publicationReady: false,
    artifactBytesIncludedInRepository: false
  });
  const projectionEvidenceValid = stableJson(mediaSurfaceBaseline?.mediaSurfaceProjectionEvidence) === stableJson({
    sha256: "352b31af533049d7fe84f1ecb55643db85e7258ceff1e2d87be8f8785e38a4fb",
    byteLength: 1022,
    mediaSurfaceCount: 2,
    representation: "platform-runtime-plane",
    byteIdentical: true
  });
  const architectureGlbEvidence = architectureBaseline?.glbEvidence;
  const baselineShapesValid = exactKeys(architectureBaseline, ["acceptedInputSha256", "assetLedgerSha256", "commit", "generationLedgerSha256", "glbEvidence", "inputBlobs", "sceneContractValidatorCommit", "semanticEvidence", "specificationSha256"])
    && exactKeys(architectureGlbEvidence, ["binaryByteLength", "byteLength", "decodedIndexCount", "decodedTriangleCount", "decodedVertexCount", "distinctPositionCount", "materialCount", "meshCount", "reopenInspectionSha256", "sha256"])
    && hashFieldsValid(architectureGlbEvidence, ["reopenInspectionSha256", "sha256"])
    && architectureGlbEvidence?.meshCount === 19
    && architectureGlbEvidence?.materialCount === 3
    && exactKeys(componentBaseline, ["acceptedInputSha256", "assetLedgerSha256", "commit", "componentConstructionRawSha256", "componentConstructionSha256", "componentGlbEvidence", "counts", "generationLedgerSha256", "inputBlobs", "sceneContractValidatorCommit", "specificationSha256", "treeOid"])
    && exactKeys(mediaSurfaceBaseline, ["acceptedInputSha256", "assetLedgerSha256", "boundaries", "commit", "componentConstructionRawSha256", "componentConstructionSha256", "counts", "generationLedgerSha256", "inputBlobs", "mediaSurfaceConstructionRawSha256", "mediaSurfaceConstructionSha256", "mediaSurfaceProjectionEvidence", "release", "sceneContractValidatorCommit", "specificationSha256", "treeOid"])
    && exactKeys(mediaSurfaceBaseline?.mediaSurfaceProjectionEvidence, ["byteIdentical", "byteLength", "mediaSurfaceCount", "representation", "sha256"])
    && exactKeys(exteriorBaseline, ["acceptedInputSha256", "assetLedgerSha256", "boundaries", "commit", "componentConstructionRawSha256", "componentConstructionSha256", "counts", "exteriorConstructionRawSha256", "exteriorConstructionSha256", "exteriorGlbEvidence", "generationLedgerSha256", "inputBlobs", "mediaSurfaceConstructionRawSha256", "mediaSurfaceConstructionSha256", "release", "sceneContractValidatorCommit", "specificationSha256", "treeOid"]);
  if (!exactKeys(lock, ["candidates", "platformValidatorCommit", "schemaVersion", "status"])
    || !exactKeys(lock?.candidates, ["candidate01", "candidate02"])
    || !exactKeys(candidate, ["acceptedInputSha256", "architectureBaseline", "assetLedgerSha256", "boundaries", "commit", "componentBaseline", "componentConstructionRawSha256", "componentConstructionSha256", "counts", "exteriorBaseline", "exteriorConstructionRawSha256", "exteriorConstructionSha256", "generationLedgerSha256", "inputBlobs", "lightingConstructionRawSha256", "lightingConstructionSha256", "lightingGlbEvidence", "mediaSurfaceBaseline", "mediaSurfaceConstructionRawSha256", "mediaSurfaceConstructionSha256", "release", "repository", "sceneContractValidatorCommit", "specificationSha256", "treeOid"])
    || !exactKeys(candidate02, ["commit", "release", "repository"])
    || candidate02.repository !== "vrata-labs/warm-modern-meeting-room-candidate-02"
    || !/^[0-9a-f]{40}$/.test(candidate02.commit ?? "")
    || candidate02.release !== null
    || lock?.schemaVersion !== 4
    || lock?.status !== "candidate-01-exact-lighting-compilation-pinned"
    || typeof candidate?.repository !== "string"
    || !/^[0-9a-f]{40}$/.test(candidate?.commit ?? "")
    || !/^[0-9a-f]{40}$/.test(candidate?.treeOid ?? "")
    || !/^[0-9a-f]{40}$/.test(candidate?.sceneContractValidatorCommit ?? "")
    || !/^[0-9a-f]{40}$/.test(lock?.platformValidatorCommit ?? "")
    || !hashFieldsValid(candidate, ["specificationSha256", "assetLedgerSha256", "generationLedgerSha256", "componentConstructionSha256", "componentConstructionRawSha256", "mediaSurfaceConstructionSha256", "mediaSurfaceConstructionRawSha256", "exteriorConstructionSha256", "exteriorConstructionRawSha256", "lightingConstructionSha256", "lightingConstructionRawSha256"])
    || !Array.isArray(candidate.acceptedInputSha256) || candidate.acceptedInputSha256.length !== 5
    || candidate.acceptedInputSha256.some((digest) => !/^[0-9a-f]{64}$/.test(digest))
    || !inputBlobsValid(candidate.inputBlobs, candidateLightingPaths)
    || !lightingCountsValid
    || !priorPhaseHashesValid
    || !baselineShapesValid
    || !lightingGlbEvidenceValid
    || !lightingBoundariesValid
    || candidate.release !== null
    || !/^[0-9a-f]{40}$/.test(exteriorBaseline?.commit ?? "")
    || !/^[0-9a-f]{40}$/.test(exteriorBaseline?.treeOid ?? "")
    || !/^[0-9a-f]{40}$/.test(exteriorBaseline?.sceneContractValidatorCommit ?? "")
    || !hashFieldsValid(exteriorBaseline, ["specificationSha256", "assetLedgerSha256", "generationLedgerSha256", "componentConstructionSha256", "componentConstructionRawSha256", "mediaSurfaceConstructionSha256", "mediaSurfaceConstructionRawSha256", "exteriorConstructionSha256", "exteriorConstructionRawSha256"])
    || !Array.isArray(exteriorBaseline?.acceptedInputSha256) || exteriorBaseline.acceptedInputSha256.length !== 4
    || exteriorBaseline.acceptedInputSha256.some((digest) => !/^[0-9a-f]{64}$/.test(digest))
    || !inputBlobsValid(exteriorBaseline?.inputBlobs, candidateExteriorPaths)
    || !exteriorCountsValid
    || !exteriorGlbEvidenceValid
    || !exteriorBoundariesValid
    || exteriorBaseline?.release !== null
    || !/^[0-9a-f]{40}$/.test(mediaSurfaceBaseline?.commit ?? "")
    || !/^[0-9a-f]{40}$/.test(mediaSurfaceBaseline?.treeOid ?? "")
    || !/^[0-9a-f]{40}$/.test(mediaSurfaceBaseline?.sceneContractValidatorCommit ?? "")
    || !hashFieldsValid(mediaSurfaceBaseline, ["specificationSha256", "assetLedgerSha256", "generationLedgerSha256", "componentConstructionSha256", "componentConstructionRawSha256", "mediaSurfaceConstructionSha256", "mediaSurfaceConstructionRawSha256"])
    || !Array.isArray(mediaSurfaceBaseline?.acceptedInputSha256) || mediaSurfaceBaseline.acceptedInputSha256.length !== 3
    || mediaSurfaceBaseline.acceptedInputSha256.some((digest) => !/^[0-9a-f]{64}$/.test(digest))
    || !inputBlobsValid(mediaSurfaceBaseline?.inputBlobs, candidateMediaSurfacePaths)
    || !mediaSurfaceCountsValid
    || !projectionEvidenceValid
    || !mediaSurfaceBoundariesValid
    || mediaSurfaceBaseline?.release !== null
    || !/^[0-9a-f]{40}$/.test(componentBaseline?.commit ?? "")
    || !/^[0-9a-f]{40}$/.test(componentBaseline?.treeOid ?? "")
    || !/^[0-9a-f]{40}$/.test(componentBaseline?.sceneContractValidatorCommit ?? "")
    || !hashFieldsValid(componentBaseline, ["specificationSha256", "assetLedgerSha256", "generationLedgerSha256", "componentConstructionSha256", "componentConstructionRawSha256"])
    || !Array.isArray(componentBaseline?.acceptedInputSha256) || componentBaseline.acceptedInputSha256.length !== 2
    || componentBaseline.acceptedInputSha256.some((digest) => !/^[0-9a-f]{64}$/.test(digest))
    || !inputBlobsValid(componentBaseline?.inputBlobs, candidateComponentPaths)
    || !componentCountsValid
    || !componentGlbEvidenceValid
    || !/^[0-9a-f]{40}$/.test(architectureBaseline?.commit ?? "")
    || !/^[0-9a-f]{40}$/.test(architectureBaseline?.sceneContractValidatorCommit ?? "")
    || !hashFieldsValid(architectureBaseline, ["specificationSha256", "assetLedgerSha256", "generationLedgerSha256"])
    || !Array.isArray(architectureBaseline.acceptedInputSha256) || architectureBaseline.acceptedInputSha256.length !== 1
    || !semanticEvidenceValid(architectureBaseline.semanticEvidence)
    || !inputBlobsValid(architectureBaseline.inputBlobs, candidateArchitecturePaths)) {
    throw new Error("approved_candidate_lock_invalid");
  }
  return Object.freeze({
    repository: candidate.repository,
    platformValidatorCommit: lock.platformValidatorCommit,
    lighting: Object.freeze({
      ...candidate,
      validatorCommit: candidate.sceneContractValidatorCommit
    }),
    exterior: Object.freeze({
      ...exteriorBaseline,
      validatorCommit: exteriorBaseline.sceneContractValidatorCommit
    }),
    mediaSurface: Object.freeze({
      ...mediaSurfaceBaseline,
      validatorCommit: mediaSurfaceBaseline.sceneContractValidatorCommit
    }),
    component: Object.freeze({
      ...componentBaseline,
      validatorCommit: componentBaseline.sceneContractValidatorCommit
    }),
    architecture: Object.freeze({
      ...architectureBaseline,
      validatorCommit: architectureBaseline.sceneContractValidatorCommit
    })
  });
}

async function loadCandidateLock() {
  return parseCandidateLockText(await readFile(candidateLockPath, "utf8"));
}

async function verifyLockedCandidateCommit(candidateRepositoryPath, lock, errorCode) {
  try {
    const topLevel = String(await gitOutput(candidateRepositoryPath, ["rev-parse", "--show-toplevel"], "utf8")).trim();
    const commit = String(await gitOutput(candidateRepositoryPath, ["rev-parse", "--verify", `${lock.commit}^{commit}`], "utf8")).trim();
    const treeOid = String(await gitOutput(candidateRepositoryPath, ["rev-parse", "--verify", `${lock.commit}^{tree}`], "utf8")).trim();
    if (resolve(topLevel) !== candidateRepositoryPath || commit !== lock.commit || treeOid !== lock.treeOid) throw new Error("invalid_repository");
  } catch {
    throw new Error(errorCode);
  }
}

export function validateCompilerSourceAttestation(attestation) {
  const paths = attestation && typeof attestation === "object" ? Object.keys(attestation).sort() : [];
  if (!exactStringSet(paths, compilerSourceAttestationPaths)
    || paths.some((path) => !/^[0-9a-f]{64}$/.test(attestation[path]))) throw new Error("compiler_source_attestation_invalid");
  return Object.freeze({ ...attestation });
}

async function compilerSourceSha256() {
  return validateCompilerSourceAttestation(Object.fromEntries(await Promise.all(compilerSourceAttestationPaths.map(async (path) => [path, sha256(await readFile(resolve(repositoryRoot, path)))]))));
}

export async function loadApprovedCandidateArchitectureSource(options = {}) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_source_options_invalid");
  const candidateLock = await loadCandidateLock();
  const lock = candidateLock.architecture;
  if (options.candidateCommit !== undefined && options.candidateCommit !== lock.commit) throw new Error("approved_candidate_commit_not_locked");
  const candidateRepositoryPath = await externalDirectory(options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR, "approved_candidate_repository");
  try {
    const topLevel = String(await gitOutput(candidateRepositoryPath, ["rev-parse", "--show-toplevel"], "utf8")).trim();
    const commit = String(await gitOutput(candidateRepositoryPath, ["rev-parse", "--verify", `${lock.commit}^{commit}`], "utf8")).trim();
    if (resolve(topLevel) !== candidateRepositoryPath || commit !== lock.commit) throw new Error("invalid_repository");
  } catch {
    throw new Error("approved_candidate_commit_missing");
  }

  const [sceneBlob, assetLedgerBlob, generationLedgerBlob, conceptSelectionBlob] = await Promise.all([
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.scene),
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.assetLedger),
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.generationLedger),
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.conceptSelection)
  ]);
  verifyLockedInputBlobs([sceneBlob, assetLedgerBlob, generationLedgerBlob, conceptSelectionBlob], lock.inputBlobs);
  const sceneText = sceneBlob.bytes.toString("utf8");
  const assetLedgerText = assetLedgerBlob.bytes.toString("utf8");
  const generationLedgerText = generationLedgerBlob.bytes.toString("utf8");
  const contract = parseSceneContract({ sceneText, assetLedgerText, generationLedgerText });
  if (contract.specificationSha256 !== lock.specificationSha256
    || contract.assetLedgerSha256 !== lock.assetLedgerSha256
    || contract.generationLedgerSha256 !== lock.generationLedgerSha256) throw new Error("approved_candidate_contract_hash_mismatch");

  const scene = JSON.parse(sceneText);
  const assetLedger = JSON.parse(assetLedgerText);
  const conceptRecords = assetLedger.records.filter((record) => record?.source?.repositoryPath === candidatePaths.conceptSelection);
  if (scene.generator?.commit !== lock.validatorCommit
    || conceptRecords.length !== 1
    || conceptRecords[0].originalSha256 !== conceptSelectionBlob.rawSha256
    || scene.generator.acceptedInputSha256.length !== 1
    || scene.generator.acceptedInputSha256[0] !== conceptSelectionBlob.rawSha256) {
    throw new Error("approved_candidate_accepted_input_mismatch");
  }

  const inputBlobs = Object.freeze(Object.fromEntries([sceneBlob, assetLedgerBlob, generationLedgerBlob, conceptSelectionBlob].map((blob) => [blob.path, Object.freeze({
    gitBlobOid: blob.gitBlobOid,
    rawSha256: blob.rawSha256,
    byteLength: blob.byteLength
  })])));
  return Object.freeze({
    inputKind: candidateArchitectureInputKind,
    fixtureOnly: false,
    componentsIncluded: false,
    exteriorIncluded: false,
    sceneBytes: Buffer.from(sceneBlob.bytes),
    scene,
    contract,
    acceptedInputSha256: Object.freeze([...scene.generator.acceptedInputSha256]),
    rawSceneSha256: sceneBlob.rawSha256,
    architectureBaseline: Object.freeze({ ...lock.semanticEvidence }),
    candidateSource: Object.freeze({
      repository: candidateLock.repository,
      commit: lock.commit,
      validatorCommit: lock.validatorCommit,
      platformValidatorCommit: candidateLock.platformValidatorCommit,
      inputBlobs
    }),
    canonicalHashes: Object.freeze({
      specificationSha256: contract.specificationSha256,
      assetLedgerSha256: contract.assetLedgerSha256,
      generationLedgerSha256: contract.generationLedgerSha256
    })
  });
}

function verifyLockedInputBlobs(blobs, expected) {
  const actualPaths = blobs.map(({ path }) => path).sort();
  const expectedPaths = Object.keys(expected).sort();
  if (actualPaths.length !== expectedPaths.length || actualPaths.some((path, index) => path !== expectedPaths[index])) {
    throw new Error("approved_candidate_input_blob_set_mismatch");
  }
  for (const blob of blobs) {
    const locked = expected[blob.path];
    if (blob.gitBlobOid !== locked.gitBlobOid || blob.rawSha256 !== locked.rawSha256 || blob.byteLength !== locked.byteLength) {
      throw new Error(`approved_candidate_input_blob_mismatch:${blob.path}`);
    }
  }
}

export async function loadApprovedCandidateComponentSource(options = {}) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_component_source_options_invalid");
  const candidateLock = await loadCandidateLock();
  const lock = candidateLock.component;
  if (options.candidateCommit !== undefined && options.candidateCommit !== lock.commit) throw new Error("approved_candidate_component_commit_not_locked");
  const candidateRepositoryPath = await externalDirectory(options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR, "approved_candidate_repository");
  await verifyLockedCandidateCommit(candidateRepositoryPath, lock, "approved_candidate_component_commit_missing");

  const blobs = await Promise.all([
    readGitBlob(candidateRepositoryPath, lock.treeOid, candidatePaths.scene),
    readGitBlob(candidateRepositoryPath, lock.treeOid, candidatePaths.assetLedger),
    readGitBlob(candidateRepositoryPath, lock.treeOid, candidatePaths.generationLedger),
    readGitBlob(candidateRepositoryPath, lock.treeOid, candidatePaths.conceptSelection),
    readGitBlob(candidateRepositoryPath, lock.treeOid, candidatePaths.componentConstruction)
  ]);
  verifyLockedInputBlobs(blobs, lock.inputBlobs);
  const blobByPath = new Map(blobs.map((blob) => [blob.path, blob]));
  const sceneBlob = blobByPath.get(candidatePaths.scene);
  const assetLedgerBlob = blobByPath.get(candidatePaths.assetLedger);
  const generationLedgerBlob = blobByPath.get(candidatePaths.generationLedger);
  const conceptSelectionBlob = blobByPath.get(candidatePaths.conceptSelection);
  const componentConstructionBlob = blobByPath.get(candidatePaths.componentConstruction);
  const sceneText = sceneBlob.bytes.toString("utf8");
  const assetLedgerText = assetLedgerBlob.bytes.toString("utf8");
  const generationLedgerText = generationLedgerBlob.bytes.toString("utf8");
  const componentConstructionText = componentConstructionBlob.bytes.toString("utf8");
  const contract = parseComponentConstructionContract({ sceneText, assetLedgerText, generationLedgerText, componentConstructionText });
  const counts = lock.counts;
  if (contract.specificationSha256 !== lock.specificationSha256
    || contract.assetLedgerSha256 !== lock.assetLedgerSha256
    || contract.generationLedgerSha256 !== lock.generationLedgerSha256
    || contract.componentConstructionSha256 !== lock.componentConstructionSha256
    || contract.componentConstructionRawSha256 !== lock.componentConstructionRawSha256
    || contract.assetRecordCount !== counts.assetRecordCount
    || contract.generationRecordCount !== counts.generationRecordCount
    || contract.familyCount !== counts.familyCount
    || contract.partCount !== counts.partCount
    || contract.overrideCount !== counts.overrideCount
    || contract.componentCount !== counts.componentCount
    || contract.resolvedComponentCount !== counts.resolvedComponentCount
    || contract.resolvedMaterialCount !== counts.resolvedMaterialCount
    || contract.seatCount !== counts.seatCount) throw new Error("approved_candidate_component_contract_lock_mismatch");

  const scene = JSON.parse(sceneText);
  const assetLedger = JSON.parse(assetLedgerText);
  const componentConstruction = JSON.parse(componentConstructionText);
  const conceptRecords = assetLedger.records.filter((record) => record?.source?.repositoryPath === candidatePaths.conceptSelection);
  const constructionRecords = assetLedger.records.filter((record) => record?.source?.repositoryPath === candidatePaths.componentConstruction);
  if (scene.generator?.commit !== lock.validatorCommit
    || scene.materialRecipes.length !== counts.materialCount
    || conceptRecords.length !== 1
    || constructionRecords.length !== 1
    || conceptRecords[0].originalSha256 !== conceptSelectionBlob.rawSha256
    || constructionRecords[0].originalSha256 !== componentConstructionBlob.rawSha256
    || stableJson(scene.generator.acceptedInputSha256) !== stableJson(lock.acceptedInputSha256)
    || scene.generator.acceptedInputSha256[0] !== conceptSelectionBlob.rawSha256
    || scene.generator.acceptedInputSha256[1] !== componentConstructionBlob.rawSha256) {
    throw new Error("approved_candidate_component_accepted_input_mismatch");
  }

  const inputBlobs = Object.freeze(Object.fromEntries(blobs.map((blob) => [blob.path, Object.freeze({
    gitBlobOid: blob.gitBlobOid,
    rawSha256: blob.rawSha256,
    byteLength: blob.byteLength
  })])));
  return Object.freeze({
    inputKind: candidateComponentInputKind,
    fixtureOnly: false,
    componentsIncluded: true,
    exteriorIncluded: false,
    sceneBytes: Buffer.from(sceneBlob.bytes),
    componentConstructionBytes: Buffer.from(componentConstructionBlob.bytes),
    scene,
    componentConstruction,
    contract,
    acceptedInputSha256: Object.freeze([...scene.generator.acceptedInputSha256]),
    rawSceneSha256: sceneBlob.rawSha256,
    rawComponentConstructionSha256: componentConstructionBlob.rawSha256,
    architectureBaseline: Object.freeze({ ...candidateLock.architecture.semanticEvidence }),
    componentGlbEvidence: Object.freeze(structuredClone(lock.componentGlbEvidence)),
    candidateSource: Object.freeze({
      repository: candidateLock.repository,
      commit: lock.commit,
      treeOid: lock.treeOid,
      validatorCommit: lock.validatorCommit,
      platformValidatorCommit: candidateLock.platformValidatorCommit,
      inputBlobs
    }),
    canonicalHashes: Object.freeze({
      specificationSha256: contract.specificationSha256,
      assetLedgerSha256: contract.assetLedgerSha256,
      generationLedgerSha256: contract.generationLedgerSha256,
      componentConstructionSha256: contract.componentConstructionSha256,
      componentConstructionRawSha256: contract.componentConstructionRawSha256
    }),
    counts: Object.freeze({ ...counts })
  });
}

export async function loadApprovedCandidateMediaSurfaceSource(options = {}) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_media_surface_source_options_invalid");
  const candidateLock = await loadCandidateLock();
  const lock = candidateLock.mediaSurface;
  if (options.candidateCommit !== undefined && options.candidateCommit !== lock.commit) throw new Error("approved_candidate_media_surface_commit_not_locked");
  const candidateRepositoryPath = await externalDirectory(options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR, "approved_candidate_repository");
  await verifyLockedCandidateCommit(candidateRepositoryPath, lock, "approved_candidate_media_surface_commit_missing");

  const blobs = await Promise.all(candidateMediaSurfacePaths.map((path) => readGitBlob(candidateRepositoryPath, lock.treeOid, path)));
  verifyLockedInputBlobs(blobs, lock.inputBlobs);
  const blobByPath = new Map(blobs.map((blob) => [blob.path, blob]));
  const sceneBlob = blobByPath.get(candidatePaths.scene);
  const assetLedgerBlob = blobByPath.get(candidatePaths.assetLedger);
  const generationLedgerBlob = blobByPath.get(candidatePaths.generationLedger);
  const conceptSelectionBlob = blobByPath.get(candidatePaths.conceptSelection);
  const componentConstructionBlob = blobByPath.get(candidatePaths.componentConstruction);
  const mediaSurfaceConstructionBlob = blobByPath.get(candidatePaths.mediaSurfaceConstruction);
  const sceneText = sceneBlob.bytes.toString("utf8");
  const assetLedgerText = assetLedgerBlob.bytes.toString("utf8");
  const generationLedgerText = generationLedgerBlob.bytes.toString("utf8");
  const componentConstructionText = componentConstructionBlob.bytes.toString("utf8");
  const mediaSurfaceConstructionText = mediaSurfaceConstructionBlob.bytes.toString("utf8");
  const commonTexts = { sceneText, assetLedgerText, generationLedgerText };
  const componentContract = parseComponentConstructionContract({ ...commonTexts, componentConstructionText });
  const mediaSurfaceContract = parseMediaSurfaceConstructionContract({ ...commonTexts, mediaSurfaceConstructionText });
  const counts = lock.counts;
  const commonContractInvalid = [componentContract, mediaSurfaceContract].some((contract) => (
    contract.specificationSha256 !== lock.specificationSha256
      || contract.assetLedgerSha256 !== lock.assetLedgerSha256
      || contract.generationLedgerSha256 !== lock.generationLedgerSha256
      || contract.assetRecordCount !== counts.assetRecordCount
      || contract.generationRecordCount !== counts.generationRecordCount
      || contract.componentCount !== counts.componentCount
      || contract.seatCount !== counts.seatCount
  ));
  if (commonContractInvalid
    || componentContract.componentConstructionSha256 !== lock.componentConstructionSha256
    || componentContract.componentConstructionRawSha256 !== lock.componentConstructionRawSha256
    || componentContract.familyCount !== counts.familyCount
    || componentContract.partCount !== counts.partCount
    || componentContract.overrideCount !== counts.overrideCount
    || componentContract.resolvedComponentCount !== counts.resolvedComponentCount
    || componentContract.resolvedMaterialCount !== counts.resolvedMaterialCount
    || mediaSurfaceContract.mediaSurfaceConstructionSha256 !== lock.mediaSurfaceConstructionSha256
    || mediaSurfaceContract.mediaSurfaceConstructionRawSha256 !== lock.mediaSurfaceConstructionRawSha256
    || mediaSurfaceContract.surfaceCount !== counts.surfaceCount
    || mediaSurfaceContract.resolvedSurfaceCount !== counts.resolvedSurfaceCount) {
    throw new Error("approved_candidate_media_surface_contract_lock_mismatch");
  }

  const scene = JSON.parse(sceneText);
  const assetLedger = JSON.parse(assetLedgerText);
  const componentConstruction = JSON.parse(componentConstructionText);
  const mediaSurfaceConstruction = JSON.parse(mediaSurfaceConstructionText);
  const acceptedSources = [conceptSelectionBlob, componentConstructionBlob, mediaSurfaceConstructionBlob];
  const provenancePaths = [candidatePaths.conceptSelection, candidatePaths.componentConstruction, candidatePaths.mediaSurfaceConstruction];
  const provenanceRecords = provenancePaths.map((path) => assetLedger.records.filter((record) => record?.source?.repositoryPath === path));
  const semanticBoundariesValid = componentContract.boundaries?.componentsSpecified === true
    && componentContract.boundaries?.componentsCompiled === false
    && componentContract.boundaries?.finalCandidateGlbVerified === false
    && componentContract.boundaries?.publicationReady === false
    && mediaSurfaceContract.boundaries?.mediaSurfacesSpecified === true
    && mediaSurfaceContract.boundaries?.mediaSurfacesCompiled === false
    && mediaSurfaceContract.boundaries?.finalCandidateGlbVerified === false
    && mediaSurfaceContract.boundaries?.publicationReady === false;
  if (scene.generator?.commit !== lock.validatorCommit
    || scene.materialRecipes.length !== counts.materialCount
    || provenanceRecords.some((records) => records.length !== 1)
    || provenanceRecords.some((records, index) => records[0].originalSha256 !== acceptedSources[index].rawSha256)
    || stableJson(scene.generator.acceptedInputSha256) !== stableJson(lock.acceptedInputSha256)
    || scene.generator.acceptedInputSha256.some((digest, index) => digest !== acceptedSources[index].rawSha256)
    || !semanticBoundariesValid
    || Object.values(lock.boundaries).some((value) => value !== false)
    || lock.release !== null) {
    throw new Error("approved_candidate_media_surface_provenance_mismatch");
  }

  const inputBlobs = Object.freeze(Object.fromEntries(blobs.map((blob) => [blob.path, Object.freeze({
    gitBlobOid: blob.gitBlobOid,
    rawSha256: blob.rawSha256,
    byteLength: blob.byteLength
  })])));
  return Object.freeze({
    inputKind: candidateMediaSurfaceInputKind,
    fixtureOnly: false,
    sceneBytes: Buffer.from(sceneBlob.bytes),
    componentConstructionBytes: Buffer.from(componentConstructionBlob.bytes),
    mediaSurfaceConstructionBytes: Buffer.from(mediaSurfaceConstructionBlob.bytes),
    scene,
    componentConstruction,
    mediaSurfaceConstruction,
    componentContract,
    mediaSurfaceContract,
    semanticReports: Object.freeze({ component: componentContract, mediaSurfaces: mediaSurfaceContract }),
    acceptedInputSha256: Object.freeze([...scene.generator.acceptedInputSha256]),
    candidateSource: Object.freeze({
      repository: candidateLock.repository,
      commit: lock.commit,
      treeOid: lock.treeOid,
      validatorCommit: lock.validatorCommit,
      platformValidatorCommit: candidateLock.platformValidatorCommit,
      inputBlobs
    }),
    canonicalHashes: Object.freeze({
      specificationSha256: componentContract.specificationSha256,
      assetLedgerSha256: componentContract.assetLedgerSha256,
      generationLedgerSha256: componentContract.generationLedgerSha256,
      componentConstructionSha256: componentContract.componentConstructionSha256,
      componentConstructionRawSha256: componentContract.componentConstructionRawSha256,
      mediaSurfaceConstructionSha256: mediaSurfaceContract.mediaSurfaceConstructionSha256,
      mediaSurfaceConstructionRawSha256: mediaSurfaceContract.mediaSurfaceConstructionRawSha256
    }),
    counts: Object.freeze({ ...counts }),
    mediaSurfaceProjectionEvidence: Object.freeze({ ...lock.mediaSurfaceProjectionEvidence }),
    boundaries: Object.freeze({ ...lock.boundaries })
  });
}

export function validateApprovedCandidateExteriorPhaseIsolation(scene, componentConstruction, mediaSurfaceConstruction, componentBaselineSource, mediaSurfaceBaselineSource) {
  const currentComponents = {
    components: scene?.components,
    materialRecipes: scene?.materialRecipes,
    componentConstruction
  };
  const baselineComponents = {
    components: componentBaselineSource?.scene?.components,
    materialRecipes: componentBaselineSource?.scene?.materialRecipes,
    componentConstruction: componentBaselineSource?.componentConstruction
  };
  const currentMediaSurfaces = {
    mediaSurfaces: scene?.mediaSurfaces,
    mediaSurfaceConstruction
  };
  const baselineMediaSurfaces = {
    mediaSurfaces: mediaSurfaceBaselineSource?.scene?.mediaSurfaces,
    mediaSurfaceConstruction: mediaSurfaceBaselineSource?.mediaSurfaceConstruction
  };
  if (stableJson(currentComponents) !== stableJson(baselineComponents)
    || stableJson(currentMediaSurfaces) !== stableJson(baselineMediaSurfaces)) {
    throw new Error("approved_candidate_exterior_phase_isolation_mismatch");
  }
  return true;
}

export async function loadApprovedCandidateExteriorSource(options = {}) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_exterior_source_options_invalid");
  const candidateLock = await loadCandidateLock();
  const lock = candidateLock.exterior;
  if (options.candidateCommit !== undefined && options.candidateCommit !== lock.commit) throw new Error("approved_candidate_exterior_commit_not_locked");
  const candidateRepositoryPath = await externalDirectory(options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR, "approved_candidate_repository");
  await verifyLockedCandidateCommit(candidateRepositoryPath, lock, "approved_candidate_exterior_commit_missing");

  const blobs = await Promise.all(candidateExteriorPaths.map((path) => readGitBlob(candidateRepositoryPath, lock.treeOid, path)));
  verifyLockedInputBlobs(blobs, lock.inputBlobs);
  const blobByPath = new Map(blobs.map((blob) => [blob.path, blob]));
  const sceneBlob = blobByPath.get(candidatePaths.scene);
  const assetLedgerBlob = blobByPath.get(candidatePaths.assetLedger);
  const generationLedgerBlob = blobByPath.get(candidatePaths.generationLedger);
  const conceptSelectionBlob = blobByPath.get(candidatePaths.conceptSelection);
  const componentConstructionBlob = blobByPath.get(candidatePaths.componentConstruction);
  const mediaSurfaceConstructionBlob = blobByPath.get(candidatePaths.mediaSurfaceConstruction);
  const exteriorConstructionBlob = blobByPath.get(candidatePaths.exteriorConstruction);
  const sceneText = sceneBlob.bytes.toString("utf8");
  const assetLedgerText = assetLedgerBlob.bytes.toString("utf8");
  const generationLedgerText = generationLedgerBlob.bytes.toString("utf8");
  const componentConstructionText = componentConstructionBlob.bytes.toString("utf8");
  const mediaSurfaceConstructionText = mediaSurfaceConstructionBlob.bytes.toString("utf8");
  const exteriorConstructionText = exteriorConstructionBlob.bytes.toString("utf8");
  const commonTexts = { sceneText, assetLedgerText, generationLedgerText };
  const componentContract = parseComponentConstructionContract({ ...commonTexts, componentConstructionText });
  const mediaSurfaceContract = parseMediaSurfaceConstructionContract({ ...commonTexts, mediaSurfaceConstructionText });
  const exteriorContract = parseExteriorConstructionContract({ ...commonTexts, exteriorConstructionText });
  const contracts = [componentContract, mediaSurfaceContract, exteriorContract];
  const counts = lock.counts;
  if (contracts.some((contract) => contract.specificationSha256 !== lock.specificationSha256
    || contract.assetLedgerSha256 !== lock.assetLedgerSha256
    || contract.generationLedgerSha256 !== lock.generationLedgerSha256
    || contract.assetRecordCount !== counts.assetRecordCount
    || contract.generationRecordCount !== counts.generationRecordCount
    || contract.componentCount !== counts.componentCount
    || contract.seatCount !== counts.seatCount)
    || componentContract.componentConstructionSha256 !== lock.componentConstructionSha256
    || componentContract.componentConstructionRawSha256 !== lock.componentConstructionRawSha256
    || componentContract.familyCount !== counts.familyCount
    || componentContract.partCount !== counts.partCount
    || componentContract.overrideCount !== counts.overrideCount
    || componentContract.resolvedComponentCount !== counts.resolvedComponentCount
    || componentContract.resolvedMaterialCount !== counts.resolvedMaterialCount
    || mediaSurfaceContract.mediaSurfaceConstructionSha256 !== lock.mediaSurfaceConstructionSha256
    || mediaSurfaceContract.mediaSurfaceConstructionRawSha256 !== lock.mediaSurfaceConstructionRawSha256
    || mediaSurfaceContract.surfaceCount !== counts.surfaceCount
    || mediaSurfaceContract.resolvedSurfaceCount !== counts.resolvedSurfaceCount
    || exteriorContract.exteriorConstructionSha256 !== lock.exteriorConstructionSha256
    || exteriorContract.exteriorConstructionRawSha256 !== lock.exteriorConstructionRawSha256
    || exteriorContract.objectCount !== counts.exteriorObjectCount
    || exteriorContract.resolvedObjectCount !== counts.exteriorResolvedObjectCount
    || exteriorContract.materialCount !== counts.exteriorMaterialCount
    || exteriorContract.roleCount !== counts.exteriorRoleCount) {
    throw new Error("approved_candidate_exterior_contract_lock_mismatch");
  }

  const scene = JSON.parse(sceneText);
  const assetLedger = JSON.parse(assetLedgerText);
  const componentConstruction = JSON.parse(componentConstructionText);
  const mediaSurfaceConstruction = JSON.parse(mediaSurfaceConstructionText);
  const exteriorConstruction = JSON.parse(exteriorConstructionText);
  const [componentBaselineSource, mediaSurfaceBaselineSource] = await Promise.all([
    loadApprovedCandidateComponentSource({ candidateRepositoryPath }),
    loadApprovedCandidateMediaSurfaceSource({ candidateRepositoryPath })
  ]);
  validateApprovedCandidateExteriorPhaseIsolation(
    scene,
    componentConstruction,
    mediaSurfaceConstruction,
    componentBaselineSource,
    mediaSurfaceBaselineSource
  );
  const acceptedSources = [conceptSelectionBlob, componentConstructionBlob, mediaSurfaceConstructionBlob, exteriorConstructionBlob];
  const provenancePaths = [candidatePaths.conceptSelection, candidatePaths.componentConstruction, candidatePaths.mediaSurfaceConstruction, candidatePaths.exteriorConstruction];
  const provenanceRecords = provenancePaths.map((path) => assetLedger.records.filter((record) => record?.source?.repositoryPath === path));
  const semanticBoundariesValid = componentContract.boundaries?.componentsSpecified === true
    && componentContract.boundaries?.componentsCompiled === false
    && mediaSurfaceContract.boundaries?.mediaSurfacesSpecified === true
    && mediaSurfaceContract.boundaries?.mediaSurfacesCompiled === false
    && exteriorContract.boundaries?.exteriorSpecified === true
    && exteriorContract.boundaries?.exteriorCompiled === false
    && contracts.every((contract) => contract.boundaries?.finalCandidateGlbVerified === false && contract.boundaries?.publicationReady === false);
  if (scene.generator?.commit !== lock.validatorCommit
    || scene.materialRecipes.length !== counts.materialCount
    || scene.exterior?.strategy !== exteriorContract.strategy
    || scene.exterior?.windowOpeningId !== exteriorContract.windowOpeningId
    || provenanceRecords.some((records) => records.length !== 1)
    || provenanceRecords.some((records, index) => records[0].originalSha256 !== acceptedSources[index].rawSha256)
    || stableJson(scene.generator.acceptedInputSha256) !== stableJson(lock.acceptedInputSha256)
    || scene.generator.acceptedInputSha256.some((digest, index) => digest !== acceptedSources[index].rawSha256)
    || !semanticBoundariesValid
    || Object.values(lock.boundaries).some((value) => value !== false)
    || lock.release !== null) {
    throw new Error("approved_candidate_exterior_provenance_mismatch");
  }

  const inputBlobs = Object.freeze(Object.fromEntries(blobs.map((blob) => [blob.path, Object.freeze({
    gitBlobOid: blob.gitBlobOid,
    rawSha256: blob.rawSha256,
    byteLength: blob.byteLength
  })])));
  return Object.freeze({
    inputKind: candidateExteriorInputKind,
    fixtureOnly: false,
    componentsIncluded: true,
    exteriorIncluded: true,
    sceneBytes: Buffer.from(sceneBlob.bytes),
    assetLedgerBytes: Buffer.from(assetLedgerBlob.bytes),
    componentConstructionBytes: Buffer.from(componentConstructionBlob.bytes),
    mediaSurfaceConstructionBytes: Buffer.from(mediaSurfaceConstructionBlob.bytes),
    exteriorConstructionBytes: Buffer.from(exteriorConstructionBlob.bytes),
    scene,
    assetLedger,
    componentConstruction,
    mediaSurfaceConstruction,
    exteriorConstruction,
    contract: exteriorContract,
    componentContract,
    mediaSurfaceContract,
    exteriorContract,
    semanticReports: Object.freeze({ component: componentContract, mediaSurfaces: mediaSurfaceContract, exterior: exteriorContract }),
    acceptedInputSha256: Object.freeze([...scene.generator.acceptedInputSha256]),
    rawSceneSha256: sceneBlob.rawSha256,
    rawComponentConstructionSha256: componentConstructionBlob.rawSha256,
    rawExteriorConstructionSha256: exteriorConstructionBlob.rawSha256,
    architectureBaseline: Object.freeze({ ...candidateLock.architecture.semanticEvidence }),
    exteriorGlbEvidence: Object.freeze(structuredClone(lock.exteriorGlbEvidence)),
    mediaSurfaceProjectionEvidence: Object.freeze({ ...candidateLock.mediaSurface.mediaSurfaceProjectionEvidence }),
    candidateSource: Object.freeze({
      repository: candidateLock.repository,
      commit: lock.commit,
      treeOid: lock.treeOid,
      validatorCommit: lock.validatorCommit,
      platformValidatorCommit: candidateLock.platformValidatorCommit,
      inputBlobs
    }),
    canonicalHashes: Object.freeze({
      specificationSha256: exteriorContract.specificationSha256,
      assetLedgerSha256: exteriorContract.assetLedgerSha256,
      generationLedgerSha256: exteriorContract.generationLedgerSha256,
      componentConstructionSha256: componentContract.componentConstructionSha256,
      componentConstructionRawSha256: componentContract.componentConstructionRawSha256,
      mediaSurfaceConstructionSha256: mediaSurfaceContract.mediaSurfaceConstructionSha256,
      mediaSurfaceConstructionRawSha256: mediaSurfaceContract.mediaSurfaceConstructionRawSha256,
      exteriorConstructionSha256: exteriorContract.exteriorConstructionSha256,
      exteriorConstructionRawSha256: exteriorContract.exteriorConstructionRawSha256
    }),
    counts: Object.freeze({ ...counts }),
    boundaries: Object.freeze({ ...lock.boundaries })
  });
}

export function validateApprovedCandidateLightingPhaseIsolation(current, exteriorBaselineSource) {
  if (!current || typeof current !== "object" || !exteriorBaselineSource || typeof exteriorBaselineSource !== "object") {
    throw new Error("approved_candidate_lighting_phase_isolation_mismatch");
  }
  const currentScene = structuredClone(current.scene);
  const baselineScene = structuredClone(exteriorBaselineSource.scene);
  for (const scene of [currentScene, baselineScene]) {
    delete scene.lighting;
    delete scene.generator?.commit;
    delete scene.generator?.acceptedInputSha256;
  }
  const currentRecords = current.assetLedger?.records;
  const baselineRecords = exteriorBaselineSource.assetLedger?.records;
  const currentAccepted = current.scene?.generator?.acceptedInputSha256;
  const baselineAccepted = exteriorBaselineSource.scene?.generator?.acceptedInputSha256;
  const appendedRecord = currentRecords?.at(-1);
  const bytesMatch = [
    [current.componentConstructionBytes, exteriorBaselineSource.componentConstructionBytes],
    [current.mediaSurfaceConstructionBytes, exteriorBaselineSource.mediaSurfaceConstructionBytes],
    [current.exteriorConstructionBytes, exteriorBaselineSource.exteriorConstructionBytes]
  ].every(([actual, expected]) => Buffer.isBuffer(actual) && Buffer.isBuffer(expected) && actual.equals(expected));
  const semanticsMatch = stableJson({
    componentConstruction: current.componentConstruction,
    mediaSurfaceConstruction: current.mediaSurfaceConstruction,
    exteriorConstruction: current.exteriorConstruction
  }) === stableJson({
    componentConstruction: exteriorBaselineSource.componentConstruction,
    mediaSurfaceConstruction: exteriorBaselineSource.mediaSurfaceConstruction,
    exteriorConstruction: exteriorBaselineSource.exteriorConstruction
  });
  if (stableJson(currentScene) !== stableJson(baselineScene)
    || !bytesMatch
    || !semanticsMatch
    || !Array.isArray(currentRecords) || !Array.isArray(baselineRecords)
    || currentRecords.length !== baselineRecords.length + 1
    || stableJson(currentRecords.slice(0, -1)) !== stableJson(baselineRecords)
    || appendedRecord?.id !== "asset-lighting-constructions-project"
    || appendedRecord?.kind !== "project-authored-input"
    || appendedRecord?.source?.classification !== "project-authored"
    || appendedRecord?.source?.repositoryPath !== candidatePaths.lightingConstruction
    || appendedRecord?.source?.publicUrl !== null
    || !Array.isArray(currentAccepted) || !Array.isArray(baselineAccepted)
    || currentAccepted.length !== baselineAccepted.length + 1
    || stableJson(currentAccepted.slice(0, -1)) !== stableJson(baselineAccepted)
    || currentAccepted.at(-1) !== current.rawLightingConstructionSha256
    || appendedRecord.originalSha256 !== current.rawLightingConstructionSha256) {
    throw new Error("approved_candidate_lighting_phase_isolation_mismatch");
  }
  return true;
}

export async function loadApprovedCandidateLightingSource(options = {}) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_lighting_source_options_invalid");
  const candidateLock = await loadCandidateLock();
  const lock = candidateLock.lighting;
  if (options.candidateCommit !== undefined && options.candidateCommit !== lock.commit) throw new Error("approved_candidate_lighting_commit_not_locked");
  const candidateRepositoryPath = await externalDirectory(options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR, "approved_candidate_repository");
  await verifyLockedCandidateCommit(candidateRepositoryPath, lock, "approved_candidate_lighting_commit_missing");
  const exteriorBaselineSource = await loadApprovedCandidateExteriorSource({ candidateRepositoryPath });

  const blobs = await Promise.all(candidateLightingPaths.map((path) => readGitBlob(candidateRepositoryPath, lock.treeOid, path)));
  verifyLockedInputBlobs(blobs, lock.inputBlobs);
  const blobByPath = new Map(blobs.map((blob) => [blob.path, blob]));
  const sceneBlob = blobByPath.get(candidatePaths.scene);
  const assetLedgerBlob = blobByPath.get(candidatePaths.assetLedger);
  const generationLedgerBlob = blobByPath.get(candidatePaths.generationLedger);
  const componentConstructionBlob = blobByPath.get(candidatePaths.componentConstruction);
  const mediaSurfaceConstructionBlob = blobByPath.get(candidatePaths.mediaSurfaceConstruction);
  const exteriorConstructionBlob = blobByPath.get(candidatePaths.exteriorConstruction);
  const lightingConstructionBlob = blobByPath.get(candidatePaths.lightingConstruction);
  const texts = {
    sceneText: sceneBlob.bytes.toString("utf8"),
    assetLedgerText: assetLedgerBlob.bytes.toString("utf8"),
    generationLedgerText: generationLedgerBlob.bytes.toString("utf8")
  };
  const componentConstructionText = componentConstructionBlob.bytes.toString("utf8");
  const mediaSurfaceConstructionText = mediaSurfaceConstructionBlob.bytes.toString("utf8");
  const exteriorConstructionText = exteriorConstructionBlob.bytes.toString("utf8");
  const lightingConstructionText = lightingConstructionBlob.bytes.toString("utf8");
  const componentContract = parseComponentConstructionContract({ ...texts, componentConstructionText });
  const mediaSurfaceContract = parseMediaSurfaceConstructionContract({ ...texts, mediaSurfaceConstructionText });
  const exteriorContract = parseExteriorConstructionContract({ ...texts, exteriorConstructionText });
  const lightingContract = parseLightingConstructionContract({ ...texts, lightingConstructionText });
  const contracts = [componentContract, mediaSurfaceContract, exteriorContract, lightingContract];
  const counts = lock.counts;
  if (contracts.some((contract) => contract.specificationSha256 !== lock.specificationSha256
    || contract.assetLedgerSha256 !== lock.assetLedgerSha256
    || contract.generationLedgerSha256 !== lock.generationLedgerSha256
    || contract.assetRecordCount !== counts.assetRecordCount
    || contract.generationRecordCount !== counts.generationRecordCount
    || contract.componentCount !== counts.componentCount
    || contract.seatCount !== counts.seatCount)
    || componentContract.componentConstructionSha256 !== lock.componentConstructionSha256
    || componentContract.componentConstructionRawSha256 !== lock.componentConstructionRawSha256
    || componentContract.familyCount !== counts.familyCount
    || componentContract.partCount !== counts.partCount
    || componentContract.overrideCount !== counts.overrideCount
    || componentContract.resolvedComponentCount !== counts.resolvedComponentCount
    || componentContract.resolvedMaterialCount !== counts.resolvedMaterialCount
    || mediaSurfaceContract.mediaSurfaceConstructionSha256 !== lock.mediaSurfaceConstructionSha256
    || mediaSurfaceContract.mediaSurfaceConstructionRawSha256 !== lock.mediaSurfaceConstructionRawSha256
    || mediaSurfaceContract.surfaceCount !== counts.surfaceCount
    || mediaSurfaceContract.resolvedSurfaceCount !== counts.resolvedSurfaceCount
    || exteriorContract.exteriorConstructionSha256 !== lock.exteriorConstructionSha256
    || exteriorContract.exteriorConstructionRawSha256 !== lock.exteriorConstructionRawSha256
    || exteriorContract.objectCount !== counts.exteriorObjectCount
    || exteriorContract.resolvedObjectCount !== counts.exteriorResolvedObjectCount
    || exteriorContract.materialCount !== counts.exteriorMaterialCount
    || exteriorContract.roleCount !== counts.exteriorRoleCount
    || lightingContract.lightingConstructionSha256 !== lock.lightingConstructionSha256
    || lightingContract.lightingConstructionRawSha256 !== lock.lightingConstructionRawSha256
    || lightingContract.lightCount !== counts.lightCount
    || lightingContract.resolvedLightCount !== counts.resolvedLightCount) {
    throw new Error("approved_candidate_lighting_contract_lock_mismatch");
  }

  const scene = JSON.parse(texts.sceneText);
  const assetLedger = JSON.parse(texts.assetLedgerText);
  const componentConstruction = JSON.parse(componentConstructionText);
  const mediaSurfaceConstruction = JSON.parse(mediaSurfaceConstructionText);
  const exteriorConstruction = JSON.parse(exteriorConstructionText);
  const lightingConstruction = JSON.parse(lightingConstructionText);
  const acceptedPaths = [candidatePaths.conceptSelection, candidatePaths.componentConstruction, candidatePaths.mediaSurfaceConstruction, candidatePaths.exteriorConstruction, candidatePaths.lightingConstruction];
  const acceptedBlobs = acceptedPaths.map((path) => blobByPath.get(path));
  const provenanceRecords = acceptedPaths.map((path) => assetLedger.records.filter((record) => record?.source?.repositoryPath === path));
  const current = {
    scene,
    assetLedger,
    componentConstruction,
    mediaSurfaceConstruction,
    exteriorConstruction,
    componentConstructionBytes: componentConstructionBlob.bytes,
    mediaSurfaceConstructionBytes: mediaSurfaceConstructionBlob.bytes,
    exteriorConstructionBytes: exteriorConstructionBlob.bytes,
    rawLightingConstructionSha256: lightingConstructionBlob.rawSha256
  };
  validateApprovedCandidateLightingPhaseIsolation(current, exteriorBaselineSource);
  if (scene.generator?.commit !== lock.validatorCommit
    || scene.materialRecipes.length !== counts.materialCount
    || provenanceRecords.some((records) => records.length !== 1)
    || provenanceRecords.some((records, index) => records[0].originalSha256 !== acceptedBlobs[index].rawSha256)
    || stableJson(scene.generator.acceptedInputSha256) !== stableJson(lock.acceptedInputSha256)
    || scene.generator.acceptedInputSha256.some((digest, index) => digest !== acceptedBlobs[index].rawSha256)
    || lightingContract.boundaries?.lightingSpecified !== true
    || lightingContract.boundaries?.firstViewAcceptanceSpecified !== true
    || lightingContract.boundaries?.lightingCompiled !== false
    || lightingContract.boundaries?.firstViewRendered !== false
    || lightingContract.boundaries?.firstViewAcceptanceVerified !== false
    || contracts.some((contract) => contract.boundaries?.finalCandidateGlbVerified !== false || contract.boundaries?.publicationReady !== false)
    || lock.release !== null) throw new Error("approved_candidate_lighting_provenance_mismatch");

  const inputBlobs = Object.freeze(Object.fromEntries(blobs.map((blob) => [blob.path, Object.freeze({
    gitBlobOid: blob.gitBlobOid,
    rawSha256: blob.rawSha256,
    byteLength: blob.byteLength
  })])));
  return Object.freeze({
    inputKind: candidateLightingInputKind,
    fixtureOnly: false,
    componentsIncluded: true,
    exteriorIncluded: true,
    lightingIncluded: true,
    sceneBytes: Buffer.from(sceneBlob.bytes),
    assetLedgerBytes: Buffer.from(assetLedgerBlob.bytes),
    componentConstructionBytes: Buffer.from(componentConstructionBlob.bytes),
    mediaSurfaceConstructionBytes: Buffer.from(mediaSurfaceConstructionBlob.bytes),
    exteriorConstructionBytes: Buffer.from(exteriorConstructionBlob.bytes),
    lightingConstructionBytes: Buffer.from(lightingConstructionBlob.bytes),
    scene,
    assetLedger,
    componentConstruction,
    mediaSurfaceConstruction,
    exteriorConstruction,
    lightingConstruction,
    contract: lightingContract,
    componentContract,
    mediaSurfaceContract,
    exteriorContract,
    lightingContract,
    semanticReports: Object.freeze({ component: componentContract, mediaSurfaces: mediaSurfaceContract, exterior: exteriorContract, lighting: lightingContract }),
    acceptedInputSha256: Object.freeze([...scene.generator.acceptedInputSha256]),
    rawSceneSha256: sceneBlob.rawSha256,
    rawComponentConstructionSha256: componentConstructionBlob.rawSha256,
    rawExteriorConstructionSha256: exteriorConstructionBlob.rawSha256,
    rawLightingConstructionSha256: lightingConstructionBlob.rawSha256,
    architectureBaseline: Object.freeze({ ...candidateLock.architecture.semanticEvidence }),
    exteriorGlbEvidence: Object.freeze(structuredClone(candidateLock.exterior.exteriorGlbEvidence)),
    lightingGlbEvidence: lock.lightingGlbEvidence === null ? null : Object.freeze(structuredClone(lock.lightingGlbEvidence)),
    f4Baseline: Object.freeze(structuredClone(candidateLock.exterior)),
    candidateSource: Object.freeze({
      repository: candidateLock.repository,
      commit: lock.commit,
      treeOid: lock.treeOid,
      validatorCommit: lock.validatorCommit,
      platformValidatorCommit: candidateLock.platformValidatorCommit,
      inputBlobs
    }),
    canonicalHashes: Object.freeze({
      specificationSha256: lightingContract.specificationSha256,
      assetLedgerSha256: lightingContract.assetLedgerSha256,
      generationLedgerSha256: lightingContract.generationLedgerSha256,
      componentConstructionSha256: componentContract.componentConstructionSha256,
      componentConstructionRawSha256: componentContract.componentConstructionRawSha256,
      mediaSurfaceConstructionSha256: mediaSurfaceContract.mediaSurfaceConstructionSha256,
      mediaSurfaceConstructionRawSha256: mediaSurfaceContract.mediaSurfaceConstructionRawSha256,
      exteriorConstructionSha256: exteriorContract.exteriorConstructionSha256,
      exteriorConstructionRawSha256: exteriorContract.exteriorConstructionRawSha256,
      lightingConstructionSha256: lightingContract.lightingConstructionSha256,
      lightingConstructionRawSha256: lightingContract.lightingConstructionRawSha256
    }),
    counts: Object.freeze({ ...counts }),
    boundaries: Object.freeze({ ...lock.boundaries })
  });
}

async function loadSyntheticSource(options) {
  const [sceneBytes, assetLedgerBytes, generationLedgerBytes] = await Promise.all([
    readFixture(options.scenePath, fixturePaths.scene, "room_shell_scene"),
    readFixture(options.assetLedgerPath, fixturePaths.assetLedger, "room_shell_asset_ledger"),
    readFixture(options.generationLedgerPath, fixturePaths.generationLedger, "room_shell_generation_ledger")
  ]);
  const sceneText = sceneBytes.toString("utf8");
  const contract = parseSceneContract({
    sceneText,
    assetLedgerText: assetLedgerBytes.toString("utf8"),
    generationLedgerText: generationLedgerBytes.toString("utf8")
  });
  const scene = JSON.parse(sceneText);
  return Object.freeze({
    inputKind: syntheticInputKind,
    fixtureOnly: true,
    componentsIncluded: false,
    exteriorIncluded: false,
    sceneBytes,
    scene,
    contract,
    acceptedInputSha256: Object.freeze([...scene.generator.acceptedInputSha256]),
    rawSceneSha256: sha256(sceneBytes)
  });
}

export function validateCompilerReport(report, source, binarySha256) {
  const wall = report.shell?.objects?.find(({ name }) => name === "shell.walls");
  const expectedStatus = source.fixtureOnly
    ? "stage3-synthetic-room-profiles-materials-compiled"
    : source.lightingIncluded
      ? "stage3-approved-candidate-lighting-compiled"
      : source.exteriorIncluded
      ? "stage3-approved-candidate-exterior-compiled"
      : source.componentsIncluded
      ? "stage3-approved-candidate-components-compiled"
      : "stage3-approved-candidate-architecture-compiled";
  const expectedMaterialRecipeCount = source.exteriorIncluded ? 8 : source.componentsIncluded ? 5 : 3;
  const expectedMaterialZoneCount = source.exteriorIncluded ? 64 : source.componentsIncluded ? 60 : 22;
  const expectedInventoryCount = source.exteriorIncluded ? 61 : source.componentsIncluded ? 57 : 19;
  const expectedObjectCount = source.lightingIncluded ? 65 : expectedInventoryCount;
  const commonInvalid = report?.status !== expectedStatus
    || report.fixtureOnly !== source.fixtureOnly
    || report.sceneId !== source.contract.sceneId
    || report.specificationSha256 !== source.contract.specificationSha256
    || report.blender?.version !== "4.5.12 LTS"
    || report.blender?.buildHash !== "84afd5f785f7"
    || report.blender?.binarySha256 !== binarySha256
    || report.shell?.objectCount !== 3
    || report.shell?.meshCount !== 3
    || wall?.geometry !== "rectangular-wall-ring-with-openings"
    || wall?.nonManifoldEdgeCount !== 0
    || report.openings?.compiled !== true
    || report.openings?.openingCount !== 2
    || report.openings?.cutCount !== 2
    || report.openings?.frameObjectCount !== 7
    || report.openings?.revealObjectCount !== 3
    || report.openings?.sillObjectCount !== 1
    || report.openings?.overlapPairCount !== 0
    || report.openings?.cutObjectsPersisted !== false
    || report.openings?.openings?.some(({ clearWidthM, clearHeightM }) => clearWidthM < 0.9 || clearHeightM < 1.6)
    || report.profiles?.compiled !== true
    || report.profiles?.baseboardDetailCount !== 4
    || report.profiles?.baseboardObjectCount !== 5
    || report.profiles?.overlapPairCount !== 0
    || report.materials?.compiled !== true
    || report.materials?.recipeCount !== expectedMaterialRecipeCount
    || report.materials?.zoneCount !== expectedMaterialZoneCount
    || report.materials?.assignmentCount !== expectedInventoryCount
    || report.materials?.imageCount !== 0
    || report.materials?.textureCount !== 0
    || report.materials?.textureNodeCount !== 0
    || report.materials?.textureImagesCompiled !== false
    || report.outputGlb?.exportSettings?.exportFormat !== "GLB"
    || report.outputGlb?.exportSettings?.exportAttributes !== true
    || report.outputGlb?.exportSettings?.exportExtras !== true
    || report.outputGlb?.exportSettings?.exportCameras !== false
    || report.outputGlb?.exportSettings?.exportLights !== Boolean(source.lightingIncluded)
    || (source.lightingIncluded
      ? report.outputGlb?.exportSettings?.exportImportConvertLightingMode !== "SPEC"
      : Object.hasOwn(report.outputGlb?.exportSettings ?? {}, "exportImportConvertLightingMode"))
    || report.outputGlb?.exportSettings?.exportYup !== true
    || report.inventory?.objectCount !== expectedObjectCount
    || report.inventory?.meshCount !== expectedInventoryCount
    || report.inventory?.materialCount !== expectedMaterialRecipeCount
    || report.inventory?.imageCount !== 0
    || report.inventory?.textureCount !== 0
    || report.inventory?.cameraCount !== (source.lightingIncluded ? 1 : 0)
    || report.inventory?.lightCount !== (source.lightingIncluded ? 3 : 0)
    || report.boundaries?.openingsCompiled !== true
    || report.boundaries?.materialsCompiled !== true
    || report.boundaries?.componentsCompiled !== source.componentsIncluded
    || report.boundaries?.profilesCompiled !== true
    || report.boundaries?.sceneBinaryAddedToRepository !== false;
  const componentInvalid = source.componentsIncluded && (report.components?.specified !== true
    || report.components?.compiled !== true
    || report.components?.componentCount !== 11
    || report.components?.familyCount !== 4
    || report.components?.partObjectCount !== 38
    || report.components?.overrideCount !== 2
    || stableJson(report.components?.familyObjectCounts) !== stableJson({ "conference-av": 1, "conference-table": 3, "pendant-luminaire": 2, "task-chair": 32 })
    || report.materials?.architectureRecipeCount !== 3
    || report.materials?.architectureZoneCount !== 22
    || report.materials?.architectureAssignmentCount !== 19
    || report.materials?.componentAssignmentCount !== 38
    || report.materials?.componentOverrideCount !== 2
    || report.componentsSpecified !== true
    || report.componentsCompiled !== true
    || report.componentGlbByteIdentical !== false
    || report.exteriorCompiled !== source.exteriorIncluded
    || report.lightingCompiled !== Boolean(source.lightingIncluded)
    || report.mediaSurfacesCompiled !== false
    || report.sceneBinaryAddedToRepository !== false
    || report.boundaries?.componentsSpecified !== true
    || report.boundaries?.componentGlbByteIdentical !== false
    || report.boundaries?.exteriorCompiled !== source.exteriorIncluded
    || report.boundaries?.lightingCompiled !== Boolean(source.lightingIncluded)
    || report.boundaries?.mediaSurfacesCompiled !== false);
  const exteriorInvalid = source.exteriorIncluded && (report.exterior?.specified !== true
    || report.exterior?.compiled !== true
    || report.exterior?.strategy !== "project-authored-geometry"
    || report.exterior?.windowOpeningId !== "main-window"
    || report.exterior?.sourceRecordId !== "asset-exterior-constructions-project"
    || report.exterior?.objectNamePattern !== "exterior.<objectId>"
    || report.exterior?.objectCount !== 4
    || report.exterior?.materialCount !== 3
    || report.exterior?.objects?.length !== 4
    || report.materials?.exteriorAssignmentCount !== 4
    || report.materials?.exteriorMaterialCount !== 3
    || report.exteriorSpecified !== true
    || report.exteriorCompiled !== true
    || report.exteriorGlbByteIdentical !== false
    || report.byteIdenticalExportsVerified !== false
    || report.releaseArtifactsCreated !== false
    || report.artifactBytesIncludedInRepository !== false
    || report.boundaries?.exteriorSpecified !== true
    || report.boundaries?.exteriorCompiled !== true
    || report.boundaries?.exteriorGlbByteIdentical !== false
    || report.boundaries?.byteIdenticalExportsVerified !== false
    || report.boundaries?.releaseArtifactsCreated !== false
    || report.boundaries?.artifactBytesIncludedInRepository !== false);
  const lightingInvalid = source.lightingIncluded && (report.lighting?.specified !== true
    || report.lighting?.compiled !== true
    || report.lighting?.sourceRecordId !== "asset-lighting-constructions-project"
    || report.lighting?.objectNamePattern !== "light.<sceneLightId>"
    || report.lighting?.lightCount !== 3
    || report.lighting?.lights?.length !== 3
    || report.lightingSpecified !== true
    || report.lightingCompiled !== true
    || report.lightingGlbByteIdentical !== false
    || report.firstView?.specified !== true
    || report.firstView?.rendered !== true
    || report.firstView?.acceptanceVerified !== true
    || report.firstView?.camera?.name !== "camera.review.entry"
    || report.firstView?.renderSettings?.output?.filepath !== "//first-view.png"
    || report.firstView?.acceptance?.acceptancePass !== true
    || report.firstViewRendered !== true
    || report.firstViewAcceptanceVerified !== true
    || report.firstViewPngByteIdentical !== false
    || report.outputFirstView?.acceptancePass !== true
    || report.boundaries?.lightingSpecified !== true
    || report.boundaries?.lightingCompiled !== true
    || report.boundaries?.lightingGlbByteIdentical !== false
    || report.boundaries?.firstViewRendered !== true
    || report.boundaries?.firstViewAcceptanceVerified !== true
    || report.boundaries?.firstViewPngByteIdentical !== false
    || report.byteIdenticalExportsVerified !== false
    || report.finalCandidateGlbVerified !== false
    || report.releaseArtifactsCreated !== false
    || report.artifactBytesIncludedInRepository !== false
    || report.publicationReady !== false);
  const boundaryInvalid = source.fixtureOnly
    ? report.boundaries?.approvedCandidateSpecification !== false || report.boundaries?.byteIdenticalExportsVerified !== false
    : report.approvedCandidateSpecification !== true
      || report.candidateArchitectureCompiled !== true
      || report.componentsCompiled !== source.componentsIncluded
      || report.finalCandidateGlbVerified !== false
      || report.publicationReady !== false
      || report.boundaries?.approvedCandidateSpecification !== true
      || report.boundaries?.candidateArchitectureCompiled !== true
      || report.boundaries?.finalCandidateGlbVerified !== false
      || report.boundaries?.publicationReady !== false;
  if (!source.componentsIncluded && !source.fixtureOnly && report.boundaries?.byteIdenticalExportsVerified !== false) throw new Error("room_shell_report_invalid");
  if (commonInvalid || componentInvalid || exteriorInvalid || lightingInvalid || boundaryInvalid) throw new Error("room_shell_report_invalid");
}

function exactKeys(value, expected) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function exactStringSet(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && new Set(actual).size === actual.length
    && actual.every((value) => expected.includes(value));
}

function containsExtensionRecord(value) {
  if (!value || typeof value !== "object") return false;
  if (!Array.isArray(value) && Object.hasOwn(value, "extensions")) return true;
  return Object.values(value).some(containsExtensionRecord);
}

function srgbColorFactor(hex) {
  const channel = (offset) => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return [channel(1), channel(3), channel(5), 1];
}

function approximatelyEqual(actual, expected, tolerance = 1e-6) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance;
}

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngCrcTable = Object.freeze(Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
}));

function pngCrc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = pngCrcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function paethPredictor(left, above, upperLeft) {
  const prediction = left + above - upperLeft;
  const leftDistance = Math.abs(prediction - left);
  const aboveDistance = Math.abs(prediction - above);
  const upperLeftDistance = Math.abs(prediction - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= upperLeftDistance ? left : aboveDistance <= upperLeftDistance ? above : upperLeft;
}

export function measureFirstViewRgb(rgb, width, height, criteria = {}) {
  const averageLuminanceMinimum = criteria.averageLuminanceMinimum ?? 40;
  const darkPixelThreshold = criteria.darkPixelThreshold ?? 40;
  const darkPixelRatioMaximum = criteria.darkPixelRatioMaximum ?? 0.7;
  if (!Buffer.isBuffer(rgb) || !Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || rgb.length !== width * height * 3 || averageLuminanceMinimum !== 40 || darkPixelThreshold !== 40 || darkPixelRatioMaximum !== 0.7) {
    throw new Error("first_view_rgb_measurement_invalid");
  }
  let weightedLuminanceSum = 0;
  let darkPixelCount = 0;
  for (let offset = 0; offset < rgb.length; offset += 3) {
    const numerator = 2126 * rgb[offset] + 7152 * rgb[offset + 1] + 722 * rgb[offset + 2];
    weightedLuminanceSum += numerator;
    if (numerator < darkPixelThreshold * 10000) darkPixelCount += 1;
  }
  const pixelCount = width * height;
  const averagePass = weightedLuminanceSum >= averageLuminanceMinimum * 10000 * pixelCount;
  const darkRatioPass = darkPixelCount * 10 <= pixelCount * 7;
  return Object.freeze({
    decodedRgbSha256: sha256(rgb),
    pixelCount,
    weightedLuminanceSum,
    darkPixelCount,
    averageLuminanceMinimum,
    averagePass,
    darkPixelThreshold,
    darkPixelRatioMaximum,
    darkRatioPass,
    acceptancePass: averagePass && darkRatioPass
  });
}

export function inspectFirstViewPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 45 || !bytes.subarray(0, 8).equals(pngSignature)) throw new Error("first_view_png_signature_invalid");
  let offset = 8;
  const chunks = [];
  const idat = [];
  let sawIdat = false;
  let idatEnded = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("first_view_png_chunk_invalid");
    const length = bytes.readUInt32BE(offset);
    const typeBytes = bytes.subarray(offset + 4, offset + 8);
    const type = typeBytes.toString("ascii");
    const end = offset + 12 + length;
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(type)) throw new Error("first_view_png_chunk_invalid");
    const data = bytes.subarray(offset + 8, offset + 8 + length);
    if (pngCrc32(Buffer.concat([typeBytes, data])) !== bytes.readUInt32BE(offset + 8 + length)) throw new Error("first_view_png_crc_invalid");
    if (!["IHDR", "IDAT", "IEND"].includes(type)) throw new Error(`first_view_png_metadata_forbidden:${type}`);
    if (type === "IDAT") {
      if (idatEnded) throw new Error("first_view_png_chunk_order_invalid");
      sawIdat = true;
      idat.push(data);
    } else if (sawIdat) {
      idatEnded = true;
    }
    chunks.push({ type, data });
    offset = end;
    if (type === "IEND") break;
  }
  if (offset !== bytes.length || chunks[0]?.type !== "IHDR" || chunks.at(-1)?.type !== "IEND"
    || chunks.filter(({ type }) => type === "IHDR").length !== 1
    || chunks.filter(({ type }) => type === "IEND").length !== 1
    || idat.length === 0 || chunks.at(-1).data.length !== 0) throw new Error("first_view_png_chunk_order_invalid");
  const ihdr = chunks[0].data;
  if (ihdr.length !== 13 || ihdr.readUInt32BE(0) !== 960 || ihdr.readUInt32BE(4) !== 540
    || ihdr[8] !== 8 || ihdr[9] !== 2 || ihdr[10] !== 0 || ihdr[11] !== 0 || ihdr[12] !== 0) throw new Error("first_view_png_ihdr_invalid");
  let filtered;
  try {
    const compressed = Buffer.concat(idat);
    const inflated = inflateSync(compressed, { info: true, maxOutputLength: 540 * (960 * 3 + 1) });
    if (inflated.engine.bytesWritten !== compressed.length) throw new Error("trailing_deflate_bytes");
    filtered = inflated.buffer;
  } catch {
    throw new Error("first_view_png_deflate_invalid");
  }
  const width = 960;
  const height = 540;
  const stride = width * 3;
  if (filtered.length !== height * (stride + 1)) throw new Error("first_view_png_scanline_invalid");
  const decoded = Buffer.allocUnsafe(width * height * 3);
  for (let row = 0; row < height; row += 1) {
    const sourceOffset = row * (stride + 1);
    const filter = filtered[sourceOffset];
    if (filter > 4) throw new Error("first_view_png_filter_invalid");
    for (let column = 0; column < stride; column += 1) {
      const target = row * stride + column;
      const left = column >= 3 ? decoded[target - 3] : 0;
      const above = row > 0 ? decoded[target - stride] : 0;
      const upperLeft = row > 0 && column >= 3 ? decoded[target - stride - 3] : 0;
      const predictor = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? above : filter === 3
        ? Math.floor((left + above) / 2) : paethPredictor(left, above, upperLeft);
      decoded[target] = (filtered[sourceOffset + 1 + column] + predictor) & 0xff;
    }
  }
  const measurement = measureFirstViewRgb(decoded, width, height);
  if (!measurement.acceptancePass) {
    const error = new Error("first_view_png_acceptance_failed");
    error.measurement = measurement;
    throw error;
  }
  return Object.freeze({
    status: "first-view-png-acceptance-valid",
    sha256: sha256(bytes),
    byteLength: bytes.length,
    ...measurement,
    widthPx: width,
    heightPx: height,
    chunkTypes: Object.freeze(chunks.map(({ type }) => type))
  });
}

function normalizeExpectedRecords(records, mode) {
  const componentMode = mode === "components" || mode === "exterior";
  const exteriorMode = mode === "exterior";
  const expectedCount = exteriorMode ? 61 : componentMode ? 57 : expectedArchitectureNodeNames.length;
  if (!Array.isArray(records) || records.length !== expectedCount) throw new Error("room_glb_expected_inventory_invalid");
  const normalized = records.map((record) => {
    const center = record?.centerM;
    const dimensions = record?.dimensionsM;
    if (typeof record?.name !== "string"
      || ![center?.x, center?.y, center?.z, dimensions?.widthM, dimensions?.heightM, dimensions?.depthM].every(Number.isFinite)
      || dimensions.widthM <= 0 || dimensions.heightM <= 0 || dimensions.depthM <= 0) throw new Error("room_glb_expected_inventory_invalid");
    const normalizedRecord = {
      name: record.name,
      centerM: { x: center.x, y: center.y, z: center.z },
      dimensionsM: { widthM: dimensions.widthM, heightM: dimensions.heightM, depthM: dimensions.depthM },
      geometry: record.geometry,
      materialRecipeId: record.materialRecipeId
    };
    if (record.geometry === "beveled-box") {
      const componentName = /^component\.[a-z0-9-]+\.[a-z0-9-]+$/.test(record.name);
      const exteriorName = /^exterior\.[a-z0-9-]+$/.test(record.name);
      if ((!componentName && !(exteriorMode && exteriorName))
        || !Number.isFinite(record.bevel?.widthM) || record.bevel.widthM <= 0
        || record.bevel?.segments !== 3 || record.bevel?.clampOverlap !== true
        || typeof record.materialRecipeId !== "string") throw new Error("room_glb_expected_component_invalid");
      normalizedRecord.bevel = {
        widthM: record.bevel.widthM,
        segments: record.bevel.segments,
        clampOverlap: record.bevel.clampOverlap
      };
      if (exteriorName) {
        if (typeof record.role !== "string" || !(record.supportObjectId === null || typeof record.supportObjectId === "string")) {
          throw new Error("room_glb_expected_exterior_invalid");
        }
        normalizedRecord.role = record.role;
        normalizedRecord.supportObjectId = record.supportObjectId;
      }
    } else if (componentMode && record.name.startsWith("component.")) {
      throw new Error("room_glb_expected_component_invalid");
    }
    return normalizedRecord;
  }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const names = normalized.map(({ name }) => name);
  if (new Set(names).size !== names.length
    || expectedArchitectureNodeNames.some((name) => !names.includes(name))
    || (!componentMode && !exactStringSet(names, expectedArchitectureNodeNames))
    || (componentMode && normalized.filter(({ name }) => name.startsWith("component.")).length !== 38)
    || (exteriorMode && normalized.filter(({ name }) => name.startsWith("exterior.")).length !== 4)
    || (!exteriorMode && normalized.some(({ name }) => name.startsWith("exterior.")))) {
    throw new Error("room_glb_expected_inventory_invalid");
  }
  return normalized;
}

function normalizeExpectedGlbContract(value) {
  if (Array.isArray(value)) return Object.freeze({
    status: "architecture-only-glb-inspection-valid",
    componentMode: false,
    exteriorMode: false,
    lightingMode: false,
    records: normalizeExpectedRecords(value, "architecture"),
    materials: expectedArchitectureMaterials,
    allowedMaterialSourceIds: allowedArchitectureMaterialSourceIds,
    requiredMaterialSourceCount: 1,
    materialSourceIds: null,
    lights: Object.freeze([])
  });
  const lightingMode = value?.status === "approved-candidate-lighting-glb-inspection-valid";
  const exteriorMode = value?.status === "approved-candidate-exterior-glb-inspection-valid" || lightingMode;
  const componentMode = value?.status === "approved-candidate-components-glb-inspection-valid" || exteriorMode;
  const allowedMaterialSourceIds = new Set(value?.allowedMaterialSourceIds);
  const materialNames = Object.keys(value?.materials ?? {});
  const exteriorContractValid = exteriorMode
    && materialNames.length === 8
    && Object.values(value.materials).every((material) => typeof material?.recipeId === "string"
      && /^#[0-9A-F]{6}$/.test(material?.baseColorSrgb ?? "")
      && [material?.roughness, material?.metalness].every((number) => Number.isFinite(number) && number >= 0 && number <= 1)
      && Number.isFinite(material?.textureScaleM) && material.textureScaleM > 0)
    && !exactStringSet(materialNames, Object.keys(expectedComponentMaterials))
    && exactStringSet(value?.allowedMaterialSourceIds, ["asset-layout-project", "asset-exterior-constructions-project"])
    && value?.requiredMaterialSourceCount === 2
    && exactStringSet(Object.keys(value?.materialSourceIds ?? {}), materialNames)
    && Object.entries(value.materialSourceIds).every(([name, sourceId]) => value.allowedMaterialSourceIds.includes(sourceId)
      && value.materials[name]?.sourceRecordId === sourceId);
  const componentContractValid = componentMode
    && stableJson(value?.materials) === stableJson(expectedComponentMaterials)
    && exactStringSet(value?.allowedMaterialSourceIds, ["asset-layout-project"])
    && value?.requiredMaterialSourceCount === 1
    && value?.materialSourceIds === undefined;
  const lightingContractValid = !lightingMode || (Array.isArray(value?.lights) && value.lights.length === 3
    && value.lights.every((light) => typeof light?.name === "string" && typeof light?.type === "string"));
  if ((!componentContractValid && !exteriorContractValid) || !lightingContractValid) throw new Error("room_glb_expected_contract_invalid");
  return Object.freeze({
    status: value.status,
    componentMode,
    exteriorMode,
    lightingMode,
    records: normalizeExpectedRecords(value.records, exteriorMode ? "exterior" : "components"),
    materials: value.materials,
    allowedMaterialSourceIds,
    requiredMaterialSourceCount: value.requiredMaterialSourceCount,
    materialSourceIds: value.materialSourceIds ?? null,
    lights: value.lights ?? Object.freeze([])
  });
}

export function inspectGlb(bytes, expectedContract) {
  const normalizedContract = normalizeExpectedGlbContract(expectedContract);
  const expectedRecords = normalizedContract.records;
  const expectedRecordByName = new Map(expectedRecords.map((record) => [record.name, record]));
  const expectedNodeNames = expectedRecords.map(({ name }) => name);
  const expectedMaterials = normalizedContract.materials;
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error("room_glb_header_invalid");
  }
  let offset = 12;
  let document;
  let binaryChunk;
  let binaryChunkCount = 0;
  const chunkTypes = [];
  while (offset < bytes.length) {
    if (offset + 8 > bytes.length) throw new Error("room_glb_chunk_invalid");
    const length = bytes.readUInt32LE(offset);
    const type = bytes.readUInt32LE(offset + 4);
    offset += 8;
    if (length % 4 !== 0 || offset + length > bytes.length) throw new Error("room_glb_chunk_invalid");
    const chunk = bytes.subarray(offset, offset + length);
    chunkTypes.push(type);
    if (type === 0x4e4f534a && document === undefined) document = JSON.parse(chunk.toString("utf8").trimEnd());
    else if (type === 0x004e4942 && binaryChunk === undefined) {
      binaryChunk = chunk;
      binaryChunkCount += 1;
    }
    else throw new Error("room_glb_chunk_invalid");
    offset += length;
  }
  if (offset !== bytes.length || document?.asset?.version !== "2.0" || binaryChunkCount !== 1
    || chunkTypes.length !== 2 || chunkTypes[0] !== 0x4e4f534a || chunkTypes[1] !== 0x004e4942) throw new Error("room_glb_document_invalid");
  const prohibitedTopLevel = ["animations", "cameras", "images", "lights", "samplers", "skins", "textures"];
  if (prohibitedTopLevel.some((key) => Object.hasOwn(document, key))) throw new Error("room_glb_prohibited_content");
  let punctualLights = [];
  if (normalizedContract.lightingMode) {
    const extensionName = "KHR_lights_punctual";
    if (stableJson(document.extensionsUsed) !== stableJson([extensionName])
      || stableJson(document.extensionsRequired) !== stableJson([extensionName])
      || !exactKeys(document.extensions, [extensionName])
      || !exactKeys(document.extensions[extensionName], ["lights"])
      || !Array.isArray(document.extensions[extensionName].lights)
      || document.extensions[extensionName].lights.length !== 3) throw new Error("room_glb_lighting_extension_invalid");
    punctualLights = document.extensions[extensionName].lights;
    const stripped = structuredClone(document);
    delete stripped.extensions;
    delete stripped.extensionsUsed;
    delete stripped.extensionsRequired;
    for (const node of stripped.nodes ?? []) if (normalizedContract.lights.some(({ name }) => name === node.name)) delete node.extensions;
    if (containsExtensionRecord(stripped)) throw new Error("room_glb_prohibited_content");
  } else if (Object.hasOwn(document, "extensionsUsed")
    || Object.hasOwn(document, "extensionsRequired")
    || containsExtensionRecord(document)) throw new Error("room_glb_prohibited_content");

  const buffer = document.buffers?.[0];
  if (document.buffers?.length !== 1 || !buffer || Object.hasOwn(buffer, "uri")
    || !Number.isInteger(buffer.byteLength) || buffer.byteLength <= 0
    || binaryChunk.length !== Math.ceil(buffer.byteLength / 4) * 4) throw new Error("room_glb_buffer_invalid");
  const bufferViews = document.bufferViews;
  if (!Array.isArray(bufferViews) || bufferViews.length === 0) throw new Error("room_glb_buffer_view_invalid");
  const bufferViewLayouts = bufferViews.map((view, index) => {
    const byteOffset = view?.byteOffset ?? 0;
    const byteStride = view?.byteStride;
    if (view?.buffer !== 0
      || !Number.isInteger(byteOffset) || byteOffset < 0 || byteOffset % 4 !== 0
      || !Number.isInteger(view?.byteLength) || view.byteLength <= 0
      || byteOffset + view.byteLength > buffer.byteLength
      || ![34962, 34963].includes(view?.target)
      || (byteStride !== undefined && (!Number.isInteger(byteStride) || byteStride < 4 || byteStride > 252 || byteStride % 4 !== 0 || view.target !== 34962))) {
      throw new Error("room_glb_buffer_view_invalid");
    }
    return { index, byteOffset, byteLength: view.byteLength, byteStride, target: view.target };
  });
  const sortedBufferViews = [...bufferViewLayouts].sort((left, right) => left.byteOffset - right.byteOffset);
  for (let index = 1; index < sortedBufferViews.length; index += 1) {
    if (sortedBufferViews[index].byteOffset < sortedBufferViews[index - 1].byteOffset + sortedBufferViews[index - 1].byteLength) {
      throw new Error("room_glb_buffer_view_invalid");
    }
  }

  const nodes = document.nodes;
  const meshes = document.meshes;
  const materials = document.materials;
  const accessors = document.accessors;
  const expectedLightNodeNames = normalizedContract.lights.map(({ name }) => name);
  const expectedAllNodeNames = [...expectedNodeNames, ...expectedLightNodeNames];
  const nodeNames = nodes?.map(({ name }) => name).sort();
  const meshNames = meshes?.map(({ name }) => name).sort();
  const materialNames = materials?.map(({ name }) => name).sort();
  if (nodes?.length !== expectedAllNodeNames.length
    || meshes?.length !== expectedNodeNames.length
    || materials?.length !== Object.keys(expectedMaterials).length
    || !exactStringSet(nodeNames, expectedAllNodeNames)
    || !exactStringSet(meshNames, expectedNodeNames.map((name) => `mesh.${name}`))
    || !exactStringSet(materialNames, Object.keys(expectedMaterials))) throw new Error("room_glb_inventory_invalid");

  if (document.scene !== 0 || document.scenes?.length !== 1 || !Array.isArray(document.scenes[0]?.nodes)) throw new Error("room_glb_scene_invalid");
  const incomingReferences = Array(nodes.length).fill(0);
  const pending = [];
  for (const index of document.scenes[0].nodes) {
    if (!Number.isInteger(index) || index < 0 || index >= nodes.length) throw new Error("room_glb_scene_invalid");
    incomingReferences[index] += 1;
    pending.push(index);
  }
  const reachable = new Set();
  while (pending.length !== 0) {
    const index = pending.pop();
    if (reachable.has(index)) continue;
    reachable.add(index);
    const children = nodes[index].children ?? [];
    if (!Array.isArray(children)) throw new Error("room_glb_scene_invalid");
    for (const child of children) {
      if (!Number.isInteger(child) || child < 0 || child >= nodes.length) throw new Error("room_glb_scene_invalid");
      incomingReferences[child] += 1;
      pending.push(child);
    }
  }
  if (reachable.size !== nodes.length || incomingReferences.some((count) => count !== 1)) throw new Error("room_glb_scene_invalid");

  const meshReferences = Array(meshes.length).fill(0);
  const meshNodes = nodes.filter((node) => Number.isInteger(node.mesh));
  const lightNodes = nodes.filter((node) => expectedLightNodeNames.includes(node.name));
  if (meshNodes.length !== expectedNodeNames.length || lightNodes.length !== expectedLightNodeNames.length
    || nodes.some((node) => !meshNodes.includes(node) && !lightNodes.includes(node))) throw new Error("room_glb_mesh_binding_invalid");
  for (const node of meshNodes) {
    if (!Number.isInteger(node.mesh) || node.mesh < 0 || node.mesh >= meshes.length || Object.hasOwn(node, "camera") || Object.hasOwn(node, "skin")) {
      throw new Error("room_glb_mesh_binding_invalid");
    }
    meshReferences[node.mesh] += 1;
    if (meshes[node.mesh].name !== `mesh.${node.name}`) throw new Error("room_glb_mesh_binding_invalid");
  }
  if (meshReferences.some((count) => count !== 1)) throw new Error("room_glb_mesh_binding_invalid");

  const lightEvidence = [];
  if (normalizedContract.lightingMode) {
    const referencedLights = new Set();
    for (const expected of normalizedContract.lights) {
      const node = nodes.find(({ name }) => name === expected.name);
      const extension = node?.extensions?.KHR_lights_punctual;
      if (!node || !exactKeys(node, ["extensions", "extras", "name", "rotation", "translation"])
        || !exactKeys(node.extensions, ["KHR_lights_punctual"])
        || !exactKeys(extension, ["light"])
        || !Number.isInteger(extension.light) || extension.light < 0 || extension.light >= punctualLights.length
        || referencedLights.has(extension.light)
        || stableJson(node.extras) !== stableJson(expected.extras)
        || !Array.isArray(node.translation) || node.translation.length !== 3
        || node.translation.some((value, axis) => !approximatelyEqual(value, expected.translation[axis], geometryTolerance))
        || !Array.isArray(node.rotation) || node.rotation.length !== 4 || !node.rotation.every(Number.isFinite)) {
        throw new Error("room_glb_light_node_invalid");
      }
      const rotationLength = Math.hypot(...node.rotation);
      const expectedRotationLength = Math.hypot(...expected.rotation);
      const rotationDot = node.rotation.reduce((sum, value, index) => sum + value / rotationLength * expected.rotation[index] / expectedRotationLength, 0);
      if (!approximatelyEqual(Math.abs(rotationDot), 1, geometryTolerance)) throw new Error("room_glb_light_node_invalid");
      referencedLights.add(extension.light);
      const light = punctualLights[extension.light];
      const expectedKeys = expected.type === "directional"
        ? ["color", "intensity", "name", "type"]
        : ["color", "intensity", "name", "range", "spot", "type"];
      if (!exactKeys(light, expectedKeys)
        || light.name !== expected.name || light.type !== expected.type
        || !Array.isArray(light.color) || light.color.length !== 3
        || light.color.some((value, index) => !approximatelyEqual(value, expected.color[index], geometryTolerance))
        || !approximatelyEqual(light.intensity, expected.intensity, 1e-4)) throw new Error("room_glb_light_invalid");
      if (expected.type === "spot" && (!approximatelyEqual(light.range, expected.range, geometryTolerance)
        || !exactKeys(light.spot, ["innerConeAngle", "outerConeAngle"])
        || !approximatelyEqual(light.spot.innerConeAngle, expected.innerConeAngle, geometryTolerance)
        || !approximatelyEqual(light.spot.outerConeAngle, expected.outerConeAngle, geometryTolerance))) throw new Error("room_glb_light_invalid");
      lightEvidence.push({
        nodeName: node.name,
        lightIndex: extension.light,
        type: light.type,
        color: [...light.color],
        intensity: light.intensity,
        ...(light.type === "spot" ? {
          range: light.range,
          innerConeAngle: light.spot.innerConeAngle,
          outerConeAngle: light.spot.outerConeAngle
        } : {}),
        translation: [...node.translation],
        rotation: [...node.rotation],
        extras: { ...node.extras }
      });
    }
    if (referencedLights.size !== punctualLights.length) throw new Error("room_glb_light_invalid");
    lightEvidence.sort((left, right) => left.lightIndex - right.lightIndex);
  }

  if (!Array.isArray(accessors) || accessors.length === 0) throw new Error("room_glb_accessor_invalid");
  const occupiedAccessorRanges = [];
  const accessorLayouts = accessors.map((accessor, index) => {
    const component = accessorComponentTypes[accessor?.componentType];
    const componentCount = accessorTypeLengths[accessor?.type];
    const view = bufferViewLayouts[accessor?.bufferView];
    const accessorByteOffset = accessor?.byteOffset ?? 0;
    if (!component || !componentCount || !view
      || !Number.isInteger(accessor?.count) || accessor.count <= 0
      || !Number.isInteger(accessorByteOffset) || accessorByteOffset < 0
      || Object.hasOwn(accessor, "sparse") || accessor?.normalized === true) throw new Error("room_glb_accessor_invalid");
    const elementByteLength = component.byteLength * componentCount;
    const stride = view.byteStride ?? elementByteLength;
    const start = view.byteOffset + accessorByteOffset;
    const end = accessorByteOffset + (accessor.count - 1) * stride + elementByteLength;
    if (stride < elementByteLength || stride % component.byteLength !== 0 || start % component.byteLength !== 0 || end > view.byteLength) {
      throw new Error("room_glb_accessor_invalid");
    }
    for (let element = 0; element < accessor.count; element += 1) {
      const elementStart = start + element * stride;
      occupiedAccessorRanges.push({ accessor: index, start: elementStart, end: elementStart + elementByteLength });
    }
    for (const key of ["min", "max"]) {
      if (accessor[key] !== undefined && (!Array.isArray(accessor[key]) || accessor[key].length !== componentCount || !accessor[key].every(Number.isFinite))) {
        throw new Error("room_glb_accessor_invalid");
      }
    }
    return { index, accessor, component, componentCount, view, start, stride, elementByteLength };
  });
  occupiedAccessorRanges.sort((left, right) => left.start - right.start || left.end - right.end);
  for (let index = 1; index < occupiedAccessorRanges.length; index += 1) {
    if (occupiedAccessorRanges[index].start < occupiedAccessorRanges[index - 1].end) throw new Error("room_glb_accessor_invalid");
  }

  const referencedAccessors = new Set();
  const referencedBufferViews = new Set();
  const accessorSemantics = new Map();
  const decodedAccessors = new Map();
  const usedMaterials = new Set();
  let primitiveCount = 0;
  let decodedVertexCount = 0;
  let decodedIndexCount = 0;
  let decodedTriangleCount = 0;
  let decodedDistinctReferencedPositionCount = 0;
  let decodedNormalCount = 0;
  let minimumNormalLength = Number.POSITIVE_INFINITY;
  let maximumNormalLength = Number.NEGATIVE_INFINITY;
  const geometryEvidence = [];
  const decodeAccessor = (index, semantic) => {
    const layout = accessorLayouts[index];
    if (!layout) throw new Error("room_glb_accessor_invalid");
    const previousSemantic = accessorSemantics.get(index);
    if (previousSemantic !== undefined && previousSemantic !== semantic) throw new Error("room_glb_accessor_invalid");
    accessorSemantics.set(index, semantic);
    referencedAccessors.add(index);
    referencedBufferViews.add(layout.accessor.bufferView);
    if (decodedAccessors.has(index)) return { layout, values: decodedAccessors.get(index) };
    const values = Array.from({ length: layout.accessor.count }, (_, element) => Array.from({ length: layout.componentCount }, (_, componentIndex) => {
      const value = binaryChunk[layout.component.read](layout.start + element * layout.stride + componentIndex * layout.component.byteLength);
      if (!Number.isFinite(value)) throw new Error("room_glb_accessor_data_invalid");
      return value;
    }));
    for (const key of ["min", "max"]) {
      const declared = layout.accessor[key];
      if (declared === undefined) continue;
      const decoded = Array.from({ length: layout.componentCount }, (_, componentIndex) => (
        key === "min"
          ? Math.min(...values.map((value) => value[componentIndex]))
          : Math.max(...values.map((value) => value[componentIndex]))
      ));
      const tolerance = layout.accessor.componentType === 5126 ? geometryTolerance : 0;
      if (declared.some((value, componentIndex) => !approximatelyEqual(value, decoded[componentIndex], tolerance))) {
        throw new Error("room_glb_accessor_bounds_invalid");
      }
    }
    decodedAccessors.set(index, values);
    return { layout, values };
  };
  for (const node of meshNodes) {
    const mesh = meshes[node.mesh];
    if (!exactKeys(mesh, ["name", "primitives"]) || !Array.isArray(mesh.primitives) || mesh.primitives.length !== 1) throw new Error("room_glb_mesh_invalid");
    const primitive = mesh.primitives[0];
    if (!exactKeys(primitive, ["attributes", "indices", "material"])
      || !exactKeys(primitive.attributes, ["NORMAL", "POSITION", "TEXCOORD_0"])) throw new Error("room_glb_mesh_invalid");
    const position = decodeAccessor(primitive.attributes.POSITION, "POSITION");
    const normal = decodeAccessor(primitive.attributes.NORMAL, "NORMAL");
    const uv = decodeAccessor(primitive.attributes.TEXCOORD_0, "TEXCOORD_0");
    const indexData = decodeAccessor(primitive.indices, "INDICES");
    if (position.layout.accessor.componentType !== 5126 || position.layout.accessor.type !== "VEC3" || position.layout.view.target !== 34962
      || normal.layout.accessor.componentType !== 5126 || normal.layout.accessor.type !== "VEC3" || normal.layout.view.target !== 34962
      || uv.layout.accessor.componentType !== 5126 || uv.layout.accessor.type !== "VEC2" || uv.layout.view.target !== 34962
      || ![5121, 5123, 5125].includes(indexData.layout.accessor.componentType) || indexData.layout.accessor.type !== "SCALAR" || indexData.layout.view.target !== 34963
      || position.values.length < 3 || normal.values.length !== position.values.length || uv.values.length !== position.values.length
      || indexData.values.length < 3 || indexData.values.length % 3 !== 0
      || !Number.isInteger(primitive.material) || primitive.material < 0 || primitive.material >= materials.length) throw new Error("room_glb_mesh_invalid");
    const normalLengths = normal.values.map((value) => Math.hypot(...value));
    if (normalLengths.some((length) => !Number.isFinite(length) || Math.abs(length - 1) > normalLengthTolerance)) {
      throw new Error("room_glb_normal_invalid");
    }
    decodedNormalCount += normalLengths.length;
    minimumNormalLength = Math.min(minimumNormalLength, ...normalLengths);
    maximumNormalLength = Math.max(maximumNormalLength, ...normalLengths);

    const indices = indexData.values.map(([value]) => value);
    if (indices.some((value) => !Number.isInteger(value) || value < 0 || value >= position.values.length)) throw new Error("room_glb_index_invalid");
    const distinctPositions = new Set(indices.map((index) => position.values[index].join(",")));
    if (distinctPositions.size < 3) throw new Error("room_glb_index_invalid");
    for (let index = 0; index < indices.length; index += 3) {
      const first = position.values[indices[index]];
      const second = position.values[indices[index + 1]];
      const third = position.values[indices[index + 2]];
      const left = second.map((value, axis) => value - first[axis]);
      const right = third.map((value, axis) => value - first[axis]);
      const cross = [
        left[1] * right[2] - left[2] * right[1],
        left[2] * right[0] - left[0] * right[2],
        left[0] * right[1] - left[1] * right[0]
      ];
      if (cross.reduce((sum, value) => sum + value * value, 0) <= 1e-16) throw new Error("room_glb_triangle_degenerate");
    }

    const decodedMin = [0, 1, 2].map((axis) => Math.min(...position.values.map((value) => value[axis])));
    const decodedMax = [0, 1, 2].map((axis) => Math.max(...position.values.map((value) => value[axis])));
    const declaredMin = position.layout.accessor.min;
    const declaredMax = position.layout.accessor.max;
    if (!Array.isArray(declaredMin) || !Array.isArray(declaredMax)
      || declaredMin.some((value, axis) => !approximatelyEqual(value, decodedMin[axis], geometryTolerance))
      || declaredMax.some((value, axis) => !approximatelyEqual(value, decodedMax[axis], geometryTolerance))) {
      throw new Error("room_glb_position_bounds_invalid");
    }
    const expectedRecord = expectedRecordByName.get(node.name);
    if (expectedRecord.supportObjectId !== undefined) {
      const extras = node.extras;
      if (extras?.wmmr_exterior_object_id !== node.name.replace(/^exterior\./, "")
        || extras?.wmmr_exterior_role !== expectedRecord.role
        || extras?.wmmr_exterior_material_id !== expectedRecord.materialRecipeId
        || extras?.wmmr_support_object_id !== (expectedRecord.supportObjectId ?? "")) {
        throw new Error("room_glb_exterior_metadata_invalid");
      }
    }
    const expectedTranslation = [expectedRecord.centerM.x, expectedRecord.centerM.y, -expectedRecord.centerM.z];
    const expectedDimensions = [expectedRecord.dimensionsM.widthM, expectedRecord.dimensionsM.heightM, expectedRecord.dimensionsM.depthM];
    const translation = node.translation ?? [0, 0, 0];
    if (!Array.isArray(translation) || translation.length !== 3 || !translation.every(Number.isFinite)
      || ["children", "matrix", "rotation", "scale"].some((key) => Object.hasOwn(node, key))
      || translation.some((value, axis) => !approximatelyEqual(value, expectedTranslation[axis], geometryTolerance))
      || decodedMin.some((value, axis) => !approximatelyEqual(value, -expectedDimensions[axis] / 2, geometryTolerance))
      || decodedMax.some((value, axis) => !approximatelyEqual(value, expectedDimensions[axis] / 2, geometryTolerance))) {
      throw new Error("room_glb_expected_bound_mismatch");
    }
    if (expectedRecord.materialRecipeId !== undefined
      && materials[primitive.material].name !== `material.${expectedRecord.materialRecipeId}`) {
      throw new Error("room_glb_material_binding_invalid");
    }
    let bevelInsetAxisCount = 0;
    if (expectedRecord.geometry === "beveled-box") {
      if (position.values.length <= 8 || distinctPositions.size <= 8) throw new Error("room_glb_bevel_topology_invalid");
      bevelInsetAxisCount = [0, 1, 2].filter((axis) => position.values.some((coordinates) => (
        approximatelyEqual(Math.abs(coordinates[axis]), expectedDimensions[axis] / 2 - expectedRecord.bevel.widthM, geometryTolerance)
      ))).length;
      if (bevelInsetAxisCount !== 3) throw new Error("room_glb_bevel_evidence_invalid");
    }

    usedMaterials.add(primitive.material);
    primitiveCount += 1;
    decodedVertexCount += position.values.length;
    decodedIndexCount += indices.length;
    decodedTriangleCount += indices.length / 3;
    decodedDistinctReferencedPositionCount += distinctPositions.size;
    const evidence = {
      name: node.name,
      translation: [...translation],
      localPositionMin: decodedMin,
      localPositionMax: decodedMax,
      decodedVertexCount: position.values.length,
      decodedIndexCount: indices.length,
      decodedTriangleCount: indices.length / 3,
      distinctReferencedPositionCount: distinctPositions.size,
      geometry: expectedRecord.geometry,
      materialRecipeId: materials[primitive.material].name.replace(/^material\./, ""),
      bevelInsetAxisCount
    };
    if (expectedRecord.bevel !== undefined) evidence.bevel = expectedRecord.bevel;
    geometryEvidence.push(evidence);
  }
  if (referencedAccessors.size !== accessors.length
    || referencedBufferViews.size !== bufferViews.length
    || usedMaterials.size !== materials.length) throw new Error("room_glb_mesh_invalid");

  const materialSourceIds = new Set();
  const materialEvidence = [];
  for (const material of materials) {
    const expected = expectedMaterials[material.name];
    const pbr = material.pbrMetallicRoughness;
    const extras = material.extras;
    const expectedColor = expected && srgbColorFactor(expected.baseColorSrgb);
    if (!expected
      || !exactKeys(material, ["doubleSided", "extras", "name", "pbrMetallicRoughness"])
      || material.doubleSided !== true
      || !exactKeys(pbr, ["baseColorFactor", "metallicFactor", "roughnessFactor"])
      || !Array.isArray(pbr.baseColorFactor)
      || pbr.baseColorFactor.length !== 4
      || pbr.baseColorFactor.some((value, index) => !approximatelyEqual(value, expectedColor[index]))
      || !approximatelyEqual(pbr.metallicFactor, expected.metalness)
      || !approximatelyEqual(pbr.roughnessFactor, expected.roughness)
      || !exactKeys(extras, ["wmmr_base_color_srgb", "wmmr_recipe_id", "wmmr_source_record_id", "wmmr_texture_scale_m"])
      || extras.wmmr_recipe_id !== expected.recipeId
      || extras.wmmr_base_color_srgb !== expected.baseColorSrgb
      || !approximatelyEqual(extras.wmmr_texture_scale_m, expected.textureScaleM)
      || !normalizedContract.allowedMaterialSourceIds.has(extras.wmmr_source_record_id)
      || (normalizedContract.materialSourceIds !== null
        && normalizedContract.materialSourceIds[material.name] !== extras.wmmr_source_record_id)) throw new Error("room_glb_material_invalid");
    materialSourceIds.add(extras.wmmr_source_record_id);
    materialEvidence.push({
      name: material.name,
      recipeId: extras.wmmr_recipe_id,
      baseColorSrgb: extras.wmmr_base_color_srgb,
      roughness: pbr.roughnessFactor,
      metalness: pbr.metallicFactor,
      textureScaleM: extras.wmmr_texture_scale_m,
      sourceRecordId: extras.wmmr_source_record_id
    });
  }
  if (materialSourceIds.size !== normalizedContract.requiredMaterialSourceCount) throw new Error("room_glb_material_invalid");
  materialEvidence.sort((left, right) => left.name.localeCompare(right.name));
  geometryEvidence.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  return Object.freeze({
    status: normalizedContract.status,
    nodeCount: document.nodes.length,
    meshCount: document.meshes.length,
    materialCount: document.materials.length,
    cameraCount: document.cameras?.length ?? 0,
    imageCount: document.images?.length ?? 0,
    textureCount: document.textures?.length ?? 0,
    lightCount: punctualLights.length,
    animationCount: 0,
    skinCount: 0,
    binaryChunkCount,
    defaultScene: document.scene,
    reachableNodeCount: reachable.size,
    uniqueMeshBindingCount: meshReferences.length,
    primitiveCount,
    accessorCount: accessors.length,
    bufferCount: 1,
    bufferViewCount: bufferViews.length,
    binaryByteLength: buffer.byteLength,
    decodedVertexCount,
    decodedIndexCount,
    decodedTriangleCount,
    decodedDistinctReferencedPositionCount,
    decodedNormalCount,
    minimumNormalLength,
    maximumNormalLength,
    extensionCount: normalizedContract.lightingMode ? 4 : 0,
    extensionsUsed: Object.freeze([...(document.extensionsUsed ?? [])]),
    extensionsRequired: Object.freeze([...(document.extensionsRequired ?? [])]),
    nodeNames: Object.freeze([...nodeNames]),
    meshNames: Object.freeze([...meshNames]),
    materialNames: Object.freeze([...materialNames]),
    materialEvidence: Object.freeze(materialEvidence),
    geometryEvidence: Object.freeze(geometryEvidence),
    lightEvidence: Object.freeze(lightEvidence)
  });
}

export async function validateGlbWithKhronos(bytes) {
  if (gltfValidator.version() !== expectedGltfValidatorVersion) throw new Error("khronos_gltf_validator_version_invalid");
  let report;
  try {
    report = await gltfValidator.validateBytes(new Uint8Array(bytes), {
      uri: "approved-candidate.glb",
      format: "glb",
      writeTimestamp: false,
      maxIssues: 0
    });
  } catch {
    throw new Error("khronos_gltf_validation_failed");
  }
  const issues = report?.issues;
  if (![issues?.numErrors, issues?.numWarnings, issues?.numInfos, issues?.numHints].every(Number.isInteger)
    || !Array.isArray(issues.messages) || issues.truncated !== false) throw new Error("khronos_gltf_report_invalid");
  const codeCounts = Object.fromEntries([...new Set(issues.messages.map(({ code }) => code))].sort().map((code) => [
    code,
    issues.messages.filter((message) => message.code === code).length
  ]));
  const summary = Object.freeze({
    status: "khronos-gltf-validator-valid",
    package: "gltf-validator",
    version: gltfValidator.version(),
    issueCounts: Object.freeze({
      errors: issues.numErrors,
      warnings: issues.numWarnings,
      infos: issues.numInfos,
      hints: issues.numHints
    }),
    issueCodeCounts: Object.freeze(codeCounts),
    truncated: issues.truncated,
    asset: Object.freeze({
      gltfVersion: report.info?.version,
      generator: report.info?.generator,
      drawCallCount: report.info?.drawCallCount,
      totalVertexCount: report.info?.totalVertexCount,
      totalTriangleCount: report.info?.totalTriangleCount,
      materialCount: report.info?.materialCount,
      animationCount: report.info?.animationCount,
      hasSkins: report.info?.hasSkins,
      hasTextures: report.info?.hasTextures
    })
  });
  if (summary.issueCounts.errors !== 0 || summary.issueCounts.warnings !== 0) throw new Error("khronos_gltf_validation_issues");
  return summary;
}

function baselineNumber(value) {
  return Object.is(value, -0) ? 0 : Number(value.toFixed(6));
}

function baselinePoint(value) {
  return Object.fromEntries(Object.entries(value).map(([key, number]) => [key, baselineNumber(number)]));
}

function normalizeArchitectureMaterials(materials) {
  const expectedNames = Object.keys(expectedArchitectureMaterials);
  const normalized = materials.filter(({ name }) => expectedNames.includes(name)).map((material) => ({
    name: material.name,
    recipeId: material.recipeId ?? material.id,
    baseColorSrgb: material.baseColorSrgb,
    textureScaleM: baselineNumber(material.textureScaleM),
    sourceRecordId: material.sourceRecordId,
    metalness: baselineNumber(material.metalness),
    roughness: baselineNumber(material.roughness)
  })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (!exactStringSet(normalized.map(({ name }) => name), expectedNames)
    || normalized.some((material) => stableJson({
      recipeId: material.recipeId,
      baseColorSrgb: material.baseColorSrgb,
      textureScaleM: material.textureScaleM,
      metalness: material.metalness,
      roughness: material.roughness
    }) !== stableJson(expectedArchitectureMaterials[material.name])
      || material.sourceRecordId !== "asset-layout-project")) throw new Error("architecture_baseline_material_invalid");
  return normalized;
}

export function createArchitectureBaselineEvidenceFromReport(report) {
  const assignments = new Map(report?.materials?.assignments?.map((assignment) => [assignment.objectName, assignment]));
  const objects = report?.inventory?.objects?.filter(({ name }) => expectedArchitectureNodeNames.includes(name)).map((record) => {
    const assignment = assignments.get(record.name);
    const actualRecipeIds = assignment?.materialSlots?.map(({ recipeId }) => recipeId) ?? assignment?.recipeIds;
    if (!Array.isArray(actualRecipeIds) || actualRecipeIds.length !== 1) throw new Error("architecture_baseline_assignment_invalid");
    return {
      name: record.name,
      geometry: record.geometry,
      centerM: baselinePoint(record.centerM),
      dimensionsM: baselinePoint(record.dimensionsM),
      materialRecipeId: actualRecipeIds[0]
    };
  }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (!exactStringSet(objects?.map(({ name }) => name), expectedArchitectureNodeNames)) throw new Error("architecture_baseline_inventory_invalid");
  const materialRecords = report.materials.materialEvidence ?? report.materials.recipes.map((recipe) => ({
    name: `material.${recipe.id}`,
    ...recipe
  }));
  return Object.freeze({
    schemaVersion: 1,
    objects: Object.freeze(objects),
    materials: Object.freeze(normalizeArchitectureMaterials(materialRecords))
  });
}

export function createArchitectureBaselineEvidenceFromGlb(inspection) {
  const geometry = new Map(inspection?.geometryEvidence?.map((record) => [record.name, record]));
  const objects = expectedArchitectureNodeNames.map((name) => {
    const record = geometry.get(name);
    if (!record) throw new Error("architecture_baseline_glb_inventory_invalid");
    return {
      name,
      geometry: record.geometry,
      centerM: baselinePoint({ x: record.translation[0], y: record.translation[1], z: -record.translation[2] }),
      dimensionsM: baselinePoint({
        widthM: record.localPositionMax[0] - record.localPositionMin[0],
        heightM: record.localPositionMax[1] - record.localPositionMin[1],
        depthM: record.localPositionMax[2] - record.localPositionMin[2]
      }),
      materialRecipeId: record.materialRecipeId
    };
  });
  return Object.freeze({
    schemaVersion: 1,
    objects: Object.freeze(objects),
    materials: Object.freeze(normalizeArchitectureMaterials(inspection.materialEvidence))
  });
}

export function architectureBaselineSha256(evidence) {
  return sha256(stableJson(evidence));
}

export function verifyArchitectureBaselineEvidence(expected, planReport, reopenReport, glbInspection) {
  if (expected?.schemaVersion !== 1
    || expected?.contract !== "f1-architecture-objects-materials-v1"
    || !/^[0-9a-f]{64}$/.test(expected?.sha256 ?? "")
    || expected?.objectCount !== 19
    || expected?.materialCount !== 3) throw new Error("architecture_baseline_lock_invalid");
  const plan = createArchitectureBaselineEvidenceFromReport(planReport);
  const reopen = createArchitectureBaselineEvidenceFromReport(reopenReport);
  const glb = createArchitectureBaselineEvidenceFromGlb(glbInspection);
  const digests = Object.freeze({
    planSha256: architectureBaselineSha256(plan),
    reopenSha256: architectureBaselineSha256(reopen),
    glbSha256: architectureBaselineSha256(glb)
  });
  if (Object.values(digests).some((digest) => digest !== expected.sha256)) throw new Error("architecture_baseline_mismatch");
  return Object.freeze({
    status: "f1-architecture-baseline-matched",
    contract: expected.contract,
    expectedSha256: expected.sha256,
    ...digests,
    objectCount: plan.objects.length,
    materialCount: plan.materials.length,
    evidence: plan
  });
}

function expectedComponentRecords(source) {
  const families = new Map(source.componentConstruction.families.map((family) => [family.id, family]));
  const overrides = new Map(source.componentConstruction.instanceMaterialOverrides.map((override) => [
    `${override.componentId}:${override.slot}`,
    override.materialRecipeId
  ]));
  const records = [];
  for (const component of source.scene.components) {
    const family = families.get(component.family);
    const defaultMaterials = new Map(family.defaultMaterials.map((mapping) => [mapping.slot, mapping.materialRecipeId]));
    for (const part of family.parts) {
      const yaw = component.transform.yaw;
      const local = part.localTransform.position;
      records.push({
        name: `component.${component.id}.${part.id}`,
        centerM: {
          x: component.transform.position.x + Math.cos(yaw) * local.x - Math.sin(yaw) * local.z,
          y: component.transform.position.y + local.y,
          z: component.transform.position.z + Math.sin(yaw) * local.x + Math.cos(yaw) * local.z
        },
        dimensionsM: {
          widthM: part.dimensions.widthM,
          heightM: part.dimensions.heightM,
          depthM: part.dimensions.depthM
        },
        geometry: "beveled-box",
        bevel: { ...part.bevel },
        materialRecipeId: overrides.get(`${component.id}:${part.materialSlotId}`) ?? defaultMaterials.get(part.materialSlotId)
      });
    }
  }
  records.sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  if (records.length !== 38 || new Set(records.map(({ name }) => name)).size !== 38) throw new Error("approved_candidate_component_inventory_invalid");
  return records;
}

export function createApprovedCandidateComponentGlbContract(report, source) {
  const materialAssignments = new Map(report.materials.assignments.map((assignment) => [assignment.objectName, assignment.recipeIds]));
  const architectureRecords = report.inventory.objects
    .filter(({ name }) => expectedArchitectureNodeNames.includes(name))
    .map((record) => {
      const recipeIds = materialAssignments.get(record.name);
      if (!Array.isArray(recipeIds) || recipeIds.length !== 1) throw new Error("approved_candidate_architecture_material_binding_invalid");
      return {
        name: record.name,
        centerM: record.centerM,
        dimensionsM: record.dimensionsM,
        geometry: record.geometry,
        materialRecipeId: recipeIds[0]
      };
    });
  const componentRecords = expectedComponentRecords(source);
  const reportComponents = new Map(report.components.objects.map((record) => [record.name, record]));
  for (const expected of componentRecords) {
    const actual = reportComponents.get(expected.name);
    if (!actual
      || actual.geometry !== "beveled-box"
      || Object.keys(expected.dimensionsM).some((axis) => !approximatelyEqual(actual.dimensionsM?.[axis], expected.dimensionsM[axis], 1e-6))
      || Object.keys(expected.centerM).some((axis) => !approximatelyEqual(actual.centerM?.[axis], expected.centerM[axis], 1e-6))
      || stableJson(actual.bevel) !== stableJson(expected.bevel)
      || actual.materialRecipeId !== expected.materialRecipeId
      || actual.modifierCount !== 0
      || actual.bevelApplied !== true
      || actual.bevelInsetAxisCount !== 3
      || actual.vertexCount !== 96
      || actual.edgeCount !== 192
      || actual.faceCount !== 98
      || !/^[0-9a-f]{64}$/.test(actual.topologySha256 ?? "")) throw new Error("approved_candidate_component_report_evidence_invalid");
  }
  return Object.freeze({
    status: "approved-candidate-components-glb-inspection-valid",
    records: Object.freeze([...architectureRecords, ...componentRecords]),
    materials: expectedComponentMaterials,
    allowedMaterialSourceIds: Object.freeze(["asset-layout-project"]),
    requiredMaterialSourceCount: 1
  });
}

export function createApprovedCandidateExteriorGlbContract(report, source) {
  const componentContract = createApprovedCandidateComponentGlbContract(report, source);
  const exteriorRecords = source.exteriorConstruction.objects.map((record) => ({
    name: `exterior.${record.id}`,
    centerM: { ...record.transform.position },
    dimensionsM: { ...record.dimensions },
    geometry: record.geometry,
    bevel: { ...record.bevel },
    role: record.role,
    supportObjectId: record.supportObjectId,
    materialRecipeId: record.materialId
  })).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const reportExterior = new Map(report.exterior.objects.map((record) => [record.name, record]));
  for (const expected of exteriorRecords) {
    const actual = reportExterior.get(expected.name);
    if (!actual
      || actual.geometry !== "beveled-box"
      || Object.keys(expected.dimensionsM).some((axis) => !approximatelyEqual(actual.dimensionsM?.[axis], expected.dimensionsM[axis], 1e-6))
      || Object.keys(expected.centerM).some((axis) => !approximatelyEqual(actual.centerM?.[axis], expected.centerM[axis], 1e-6))
      || stableJson(actual.bevel) !== stableJson(expected.bevel)
      || actual.role !== expected.role
      || actual.supportObjectId !== expected.supportObjectId
      || actual.parentName !== null
      || actual.materialRecipeId !== expected.materialRecipeId
      || actual.modifierCount !== 0
      || actual.bevelApplied !== true
      || actual.bevelInsetAxisCount !== 3
      || actual.vertexCount !== 96
      || actual.edgeCount !== 192
      || actual.faceCount !== 98
      || !/^[0-9a-f]{64}$/.test(actual.topologySha256 ?? "")) throw new Error("approved_candidate_exterior_report_evidence_invalid");
  }
  const componentMaterials = Object.fromEntries(Object.entries(expectedComponentMaterials).map(([name, material]) => [name, {
    ...material,
    sourceRecordId: "asset-layout-project"
  }]));
  const exteriorMaterials = Object.fromEntries(source.exteriorConstruction.materials.map((material) => [`material.${material.id}`, {
    recipeId: material.id,
    baseColorSrgb: material.baseColorSrgb,
    roughness: material.roughness,
    metalness: material.metalness,
    textureScaleM: material.textureScaleM,
    sourceRecordId: source.exteriorConstruction.sourceRecordId
  }]));
  const materials = Object.freeze({ ...componentMaterials, ...exteriorMaterials });
  const materialSourceIds = Object.freeze(Object.fromEntries(Object.entries(materials).map(([name, material]) => [name, material.sourceRecordId])));
  return Object.freeze({
    status: "approved-candidate-exterior-glb-inspection-valid",
    records: Object.freeze([...componentContract.records, ...exteriorRecords]),
    materials,
    allowedMaterialSourceIds: Object.freeze(["asset-layout-project", source.exteriorConstruction.sourceRecordId]),
    requiredMaterialSourceCount: 2,
    materialSourceIds
  });
}

function tannerHellandLinearColor(temperatureKelvin) {
  const temperature = Math.min(40000, Math.max(1000, temperatureKelvin)) / 100;
  const encoded = temperature <= 66
    ? [
        255,
        99.4708025861 * Math.log(temperature) - 161.1195681661,
        temperature <= 19 ? 0 : 138.5177312231 * Math.log(temperature - 10) - 305.0447927307
      ]
    : [
        329.698727446 * ((temperature - 60) ** -0.1332047592),
        288.1221695283 * ((temperature - 60) ** -0.0755148492),
        255
      ];
  return encoded.map((channel) => {
    const srgb = Math.min(255, Math.max(0, channel)) / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
}

export function createApprovedCandidateLightingGlbContract(report, source) {
  const exteriorContract = createApprovedCandidateExteriorGlbContract(report, source);
  const reportLights = new Map(report.lighting?.lights?.map((light) => [light.sceneLightId, light]));
  const implementationById = new Map(source.lightingConstruction.lights.map((light) => [light.sceneLightId, light]));
  const lights = source.scene.lighting.map((sceneLight) => {
    const implementation = implementationById.get(sceneLight.id);
    const compiled = reportLights.get(sceneLight.id);
    if (!implementation || !compiled?.rotationQuaternion) throw new Error("approved_candidate_lighting_report_evidence_invalid");
    const directional = implementation.emitter.type === "directional";
    const energy = sceneLight.intensityLumens / implementation.emitter.intensityMapping.divisor;
    const rotation = compiled.rotationQuaternion;
    const halfSqrtTwo = Math.SQRT1_2;
    const expected = {
      name: `light.${sceneLight.id}`,
      type: directional ? "directional" : "spot",
      color: tannerHellandLinearColor(sceneLight.temperatureK),
      intensity: directional ? energy * 683 : energy / (4 * Math.PI) * 683,
      translation: [sceneLight.position.x, sceneLight.position.y, -sceneLight.position.z],
      rotation: [
        halfSqrtTwo * (rotation.x - rotation.w),
        halfSqrtTwo * (rotation.z + rotation.y),
        halfSqrtTwo * (rotation.z - rotation.y),
        halfSqrtTwo * (rotation.w + rotation.x)
      ],
      extras: {
        wmmr_cast_shadow: implementation.emitter.castShadow,
        wmmr_intensity_lumens: sceneLight.intensityLumens,
        wmmr_light_kind: sceneLight.kind,
        wmmr_roll_radians: implementation.emitter.rollRadians,
        wmmr_scene_light_id: sceneLight.id,
        wmmr_target_x: implementation.emitter.target.x,
        wmmr_target_y: implementation.emitter.target.y,
        wmmr_target_z: implementation.emitter.target.z,
        wmmr_temperature_kelvin: sceneLight.temperatureK
      }
    };
    if (!directional) {
      expected.range = implementation.emitter.rangeM;
      expected.innerConeAngle = implementation.emitter.innerConeHalfAngleRadians;
      expected.outerConeAngle = implementation.emitter.outerConeHalfAngleRadians;
    }
    return Object.freeze(expected);
  });
  return Object.freeze({
    ...exteriorContract,
    status: "approved-candidate-lighting-glb-inspection-valid",
    lights: Object.freeze(lights)
  });
}

async function compileRoomArchitecture(options, source) {
  const sourceHashes = source.fixtureOnly ? null : await compilerSourceSha256();
  const blenderPath = await exactRegularFile(options.blenderPath, "room_shell_blender");
  const blenderBytes = await readFile(blenderPath);
  const binarySha256 = sha256(blenderBytes);
  if (binarySha256 !== expectedBlenderBinarySha256) throw new Error("room_shell_blender_sha256_invalid");
  const forbiddenRoots = source.exteriorIncluded
    ? [repositoryRoot, await externalDirectory(options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR, "approved_candidate_repository")]
    : [repositoryRoot];
  const outputBlendPath = await newExternalOutput(options.outputBlendPath, ".blend", "room_shell_output", forbiddenRoots);
  const outputGlbPath = await newExternalOutput(options.outputGlbPath, ".glb", "room_glb_output", forbiddenRoots);
  const outputFirstViewPath = source.lightingIncluded
    ? await newExternalOutput(options.firstViewOutputPath, ".png", "room_first_view_output", forbiddenRoots)
    : null;
  if (!source.lightingIncluded && options.firstViewOutputPath !== undefined) throw new Error("room_first_view_output_invalid");
  const reportPath = await newExternalOutput(options.reportPath, ".json", "room_shell_report", forbiddenRoots);
  const outputPaths = [outputBlendPath, outputGlbPath, ...(outputFirstViewPath ? [outputFirstViewPath] : []), reportPath];
  if (new Set(outputPaths).size !== outputPaths.length) throw new Error("room_shell_output_paths_conflict");
  const outputFaults = {
    blend: roomOutputFault(options, "blend"),
    glb: roomOutputFault(options, "glb"),
    firstView: roomOutputFault(options, "first-view"),
    report: roomOutputFault(options, "compile-report")
  };
  const publishedRecords = [];

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-room-shell-"));
  const temporaryScenePath = resolve(temporaryRoot, "scene-spec.json");
  const temporaryComponentPath = resolve(temporaryRoot, "component-constructions.json");
  const temporaryExteriorPath = resolve(temporaryRoot, "exterior-constructions.json");
  const temporaryLightingPath = resolve(temporaryRoot, "lighting-constructions.json");
  const temporaryBlendOutputPath = resolve(temporaryRoot, "output.blend");
  const temporaryGlbOutputPath = resolve(temporaryRoot, "output.glb");
  const temporaryFirstViewOutputPath = resolve(temporaryRoot, "first-view.png");
  const temporaryAdapterReportPath = resolve(temporaryRoot, "compile-report.json");
  const componentArguments = source.componentsIncluded ? [
    "--component-constructions",
    temporaryComponentPath,
    "--expected-component-raw-sha256",
    source.rawComponentConstructionSha256,
    "--expected-component-sha256",
    source.componentContract?.componentConstructionSha256 ?? source.contract.componentConstructionSha256
  ] : [];
  const exteriorArguments = source.exteriorIncluded ? [
    "--exterior-constructions",
    temporaryExteriorPath,
    "--expected-exterior-raw-sha256",
    source.rawExteriorConstructionSha256,
    "--expected-exterior-sha256",
    source.exteriorContract.exteriorConstructionSha256
  ] : [];
  const lightingArguments = source.lightingIncluded ? [
    "--lighting-constructions",
    temporaryLightingPath,
    "--expected-lighting-raw-sha256",
    source.rawLightingConstructionSha256,
    "--expected-lighting-sha256",
    source.lightingContract.lightingConstructionSha256
  ] : [];

  try {
    await writeFile(temporaryScenePath, source.sceneBytes, { flag: "wx", mode: 0o600 });
    if (source.componentsIncluded) await writeFile(temporaryComponentPath, source.componentConstructionBytes, { flag: "wx", mode: 0o600 });
    if (source.exteriorIncluded) await writeFile(temporaryExteriorPath, source.exteriorConstructionBytes, { flag: "wx", mode: 0o600 });
    if (source.lightingIncluded) await writeFile(temporaryLightingPath, source.lightingConstructionBytes, { flag: "wx", mode: 0o600 });
    await execFileAsync(blenderPath, [
      "--background",
      "--factory-startup",
      "--python",
      adapterPath,
      "--",
      "--input-kind",
      source.inputKind,
      "--scene-spec",
      temporaryScenePath,
      "--expected-raw-sha256",
      source.rawSceneSha256,
      "--expected-specification-sha256",
      source.contract.specificationSha256,
      ...componentArguments,
      ...exteriorArguments,
      ...lightingArguments,
      "--report",
      temporaryAdapterReportPath,
      "--output-blend",
      temporaryBlendOutputPath,
      "--output-glb",
      temporaryGlbOutputPath,
      ...(source.lightingIncluded ? ["--output-first-view", temporaryFirstViewOutputPath] : [])
    ], {
      cwd: temporaryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: blenderTimeoutMs
    });
    const report = JSON.parse(await readFile(temporaryAdapterReportPath, "utf8"));
    validateCompilerReport(report, source, binarySha256);
    const outputBytes = await readFile(temporaryBlendOutputPath);
    if (report.outputBlend?.byteLength !== outputBytes.length || report.outputBlend?.sha256 !== sha256(outputBytes)) throw new Error("room_shell_output_digest_mismatch");
    const glbBytes = await readFile(temporaryGlbOutputPath);
    if (report.outputGlb?.byteLength !== glbBytes.length || report.outputGlb?.sha256 !== sha256(glbBytes)) throw new Error("room_glb_output_digest_mismatch");
    const firstViewBytes = source.lightingIncluded ? await readFile(temporaryFirstViewOutputPath) : null;
    const firstViewInspection = source.lightingIncluded ? inspectFirstViewPng(firstViewBytes) : null;
    if (source.lightingIncluded && stableJson(firstViewInspection) !== stableJson(report.outputFirstView)) throw new Error("room_first_view_output_evidence_mismatch");
    const inspectionPath = resolve(temporaryRoot, "inspection.json");
    await execFileAsync(blenderPath, [
      "--background",
      temporaryBlendOutputPath,
      "--python",
      adapterPath,
      "--",
      "--input-kind",
      source.inputKind,
      "--scene-spec",
      temporaryScenePath,
      "--expected-raw-sha256",
      source.rawSceneSha256,
      "--expected-specification-sha256",
      source.contract.specificationSha256,
      ...componentArguments,
      ...exteriorArguments,
      ...lightingArguments,
      "--report",
      inspectionPath,
      "--inspect-only"
    ], {
      cwd: temporaryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: blenderTimeoutMs
    });
    const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
    const expectedInspectionStatus = source.fixtureOnly
      ? "stage3-synthetic-room-profiles-materials-inspection-valid"
      : source.lightingIncluded
        ? "stage3-approved-candidate-lighting-inspection-valid"
        : source.exteriorIncluded
        ? "stage3-approved-candidate-exterior-inspection-valid"
        : source.componentsIncluded
        ? "stage3-approved-candidate-components-inspection-valid"
        : "stage3-approved-candidate-architecture-inspection-valid";
    if (inspection.status !== expectedInspectionStatus
      || inspection.fixtureOnly !== source.fixtureOnly
      || inspection.specificationSha256 !== source.contract.specificationSha256
      || inspection.inventory?.objectCount !== report.inventory.objectCount
      || inspection.inventory?.meshCount !== report.inventory.meshCount
      || inspection.inventory?.materialCount !== report.inventory.materialCount
      || inspection.inventory?.imageCount !== 0
      || inspection.inventory?.textureCount !== 0
      || inspection.inventory?.cameraCount !== (source.lightingIncluded ? 1 : 0)
      || inspection.inventory?.lightCount !== (source.lightingIncluded ? 3 : 0)
      || inspection.inventory?.vertexCount !== report.inventory.vertexCount
      || inspection.inventory?.faceCount !== report.inventory.faceCount
      || stableJson(inspection.inventory?.objects) !== stableJson(report.inventory.objects)
      || stableJson(inspection.materials) !== stableJson(report.materials)
      || (source.componentsIncluded && stableJson(inspection.components) !== stableJson(report.components))
      || (source.exteriorIncluded && stableJson(inspection.exterior) !== stableJson(report.exterior))
      || (source.lightingIncluded && stableJson(inspection.lighting) !== stableJson(report.lighting))
      || (source.lightingIncluded && stableJson(inspection.firstView?.camera) !== stableJson(report.firstView?.camera))
      || (source.lightingIncluded && stableJson(inspection.firstView?.renderSettings) !== stableJson(report.firstView?.renderSettings))) throw new Error("room_shell_saved_inspection_invalid");
    const glbInspection = inspectGlb(glbBytes, source.lightingIncluded
      ? createApprovedCandidateLightingGlbContract(report, source)
      : source.exteriorIncluded
      ? createApprovedCandidateExteriorGlbContract(report, source)
      : source.componentsIncluded
        ? createApprovedCandidateComponentGlbContract(report, source)
      : report.inventory.objects);
    const khronosValidation = await validateGlbWithKhronos(glbBytes);
    const architectureBaseline = source.architectureBaseline
      ? verifyArchitectureBaselineEvidence(source.architectureBaseline, report, inspection, glbInspection)
      : null;
    const reopenInspectionSha256 = sha256(stableJson(inspection));
    if (source.componentsIncluded) {
      const locked = source.exteriorIncluded ? null : source.componentGlbEvidence;
      const issueCounts = khronosValidation.issueCounts;
      if (locked !== null && (report.outputGlb.sha256 !== locked.sha256
        || report.outputGlb.byteLength !== locked.byteLength
        || reopenInspectionSha256 !== locked.reopenInspectionSha256
        || report.inventory.meshCount !== locked.meshCount
        || report.inventory.materialCount !== locked.materialCount
        || glbInspection.decodedNormalCount !== locked.decodedNormalCount
        || architectureBaseline.expectedSha256 !== locked.architectureSemanticSha256
        || khronosValidation.package !== locked.khronosValidator.package
        || khronosValidation.version !== locked.khronosValidator.version
        || issueCounts.errors !== locked.khronosValidator.errors
        || issueCounts.warnings !== locked.khronosValidator.warnings
        || issueCounts.infos !== locked.khronosValidator.infos
        || issueCounts.hints !== locked.khronosValidator.hints)) throw new Error("approved_candidate_component_glb_evidence_mismatch");
    }
    if (source.exteriorIncluded && !source.lightingIncluded && source.exteriorGlbEvidence !== null) {
      const locked = source.exteriorGlbEvidence;
      const issueCounts = khronosValidation.issueCounts;
      if (report.outputGlb.sha256 !== locked.sha256
        || report.outputGlb.byteLength !== locked.byteLength
        || report.outputBlend.byteLength !== locked.blendByteLength
        || reopenInspectionSha256 !== locked.reopenInspectionSha256
        || report.inventory.meshCount !== locked.meshCount
        || report.inventory.materialCount !== locked.materialCount
        || report.inventory.vertexCount !== locked.objectVertexCount
        || report.inventory.faceCount !== locked.objectFaceCount
        || glbInspection.binaryByteLength !== locked.binaryByteLength
        || glbInspection.decodedVertexCount !== locked.decodedVertexCount
        || glbInspection.decodedIndexCount !== locked.decodedIndexCount
        || glbInspection.decodedTriangleCount !== locked.decodedTriangleCount
        || glbInspection.decodedDistinctReferencedPositionCount !== locked.distinctPositionCount
        || glbInspection.decodedNormalCount !== locked.decodedNormalCount
        || glbInspection.minimumNormalLength !== locked.minimumNormalLength
        || glbInspection.maximumNormalLength !== locked.maximumNormalLength
        || glbInspection.geometryEvidence.filter(({ name }) => expectedArchitectureNodeNames.includes(name)).length !== locked.architectureMeshCount
        || glbInspection.geometryEvidence.filter(({ name }) => name.startsWith("component.")).length !== locked.componentMeshCount
        || glbInspection.geometryEvidence.filter(({ name }) => name.startsWith("exterior.")).length !== locked.exteriorMeshCount
        || architectureBaseline.expectedSha256 !== locked.architectureSemanticSha256
        || khronosValidation.package !== locked.khronosValidator.package
        || khronosValidation.version !== locked.khronosValidator.version
        || issueCounts.errors !== locked.khronosValidator.errors
        || issueCounts.warnings !== locked.khronosValidator.warnings
        || issueCounts.infos !== locked.khronosValidator.infos
        || issueCounts.hints !== locked.khronosValidator.hints) throw new Error("approved_candidate_exterior_glb_evidence_mismatch");
    }
    if (source.lightingIncluded && source.lightingGlbEvidence !== null) {
      const locked = source.lightingGlbEvidence;
      const issueCounts = khronosValidation.issueCounts;
      const lightingEvidence = {
        sha256: [report.outputGlb.sha256, locked.sha256],
        byteLength: [report.outputGlb.byteLength, locked.byteLength],
        blendByteLength: [report.outputBlend.byteLength, locked.blendByteLength],
        firstViewSha256: [firstViewInspection.sha256, locked.firstViewSha256],
        firstViewByteLength: [firstViewInspection.byteLength, locked.firstViewByteLength],
        firstViewDecodedRgbSha256: [firstViewInspection.decodedRgbSha256, locked.firstViewDecodedRgbSha256],
        firstViewWeightedLuminanceSum: [firstViewInspection.weightedLuminanceSum, locked.firstViewWeightedLuminanceSum],
        firstViewPixelCount: [firstViewInspection.pixelCount, locked.firstViewPixelCount],
        firstViewDarkPixelCount: [firstViewInspection.darkPixelCount, locked.firstViewDarkPixelCount],
        reopenInspectionSha256: [reopenInspectionSha256, locked.reopenInspectionSha256],
        meshCount: [report.inventory.meshCount, locked.meshCount],
        architectureMeshCount: [glbInspection.geometryEvidence.filter(({ name }) => expectedArchitectureNodeNames.includes(name)).length, locked.architectureMeshCount],
        componentMeshCount: [glbInspection.geometryEvidence.filter(({ name }) => name.startsWith("component.")).length, locked.componentMeshCount],
        exteriorMeshCount: [glbInspection.geometryEvidence.filter(({ name }) => name.startsWith("exterior.")).length, locked.exteriorMeshCount],
        lightCount: [report.inventory.lightCount, locked.lightCount],
        materialCount: [report.inventory.materialCount, locked.materialCount],
        nodeCount: [glbInspection.nodeCount, locked.nodeCount],
        binaryByteLength: [glbInspection.binaryByteLength, locked.binaryByteLength],
        decodedVertexCount: [glbInspection.decodedVertexCount, locked.decodedVertexCount],
        decodedIndexCount: [glbInspection.decodedIndexCount, locked.decodedIndexCount],
        decodedTriangleCount: [glbInspection.decodedTriangleCount, locked.decodedTriangleCount],
        distinctPositionCount: [glbInspection.decodedDistinctReferencedPositionCount, locked.distinctPositionCount],
        decodedNormalCount: [glbInspection.decodedNormalCount, locked.decodedNormalCount],
        minimumNormalLength: [glbInspection.minimumNormalLength, locked.minimumNormalLength],
        maximumNormalLength: [glbInspection.maximumNormalLength, locked.maximumNormalLength],
        objectVertexCount: [report.inventory.vertexCount, locked.objectVertexCount],
        objectFaceCount: [report.inventory.faceCount, locked.objectFaceCount],
        architectureSemanticSha256: [architectureBaseline.expectedSha256, locked.architectureSemanticSha256],
        khronosPackage: [khronosValidation.package, locked.khronosValidator.package],
        khronosVersion: [khronosValidation.version, locked.khronosValidator.version],
        khronosErrors: [issueCounts.errors, locked.khronosValidator.errors],
        khronosWarnings: [issueCounts.warnings, locked.khronosValidator.warnings],
        khronosInfos: [issueCounts.infos, locked.khronosValidator.infos],
        khronosHints: [issueCounts.hints, locked.khronosValidator.hints]
      };
      const mismatches = Object.fromEntries(Object.entries(lightingEvidence)
        .filter(([, [observed, expected]]) => observed !== expected)
        .map(([field, [observed, expected]]) => [field, { observed, expected }]));
      if (Object.keys(mismatches).length > 0) throw new Error(`approved_candidate_lighting_glb_evidence_mismatch:${stableJson(mismatches)}`);
    }

    const commonEnvelope = {
      ...report,
      assetLedgerSha256: source.contract.assetLedgerSha256,
      generationLedgerSha256: source.contract.generationLedgerSha256,
      acceptedInputSha256: source.acceptedInputSha256,
      glbInspection,
      khronosValidation,
      architectureBaseline,
      lockedComponentGlbEvidence: source.componentGlbEvidence ?? null,
      ...(source.exteriorIncluded ? { lockedExteriorGlbEvidence: source.exteriorGlbEvidence } : {}),
      ...(source.lightingIncluded ? {
        firstViewInspection,
        lockedLightingGlbEvidence: source.lightingGlbEvidence,
        f4Baseline: source.f4Baseline
      } : {}),
      reopenInspection: inspection,
      reopenInspectionSha256
    };
    const finalReport = source.fixtureOnly ? commonEnvelope : {
      ...commonEnvelope,
      candidateSource: source.candidateSource,
      canonicalHashes: source.canonicalHashes,
      compilerSourceSha256: sourceHashes,
      ...(source.exteriorIncluded ? { semanticReports: source.semanticReports } : {})
    };
    Object.defineProperty(finalReport, publishedRoomOutputs, { value: publishedRecords });
    const finalReportBytes = Buffer.from(`${stableJson(finalReport)}\n`);
    publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: outputBlendPath,
      bytes: outputBytes,
      label: "room_shell_output",
      faultPhase: outputFaults.blend,
      validate: async (writtenBytes) => {
        if (writtenBytes.length !== report.outputBlend.byteLength || sha256(writtenBytes) !== report.outputBlend.sha256) throw new Error("room_shell_output_digest_mismatch");
      }
    }));
    publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: outputGlbPath,
      bytes: glbBytes,
      label: "room_glb_output",
      faultPhase: outputFaults.glb,
      validate: async (writtenBytes) => {
        if (writtenBytes.length !== report.outputGlb.byteLength || sha256(writtenBytes) !== report.outputGlb.sha256) throw new Error("room_glb_output_digest_mismatch");
      }
    }));
    if (source.lightingIncluded) publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: outputFirstViewPath,
      bytes: firstViewBytes,
      label: "room_first_view_output",
      faultPhase: outputFaults.firstView,
      validate: async (writtenBytes) => {
        if (stableJson(inspectFirstViewPng(writtenBytes)) !== stableJson(firstViewInspection)) throw new Error("room_first_view_output_evidence_mismatch");
      }
    }));
    publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: reportPath,
      bytes: finalReportBytes,
      label: "room_shell_report",
      faultPhase: outputFaults.report,
      validate: async (writtenBytes) => validateMediaSurfaceReportBytes(writtenBytes, finalReport, "room_shell_report")
    }));
    Object.freeze(publishedRecords);
    return Object.freeze(finalReport);
  } catch (error) {
    try {
      await removePublishedMediaSurfaceOutputs(publishedRecords);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "room_shell_output_cleanup_failed");
    }
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function compileSyntheticRoomShell(options) {
  if (!options || typeof options !== "object") throw new Error("room_shell_options_invalid");
  return compileRoomArchitecture(options, await loadSyntheticSource(options));
}

export async function compileApprovedCandidateArchitecture(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_compile_options_invalid");
  return compileRoomArchitecture(options, await loadApprovedCandidateArchitectureSource(options));
}

export async function compileApprovedCandidateComponents(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_component_compile_options_invalid");
  return compileRoomArchitecture(options, await loadApprovedCandidateComponentSource(options));
}

export async function compileApprovedCandidateExterior(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_exterior_compile_options_invalid");
  return compileRoomArchitecture(options, await loadApprovedCandidateExteriorSource(options));
}

export async function compileApprovedCandidateLighting(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_lighting_compile_options_invalid");
  return compileRoomArchitecture(options, await loadApprovedCandidateLightingSource(options));
}

function expectedMediaSurfaceProjection(source) {
  const semanticById = new Map(source.mediaSurfaceConstruction.surfaces.map((surface) => [surface.surfaceId, surface]));
  const mediaSurfaces = source.scene.mediaSurfaces.map((physical) => {
    const semantic = semanticById.get(physical.surfaceId);
    if (!semantic) throw new Error(`approved_candidate_media_surface_semantics_missing:${physical.surfaceId}`);
    return {
      surfaceId: physical.surfaceId,
      representation: semantic.representation,
      position: { x: physical.position.x, y: physical.position.y, z: physical.position.z },
      yaw: physical.yaw,
      widthM: physical.widthM,
      heightM: physical.heightM,
      pixelDimensions: { width: semantic.pixelDimensions.width, height: semantic.pixelDimensions.height },
      frontFace: semantic.frontFace,
      input: { enabled: semantic.input.enabled, maxDistanceM: semantic.input.maxDistanceM }
    };
  });
  if (mediaSurfaces.length !== semanticById.size) throw new Error("approved_candidate_media_surface_projection_set_mismatch");
  return {
    schemaVersion: 1,
    sceneId: source.scene.sceneId,
    mediaSurfaces
  };
}

export function validateApprovedCandidateMediaSurfaceProjection(projection, source) {
  if (!source || typeof source !== "object" || source.inputKind !== candidateMediaSurfaceInputKind) {
    throw new Error("approved_candidate_media_surface_projection_source_invalid");
  }
  const expected = expectedMediaSurfaceProjection(source);
  if (!exactKeys(projection, ["mediaSurfaces", "sceneId", "schemaVersion"])
    || !Array.isArray(projection.mediaSurfaces)
    || projection.mediaSurfaces.some((surface) => !exactKeys(surface, ["frontFace", "heightM", "input", "pixelDimensions", "position", "representation", "surfaceId", "widthM", "yaw"])
      || !exactKeys(surface.position, ["x", "y", "z"])
      || !exactKeys(surface.pixelDimensions, ["height", "width"])
      || !exactKeys(surface.input, ["enabled", "maxDistanceM"]))
    || stableJson(projection) !== stableJson(expected)) {
    throw new Error("approved_candidate_media_surface_projection_invalid");
  }
  return Object.freeze(projection);
}

export function parseApprovedCandidateMediaSurfaceProjectionText(text, source) {
  const projection = parseCanonicalJsonText(text, "approved_candidate_media_surface_projection");
  if (`${JSON.stringify(projection, null, 2)}\n` !== text) throw new Error("approved_candidate_media_surface_projection_encoding_noncanonical");
  return validateApprovedCandidateMediaSurfaceProjection(projection, source);
}

function mediaSurfaceProjectionBoundaries(byteIdentical) {
  return {
    mediaSurfacesCompiled: true,
    byteIdentical,
    exteriorCompiled: false,
    lightingCompiled: false,
    finalCandidateGlbVerified: false,
    releaseArtifactsCreated: false,
    publicationReady: false,
    artifactBytesIncludedInRepository: false
  };
}

export async function compileApprovedCandidateMediaSurfaces(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_media_surface_compile_options_invalid");
  const { source, candidateRepositoryPath } = await loadTrustedMediaSurfaceSource(options);
  const sourceHashes = await compilerSourceSha256();
  const forbiddenRoots = [repositoryRoot, candidateRepositoryPath];
  const outputManifestPath = await newExternalOutput(options.outputManifestPath, ".json", "media_surface_manifest_output", forbiddenRoots);
  const reportPath = await newExternalOutput(options.reportPath, ".json", "media_surface_manifest_report", forbiddenRoots);
  if (outputManifestPath === reportPath) throw new Error("media_surface_manifest_output_paths_conflict");
  const manifestFault = mediaSurfaceOutputFault(options, "manifest");
  const reportFault = mediaSurfaceOutputFault(options, "compile-report");

  const projection = expectedMediaSurfaceProjection(source);
  validateApprovedCandidateMediaSurfaceProjection(projection, source);
  const projectionBytes = Buffer.from(`${JSON.stringify(projection, null, 2)}\n`);
  parseApprovedCandidateMediaSurfaceProjectionText(projectionBytes.toString("utf8"), source);
  const projectionEvidence = Object.freeze({
    sha256: sha256(projectionBytes),
    byteLength: projectionBytes.length,
    mediaSurfaceCount: projection.mediaSurfaces.length
  });
  if (stableJson({
    ...projectionEvidence,
    representation: source.mediaSurfaceContract.representation,
    byteIdentical: true
  }) !== stableJson(source.mediaSurfaceProjectionEvidence)) throw new Error("media_surface_projection_evidence_mismatch");
  const boundaries = mediaSurfaceProjectionBoundaries(false);
  const publishedRecords = [];
  const report = {
    schemaVersion: 1,
    status: "stage3-approved-candidate-media-surfaces-compiled",
    fixtureOnly: false,
    sceneId: source.scene.sceneId,
    approvedCandidateSpecification: true,
    mediaSurfacesSpecified: true,
    mediaSurfacesCompiled: true,
    byteIdentical: false,
    exteriorCompiled: false,
    lightingCompiled: false,
    finalCandidateGlbVerified: false,
    releaseArtifactsCreated: false,
    publicationReady: false,
    artifactBytesIncludedInRepository: false,
    candidateSource: source.candidateSource,
    canonicalHashes: source.canonicalHashes,
    acceptedInputSha256: source.acceptedInputSha256,
    semanticReports: source.semanticReports,
    compilerSourceSha256: sourceHashes,
    projection: projectionEvidence,
    boundaries
  };
  Object.defineProperty(report, publishedMediaSurfaceOutputs, { value: publishedRecords });
  Object.freeze(report);
  const reportBytes = Buffer.from(`${stableJson(report)}\n`);
  try {
    publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: outputManifestPath,
      bytes: projectionBytes,
      label: "media_surface_manifest_output",
      faultPhase: manifestFault,
      validate: async (writtenProjectionBytes) => {
        if (sha256(writtenProjectionBytes) !== projectionEvidence.sha256
          || writtenProjectionBytes.length !== projectionEvidence.byteLength) throw new Error("media_surface_manifest_output_digest_mismatch");
        parseApprovedCandidateMediaSurfaceProjectionText(writtenProjectionBytes.toString("utf8"), source);
      }
    }));
    publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: reportPath,
      bytes: reportBytes,
      label: "media_surface_manifest_report",
      faultPhase: reportFault,
      validate: async (writtenReportBytes) => validateMediaSurfaceReportBytes(writtenReportBytes, report, "media_surface_manifest_report")
    }));
    Object.freeze(publishedRecords);
    return report;
  } catch (error) {
    try {
      await removePublishedMediaSurfaceOutputs(publishedRecords);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "media_surface_manifest_compile_cleanup_failed");
    }
    throw error;
  }
}

export async function verifyApprovedCandidateMediaSurfacesReproducibility(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_media_surface_reproducibility_options_invalid");
  const { candidateRepositoryPath } = await loadTrustedMediaSurfaceSource(options);
  const forbiddenRoots = [repositoryRoot, candidateRepositoryPath];
  const outputDirectory = await externalOutputDirectory(options.outputDirectory, "media_surface_reproducibility_output_directory", forbiddenRoots);
  const reproducibilityReportPath = await newExternalOutput(options.reportPath, ".json", "media_surface_reproducibility_report", forbiddenRoots);
  const runPaths = [1, 2].flatMap((number) => {
    const prefix = `run-${String(number).padStart(2, "0")}`;
    return [resolve(outputDirectory, `${prefix}.media-surfaces.json`), resolve(outputDirectory, `${prefix}.report.json`)];
  });
  const allPaths = [...runPaths, reproducibilityReportPath];
  if (new Set(allPaths).size !== allPaths.length) throw new Error("media_surface_reproducibility_output_paths_conflict");
  await Promise.all(runPaths.map((path) => newExternalOutput(path, ".json", "media_surface_reproducibility_run_output", forbiddenRoots)));
  const reportFault = mediaSurfaceOutputFault(options, "reproducibility-report");
  const publishedRecords = [];

  try {
    const runs = [];
    for (const number of [1, 2]) {
      const prefix = `run-${String(number).padStart(2, "0")}`;
      runs.push(await compileApprovedCandidateMediaSurfaces({
        candidateRepositoryPath,
        candidateCommit: options.candidateCommit,
        outputManifestPath: resolve(outputDirectory, `${prefix}.media-surfaces.json`),
        reportPath: resolve(outputDirectory, `${prefix}.report.json`),
        [mediaSurfaceOutputFaultInjection]: options[mediaSurfaceOutputFaultInjection]
      }));
      publishedRecords.push(...runs.at(-1)[publishedMediaSurfaceOutputs]);
    }
    const projectionPaths = [1, 2].map((number) => resolve(outputDirectory, `run-${String(number).padStart(2, "0")}.media-surfaces.json`));
    const [firstBytes, secondBytes] = await Promise.all(projectionPaths.map((path) => readFile(path)));
    if (!firstBytes.equals(secondBytes)
      || runs[0].projection.sha256 !== runs[1].projection.sha256
      || runs[0].projection.byteLength !== runs[1].projection.byteLength) throw new Error("media_surface_manifest_not_byte_identical");
    if (stableJson(runs[0].candidateSource) !== stableJson(runs[1].candidateSource)
      || stableJson(runs[0].semanticReports) !== stableJson(runs[1].semanticReports)
      || stableJson(runs[0].compilerSourceSha256) !== stableJson(runs[1].compilerSourceSha256)) {
      throw new Error("approved_candidate_media_surface_source_changed_between_runs");
    }
    const comparison = Object.freeze({
      byteIdentical: true,
      projectionSha256: runs[0].projection.sha256,
      projectionByteLength: runs[0].projection.byteLength,
      mediaSurfaceCount: runs[0].projection.mediaSurfaceCount
    });
    const report = Object.freeze({
      schemaVersion: 1,
      status: "stage3-approved-candidate-media-surfaces-byte-identical",
      fixtureOnly: false,
      sceneId: runs[0].sceneId,
      approvedCandidateSpecification: true,
      mediaSurfacesSpecified: true,
      mediaSurfacesCompiled: true,
      byteIdentical: true,
      exteriorCompiled: false,
      lightingCompiled: false,
      finalCandidateGlbVerified: false,
      releaseArtifactsCreated: false,
      publicationReady: false,
      artifactBytesIncludedInRepository: false,
      candidateSource: runs[0].candidateSource,
      canonicalHashes: runs[0].canonicalHashes,
      acceptedInputSha256: runs[0].acceptedInputSha256,
      semanticReports: runs[0].semanticReports,
      compilerSourceSha256: runs[0].compilerSourceSha256,
      runs: Object.freeze(runs.map((run, index) => Object.freeze({ run: index + 1, projection: run.projection }))),
      comparison,
      boundaries: mediaSurfaceProjectionBoundaries(true)
    });
    const reportBytes = Buffer.from(`${stableJson(report)}\n`);
    publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: reproducibilityReportPath,
      bytes: reportBytes,
      label: "media_surface_reproducibility_report",
      faultPhase: reportFault,
      validate: async (writtenReportBytes) => validateMediaSurfaceReportBytes(writtenReportBytes, report, "media_surface_reproducibility_report")
    }));
    return report;
  } catch (error) {
    try {
      await removePublishedMediaSurfaceOutputs(publishedRecords);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "media_surface_reproducibility_cleanup_failed");
    }
    throw error;
  }
}

async function verifyRoomReproducibility(options, compile, mode) {
  const forbiddenRoots = mode === "exterior" || mode === "lighting"
    ? [repositoryRoot, await externalDirectory(options.candidateRepositoryPath ?? process.env.CANDIDATE_01_DIR, "approved_candidate_repository")]
    : [repositoryRoot];
  const outputDirectory = mode === "exterior" || mode === "lighting"
    ? await externalOutputDirectory(options.outputDirectory, "room_reproducibility_output_directory", forbiddenRoots)
    : await externalDirectory(options.outputDirectory, "room_reproducibility_output_directory");
  const reproducibilityReportPath = await newExternalOutput(options.reportPath, ".json", "room_reproducibility_report", forbiddenRoots);
  const runPaths = [
    ...[1, 2].flatMap((number) => {
      const prefix = `run-${String(number).padStart(2, "0")}`;
      return [
        resolve(outputDirectory, `${prefix}.blend`),
        resolve(outputDirectory, `${prefix}.glb`),
        ...(mode === "lighting" ? [resolve(outputDirectory, `${prefix}.first-view.png`)] : []),
        resolve(outputDirectory, `${prefix}.json`)
      ];
    }),
    reproducibilityReportPath
  ];
  if (new Set(runPaths).size !== runPaths.length) throw new Error("room_reproducibility_output_paths_conflict");
  await Promise.all(runPaths.slice(0, -1).map((path) => newExternalOutput(
    path,
    path.endsWith(".blend") ? ".blend" : path.endsWith(".glb") ? ".glb" : path.endsWith(".png") ? ".png" : ".json",
    "room_reproducibility_run_output",
    forbiddenRoots
  )));
  const reportFault = roomOutputFault(options, "reproducibility-report");
  const publishedRecords = [];
  const candidate = mode !== "synthetic";
  const components = mode === "components";
  const exterior = mode === "exterior";
  const lighting = mode === "lighting";
  const common = candidate ? {
    blenderPath: options.blenderPath,
    candidateRepositoryPath: options.candidateRepositoryPath,
    candidateCommit: options.candidateCommit
  } : {
    blenderPath: options.blenderPath,
    scenePath: options.scenePath,
    assetLedgerPath: options.assetLedgerPath,
    generationLedgerPath: options.generationLedgerPath
  };
  try {
    const runs = [];
    for (const number of [1, 2]) {
      const prefix = `run-${String(number).padStart(2, "0")}`;
      runs.push(await compile({
        ...common,
        outputBlendPath: resolve(outputDirectory, `${prefix}.blend`),
        outputGlbPath: resolve(outputDirectory, `${prefix}.glb`),
        ...(lighting ? { firstViewOutputPath: resolve(outputDirectory, `${prefix}.first-view.png`) } : {}),
        reportPath: resolve(outputDirectory, `${prefix}.json`),
        [roomOutputFaultInjection]: options[roomOutputFaultInjection]
      }));
      publishedRecords.push(...runs.at(-1)[publishedRoomOutputs]);
    }
    const [firstGlb, secondGlb] = await Promise.all([
      readFile(resolve(outputDirectory, "run-01.glb")),
      readFile(resolve(outputDirectory, "run-02.glb"))
    ]);
    if (!firstGlb.equals(secondGlb) || runs[0].outputGlb.sha256 !== runs[1].outputGlb.sha256) throw new Error("room_glb_not_byte_identical");
    let firstViewComparison = null;
    if (lighting) {
      const [firstPng, secondPng] = await Promise.all([
        readFile(resolve(outputDirectory, "run-01.first-view.png")),
        readFile(resolve(outputDirectory, "run-02.first-view.png"))
      ]);
      const inspections = [inspectFirstViewPng(firstPng), inspectFirstViewPng(secondPng)];
      if (!firstPng.equals(secondPng)
        || stableJson(inspections[0]) !== stableJson(inspections[1])
        || stableJson(inspections[0]) !== stableJson(runs[0].firstViewInspection)
        || stableJson(inspections[1]) !== stableJson(runs[1].firstViewInspection)) throw new Error("room_first_view_png_not_byte_identical");
      firstViewComparison = Object.freeze({
        pngByteIdentical: true,
        pngSha256: inspections[0].sha256,
        pngByteLength: inspections[0].byteLength,
        decodedRgbSha256: inspections[0].decodedRgbSha256,
        pixelCount: inspections[0].pixelCount,
        weightedLuminanceSum: inspections[0].weightedLuminanceSum,
        darkPixelCount: inspections[0].darkPixelCount,
        averagePass: inspections[0].averagePass,
        darkRatioPass: inspections[0].darkRatioPass
      });
    }
    if (runs.some((run) => run.reopenInspectionSha256 !== sha256(stableJson(run.reopenInspection)))
      || runs[0].reopenInspectionSha256 !== runs[1].reopenInspectionSha256) throw new Error("room_reopen_inspection_not_identical");
    if (candidate && (stableJson(runs[0].candidateSource) !== stableJson(runs[1].candidateSource)
      || stableJson(runs[0].canonicalHashes) !== stableJson(runs[1].canonicalHashes)
      || stableJson(runs[0].acceptedInputSha256) !== stableJson(runs[1].acceptedInputSha256)
      || stableJson(runs[0].compilerSourceSha256) !== stableJson(runs[1].compilerSourceSha256)
      || stableJson(runs[0].khronosValidation) !== stableJson(runs[1].khronosValidation)
      || stableJson(runs[0].architectureBaseline) !== stableJson(runs[1].architectureBaseline)
      || (lighting && stableJson(runs[0].semanticReports) !== stableJson(runs[1].semanticReports))
      || (lighting && stableJson(runs[0].f4Baseline) !== stableJson(runs[1].f4Baseline)))) {
      throw new Error("approved_candidate_source_changed_between_runs");
    }

    const runReports = runs.map((run, index) => ({
      run: index + 1,
      blend: run.outputBlend,
      glb: run.outputGlb,
      ...(lighting ? { firstView: run.firstViewInspection } : {}),
      inventory: run.glbInspection,
      khronosValidation: run.khronosValidation,
      architectureBaseline: run.architectureBaseline,
      reopenInspection: {
        status: run.reopenInspection.status,
        inventory: run.reopenInspection.inventory,
        sha256: run.reopenInspectionSha256
      }
    }));
    const comparison = {
      glbByteIdentical: true,
      glbSha256: runs[0].outputGlb.sha256,
      glbByteLength: runs[0].outputGlb.byteLength,
      blendByteIdentical: runs[0].outputBlend.sha256 === runs[1].outputBlend.sha256,
      reopenInspectionIdentical: true,
      reopenInspectionSha256: runs[0].reopenInspectionSha256,
      ...(firstViewComparison ?? {})
    };
    const lightingCandidateReport = {
      schemaVersion: 1,
      status: "stage3-approved-candidate-lighting-glb-and-first-view-byte-identical",
      fixtureOnly: false,
      approvedCandidateSpecification: true,
      candidateArchitectureCompiled: true,
      componentsSpecified: true,
      componentsCompiled: true,
      exteriorSpecified: true,
      exteriorCompiled: true,
      lightingSpecified: true,
      lightingCompiled: true,
      firstViewRendered: true,
      firstViewAcceptanceVerified: true,
      lightingGlbByteIdentical: true,
      firstViewPngByteIdentical: true,
      byteIdenticalExportsVerified: false,
      mediaSurfacesCompiled: false,
      sceneBinaryAddedToRepository: false,
      artifactBytesIncludedInRepository: false,
      releaseArtifactsCreated: false,
      finalCandidateGlbVerified: false,
      publicationReady: false,
      candidateSource: runs[0].candidateSource,
      canonicalHashes: runs[0].canonicalHashes,
      acceptedInputSha256: runs[0].acceptedInputSha256,
      semanticReports: runs[0].semanticReports,
      blender: runs[0].blender,
      compilerSourceSha256: runs[0].compilerSourceSha256,
      khronosValidation: runs[0].khronosValidation,
      architectureBaseline: runs[0].architectureBaseline,
      f4Baseline: runs[0].f4Baseline,
      exporter: runs[0].outputGlb.exportSettings,
      runs: runReports,
      comparison,
      boundaries: {
        approvedCandidateSpecification: true,
        candidateArchitectureCompiled: true,
        componentsSpecified: true,
        componentsCompiled: true,
        exteriorSpecified: true,
        exteriorCompiled: true,
        lightingSpecified: true,
        lightingCompiled: true,
        firstViewRendered: true,
        firstViewAcceptanceVerified: true,
        lightingGlbByteIdentical: true,
        firstViewPngByteIdentical: true,
        byteIdenticalExportsVerified: false,
        mediaSurfacesCompiled: false,
        finalCandidateGlbVerified: false,
        releaseArtifactsCreated: false,
        publicationReady: false,
        artifactBytesIncludedInRepository: false,
        sceneBinaryAddedToRepository: false
      }
    };
    const exteriorCandidateReport = {
      schemaVersion: 1,
      status: "stage3-approved-candidate-exterior-glb-byte-identical",
      fixtureOnly: false,
      approvedCandidateSpecification: true,
      candidateArchitectureCompiled: true,
      componentsSpecified: true,
      componentsCompiled: true,
      exteriorSpecified: true,
      exteriorCompiled: true,
      exteriorGlbByteIdentical: true,
      byteIdenticalExportsVerified: false,
      lightingCompiled: false,
      mediaSurfacesCompiled: false,
      sceneBinaryAddedToRepository: false,
      artifactBytesIncludedInRepository: false,
      releaseArtifactsCreated: false,
      finalCandidateGlbVerified: false,
      publicationReady: false,
      candidateSource: runs[0].candidateSource,
      canonicalHashes: runs[0].canonicalHashes,
      acceptedInputSha256: runs[0].acceptedInputSha256,
      semanticReports: runs[0].semanticReports,
      blender: runs[0].blender,
      compilerSourceSha256: runs[0].compilerSourceSha256,
      khronosValidation: runs[0].khronosValidation,
      architectureBaseline: runs[0].architectureBaseline,
      exporter: runs[0].outputGlb.exportSettings,
      runs: runReports,
      comparison,
      boundaries: {
        approvedCandidateSpecification: true,
        candidateArchitectureCompiled: true,
        componentsSpecified: true,
        componentsCompiled: true,
        exteriorSpecified: true,
        exteriorCompiled: true,
        exteriorGlbByteIdentical: true,
        byteIdenticalExportsVerified: false,
        lightingCompiled: false,
        mediaSurfacesCompiled: false,
        finalCandidateGlbVerified: false,
        releaseArtifactsCreated: false,
        publicationReady: false,
        artifactBytesIncludedInRepository: false,
        sceneBinaryAddedToRepository: false
      }
    };
    const candidateReport = lighting ? lightingCandidateReport : exterior ? exteriorCandidateReport : components ? {
      schemaVersion: 1,
      status: "stage3-approved-candidate-components-glb-byte-identical",
      fixtureOnly: false,
      approvedCandidateSpecification: true,
      candidateArchitectureCompiled: true,
      componentsSpecified: true,
      componentsCompiled: true,
      componentGlbByteIdentical: true,
      exteriorCompiled: false,
      lightingCompiled: false,
      mediaSurfacesCompiled: false,
      sceneBinaryAddedToRepository: false,
      finalCandidateGlbVerified: false,
      publicationReady: false,
      candidateSource: runs[0].candidateSource,
      canonicalHashes: runs[0].canonicalHashes,
      acceptedInputSha256: runs[0].acceptedInputSha256,
      blender: runs[0].blender,
      compilerSourceSha256: runs[0].compilerSourceSha256,
      khronosValidation: runs[0].khronosValidation,
      architectureBaseline: runs[0].architectureBaseline,
      exporter: runs[0].outputGlb.exportSettings,
      runs: runReports,
      comparison,
      boundaries: {
        approvedCandidateSpecification: true,
        candidateArchitectureCompiled: true,
        componentsSpecified: true,
        componentsCompiled: true,
        componentGlbByteIdentical: true,
        exteriorCompiled: false,
        lightingCompiled: false,
        mediaSurfacesCompiled: false,
        finalCandidateGlbVerified: false,
        publicationReady: false,
        sceneBinaryAddedToRepository: false
      }
    } : {
      schemaVersion: 1,
      status: "stage3-approved-candidate-architecture-glb-byte-identical",
      fixtureOnly: false,
      approvedCandidateSpecification: true,
      candidateArchitectureCompiled: true,
      componentsCompiled: false,
      finalCandidateGlbVerified: false,
      publicationReady: false,
      candidateSource: runs[0].candidateSource,
      canonicalHashes: runs[0].canonicalHashes,
      acceptedInputSha256: runs[0].acceptedInputSha256,
      blender: runs[0].blender,
      compilerSourceSha256: runs[0].compilerSourceSha256,
      khronosValidation: runs[0].khronosValidation,
      architectureBaseline: runs[0].architectureBaseline,
      exporter: runs[0].outputGlb.exportSettings,
      runs: runReports,
      comparison,
      boundaries: {
        approvedCandidateSpecification: true,
        candidateArchitectureCompiled: true,
        candidateArchitectureGlbByteIdentical: true,
        componentsCompiled: false,
        finalCandidateGlbVerified: false,
        publicationReady: false,
        sceneBinaryAddedToRepository: false
      }
    };
    const report = candidate ? candidateReport : {
      schemaVersion: 1,
      status: "stage3-synthetic-room-glb-byte-identical",
      fixtureOnly: true,
      specificationSha256: runs[0].specificationSha256,
      assetLedgerSha256: runs[0].assetLedgerSha256,
      generationLedgerSha256: runs[0].generationLedgerSha256,
      acceptedInputSha256: runs[0].acceptedInputSha256,
      blender: runs[0].blender,
      khronosValidation: runs[0].khronosValidation,
      architectureBaseline: runs[0].architectureBaseline,
      exporter: runs[0].outputGlb.exportSettings,
      runs: runReports,
      comparison,
      boundaries: {
        approvedCandidateSpecification: false,
        finalCandidateGlbVerified: false,
        publicationReady: false,
        syntheticFixtureGlbByteIdentical: true
      }
    };
    const reportBytes = Buffer.from(`${stableJson(report)}\n`);
    publishedRecords.push(await publishMediaSurfaceOutputAtomically({
      finalPath: reproducibilityReportPath,
      bytes: reportBytes,
      label: "room_reproducibility_report",
      faultPhase: reportFault,
      validate: async (writtenBytes) => validateMediaSurfaceReportBytes(writtenBytes, report, "room_reproducibility_report")
    }));
    return Object.freeze(report);
  } catch (error) {
    try {
      await removePublishedMediaSurfaceOutputs(publishedRecords);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "room_reproducibility_cleanup_failed");
    }
    throw error;
  }
}

export async function verifySyntheticRoomReproducibility(options) {
  if (!options || typeof options !== "object") throw new Error("room_reproducibility_options_invalid");
  return verifyRoomReproducibility(options, compileSyntheticRoomShell, "synthetic");
}

export async function verifyApprovedCandidateArchitectureReproducibility(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_reproducibility_options_invalid");
  return verifyRoomReproducibility(options, compileApprovedCandidateArchitecture, "architecture");
}

export async function verifyApprovedCandidateComponentsReproducibility(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_component_reproducibility_options_invalid");
  return verifyRoomReproducibility(options, compileApprovedCandidateComponents, "components");
}

export async function verifyApprovedCandidateExteriorReproducibility(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_exterior_reproducibility_options_invalid");
  return verifyRoomReproducibility(options, compileApprovedCandidateExterior, "exterior");
}

export async function verifyApprovedCandidateLightingReproducibility(options) {
  if (!options || typeof options !== "object") throw new Error("approved_candidate_lighting_reproducibility_options_invalid");
  return verifyRoomReproducibility(options, compileApprovedCandidateLighting, "lighting");
}

function parsePairs(arguments_, code) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values[flag] !== undefined) throw new Error(code);
    values[flag] = value;
  }
  return values;
}

function parseCompileCli(arguments_) {
  const values = parsePairs(arguments_, "room_shell_cli_arguments_invalid");
  const inputKind = values["--input-kind"] ?? syntheticInputKind;
  if (inputKind === candidateMediaSurfaceInputKind) {
    const allowed = new Set(["--candidate-dir", "--input-kind", "--output-manifest", "--report"]);
    if (Object.keys(values).some((key) => !allowed.has(key))
      || values["--output-manifest"] === undefined
      || values["--report"] === undefined) throw new Error("room_shell_cli_arguments_invalid");
    return {
      inputKind,
      options: {
        candidateRepositoryPath: values["--candidate-dir"],
        outputManifestPath: values["--output-manifest"],
        reportPath: values["--report"]
      }
    };
  }
  const common = {
    blenderPath: values["--blender"],
    outputBlendPath: values["--output-blend"],
    outputGlbPath: values["--output-glb"],
    reportPath: values["--report"]
  };
  if ([candidateArchitectureInputKind, candidateComponentInputKind, candidateExteriorInputKind, candidateLightingInputKind].includes(inputKind)) {
    const lighting = inputKind === candidateLightingInputKind;
    const allowed = new Set(["--blender", "--candidate-dir", "--input-kind", "--output-blend", "--output-glb", "--output-first-view", "--report"]);
    if (Object.keys(values).some((key) => !allowed.has(key)) || Object.values(common).some((value) => value === undefined)) throw new Error("room_shell_cli_arguments_invalid");
    if (lighting !== (values["--output-first-view"] !== undefined)) throw new Error("room_shell_cli_arguments_invalid");
    return { inputKind, options: {
      ...common,
      candidateRepositoryPath: values["--candidate-dir"],
      ...(lighting ? { firstViewOutputPath: values["--output-first-view"] } : {})
    } };
  }
  const expected = ["--asset-ledger", "--blender", "--generation-ledger", "--output-blend", "--output-glb", "--report", "--scene-spec"];
  if (inputKind !== syntheticInputKind || values["--input-kind"] !== undefined || Object.keys(values).sort().join(",") !== expected.join(",")) throw new Error("room_shell_cli_arguments_invalid");
  return {
    inputKind,
    options: {
      ...common,
      scenePath: values["--scene-spec"],
      assetLedgerPath: values["--asset-ledger"],
      generationLedgerPath: values["--generation-ledger"]
    }
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const cli = parseCompileCli(process.argv.slice(2));
    const report = cli.inputKind === candidateArchitectureInputKind
      ? await compileApprovedCandidateArchitecture(cli.options)
      : cli.inputKind === candidateComponentInputKind
        ? await compileApprovedCandidateComponents(cli.options)
        : cli.inputKind === candidateExteriorInputKind
          ? await compileApprovedCandidateExterior(cli.options)
          : cli.inputKind === candidateLightingInputKind
            ? await compileApprovedCandidateLighting(cli.options)
          : cli.inputKind === candidateMediaSurfaceInputKind
            ? await compileApprovedCandidateMediaSurfaces(cli.options)
            : await compileSyntheticRoomShell(cli.options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "room_shell_compile_failed"}\n`);
    process.exitCode = 1;
  }
}
