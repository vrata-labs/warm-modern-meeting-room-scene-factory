import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import gltfValidator from "gltf-validator";

import { parseCanonicalJsonText, parseComponentConstructionContract, parseSceneContract } from "./scene-contract.mjs";

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
  componentConstruction: "source/component-constructions.json"
});
export const compilerSourceAttestationPaths = Object.freeze([
  "compiler/blender-room-shell.py",
  "compiler/compile-room-shell.mjs",
  "compiler/scene-contract.mjs",
  "compiler/verify-room-reproducibility.mjs",
  "schemas/asset-ledger.schema.json",
  "schemas/component-constructions.schema.json",
  "schemas/generation-ledger.schema.json",
  "schemas/media-surface-constructions.schema.json",
  "schemas/scene-spec.schema.json",
  "experiment/warm-modern-meeting-room/candidate-lock.json",
  "package.json",
  "pnpm-lock.yaml"
]);
const expectedBlenderBinarySha256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880";
const blenderTimeoutMs = 300_000;
const syntheticInputKind = "synthetic-fixture";
const candidateArchitectureInputKind = "approved-candidate-architecture";
const candidateComponentInputKind = "approved-candidate-components";
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

async function newExternalOutput(path, extension, label) {
  if (typeof path !== "string" || path.length === 0) throw new Error(`${label}_invalid`);
  const resolved = resolve(path);
  if (inside(repositoryRoot, resolved) || extname(resolved) !== extension) throw new Error(`${label}_invalid`);
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

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
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
  const baseline = candidate?.architectureBaseline;
  const hashFieldsValid = (value, fields) => fields.every((field) => /^[0-9a-f]{64}$/.test(value?.[field] ?? ""));
  const inputBlobsValid = (value, paths) => value && typeof value === "object"
    && Object.keys(value).sort().join(",") === [...paths].sort().join(",")
    && Object.values(value).every((blob) => /^[0-9a-f]{40}$/.test(blob?.gitBlobOid ?? "")
      && /^[0-9a-f]{64}$/.test(blob?.rawSha256 ?? "")
      && Number.isSafeInteger(blob?.byteLength) && blob.byteLength > 0);
  const semanticEvidenceValid = (value) => value?.schemaVersion === 1
    && value?.contract === "f1-architecture-objects-materials-v1"
    && /^[0-9a-f]{64}$/.test(value?.sha256 ?? "")
    && value?.objectCount === 19
    && value?.materialCount === 3;
  const componentGlbEvidence = candidate?.componentGlbEvidence;
  const khronosEvidence = componentGlbEvidence?.khronosValidator;
  const componentGlbEvidenceValid = /^[0-9a-f]{64}$/.test(componentGlbEvidence?.sha256 ?? "")
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
  if (lock?.schemaVersion !== 2
    || typeof candidate?.repository !== "string"
    || !/^[0-9a-f]{40}$/.test(candidate?.commit ?? "")
    || !/^[0-9a-f]{40}$/.test(candidate?.sceneContractValidatorCommit ?? "")
    || !/^[0-9a-f]{40}$/.test(lock?.platformValidatorCommit ?? "")
    || !hashFieldsValid(candidate, ["specificationSha256", "assetLedgerSha256", "generationLedgerSha256", "componentConstructionSha256", "componentConstructionRawSha256"])
    || !Array.isArray(candidate.acceptedInputSha256) || candidate.acceptedInputSha256.length !== 2
    || candidate.acceptedInputSha256.some((digest) => !/^[0-9a-f]{64}$/.test(digest))
    || !inputBlobsValid(candidate.inputBlobs, Object.values(candidatePaths))
    || !componentGlbEvidenceValid
    || !/^[0-9a-f]{40}$/.test(baseline?.commit ?? "")
    || !/^[0-9a-f]{40}$/.test(baseline?.sceneContractValidatorCommit ?? "")
    || !hashFieldsValid(baseline, ["specificationSha256", "assetLedgerSha256", "generationLedgerSha256"])
    || !Array.isArray(baseline.acceptedInputSha256) || baseline.acceptedInputSha256.length !== 1
    || !semanticEvidenceValid(baseline.semanticEvidence)
    || !inputBlobsValid(baseline.inputBlobs, Object.values(candidatePaths).filter((path) => path !== candidatePaths.componentConstruction))) {
    throw new Error("approved_candidate_lock_invalid");
  }
  return Object.freeze({
    repository: candidate.repository,
    platformValidatorCommit: lock.platformValidatorCommit,
    component: Object.freeze({
      ...candidate,
      validatorCommit: candidate.sceneContractValidatorCommit
    }),
    architecture: Object.freeze({
      ...baseline,
      validatorCommit: baseline.sceneContractValidatorCommit
    })
  });
}

