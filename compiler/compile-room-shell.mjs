import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { parseSceneContract } from "./scene-contract.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "..");
const adapterPath = resolve(import.meta.dirname, "blender-room-shell.py");
const fixturePaths = Object.freeze({
  scene: resolve(repositoryRoot, "tests/fixtures/stage3/scene-spec.valid.json"),
  assetLedger: resolve(repositoryRoot, "tests/fixtures/stage3/asset-ledger.valid.json"),
  generationLedger: resolve(repositoryRoot, "tests/fixtures/stage3/generation-ledger.valid.json")
});
const expectedBlenderBinarySha256 = "33ac108ebce3c271f5357e5c664d0488717263bcf2145c80300edd0b12c31880";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function inside(parent, child) {
  const path = relative(parent, child);
  return path === "" || (!path.startsWith("..") && !path.startsWith("/"));
}

async function exactRegularFile(path, label) {
  const resolved = resolve(path);
  const metadata = await lstat(resolved).catch(() => null);
  if (!metadata?.isFile() || metadata.isSymbolicLink() || await realpath(resolved) !== resolved) throw new Error(`${label}_invalid`);
  return resolved;
}

async function newExternalOutput(path, extension, label) {
  const resolved = resolve(path);
  if (inside(repositoryRoot, resolved) || extname(resolved) !== extension) throw new Error(`${label}_invalid`);
  const parent = resolve(dirname(resolved));
  const parentMetadata = await lstat(parent).catch(() => null);
  if (!parentMetadata?.isDirectory() || parentMetadata.isSymbolicLink() || await realpath(parent) !== parent) throw new Error(`${label}_parent_invalid`);
  if (await lstat(resolved).catch(() => null) !== null) throw new Error(`${label}_exists`);
  return resolved;
}

async function externalDirectory(path, label) {
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
  return readFile(resolved, "utf8");
}

function verifyCompilerReport(report, contract, binarySha256) {
  const wall = report.shell?.objects?.find(({ name }) => name === "shell.walls");
  if (report?.status !== "stage3-synthetic-room-profiles-materials-compiled"
    || report.fixtureOnly !== true
    || report.sceneId !== contract.sceneId
    || report.specificationSha256 !== contract.specificationSha256
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
    || report.materials?.recipeCount !== 3
    || report.materials?.zoneCount !== 22
    || report.materials?.assignmentCount !== 19
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
    || report.inventory?.objectCount !== 19
    || report.inventory?.meshCount !== 19
    || report.inventory?.materialCount !== 3
    || report.inventory?.imageCount !== 0
    || report.inventory?.textureCount !== 0
    || report.boundaries?.approvedCandidateSpecification !== false
    || report.boundaries?.byteIdenticalExportsVerified !== false
    || report.boundaries?.openingsCompiled !== true
    || report.boundaries?.materialsCompiled !== true
    || report.boundaries?.componentsCompiled !== false
    || report.boundaries?.profilesCompiled !== true
    || report.boundaries?.sceneBinaryAddedToRepository !== false) {
    throw new Error("room_shell_report_invalid");
  }
}

export function inspectGlb(bytes) {
  if (bytes.length < 20 || bytes.toString("ascii", 0, 4) !== "glTF" || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length) {
    throw new Error("room_glb_header_invalid");
  }
  let offset = 12;
  let document;
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
    else if (type === 0x004e4942) binaryChunkCount += 1;
    else throw new Error("room_glb_chunk_invalid");
    offset += length;
  }
  if (offset !== bytes.length || document?.asset?.version !== "2.0" || binaryChunkCount !== 1
    || chunkTypes.length !== 2 || chunkTypes[0] !== 0x4e4f534a || chunkTypes[1] !== 0x004e4942) throw new Error("room_glb_document_invalid");
  const names = document.nodes?.map(({ name }) => name).sort();
  if (document.nodes?.length !== 19 || document.meshes?.length !== 19 || document.materials?.length !== 3
    || (document.cameras?.length ?? 0) !== 0 || (document.images?.length ?? 0) !== 0 || (document.textures?.length ?? 0) !== 0
    || names?.[0] !== "opening.main-door.frame.head" || names?.at(-1) !== "shell.walls") throw new Error("room_glb_inventory_invalid");
  return Object.freeze({
    nodeCount: document.nodes.length,
    meshCount: document.meshes.length,
    materialCount: document.materials.length,
    cameraCount: document.cameras?.length ?? 0,
    imageCount: document.images?.length ?? 0,
    textureCount: document.textures?.length ?? 0,
    binaryChunkCount
  });
}

