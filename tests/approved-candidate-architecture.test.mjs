import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  compileApprovedCandidateArchitecture,
  loadApprovedCandidateArchitectureSource,
  verifyApprovedCandidateArchitectureReproducibility
} from "../compiler/compile-room-shell.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const candidateRepositoryPath = process.env.CANDIDATE_01_DIR ?? resolve(root, "../warm-modern-meeting-room-candidate-01");
const candidateCommit = "df564befcd65cb51a345fa9d315e40cadef6e563";
const candidateSpecificationSha256 = "29d76ca0feaefd4bf9cac9ebd25113c601e358c939778c4a0f43f3f94b58e0dd";
const candidateSceneRawSha256 = "875619d8513467417bbc89d50cd11b07fc363e8c4fbaeb8161394c8f2e885b76";
const conceptSelectionSha256 = "978d0c7d75dd73d9c4d4419daa2f1530b0fdfac26c0eee1bcd7ef4e76501272a";
const adapter = resolve(root, "compiler/blender-room-shell.py");
const python = process.env.PYTHON ?? "python3";

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("Candidate 01 source is loaded only from the four locked Git blobs", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-candidate-source-"));
  try {
    const clonePath = resolve(temporaryRoot, "candidate-01");
    await execFileAsync("git", ["clone", "--local", "--no-checkout", candidateRepositoryPath, clonePath]);
    await mkdir(resolve(clonePath, "source"), { recursive: true });
    await writeFile(resolve(clonePath, "source/scene-spec.json"), "{}\n");

    const source = await loadApprovedCandidateArchitectureSource({ candidateRepositoryPath: clonePath });
    assert.equal(source.candidateSource.repository, "vrata-labs/warm-modern-meeting-room-candidate-01");
    assert.equal(source.candidateSource.commit, candidateCommit);
    assert.equal(source.candidateSource.validatorCommit, "fa9767913fc3cc2b1d06fc00c44ed6a26369b219");
    assert.deepEqual(source.canonicalHashes, {
      specificationSha256: candidateSpecificationSha256,
      assetLedgerSha256: "389335100442f2f6806d84be7074cb7a7c60022b588b6a7b4df9a05778dec80d",
      generationLedgerSha256: "42d49a3ad4f0f2a0b6f490461a30ed27a904396d51c34c9742862e02ba818930"
    });
    assert.equal(source.rawSceneSha256, candidateSceneRawSha256);
    assert.deepEqual(source.acceptedInputSha256, [conceptSelectionSha256]);
    assert.deepEqual(Object.keys(source.candidateSource.inputBlobs).sort(), [
      "provenance/asset-ledger.json",
      "provenance/generation-ledger.json",
      "source/concept-selection.json",
      "source/scene-spec.json"
    ]);
    assert.equal(source.candidateSource.inputBlobs["source/concept-selection.json"].rawSha256, conceptSelectionSha256);
    assert.equal(source.candidateSource.inputBlobs["source/scene-spec.json"].gitBlobOid, "bc8f5ccfcd9433ddbfea4949b0cd8a805e020690");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Candidate 01 loader rejects a wrong override and a repository missing the locked commit", async () => {
  await assert.rejects(loadApprovedCandidateArchitectureSource({
    candidateRepositoryPath,
    candidateCommit: "0000000000000000000000000000000000000000"
  }), /approved_candidate_commit_not_locked/);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-candidate-missing-"));
  try {
    await execFileAsync("git", ["init", temporaryRoot]);
    await assert.rejects(loadApprovedCandidateArchitectureSource({ candidateRepositoryPath: temporaryRoot }), /approved_candidate_commit_missing/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Candidate 01 loader ignores ambient GIT_DIR and GIT_WORK_TREE redirects", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-candidate-git-env-"));
  const previousGitDir = process.env.GIT_DIR;
  const previousGitWorkTree = process.env.GIT_WORK_TREE;
  try {
    const { stdout } = await execFileAsync("git", ["-C", candidateRepositoryPath, "rev-parse", "--absolute-git-dir"], { encoding: "utf8" });
    process.env.GIT_DIR = stdout.trim();
    process.env.GIT_WORK_TREE = temporaryRoot;
    await assert.rejects(
      loadApprovedCandidateArchitectureSource({ candidateRepositoryPath: temporaryRoot }),
      /approved_candidate_commit_missing/
    );
  } finally {
    if (previousGitDir === undefined) delete process.env.GIT_DIR;
    else process.env.GIT_DIR = previousGitDir;
    if (previousGitWorkTree === undefined) delete process.env.GIT_WORK_TREE;
    else process.env.GIT_WORK_TREE = previousGitWorkTree;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Candidate architecture plan accepts exact staged bytes and rejects mixed bytes", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-candidate-plan-"));
  try {
    const source = await loadApprovedCandidateArchitectureSource({ candidateRepositoryPath });
    const scenePath = resolve(temporaryRoot, "scene-spec.json");
    const reportPath = resolve(temporaryRoot, "plan.json");
    await writeFile(scenePath, source.sceneBytes);
    await execFileAsync(python, [
      adapter,
      "--input-kind",
      "approved-candidate-architecture",
      "--scene-spec",
      scenePath,
      "--expected-raw-sha256",
      candidateSceneRawSha256,
      "--expected-specification-sha256",
      candidateSpecificationSha256,
      "--report",
      reportPath,
      "--plan-only"
    ]);
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(report.status, "stage3-approved-candidate-architecture-plan-valid");
    assert.equal(report.fixtureOnly, false);
    assert.equal(report.approvedCandidateSpecification, true);
    assert.equal(report.candidateArchitectureCompiled, false);
    assert.equal(report.componentsCompiled, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.materials.assignmentCount, 19);

    const mixedPath = resolve(temporaryRoot, "mixed-scene-spec.json");
    await writeFile(mixedPath, Buffer.concat([source.sceneBytes, Buffer.from(" ")]));
    await assert.rejects(execFileAsync(python, [
      adapter,
      "--input-kind",
      "approved-candidate-architecture",
      "--scene-spec",
      mixedPath,
      "--expected-raw-sha256",
      candidateSceneRawSha256,
      "--expected-specification-sha256",
      candidateSpecificationSha256,
      "--report",
      resolve(temporaryRoot, "mixed-report.json"),
      "--plan-only"
    ]), /approved_candidate_scene_raw_sha256_mismatch/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("exact Blender compiles, reopens, and persists Candidate 01 architecture only", { skip: !process.env.BLENDER_BIN }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-candidate-compile-"));
  try {
    const reportPath = resolve(temporaryRoot, "candidate-architecture.json");
    const report = await compileApprovedCandidateArchitecture({
      blenderPath: process.env.BLENDER_BIN,
      candidateRepositoryPath,
      outputBlendPath: resolve(temporaryRoot, "candidate-architecture.blend"),
      outputGlbPath: resolve(temporaryRoot, "candidate-architecture.glb"),
      reportPath
    });
    assert.equal(report.status, "stage3-approved-candidate-architecture-compiled");
    assert.equal(report.fixtureOnly, false);
    assert.equal(report.approvedCandidateSpecification, true);
    assert.equal(report.candidateArchitectureCompiled, true);
    assert.equal(report.componentsCompiled, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.inventory.meshCount, 19);
    assert.equal(report.inventory.materialCount, 3);
    assert.equal(report.inventory.lightCount, 0);
    assert.equal(report.glbInspection.status, "architecture-only-glb-inspection-valid");
    assert.equal(report.glbInspection.nodeCount, 19);
    assert.equal(report.glbInspection.meshCount, 19);
    assert.equal(report.glbInspection.materialCount, 3);
    assert.equal(report.glbInspection.reachableNodeCount, 19);
    assert.equal(report.glbInspection.uniqueMeshBindingCount, 19);
    assert.equal(report.glbInspection.primitiveCount, 19);
    assert.equal(report.glbInspection.binaryByteLength, 17376);
    assert.equal(report.glbInspection.decodedVertexCount, 528);
    assert.equal(report.glbInspection.decodedIndexCount, 852);
    assert.equal(report.glbInspection.decodedTriangleCount, 284);
    assert.equal(report.glbInspection.geometryEvidence.length, 19);
    assert.equal(report.glbInspection.extensionCount, 0);
    assert.deepEqual(report.glbInspection.materialNames, ["material.graphite-metal", "material.mineral-plaster", "material.warm-oak"]);
    assert.equal(report.reopenInspection.status, "stage3-approved-candidate-architecture-inspection-valid");
    assert.equal(report.reopenInspection.inventory.objectCount, 19);
    assert.equal(report.reopenInspection.inventory.meshCount, 19);
    assert.equal(report.reopenInspection.inventory.materialCount, 3);
    assert.equal(report.reopenInspectionSha256, sha256(stableJson(report.reopenInspection)));
    assert.equal(report.candidateSource.inputBlobs["source/scene-spec.json"].rawSha256, candidateSceneRawSha256);
    assert.ok(Object.values(report.compilerSourceSha256).every((digest) => /^[0-9a-f]{64}$/.test(digest)));
    assert.equal(report.boundaries.byteIdenticalExportsVerified, false);
    assert.equal(report.boundaries.finalCandidateGlbVerified, false);
    assert.equal(report.boundaries.publicationReady, false);
    assert.equal(Object.hasOwn(report, "components"), false);
    assert.equal(Object.hasOwn(report, "exterior"), false);
    assert.equal(Object.hasOwn(report, "lighting"), false);
    assert.equal(Object.hasOwn(report, "mediaSurfaces"), false);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("two exact-Blender Candidate 01 architecture exports are byte-identical without final or release claims", { skip: !process.env.BLENDER_BIN }, async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-candidate-repro-"));
  try {
    const reportPath = resolve(temporaryRoot, "reproducibility.json");
    const report = await verifyApprovedCandidateArchitectureReproducibility({
      blenderPath: process.env.BLENDER_BIN,
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath
    });
    assert.equal(report.status, "stage3-approved-candidate-architecture-glb-byte-identical");
    assert.equal(report.comparison.glbByteIdentical, true);
    assert.equal(report.comparison.reopenInspectionIdentical, true);
    assert.equal(report.runs[0].glb.sha256, report.runs[1].glb.sha256);
    assert.equal(report.runs[0].glb.byteLength, report.runs[1].glb.byteLength);
    assert.equal(report.boundaries.candidateArchitectureGlbByteIdentical, true);
    assert.equal(report.boundaries.componentsCompiled, false);
    assert.equal(report.boundaries.finalCandidateGlbVerified, false);
    assert.equal(report.boundaries.publicationReady, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.publicationReady, false);
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
    for (const [index, run] of report.runs.entries()) {
      const runReport = JSON.parse(await readFile(resolve(temporaryRoot, `run-0${index + 1}.json`), "utf8"));
      assert.equal(runReport.candidateSource.commit, candidateCommit);
      assert.deepEqual(runReport.canonicalHashes, report.canonicalHashes);
      assert.deepEqual(runReport.glbInspection, run.inventory);
      assert.equal(runReport.reopenInspectionSha256, sha256(stableJson(runReport.reopenInspection)));
      assert.deepEqual(run.reopenInspection, {
        status: runReport.reopenInspection.status,
        inventory: runReport.reopenInspection.inventory,
        sha256: runReport.reopenInspectionSha256
      });
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("Candidate reproducibility preflight keeps external output clean on path conflict", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-candidate-conflict-"));
  try {
    await assert.rejects(verifyApprovedCandidateArchitectureReproducibility({
      blenderPath: process.env.BLENDER_BIN ?? "/missing/blender",
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath: resolve(temporaryRoot, "run-02.json")
    }), /room_reproducibility_output_paths_conflict/);
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