async function loadCandidateLock() {
  return parseCandidateLockText(await readFile(candidateLockPath, "utf8"));
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
  try {
    const topLevel = String(await gitOutput(candidateRepositoryPath, ["rev-parse", "--show-toplevel"], "utf8")).trim();
    const commit = String(await gitOutput(candidateRepositoryPath, ["rev-parse", "--verify", `${lock.commit}^{commit}`], "utf8")).trim();
    if (resolve(topLevel) !== candidateRepositoryPath || commit !== lock.commit) throw new Error("invalid_repository");
  } catch {
    throw new Error("approved_candidate_component_commit_missing");
  }

  const blobs = await Promise.all([
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.scene),
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.assetLedger),
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.generationLedger),
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.conceptSelection),
    readGitBlob(candidateRepositoryPath, lock.commit, candidatePaths.componentConstruction)
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
    : source.componentsIncluded
      ? "stage3-approved-candidate-components-compiled"
      : "stage3-approved-candidate-architecture-compiled";
  const expectedMaterialRecipeCount = source.componentsIncluded ? 5 : 3;
  const expectedMaterialZoneCount = source.componentsIncluded ? 60 : 22;
  const expectedInventoryCount = source.componentsIncluded ? 57 : 19;
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
    || report.outputGlb?.exportSettings?.exportLights !== false
    || report.outputGlb?.exportSettings?.exportYup !== true
    || report.inventory?.objectCount !== expectedInventoryCount
    || report.inventory?.meshCount !== expectedInventoryCount
    || report.inventory?.materialCount !== expectedMaterialRecipeCount
    || report.inventory?.imageCount !== 0
    || report.inventory?.textureCount !== 0
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
    || report.exteriorCompiled !== false
    || report.lightingCompiled !== false
    || report.mediaSurfacesCompiled !== false
    || report.sceneBinaryAddedToRepository !== false
    || report.boundaries?.componentsSpecified !== true
    || report.boundaries?.componentGlbByteIdentical !== false
    || report.boundaries?.exteriorCompiled !== false
    || report.boundaries?.lightingCompiled !== false
    || report.boundaries?.mediaSurfacesCompiled !== false);
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
  if (commonInvalid || componentInvalid || boundaryInvalid) throw new Error("room_shell_report_invalid");
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

function normalizeExpectedRecords(records, componentMode) {
  const expectedCount = componentMode ? 57 : expectedArchitectureNodeNames.length;
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
      if (!/^component\.[a-z0-9-]+\.[a-z0-9-]+$/.test(record.name)
        || !Number.isFinite(record.bevel?.widthM) || record.bevel.widthM <= 0
        || record.bevel?.segments !== 3 || record.bevel?.clampOverlap !== true
        || typeof record.materialRecipeId !== "string") throw new Error("room_glb_expected_component_invalid");
      normalizedRecord.bevel = {
        widthM: record.bevel.widthM,
        segments: record.bevel.segments,
        clampOverlap: record.bevel.clampOverlap
      };
    } else if (componentMode && record.name.startsWith("component.")) {
      throw new Error("room_glb_expected_component_invalid");
    }
    return normalizedRecord;
  }).sort((left, right) => left.name < right.name ? -1 : left.name > right.name ? 1 : 0);
  const names = normalized.map(({ name }) => name);
  if (new Set(names).size !== names.length
    || expectedArchitectureNodeNames.some((name) => !names.includes(name))
    || (!componentMode && !exactStringSet(names, expectedArchitectureNodeNames))
    || (componentMode && normalized.filter(({ geometry }) => geometry === "beveled-box").length !== 38)) {
    throw new Error("room_glb_expected_inventory_invalid");
  }
  return normalized;
}

