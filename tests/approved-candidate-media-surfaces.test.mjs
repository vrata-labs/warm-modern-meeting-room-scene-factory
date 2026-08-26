import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  compileApprovedCandidateMediaSurfaces,
  loadApprovedCandidateArchitectureSource,
  loadApprovedCandidateComponentSource,
  loadApprovedCandidateExteriorSource,
  loadApprovedCandidateMediaSurfaceSource,
  mediaSurfaceOutputFaultInjection,
  parseApprovedCandidateMediaSurfaceProjectionText,
  validateApprovedCandidateMediaSurfaceProjection,
  verifyApprovedCandidateMediaSurfacesReproducibility
} from "../compiler/compile-room-shell.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const candidateRepositoryPath = process.env.CANDIDATE_01_DIR ?? resolve(root, "../warm-modern-meeting-room-candidate-01");
const candidateCommit = "26d3af6e2720576113431c22b9443533b919f390";
const componentBaselineCommit = "8fec157a37bf619797f1ff200ccc32f611f94c18";
const projectionSha256 = "352b31af533049d7fe84f1ecb55643db85e7258ceff1e2d87be8f8785e38a4fb";

const canonicalHashes = {
  specificationSha256: "4dc23d561b3e32d0a8e1aa0c96f52a62ec57726f03e7b7b20c42c1c2a8eaf15b",
  assetLedgerSha256: "7ed139f492589c229d0c1473fb444bc03ec6ca8f4c113e665cfaef4a6d92479a",
  generationLedgerSha256: "42d49a3ad4f0f2a0b6f490461a30ed27a904396d51c34c9742862e02ba818930",
  componentConstructionSha256: "a28310aa7806fb05b8b08087a8b13de900498c3a12dbc6c3e0a5cc77ae7a3709",
  componentConstructionRawSha256: "f32327442d015f4c89942bf752e959d6c0abc24613c72f32a8ba4c2b2b29d5d1",
  mediaSurfaceConstructionSha256: "829c7ccba37c9bf73e570ad3769224895dbd2d2784fb0e9c776ad959bb6f9e8f",
  mediaSurfaceConstructionRawSha256: "0bdf11ca588d700c8a721d60cb503215c29ce021b48708302b8b9da45ec1036b"
};

test("Candidate 01 media-surface source reads exactly six locked Git blobs and both semantic reports", async () => {
  const source = await loadApprovedCandidateMediaSurfaceSource({ candidateRepositoryPath });
  assert.equal(source.inputKind, "approved-candidate-media-surfaces");
  assert.equal(source.candidateSource.commit, candidateCommit);
  assert.equal(source.candidateSource.treeOid, "f9974b153861112cd5b53bcbdc5d5530227edbe1");
  assert.equal(source.candidateSource.validatorCommit, "c3157b65c739bf784d5b8654e0808a3c3a84f611");
  assert.deepEqual(source.canonicalHashes, canonicalHashes);
  assert.deepEqual(source.acceptedInputSha256, [
    "978d0c7d75dd73d9c4d4419daa2f1530b0fdfac26c0eee1bcd7ef4e76501272a",
    canonicalHashes.componentConstructionRawSha256,
    canonicalHashes.mediaSurfaceConstructionRawSha256
  ]);
  assert.deepEqual(Object.keys(source.candidateSource.inputBlobs).sort(), [
    "provenance/asset-ledger.json",
    "provenance/generation-ledger.json",
    "source/component-constructions.json",
    "source/concept-selection.json",
    "source/media-surface-constructions.json",
    "source/scene-spec.json"
  ]);
  assert.deepEqual(source.candidateSource.inputBlobs["source/media-surface-constructions.json"], {
    gitBlobOid: "87faedb5845ad1eed5cda3b1fac8a0f15cea5365",
    rawSha256: canonicalHashes.mediaSurfaceConstructionRawSha256,
    byteLength: 847
  });
  assert.equal(source.semanticReports.component.status, "stage3-component-construction-contract-valid");
  assert.equal(source.semanticReports.mediaSurfaces.status, "stage3-media-surface-construction-contract-valid");
  assert.equal(source.semanticReports.component.assetRecordCount, 3);
  assert.equal(source.semanticReports.component.partCount, 38);
  assert.equal(source.semanticReports.mediaSurfaces.surfaceCount, 2);
  assert.deepEqual(source.mediaSurfaceProjectionEvidence, {
    sha256: projectionSha256,
    byteLength: 1022,
    mediaSurfaceCount: 2,
    representation: "platform-runtime-plane",
    byteIdentical: true
  });
  assert.ok(Object.values(source.boundaries).every((value) => value === false));
});

