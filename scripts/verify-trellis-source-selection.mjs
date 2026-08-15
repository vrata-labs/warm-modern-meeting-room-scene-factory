import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const defaultPolicyPath = resolve(
  import.meta.dirname,
  "../experiment/warm-modern-meeting-room/trellis-source-selection-lock.json"
);
const selectionPurpose = "candidate-upstream-files-for-image-to-raw-mesh-prune";
const selectionCanonicalization = "sort by ASCII path, then concatenate UTF-8 path, NUL, lowercase SHA-256, and LF";
const expectedSource = Object.freeze({
  repository: "https://github.com/microsoft/TRELLIS.git",
  commit: "442aa1e1afb9014e80681d3bf604e8d728a86ee7",
  submodulePath: "trellis/representations/mesh/flexicubes",
  submoduleRepository: "https://github.com/MaxtirError/FlexiCubes.git",
  submoduleCommit: "815e075a2a400d06c48d94c347674344ed6ae5c5",
  fileCount: 53,
  selectionSha256: "5860f91b0fddd401f661f5a16ef2f224d3c6f712f73a2fb050fd547abcac8348",
  policySha256: "9d41db04bbec3977c797751e671377df073b642726d2d1ca554ed5c7c385443c"
});
const requiredPatchPaths = Object.freeze([
  "trellis/__init__.py",
  "trellis/models/__init__.py",
  "trellis/models/sparse_structure_flow.py",
  "trellis/models/structured_latent_flow.py",
  "trellis/models/structured_latent_vae/__init__.py",
  "trellis/models/structured_latent_vae/base.py",
  "trellis/models/structured_latent_vae/decoder_mesh.py",
  "trellis/modules/attention/__init__.py",
  "trellis/modules/attention/full_attn.py",
  "trellis/modules/sparse/__init__.py",
  "trellis/modules/sparse/attention/__init__.py",
  "trellis/modules/sparse/attention/full_attn.py",
  "trellis/modules/sparse/attention/modules.py",
  "trellis/modules/sparse/attention/serialized_attn.py",
  "trellis/modules/sparse/attention/windowed_attn.py",
  "trellis/modules/sparse/basic.py",
  "trellis/modules/sparse/conv/__init__.py",
  "trellis/modules/sparse/conv/conv_spconv.py",
  "trellis/modules/sparse/transformer/blocks.py",
  "trellis/modules/sparse/transformer/modulated.py",
  "trellis/pipelines/__init__.py",
  "trellis/pipelines/base.py",
  "trellis/pipelines/trellis_image_to_3d.py",
  "trellis/pipelines/samplers/flow_euler.py",
  "trellis/representations/__init__.py",
  "trellis/representations/mesh/cube2mesh.py",
  "trellis/representations/mesh/flexicubes/flexicubes.py",
  "trellis/representations/mesh/utils_cube.py"
]);
const requiredExclusions = Object.freeze([
  "trellis.datasets",
  "trellis.models.sparse_elastic_mixin",
  "trellis.models.structured_latent_vae.decoder_gs",
  "trellis.models.structured_latent_vae.decoder_rf",
  "trellis.models.structured_latent_vae.encoder",
  "trellis.modules.sparse.conv.conv_torchsparse",
  "trellis.pipelines.trellis_text_to_3d",
  "trellis.renderers",
  "trellis.representations.gaussian",
  "trellis.representations.octree",
  "trellis.representations.radiance_field",
  "trellis.trainers",
  "trellis.utils"
]);
const requiredProhibitedDependencies = Object.freeze([
  "diffoctreerast",
  "diff-gaussian-rasterization",
  "easydict",
  "flash_attn",
  "huggingface_hub",
  "kaolin",
  "nvdiffrast",
  "open3d",
  "plyfile",
  "rembg",
  "torch.hub",
  "torchsparse",
  "torchvision",
  "tqdm",
  "vox2seq"
]);
const requiredOpenGates = Object.freeze([
  "patchedSourceTreeDigest",
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

export class SourceSelectionError extends Error {
  constructor(issues) {
    super(`trellis_source_selection_invalid:${issues.join(",")}`);
    this.name = "SourceSelectionError";
    this.issues = issues;
  }
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
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

function validateUniqueStrings(value, name, issues) {
  if (!Array.isArray(value) || value.length === 0 || value.some((entry) => typeof entry !== "string" || !entry)) {
    issues.push(`${name}_invalid`);
    return new Set();
  }
  const entries = new Set(value);
  if (entries.size !== value.length) issues.push(`${name}_duplicates`);
  return entries;
}

function requireEntries(actual, required, name, issues) {
  const entries = validateUniqueStrings(actual, name, issues);
  for (const requiredEntry of required) {
    if (!entries.has(requiredEntry)) issues.push(`${name}_missing:${requiredEntry}`);
  }
}

export function canonicalSelectionDigest(files) {
  const canonical = [...files]
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
    .map(({ path, sha256: digest }) => `${path}\0${digest}\n`)
    .join("");
  return sha256(canonical);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function canonicalPolicyDigest(policy) {
  const semanticPolicy = structuredClone(policy);
  delete semanticPolicy.policySha256;
  return sha256(stableJson(semanticPolicy));
}

export function validateSelectionPolicy(policy) {
  const issues = [];
  if (policy?.schemaVersion !== 1) issues.push("invalid_schema_version");
  if (!/^[0-9a-f]{64}$/.test(policy?.policySha256 ?? "")) issues.push("invalid_policy_digest");
  else if (policy.policySha256 !== canonicalPolicyDigest(policy)) issues.push("policy_digest_mismatch");
  if (policy?.status !== "selection-locked-runtime-blocked") issues.push("invalid_status");
  if (policy?.generationAllowed !== false) issues.push("generation_must_be_blocked");
  if (!/^https:\/\//.test(policy?.source?.repository ?? "")) issues.push("invalid_source_repository");
  if (!/^[0-9a-f]{40}$/.test(policy?.source?.commit ?? "")) issues.push("invalid_source_commit");
  if (typeof policy?.source?.declaredLicense !== "string" || !policy.source.declaredLicense) issues.push("invalid_source_license");
  if (!Array.isArray(policy?.source?.submodules) || policy.source.submodules.length !== 1) {
    issues.push("invalid_submodules");
  } else {
    for (const submodule of policy.source.submodules) {
      if (!isSafeRelativePath(submodule?.path)) issues.push("invalid_submodule_path");
      if (!/^https:\/\//.test(submodule?.repository ?? "")) issues.push("invalid_submodule_repository");
      if (!/^[0-9a-f]{40}$/.test(submodule?.commit ?? "")) issues.push("invalid_submodule_commit");
      if (typeof submodule?.declaredLicense !== "string" || !submodule.declaredLicense) issues.push("invalid_submodule_license");
    }
  }

  const files = policy?.selection?.files;
  if (policy?.selection?.purpose !== selectionPurpose) issues.push("invalid_selection_purpose");
  if (policy?.selection?.canonicalization !== selectionCanonicalization) issues.push("invalid_selection_canonicalization");
  if (!Array.isArray(files) || files.length === 0) {
    issues.push("invalid_file_selection");
  } else {
    const paths = new Set();
    for (const file of files) {
      if (!isSafeRelativePath(file?.path)) issues.push(`invalid_file_path:${file?.path ?? "missing"}`);
      if (paths.has(file?.path)) issues.push(`duplicate_file_path:${file.path}`);
      paths.add(file?.path);
      if (!/^[0-9a-f]{64}$/.test(file?.sha256 ?? "")) issues.push(`invalid_file_hash:${file?.path ?? "missing"}`);
    }
    if (policy.selection.fileCount !== files.length) issues.push("file_count_mismatch");
    if (policy.selection.selectionSha256 !== canonicalSelectionDigest(files)) issues.push("selection_digest_mismatch");

    if (!Array.isArray(policy.requiredPatches) || policy.requiredPatches.length === 0) {
      issues.push("required_patches_missing");
    } else {
      const patchPaths = new Set();
      for (const patch of policy.requiredPatches) {
        if (!paths.has(patch?.path)) issues.push(`patch_path_not_selected:${patch?.path ?? "missing"}`);
        if (patchPaths.has(patch?.path)) issues.push(`duplicate_patch_path:${patch.path}`);
        patchPaths.add(patch?.path);
        if (!Array.isArray(patch?.requirements) || patch.requirements.length === 0) {
          issues.push(`patch_requirements_missing:${patch?.path ?? "missing"}`);
        } else if (patch.requirements.some((requirement) => typeof requirement !== "string" || !requirement)) {
          issues.push(`patch_requirements_invalid:${patch?.path ?? "missing"}`);
        }
      }
    }
  }

  validateUniqueStrings(policy?.requiredExclusions, "required_exclusions", issues);
  validateUniqueStrings(policy?.prohibitedRuntimeDependencies, "prohibited_dependencies", issues);
  validateUniqueStrings(policy?.openGates, "open_gates", issues);
  if (!Array.isArray(policy?.licenseCoverage) || policy.licenseCoverage.length < 3) {
    issues.push("license_coverage_invalid");
  } else {
    for (const coverage of policy.licenseCoverage) {
      if (typeof coverage?.scope !== "string" || !coverage.scope) issues.push("license_scope_invalid");
      if (!coverage.license && !coverage.classification) issues.push("license_or_classification_missing");
    }
  }
  for (const field of [
    "weightsDownloaded",
    "modelInputsDownloaded",
    "generationRun",
    "cloudResourcesCreated",
    "localVerificationCiReproducible"
  ]) {
    if (policy?.evidenceBoundary?.[field] !== false) issues.push(`evidence_boundary_invalid:${field}`);
  }
  if (typeof policy?.evidenceBoundary?.claim !== "string" || !policy.evidenceBoundary.claim) issues.push("evidence_claim_missing");
  if (issues.length > 0) throw new SourceSelectionError(issues);
  return policy;
}

export function validateWmmrSelectionContract(policy) {
  validateSelectionPolicy(policy);
  const issues = [];
  const submodule = policy.source.submodules[0];
  if (policy.source.repository !== expectedSource.repository) issues.push("unexpected_source_repository");
  if (policy.source.commit !== expectedSource.commit) issues.push("unexpected_source_commit");
  if (policy.source.declaredLicense !== "MIT") issues.push("unexpected_source_license");
  if (submodule.path !== expectedSource.submodulePath) issues.push("unexpected_submodule_path");
  if (submodule.repository !== expectedSource.submoduleRepository) issues.push("unexpected_submodule_repository");
  if (submodule.commit !== expectedSource.submoduleCommit) issues.push("unexpected_submodule_commit");
  if (submodule.declaredLicense !== "Apache-2.0") issues.push("unexpected_submodule_license");
  if (policy.selection.fileCount !== expectedSource.fileCount) issues.push("unexpected_file_count");
  if (policy.selection.selectionSha256 !== expectedSource.selectionSha256) issues.push("unexpected_selection_digest");
  if (policy.policySha256 !== expectedSource.policySha256) issues.push("unexpected_policy_digest");

  requireEntries(policy.requiredPatches.map(({ path }) => path), requiredPatchPaths, "required_patch_paths", issues);
  requireEntries(policy.requiredExclusions, requiredExclusions, "required_exclusions", issues);
  requireEntries(policy.prohibitedRuntimeDependencies, requiredProhibitedDependencies, "prohibited_dependencies", issues);
  requireEntries(policy.openGates, requiredOpenGates, "open_gates", issues);

  const mit = policy.licenseCoverage.find(({ licensePath }) => licensePath === "LICENSE");
  if (mit?.license !== "MIT") issues.push("mit_license_coverage_missing");
  const apache = policy.licenseCoverage.find(({ licensePath }) => licensePath === "trellis/representations/mesh/flexicubes/LICENSE.txt");
  if (apache?.license !== "Apache-2.0" || apache.modificationNoticesRequired !== true) {
    issues.push("apache_license_coverage_missing");
  }
  const dco = policy.licenseCoverage.find(({ scope }) => scope === "trellis/representations/mesh/flexicubes/DCO.txt");
  if (dco?.classification !== "provenance-only-non-shipping"
    || dco.terms !== "verbatim-copy-only"
    || dco.modificationAllowed !== false) {
    issues.push("dco_provenance_classification_missing");
  }
  if (!Array.isArray(policy.knownAttributionQuestions)
    || !policy.knownAttributionQuestions.some(({ path, status, noticePath }) => (
      path === "trellis/models/sparse_structure_flow.py"
      && status === "required-for-materialized-patched-tree"
      && noticePath === "third_party/openai-glide/LICENSE.txt"
    ))) {
    issues.push("known_attribution_question_missing");
  }
  if (issues.length > 0) throw new SourceSelectionError(issues);
  return policy;
}

export async function loadSelectionPolicy(path = defaultPolicyPath) {
  return validateWmmrSelectionContract(JSON.parse(await readFile(path, "utf8")));
}

export async function verifySelectedFiles(policy, sourceDirectory) {
  validateSelectionPolicy(policy);
  const issues = [];
  const actualFiles = [];
  const sourceRoot = await realpath(sourceDirectory);

  for (const expected of policy.selection.files) {
    try {
      const sourcePath = resolve(sourceRoot, expected.path);
      const metadata = await lstat(sourcePath);
      if (!metadata.isFile() || metadata.isSymbolicLink()) {
        issues.push(`unsafe_file_type:${expected.path}`);
        continue;
      }
      const resolvedSourcePath = await realpath(sourcePath);
      const pathFromRoot = relative(sourceRoot, resolvedSourcePath);
      if (pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot) || resolvedSourcePath !== sourcePath) {
        issues.push(`symlinked_or_external_path:${expected.path}`);
        continue;
      }
      const bytes = await readFile(sourcePath);
      const actualHash = sha256(bytes);
      if (actualHash !== expected.sha256) issues.push(`hash_mismatch:${expected.path}`);
      actualFiles.push({ path: expected.path, sha256: actualHash });
    } catch (error) {
      issues.push(`${error?.code === "ENOENT" ? "missing_file" : "read_failed"}:${expected.path}`);
    }
  }

  if (issues.length === 0 && canonicalSelectionDigest(actualFiles) !== policy.selection.selectionSha256) {
    issues.push("actual_selection_digest_mismatch");
  }
  if (issues.length > 0) throw new SourceSelectionError(issues);
  return {
    fileCount: actualFiles.length,
    selectionSha256: policy.selection.selectionSha256
  };
}

async function gitText(sourceDirectory, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", sourceDirectory, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function gitBytes(sourceDirectory, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", sourceDirectory, ...args], {
    encoding: null,
    maxBuffer: 16 * 1024 * 1024
  });
  return Buffer.isBuffer(stdout) ? stdout : Buffer.from(stdout);
}

async function verifyCommittedFiles(policy, sourceRoot, submoduleRoots) {
  const issues = [];
  for (const expected of policy.selection.files) {
    const submodule = policy.source.submodules.find(({ path }) => expected.path.startsWith(`${path}/`));
    const repositoryRoot = submodule ? submoduleRoots.get(submodule.path) : sourceRoot;
    if (!repositoryRoot) {
      issues.push(`submodule_context_missing:${submodule.path}`);
      continue;
    }
    const commit = submodule ? submodule.commit : policy.source.commit;
    const repositoryPath = submodule ? expected.path.slice(submodule.path.length + 1) : expected.path;
    try {
      const treeEntry = await gitText(repositoryRoot, "ls-tree", commit, "--", repositoryPath);
      const match = /^(100644|100755) blob [0-9a-f]{40}\t(.+)$/.exec(treeEntry);
      if (!match || match[2] !== repositoryPath) {
        issues.push(`file_not_regular_blob_at_commit:${expected.path}`);
        continue;
      }
      const committedHash = sha256(await gitBytes(repositoryRoot, "show", `${commit}:${repositoryPath}`));
      if (committedHash !== expected.sha256) issues.push(`committed_blob_hash_mismatch:${expected.path}`);
    } catch {
      issues.push(`committed_blob_read_failed:${expected.path}`);
    }
  }
  if (issues.length > 0) throw new SourceSelectionError(issues);
}

export async function verifySourceSelection(policy, sourceDirectory, { verifiedAt = new Date().toISOString() } = {}) {
  validateSelectionPolicy(policy);
  const issues = [];
  const sourceRoot = await realpath(sourceDirectory);
  const observedSourceRoot = await realpath(await gitText(sourceRoot, "rev-parse", "--show-toplevel"));
  if (observedSourceRoot !== sourceRoot) issues.push("source_directory_not_repository_root");

  const sourceRepository = await gitText(sourceRoot, "remote", "get-url", "origin");
  if (sourceRepository !== policy.source.repository) issues.push("source_remote_mismatch");
  const sourceCommit = await gitText(sourceRoot, "rev-parse", "HEAD");
  if (sourceCommit !== policy.source.commit) issues.push("source_commit_mismatch");
  if (await gitText(sourceRoot, "status", "--porcelain", "--untracked-files=all")) issues.push("source_checkout_dirty");

  const submoduleRoots = new Map();
  const verifiedSubmodules = [];
  for (const submodule of policy.source.submodules) {
    const submodulePath = resolve(sourceRoot, submodule.path);
    let metadata;
    let observedSubmoduleRoot;
    try {
      metadata = await lstat(submodulePath);
      observedSubmoduleRoot = await realpath(submodulePath);
    } catch {
      issues.push(`submodule_path_unreadable:${submodule.path}`);
      continue;
    }
    const pathFromRoot = relative(sourceRoot, observedSubmoduleRoot);
    if (!metadata.isDirectory() || metadata.isSymbolicLink()
      || pathFromRoot.startsWith("..") || isAbsolute(pathFromRoot)
      || observedSubmoduleRoot !== submodulePath) {
      issues.push(`unsafe_submodule_path:${submodule.path}`);
      continue;
    }
    const gitRoot = await realpath(await gitText(observedSubmoduleRoot, "rev-parse", "--show-toplevel"));
    if (gitRoot !== observedSubmoduleRoot) issues.push(`submodule_directory_not_repository_root:${submodule.path}`);

    const repository = await gitText(observedSubmoduleRoot, "remote", "get-url", "origin");
    if (repository !== submodule.repository) issues.push(`submodule_remote_mismatch:${submodule.path}`);
    const commit = await gitText(observedSubmoduleRoot, "rev-parse", "HEAD");
    if (commit !== submodule.commit) issues.push(`submodule_commit_mismatch:${submodule.path}`);
    if (await gitText(observedSubmoduleRoot, "status", "--porcelain", "--untracked-files=all")) {
      issues.push(`submodule_checkout_dirty:${submodule.path}`);
    }
    const gitlink = await gitText(sourceRoot, "ls-tree", policy.source.commit, "--", submodule.path);
    if (gitlink !== `160000 commit ${submodule.commit}\t${submodule.path}`) {
      issues.push(`submodule_gitlink_mismatch:${submodule.path}`);
    }
    submoduleRoots.set(submodule.path, observedSubmoduleRoot);
    verifiedSubmodules.push({ path: submodule.path, repository, commit });
  }

  let selectedFiles;
  try {
    selectedFiles = await verifySelectedFiles(policy, sourceDirectory);
  } catch (error) {
    if (error instanceof SourceSelectionError) issues.push(...error.issues);
    else throw error;
  }

  try {
    await verifyCommittedFiles(policy, sourceRoot, submoduleRoots);
  } catch (error) {
    if (error instanceof SourceSelectionError) issues.push(...error.issues);
    else throw error;
  }

  if (issues.length > 0) throw new SourceSelectionError(issues);
  return {
    schemaVersion: 1,
    status: "verified-upstream-selection-runtime-blocked",
    verifiedAt,
    repository: sourceRepository,
    commit: sourceCommit,
    submodules: verifiedSubmodules,
    fileCount: selectedFiles.fileCount,
    selectionSha256: selectedFiles.selectionSha256,
    policySha256: policy.policySha256,
    generationAllowed: false,
    openGates: policy.openGates
  };
}

async function main() {
  const sourceDirectory = process.argv[2];
  if (!sourceDirectory) throw new Error("usage: node scripts/verify-trellis-source-selection.mjs <trellis-source-directory> [policy-path]");
  const policy = await loadSelectionPolicy(process.argv[3] ? resolve(process.argv[3]) : defaultPolicyPath);
  process.stdout.write(`${JSON.stringify(await verifySourceSelection(policy, resolve(sourceDirectory)), null, 2)}\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
