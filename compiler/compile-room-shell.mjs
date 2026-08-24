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

async function readFixture(path, expected, label) {
  const resolved = await exactRegularFile(path, label);
  if (resolved !== expected) throw new Error(`${label}_must_be_synthetic_fixture`);
  return readFile(resolved, "utf8");
}

function verifyCompilerReport(report, contract, binarySha256) {
  if (report?.status !== "stage3-synthetic-room-shell-compiled"
    || report.fixtureOnly !== true
    || report.sceneId !== contract.sceneId
    || report.specificationSha256 !== contract.specificationSha256
    || report.blender?.version !== "4.5.12 LTS"
    || report.blender?.buildHash !== "84afd5f785f7"
    || report.blender?.binarySha256 !== binarySha256
    || report.shell?.objectCount !== 3
    || report.shell?.meshCount !== 3
    || report.shell?.vertexCount !== 32
    || report.shell?.faceCount !== 28
    || report.boundaries?.approvedCandidateSpecification !== false
    || report.boundaries?.byteIdenticalExportsVerified !== false
    || report.boundaries?.openingsCompiled !== false
    || report.boundaries?.materialsCompiled !== false
    || report.boundaries?.componentsCompiled !== false
    || report.boundaries?.sceneBinaryAddedToRepository !== false) {
    throw new Error("room_shell_report_invalid");
  }
}

export async function compileSyntheticRoomShell(options) {
  if (!options || typeof options !== "object") throw new Error("room_shell_options_invalid");
  const blenderPath = await exactRegularFile(options.blenderPath, "room_shell_blender");
  const blenderBytes = await readFile(blenderPath);
  const binarySha256 = sha256(blenderBytes);
  if (binarySha256 !== expectedBlenderBinarySha256) throw new Error("room_shell_blender_sha256_invalid");
  const outputBlendPath = await newExternalOutput(options.outputBlendPath, ".blend", "room_shell_output");
  const reportPath = await newExternalOutput(options.reportPath, ".json", "room_shell_report");
  if (outputBlendPath === reportPath) throw new Error("room_shell_output_paths_conflict");

  const [sceneText, assetLedgerText, generationLedgerText] = await Promise.all([
    readFixture(options.scenePath, fixturePaths.scene, "room_shell_scene"),
    readFixture(options.assetLedgerPath, fixturePaths.assetLedger, "room_shell_asset_ledger"),
    readFixture(options.generationLedgerPath, fixturePaths.generationLedger, "room_shell_generation_ledger")
  ]);
  const contract = parseSceneContract({ sceneText, assetLedgerText, generationLedgerText });
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
      outputBlendPath
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
    if (inspection.status !== "stage3-synthetic-room-shell-inspection-valid"
      || inspection.specificationSha256 !== contract.specificationSha256
      || inspection.inventory?.objectCount !== 3
      || inspection.inventory?.meshCount !== 3
      || inspection.inventory?.materialCount !== 0
      || inspection.inventory?.cameraCount !== 0
      || inspection.inventory?.lightCount !== 0) throw new Error("room_shell_saved_inspection_invalid");
    return Object.freeze(report);
  } catch (error) {
    await Promise.all([rm(outputBlendPath, { force: true }), rm(reportPath, { force: true })]);
    throw error;
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
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
  const expected = ["--asset-ledger", "--blender", "--generation-ledger", "--output-blend", "--report", "--scene-spec"];
  if (Object.keys(values).sort().join(",") !== expected.join(",")) throw new Error("room_shell_cli_arguments_invalid");
  return {
    blenderPath: values["--blender"],
    scenePath: values["--scene-spec"],
    assetLedgerPath: values["--asset-ledger"],
    generationLedgerPath: values["--generation-ledger"],
    outputBlendPath: values["--output-blend"],
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