test("F1, F2, and F3 evidence remains bound to historical baselines, never the current F4 commit", async () => {
  const [architecture, components, exterior] = await Promise.all([
    loadApprovedCandidateArchitectureSource({ candidateRepositoryPath }),
    loadApprovedCandidateComponentSource({ candidateRepositoryPath }),
    loadApprovedCandidateExteriorSource({ candidateRepositoryPath })
  ]);
  assert.equal(architecture.candidateSource.commit, "df564befcd65cb51a345fa9d315e40cadef6e563");
  assert.equal(architecture.architectureBaseline.sha256, "ae24faad5306191667195c0157db9cd5c6d800875492cdf242fe32d1ff962b33");
  assert.equal(components.candidateSource.commit, componentBaselineCommit);
  assert.equal(components.candidateSource.treeOid, "2b0b3ecf36f80cad2301e325e821fd1bf48d3606");
  assert.equal(components.componentGlbEvidence.sha256, "a6e67219590ae4bbc1e887f97f9a7c071c924943223a90ef3560bdd7b06e5c69");
  assert.equal(components.componentGlbEvidence.reopenInspectionSha256, "5a1014f9fad8f12929d43d7fae0fd8155274754dc514db6590151bbbcda5e810");
  assert.equal(components.componentGlbEvidence.architectureSemanticSha256, architecture.architectureBaseline.sha256);
  assert.notEqual(components.candidateSource.commit, candidateCommit);
  assert.equal(exterior.candidateSource.commit, "380098d4b7cbc1d57498b059466f095ae3568929");
  assert.notEqual(exterior.candidateSource.commit, candidateCommit);
});