export async function compileSyntheticRoomShell(options) {
  if (!options || typeof options !== "object") throw new Error("room_shell_options_invalid");
  const blenderPath = await exactRegularFile(options.blenderPath, "room_shell_blender");
  const blenderBytes = await readFile(blenderPath);
  const binarySha256 = sha256(blenderBytes);
  if (binarySha256 !== expectedBlenderBinarySha256) throw new Error("room_shell_blender_sha256_invalid");
  const outputBlendPath = await newExternalOutput(options.outputBlendPath, ".blend", "room_shell_output");
  const outputGlbPath = await newExternalOutput(options.outputGlbPath, ".glb", "room_glb_output");
  const reportPath = await newExternalOutput(options.reportPath, ".json", "room_shell_report");
  if (new Set([outputBlendPath, outputGlbPath, reportPath]).size !== 3) throw new Error("room_shell_output_paths_conflict");

  const [sceneText, assetLedgerText, generationLedgerText] = await Promise.all([
    readFixture(options.scenePath, fixturePaths.scene, "room_shell_scene"),
    readFixture(options.assetLedgerPath, fixturePaths.assetLedger, "room_shell_asset_ledger"),
    readFixture(options.generationLedgerPath, fixturePaths.generationLedger, "room_shell_generation_ledger")
  ]);
  const contract = parseSceneContract({ sceneText, assetLedgerText, generationLedgerText });
  const scene = JSON.parse(sceneText);
  const temporaryRoot = await mkdtemp(resolve(tmpdir(), "wmmr-room-shell-"));
  const temporaryScenePath = resolve(temporaryRoot, "scene-spec.json");
  const sceneBytes = Buffer.from(sceneText, "utf8");
  await writeFile(temporaryScenePath, sceneBytes, { flag: "wx", mode: 0o600 });

  try {
    await execFileAsync(blenderPath, [
      "--background",
      "--factory-startup",
      "--python",
      adapterPath,
      "--",
      "--scene-spec",
      temporaryScenePath,
      "--expected-specification-sha256",
      contract.specificationSha256,
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
      timeout: 120_000
    });
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    verifyCompilerReport(report, contract, binarySha256);
    const outputBytes = await readFile(outputBlendPath);
    if (report.outputBlend?.byteLength !== outputBytes.length || report.outputBlend?.sha256 !== sha256(outputBytes)) throw new Error("room_shell_output_digest_mismatch");
    const glbBytes = await readFile(outputGlbPath);
    const glbInspection = inspectGlb(glbBytes);
    if (report.outputGlb?.byteLength !== glbBytes.length || report.outputGlb?.sha256 !== sha256(glbBytes)) throw new Error("room_glb_output_digest_mismatch");
    const inspectionPath = resolve(temporaryRoot, "inspection.json");
    await execFileAsync(blenderPath, [
      "--background",
      outputBlendPath,
      "--python",
      adapterPath,
      "--",
      "--expected-specification-sha256",
      contract.specificationSha256,
      "--report",
      inspectionPath,
      "--inspect-only"
    ], {
      cwd: temporaryRoot,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000
    });
    const inspection = JSON.parse(await readFile(inspectionPath, "utf8"));
    if (inspection.status !== "stage3-synthetic-room-profiles-materials-inspection-valid"
      || inspection.specificationSha256 !== contract.specificationSha256
      || inspection.inventory?.objectCount !== report.inventory.objectCount
      || inspection.inventory?.meshCount !== report.inventory.meshCount
      || inspection.inventory?.materialCount !== report.inventory.materialCount
      || inspection.inventory?.imageCount !== 0
      || inspection.inventory?.textureCount !== 0
      || inspection.inventory?.cameraCount !== 0
      || inspection.inventory?.lightCount !== 0
      || inspection.inventory?.vertexCount !== report.inventory.vertexCount
      || inspection.inventory?.faceCount !== report.inventory.faceCount) throw new Error("room_shell_saved_inspection_invalid");
    return Object.freeze({
      ...report,
      assetLedgerSha256: contract.assetLedgerSha256,
      generationLedgerSha256: contract.generationLedgerSha256,
      acceptedInputSha256: Object.freeze([...scene.generator.acceptedInputSha256]),
      glbInspection
    });
  } catch (error) {
    await Promise.all([rm(outputBlendPath, { force: true }), rm(outputGlbPath, { force: true }), rm(reportPath, { force: true })]);
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

export async function verifySyntheticRoomReproducibility(options) {
  if (!options || typeof options !== "object") throw new Error("room_reproducibility_options_invalid");
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
  const common = {
    blenderPath: options.blenderPath,
    scenePath: options.scenePath,
    assetLedgerPath: options.assetLedgerPath,
    generationLedgerPath: options.generationLedgerPath
  };
  try {
    const runs = [];
    for (const number of [1, 2]) {
      const prefix = `run-${String(number).padStart(2, "0")}`;
      runs.push(await compileSyntheticRoomShell({
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
    const report = {
    schemaVersion: 1,
    status: "stage3-synthetic-room-glb-byte-identical",
    fixtureOnly: true,
    specificationSha256: runs[0].specificationSha256,
    assetLedgerSha256: runs[0].assetLedgerSha256,
    generationLedgerSha256: runs[0].generationLedgerSha256,
    acceptedInputSha256: runs[0].acceptedInputSha256,
    blender: runs[0].blender,
    exporter: runs[0].outputGlb.exportSettings,
    runs: runs.map((run, index) => ({
      run: index + 1,
      blend: run.outputBlend,
      glb: run.outputGlb,
      inventory: run.glbInspection
    })),
    comparison: {
      glbByteIdentical: true,
      glbSha256: runs[0].outputGlb.sha256,
      glbByteLength: runs[0].outputGlb.byteLength,
      blendByteIdentical: runs[0].outputBlend.sha256 === runs[1].outputBlend.sha256
    },
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

function parseCli(arguments_) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const flag = arguments_[index];
    const value = arguments_[index + 1];
    if (!flag?.startsWith("--") || value === undefined || values[flag] !== undefined) throw new Error("room_shell_cli_arguments_invalid");
    values[flag] = value;
  }
  const expected = ["--asset-ledger", "--blender", "--generation-ledger", "--output-blend", "--output-glb", "--report", "--scene-spec"];
  if (Object.keys(values).sort().join(",") !== expected.join(",")) throw new Error("room_shell_cli_arguments_invalid");
  return {
    blenderPath: values["--blender"],
    scenePath: values["--scene-spec"],
    assetLedgerPath: values["--asset-ledger"],
    generationLedgerPath: values["--generation-ledger"],
    outputBlendPath: values["--output-blend"],
    outputGlbPath: values["--output-glb"],
    reportPath: values["--report"]
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const report = await compileSyntheticRoomShell(parseCli(process.argv.slice(2)));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : "room_shell_compile_failed"}\n`);
    process.exitCode = 1;
  }
}