function normalizeExpectedGlbContract(value) {
  if (Array.isArray(value)) return Object.freeze({
    status: "architecture-only-glb-inspection-valid",
    componentMode: false,
    records: normalizeExpectedRecords(value, false),
    materials: expectedArchitectureMaterials,
    allowedMaterialSourceIds: allowedArchitectureMaterialSourceIds,
    requiredMaterialSourceCount: 1
  });
  const componentMode = value?.status === "approved-candidate-components-glb-inspection-valid";
  const allowedMaterialSourceIds = new Set(value?.allowedMaterialSourceIds);
  if (!componentMode
    || stableJson(value?.materials) !== stableJson(expectedComponentMaterials)
    || !exactStringSet(value?.allowedMaterialSourceIds, ["asset-layout-project"])
    || value?.requiredMaterialSourceCount !== 1) throw new Error("room_glb_expected_contract_invalid");
  return Object.freeze({
    status: value.status,
    componentMode,
    records: normalizeExpectedRecords(value.records, true),
    materials: value.materials,
    allowedMaterialSourceIds,
    requiredMaterialSourceCount: value.requiredMaterialSourceCount
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
  if (prohibitedTopLevel.some((key) => Object.hasOwn(document, key))
    || Object.hasOwn(document, "extensionsUsed")
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
  const nodeNames = nodes?.map(({ name }) => name).sort();
  const meshNames = meshes?.map(({ name }) => name).sort();
  const materialNames = materials?.map(({ name }) => name).sort();
  if (nodes?.length !== expectedNodeNames.length
    || meshes?.length !== expectedNodeNames.length
    || materials?.length !== Object.keys(expectedMaterials).length
    || !exactStringSet(nodeNames, expectedNodeNames)
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
  for (const node of nodes) {
    if (!Number.isInteger(node.mesh) || node.mesh < 0 || node.mesh >= meshes.length || Object.hasOwn(node, "camera") || Object.hasOwn(node, "skin")) {
      throw new Error("room_glb_mesh_binding_invalid");
    }
    meshReferences[node.mesh] += 1;
    if (meshes[node.mesh].name !== `mesh.${node.name}`) throw new Error("room_glb_mesh_binding_invalid");
  }
  if (meshReferences.some((count) => count !== 1)) throw new Error("room_glb_mesh_binding_invalid");

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
  for (const node of nodes) {
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
      || !normalizedContract.allowedMaterialSourceIds.has(extras.wmmr_source_record_id)) throw new Error("room_glb_material_invalid");
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
    lightCount: 0,
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
    extensionCount: 0,
    nodeNames: Object.freeze([...nodeNames]),
    meshNames: Object.freeze([...meshNames]),
    materialNames: Object.freeze([...materialNames]),
    materialEvidence: Object.freeze(materialEvidence),
    geometryEvidence: Object.freeze(geometryEvidence)
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
    .filter(({ name }) => !name.startsWith("component."))
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

async function compileRoomArchitecture(options, source) {
  const sourceHashes = source.fixtureOnly ? null : await compilerSourceSha256();
  const blenderPath = await exactRegularFile(options.blenderPath, "room_shell_blender");
  const blenderBytes = await readFile(blenderPath);
  const binarySha256 = sha256(blenderBytes);
  if (binarySha256 !== expectedBlenderBinarySha256) throw new Error("room_shell_blender_sha256_invalid");
  const outputBlendPath = await newExternalOutput(options.outputBlendPath, ".blend", "room_shell_output");
  const outputGlbPath = await newExternalOutput(options.outputGlbPath, ".glb", "room_glb_output");
  const reportPath = await newExternalOutput(options.reportPath, ".json", "room_shell_report");
  if (new Set([outputBlendPath, outputGlbPath, reportPath]).size !== 3) throw new Error("room_shell_output_paths_conflict");

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-room-shell-"));
  const temporaryScenePath = resolve(temporaryRoot, "scene-spec.json");
  const temporaryComponentPath = resolve(temporaryRoot, "component-constructions.json");
  const componentArguments = source.componentsIncluded ? [
    "--component-constructions",
    temporaryComponentPath,
    "--expected-component-raw-sha256",
    source.rawComponentConstructionSha256,
    "--expected-component-sha256",
    source.contract.componentConstructionSha256
  ] : [];

  try {
    await writeFile(temporaryScenePath, source.sceneBytes, { flag: "wx", mode: 0o600 });
    if (source.componentsIncluded) await writeFile(temporaryComponentPath, source.componentConstructionBytes, { flag: "wx", mode: 0o600 });
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
      "--report",
      reportPath,
      "--output-blend",
      outputBlendPath,
      "--output-glb",
      outputGlbPath
    ], {
      cwd: temporaryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: blenderTimeoutMs
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    validateCompilerReport(report, source, binarySha256);
    const outputBytes = await readFile(outputBlendPath);
    if (report.outputBlend?.byteLength !== outputBytes.length || report.outputBlend?.sha256 !== sha256(outputBytes)) throw new Error("room_shell_output_digest_mismatch");
    const glbBytes = await readFile(outputGlbPath);
    if (report.outputGlb?.byteLength !== glbBytes.length || report.outputGlb?.sha256 !== sha256(glbBytes)) throw new Error("room_glb_output_digest_mismatch");
    const inspectionPath = resolve(temporaryRoot, "inspection.json");
    await execFileAsync(blenderPath, [
      "--background",
      outputBlendPath,
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
      || inspection.inventory?.cameraCount !== 0
      || inspection.inventory?.lightCount !== 0
      || inspection.inventory?.vertexCount !== report.inventory.vertexCount
      || inspection.inventory?.faceCount !== report.inventory.faceCount
      || stableJson(inspection.inventory?.objects) !== stableJson(report.inventory.objects)
      || stableJson(inspection.materials) !== stableJson(report.materials)
      || (source.componentsIncluded && stableJson(inspection.components) !== stableJson(report.components))) throw new Error("room_shell_saved_inspection_invalid");
    const glbInspection = inspectGlb(glbBytes, source.componentsIncluded
      ? createApprovedCandidateComponentGlbContract(report, source)
      : report.inventory.objects);
    const khronosValidation = await validateGlbWithKhronos(glbBytes);
    const architectureBaseline = source.architectureBaseline
      ? verifyArchitectureBaselineEvidence(source.architectureBaseline, report, inspection, glbInspection)
      : null;
    const reopenInspectionSha256 = sha256(stableJson(inspection));
    if (source.componentsIncluded) {
      const locked = source.componentGlbEvidence;
      const issueCounts = khronosValidation.issueCounts;
      if (report.outputGlb.sha256 !== locked.sha256
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
        || issueCounts.hints !== locked.khronosValidator.hints) throw new Error("approved_candidate_component_glb_evidence_mismatch");
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
      reopenInspection: inspection,
      reopenInspectionSha256
    };
    const finalReport = source.fixtureOnly ? commonEnvelope : {
      ...commonEnvelope,
      candidateSource: source.candidateSource,
      canonicalHashes: source.canonicalHashes,
      compilerSourceSha256: sourceHashes
    };
    await writeFile(reportPath, `${stableJson(finalReport)}\n`, { mode: 0o600 });
    return Object.freeze(finalReport);
  } catch (error) {
    await Promise.all([rm(outputBlendPath, { force: true }), rm(outputGlbPath, { force: true }), rm(reportPath, { force: true })]);
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

async function verifyRoomReproducibility(options, compile, mode) {
  const outputDirectory = await externalDirectory(options.outputDirectory, "room_reproducibility_output_directory");
  const reproducibilityReportPath = await newExternalOutput(options.reportPath, ".json", "room_reproducibility_report");
  const runPaths = [
    ...[1, 2].flatMap((number) => {
      const prefix = `run-${String(number).padStart(2, "0")}`;
      return [resolve(outputDirectory, `${prefix}.blend`), resolve(outputDirectory, `${prefix}.glb`), resolve(outputDirectory, `${prefix}.json`)];
    }),
    reproducibilityReportPath
  ];
  if (new Set(runPaths).size !== runPaths.length) throw new Error("room_reproducibility_output_paths_conflict");
  await Promise.all(runPaths.slice(0, -1).map((path) => newExternalOutput(path, path.endsWith(".blend") ? ".blend" : path.endsWith(".glb") ? ".glb" : ".json", "room_reproducibility_run_output")));
  const candidate = mode !== "synthetic";
  const components = mode === "components";
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
        reportPath: resolve(outputDirectory, `${prefix}.json`)
      }));
    }
    const [firstGlb, secondGlb] = await Promise.all([
      readFile(resolve(outputDirectory, "run-01.glb")),
      readFile(resolve(outputDirectory, "run-02.glb"))
    ]);
    if (!firstGlb.equals(secondGlb) || runs[0].outputGlb.sha256 !== runs[1].outputGlb.sha256) throw new Error("room_glb_not_byte_identical");
    if (runs.some((run) => run.reopenInspectionSha256 !== sha256(stableJson(run.reopenInspection)))
      || runs[0].reopenInspectionSha256 !== runs[1].reopenInspectionSha256) throw new Error("room_reopen_inspection_not_identical");
    if (candidate && (stableJson(runs[0].candidateSource) !== stableJson(runs[1].candidateSource)
      || stableJson(runs[0].compilerSourceSha256) !== stableJson(runs[1].compilerSourceSha256)
      || stableJson(runs[0].khronosValidation) !== stableJson(runs[1].khronosValidation)
      || stableJson(runs[0].architectureBaseline) !== stableJson(runs[1].architectureBaseline))) {
      throw new Error("approved_candidate_source_changed_between_runs");
    }

    const runReports = runs.map((run, index) => ({
      run: index + 1,
      blend: run.outputBlend,
      glb: run.outputGlb,
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
      reopenInspectionSha256: runs[0].reopenInspectionSha256
    };
    const candidateReport = components ? {
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
    await writeFile(reproducibilityReportPath, `${stableJson(report)}\n`, { flag: "wx", mode: 0o600 });
    return Object.freeze(report);
  } catch (error) {
    await Promise.all(runPaths.map((path) => rm(path, { force: true })));
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
  const common = {
    blenderPath: values["--blender"],
    outputBlendPath: values["--output-blend"],
    outputGlbPath: values["--output-glb"],
    reportPath: values["--report"]
  };
  if ([candidateArchitectureInputKind, candidateComponentInputKind].includes(inputKind)) {
    const allowed = new Set(["--blender", "--candidate-dir", "--input-kind", "--output-blend", "--output-glb", "--report"]);
    if (Object.keys(values).some((key) => !allowed.has(key)) || Object.values(common).some((value) => value === undefined)) throw new Error("room_shell_cli_arguments_invalid");
    return { inputKind, options: { ...common, candidateRepositoryPath: values["--candidate-dir"] } };
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
        : await compileSyntheticRoomShell(cli.options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "room_shell_compile_failed"}\n`);
    process.exitCode = 1;
  }
}