test("media-surface loader rejects wrong commits and ignores worktree, replacement, and ambient Git drift", async () => {
  await assert.rejects(loadApprovedCandidateMediaSurfaceSource({
    candidateRepositoryPath,
    candidateCommit: componentBaselineCommit
  }), /approved_candidate_media_surface_commit_not_locked/);

  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-source-"));
  const ambientNames = ["GIT_DIR", "GIT_WORK_TREE", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES"];
  const ambient = Object.fromEntries(ambientNames.map((name) => [name, process.env[name]]));
  try {
    const clonePath = resolve(temporaryRoot, "candidate-01");
    await execFileAsync("git", ["clone", "--local", "--no-checkout", candidateRepositoryPath, clonePath]);
    await execFileAsync("git", ["-C", clonePath, "replace", candidateCommit, componentBaselineCommit]);
    await mkdir(resolve(clonePath, "source"), { recursive: true });
    const { stdout: baselineScene } = await execFileAsync("git", ["-C", candidateRepositoryPath, "cat-file", "blob", `${componentBaselineCommit}:source/scene-spec.json`]);
    await writeFile(resolve(clonePath, "source/scene-spec.json"), baselineScene);
    process.env.GIT_DIR = resolve(temporaryRoot, "hostile.git");
    process.env.GIT_WORK_TREE = temporaryRoot;
    process.env.GIT_OBJECT_DIRECTORY = resolve(temporaryRoot, "objects");
    process.env.GIT_ALTERNATE_OBJECT_DIRECTORIES = resolve(temporaryRoot, "alternates");
    const source = await loadApprovedCandidateMediaSurfaceSource({ candidateRepositoryPath: clonePath });
    assert.equal(source.candidateSource.commit, candidateCommit);
    assert.equal(source.canonicalHashes.specificationSha256, canonicalHashes.specificationSha256);
    assert.equal(source.scene.mediaSurfaces[0].surfaceId, "debug-main");
  } finally {
    for (const name of ambientNames) {
      if (ambient[name] === undefined) delete process.env[name];
      else process.env[name] = ambient[name];
    }
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("compile projects physical and runtime ownership into canonical visual-only manifest bytes", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-compile-"));
  try {
    const manifestPath = resolve(temporaryRoot, "media-surfaces.json");
    const reportPath = resolve(temporaryRoot, "compile-report.json");
    const report = await compileApprovedCandidateMediaSurfaces({ candidateRepositoryPath, outputManifestPath: manifestPath, reportPath });
    const text = await readFile(manifestPath, "utf8");
    const projection = JSON.parse(text);
    assert.equal(text, `${JSON.stringify(projection, null, 2)}\n`);
    assert.deepEqual(projection, {
      schemaVersion: 1,
      sceneId: "warm-modern-meeting-room-candidate-01",
      mediaSurfaces: [
        {
          surfaceId: "debug-main",
          representation: "platform-runtime-plane",
          position: { x: -3.4, y: 1.55, z: 0.15 },
          yaw: Math.PI / 2,
          widthM: 3.2,
          heightM: 1.8,
          pixelDimensions: { width: 1920, height: 1080 },
          frontFace: "local-positive-z",
          input: { enabled: true, maxDistanceM: 0.05 }
        },
        {
          surfaceId: "whiteboard-wall",
          representation: "platform-runtime-plane",
          position: { x: 3.4, y: 1.5, z: 0.5 },
          yaw: -Math.PI / 2,
          widthM: 2.4,
          heightM: 1.25,
          pixelDimensions: { width: 1920, height: 1000 },
          frontFace: "local-positive-z",
          input: { enabled: true, maxDistanceM: 0.05 }
        }
      ]
    });
    assert.ok(projection.mediaSurfaces.every((surface) => !Object.hasOwn(surface, "purpose")));
    assert.deepEqual(report.projection, { sha256: projectionSha256, byteLength: 1022, mediaSurfaceCount: 2 });
    assert.equal(report.byteIdentical, false);
    assert.equal(report.mediaSurfacesCompiled, true);
    assert.equal(report.boundaries.byteIdentical, false);
    assert.equal(report.exteriorCompiled, false);
    assert.equal(report.lightingCompiled, false);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.releaseArtifactsCreated, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.artifactBytesIncludedInRepository, false);
    assert.equal(Object.keys(report.candidateSource.inputBlobs).length, 6);
    assert.ok(Object.values(report.compilerSourceSha256).every((digest) => /^[0-9a-f]{64}$/.test(digest)));
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("projection validation rejects malformed, mixed-ownership, duplicate-key, and noncanonical artifacts", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-invalid-"));
  try {
    const source = await loadApprovedCandidateMediaSurfaceSource({ candidateRepositoryPath });
    const manifestPath = resolve(temporaryRoot, "media-surfaces.json");
    await compileApprovedCandidateMediaSurfaces({
      candidateRepositoryPath,
      outputManifestPath: manifestPath,
      reportPath: resolve(temporaryRoot, "report.json")
    });
    const text = await readFile(manifestPath, "utf8");
    const projection = parseApprovedCandidateMediaSurfaceProjectionText(text, source);
    for (const mutate of [
      (value) => { value.mediaSurfaces[0].purpose = "presentation-display"; },
      (value) => { value.mediaSurfaces[0].position.x = value.mediaSurfaces[1].position.x; },
      (value) => { value.mediaSurfaces[0].pixelDimensions.width = 1; },
      (value) => { value.mediaSurfaces.reverse(); }
    ]) {
      const malformed = structuredClone(projection);
      mutate(malformed);
      assert.throws(() => validateApprovedCandidateMediaSurfaceProjection(malformed, source), /approved_candidate_media_surface_projection_invalid/);
    }
    assert.throws(() => parseApprovedCandidateMediaSurfaceProjectionText(text.slice(0, -1), source), /encoding_noncanonical/);
    assert.throws(() => parseApprovedCandidateMediaSurfaceProjectionText(
      text.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,'),
      source
    ), /approved_candidate_media_surface_projection_duplicate_key/);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("two media-surface projection runs require byte-identical manifest bytes", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-repro-"));
  try {
    const reportPath = resolve(temporaryRoot, "reproducibility.json");
    const report = await verifyApprovedCandidateMediaSurfacesReproducibility({
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath
    });
    assert.equal(report.status, "stage3-approved-candidate-media-surfaces-byte-identical");
    assert.equal(report.byteIdentical, true);
    assert.deepEqual(report.comparison, {
      byteIdentical: true,
      projectionSha256,
      projectionByteLength: 1022,
      mediaSurfaceCount: 2
    });
    assert.equal(report.boundaries.byteIdentical, true);
    assert.equal(report.finalCandidateGlbVerified, false);
    assert.equal(report.releaseArtifactsCreated, false);
    assert.equal(report.publicationReady, false);
    assert.equal(report.artifactBytesIncludedInRepository, false);
    assert.deepEqual(
      await readFile(resolve(temporaryRoot, "run-01.media-surfaces.json")),
      await readFile(resolve(temporaryRoot, "run-02.media-surfaces.json"))
    );
    assert.deepEqual(JSON.parse(await readFile(reportPath, "utf8")), report);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("media-surface compile and reproducibility preflight conflicts and remove partial outputs", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-conflict-"));
  try {
    const samePath = resolve(temporaryRoot, "same.json");
    await assert.rejects(compileApprovedCandidateMediaSurfaces({
      candidateRepositoryPath,
      outputManifestPath: samePath,
      reportPath: samePath
    }), /media_surface_manifest_output_paths_conflict/);
    assert.deepEqual(await readdir(temporaryRoot), []);

    await assert.rejects(verifyApprovedCandidateMediaSurfacesReproducibility({
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath: resolve(temporaryRoot, "run-01.report.json")
    }), /media_surface_reproducibility_output_paths_conflict/);
    assert.deepEqual(await readdir(temporaryRoot), []);

    const occupiedPath = resolve(temporaryRoot, "occupied.json");
    await writeFile(occupiedPath, "pre-existing\n");
    await assert.rejects(compileApprovedCandidateMediaSurfaces({
      candidateRepositoryPath,
      outputManifestPath: occupiedPath,
      reportPath: resolve(temporaryRoot, "unused-report.json")
    }), /media_surface_manifest_output_exists/);
    assert.equal(await readFile(occupiedPath, "utf8"), "pre-existing\n");
    assert.deepEqual((await readdir(temporaryRoot)).sort(), ["occupied.json"]);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("F3 outputs reject Scene Factory and trusted Candidate roots and nested paths", async () => {
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-roots-"));
  const forbiddenPaths = [
    resolve(root, "review-f3-manifest.json"),
    resolve(root, "tests/review-f3-manifest.json"),
    resolve(candidateRepositoryPath, "review-f3-manifest.json"),
    resolve(candidateRepositoryPath, "source/review-f3-manifest.json")
  ];
  try {
    for (const outputManifestPath of forbiddenPaths) {
      await assert.rejects(compileApprovedCandidateMediaSurfaces({
        candidateRepositoryPath,
        outputManifestPath,
        reportPath: resolve(temporaryRoot, `report-${forbiddenPaths.indexOf(outputManifestPath)}.json`)
      }), /media_surface_manifest_output_invalid/);
      assert.equal(await lstat(outputManifestPath).catch(() => null), null);
    }
    for (const reportPath of [
      resolve(root, "review-f3-report.json"),
      resolve(candidateRepositoryPath, "review-f3-report.json"),
      resolve(candidateRepositoryPath, "source/review-f3-report.json")
    ]) {
      await assert.rejects(compileApprovedCandidateMediaSurfaces({
        candidateRepositoryPath,
        outputManifestPath: resolve(temporaryRoot, `manifest-${reportPath.length}.json`),
        reportPath
      }), /media_surface_manifest_report_invalid/);
      assert.equal(await lstat(reportPath).catch(() => null), null);
    }
    for (const outputDirectory of [root, resolve(root, "tests"), candidateRepositoryPath, resolve(candidateRepositoryPath, "source")]) {
      await assert.rejects(verifyApprovedCandidateMediaSurfacesReproducibility({
        candidateRepositoryPath,
        outputDirectory,
        reportPath: resolve(temporaryRoot, `repro-${outputDirectory.length}.json`)
      }), /media_surface_reproducibility_output_directory_invalid/);
    }
    await assert.rejects(verifyApprovedCandidateMediaSurfacesReproducibility({
      candidateRepositoryPath,
      outputDirectory: temporaryRoot,
      reportPath: resolve(candidateRepositoryPath, "review-f3-repro-report.json")
    }), /media_surface_reproducibility_report_invalid/);
    assert.equal(await lstat(resolve(candidateRepositoryPath, "review-f3-repro-report.json")).catch(() => null), null);
    assert.deepEqual(await readdir(temporaryRoot), []);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("atomic compile publication removes partial temps and invocation-owned finals after injected failures", async (t) => {
  for (const [artifact, phase] of [
    ["manifest", "after-partial-write"],
    ["manifest", "after-write"],
    ["manifest", "before-link"],
    ["manifest", "after-link"],
    ["compile-report", "after-partial-write"],
    ["compile-report", "before-link"],
    ["compile-report", "after-link"]
  ]) await t.test(`${artifact} ${phase}`, async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-atomic-"));
    try {
      await assert.rejects(compileApprovedCandidateMediaSurfaces({
        candidateRepositoryPath,
        outputManifestPath: resolve(temporaryRoot, "manifest.json"),
        reportPath: resolve(temporaryRoot, "report.json"),
        [mediaSurfaceOutputFaultInjection]: { artifact, phase }
      }), /fault/);
      assert.deepEqual(await readdir(temporaryRoot), []);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});

test("atomic reproducibility publication removes run outputs, partial temps, and final report on failure", async (t) => {
  for (const phase of ["after-partial-write", "before-link", "after-link"]) await t.test(phase, async () => {
    const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-media-repro-atomic-"));
    try {
      await assert.rejects(verifyApprovedCandidateMediaSurfacesReproducibility({
        candidateRepositoryPath,
        outputDirectory: temporaryRoot,
        reportPath: resolve(temporaryRoot, "reproducibility.json"),
        [mediaSurfaceOutputFaultInjection]: { artifact: "reproducibility-report", phase }
      }), /fault/);
      assert.deepEqual(await readdir(temporaryRoot), []);
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });
});
