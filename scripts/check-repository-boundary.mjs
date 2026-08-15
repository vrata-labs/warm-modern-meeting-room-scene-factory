import { execFile } from "node:child_process";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { extname, isAbsolute, posix, resolve } from "node:path";
import { promisify, TextDecoder } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const defaultRoot = resolve(import.meta.dirname, "..");
const forbiddenTopLevel = new Set(["assets", "source", "sources", "provenance", "raw-outputs", "restricted"]);
const forbiddenPathSegments = new Set(["node_modules"]);
const forbiddenExtensions = new Set([
  ".7z",
  ".avi",
  ".bin",
  ".blend",
  ".bz2",
  ".ckpt",
  ".exr",
  ".fbx",
  ".flv",
  ".glb",
  ".gltf",
  ".gz",
  ".hdr",
  ".jpeg",
  ".jpg",
  ".ktx2",
  ".key",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".npy",
  ".npz",
  ".obj",
  ".onnx",
  ".pem",
  ".ply",
  ".png",
  ".pt",
  ".pth",
  ".safetensors",
  ".stl",
  ".tar",
  ".tgz",
  ".webm",
  ".webp",
  ".wasm",
  ".wmv",
  ".xz",
  ".zip"
]);
const utf8 = new TextDecoder("utf-8", { fatal: true });

function safeTrackedPath(path) {
  return typeof path === "string"
    && path.length > 0
    && !isAbsolute(path)
    && !path.includes("\\")
    && !path.includes(":")
    && !path.includes("\0")
    && !path.startsWith("../")
    && posix.normalize(path) === path;
}

async function gitOutput(root, args, encoding = null) {
  const { stdout } = await execFileAsync(
    "git",
    ["-C", root, ...args],
    {
      encoding,
      maxBuffer: 16 * 1024 * 1024
    }
  );
  return stdout;
}

async function repositoryFiles(root) {
  const stagedOutput = await gitOutput(root, ["ls-files", "--stage", "-z"]);
  const staged = new Map();
  for (const record of Buffer.from(stagedOutput).toString("utf8").split("\0").filter(Boolean)) {
    const separator = record.indexOf("\t");
    const metadata = record.slice(0, separator).split(" ");
    const path = record.slice(separator + 1);
    if (separator < 0 || metadata.length !== 3 || metadata[2] !== "0") {
      throw new Error(`invalid_git_index_record:${path || "missing"}`);
    }
    staged.set(path, { mode: metadata[0] });
  }
  const untrackedOutput = await gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  const untracked = Buffer.from(untrackedOutput).toString("utf8").split("\0").filter(Boolean);
  return { staged, untracked };
}

function textArtifactIssue(text) {
  if (/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(text) || /["']private_key["']\s*:/.test(text)) {
    return "private_key_material";
  }
  if (/data:(?:application\/octet-stream|model\/gltf-buffer);base64,/i.test(text)) {
    return "embedded_binary_data_uri";
  }
  if (/[A-Za-z0-9+/]{2048,}={0,2}/.test(text)) return "large_base64_payload";
  let wrappedBase64Length = 0;
  for (const line of text.split(/\r?\n/)) {
    const value = line.trim();
    if (value.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
      wrappedBase64Length += value.replace(/=+$/, "").length;
      if (wrappedBase64Length >= 2048) return "large_base64_payload";
    } else {
      wrappedBase64Length = 0;
    }
  }
  if (/^ply\s*\nformat\s+ascii\b/m.test(text)) return "ascii_ply_payload";
  if (/^;\s*FBX\b/m.test(text)) return "ascii_fbx_payload";
  if (/^solid\s+.+\n[\s\S]*?\bfacet\s+normal\b/m.test(text)) return "ascii_stl_payload";

  const lines = text.split(/\r?\n/).map((line) => line.trim());
  const objVertices = lines.filter((line) => /^v\s+-?(?:\d|\.\d)/.test(line)).length;
  const objFaces = lines.filter((line) => /^f\s+-?\d+(?:\/\S*)?(?:\s+-?\d+(?:\/\S*)?){2,}/.test(line)).length;
  if (objVertices >= 3 && objFaces >= 1) return "ascii_obj_payload";

  try {
    const value = JSON.parse(text);
    if (value?.asset?.version && ["buffers", "meshes", "nodes", "scenes"].some((key) => Object.hasOwn(value, key))) {
      return "gltf_json_payload";
    }
  } catch {
    // Most repository text is not JSON.
  }
  return null;
}

function validateBytes(bytes, path, source, issues) {
  if (bytes.includes(0)) {
    issues.push(`${source}_file_must_be_utf8_text:${path}`);
    return;
  }
  try {
    const text = utf8.decode(bytes);
    const artifactIssue = textArtifactIssue(text);
    if (artifactIssue) issues.push(`forbidden_text_artifact:${path}:${artifactIssue}`);
  } catch {
    issues.push(`${source}_file_must_be_utf8_text:${path}`);
  }
}

export async function checkRepositoryBoundary(root = defaultRoot) {
  const repositoryRoot = await realpath(root);
  const issues = [];

  for (const entry of await readdir(repositoryRoot, { withFileTypes: true })) {
    if (forbiddenTopLevel.has(entry.name)) issues.push(`forbidden_experiment_top_level_path:${entry.name}`);
  }

  const { staged, untracked } = await repositoryFiles(repositoryRoot);
  const candidates = new Set([...staged.keys(), ...untracked]);
  for (const trackedPath of candidates) {
    if (!safeTrackedPath(trackedPath)) {
      issues.push(`unsafe_tracked_path:${trackedPath}`);
      continue;
    }
    const topLevel = trackedPath.split("/", 1)[0];
    if (forbiddenTopLevel.has(topLevel)) issues.push(`forbidden_experiment_top_level_path:${topLevel}`);
    if (trackedPath.split("/").some((segment) => forbiddenPathSegments.has(segment))) {
      issues.push(`forbidden_repository_path:${trackedPath}`);
    }
    if (forbiddenExtensions.has(extname(trackedPath).toLowerCase())) {
      issues.push(`forbidden_scene_binary:${trackedPath}`);
    }
    if (/alpha|beta/i.test(trackedPath)) issues.push(`review_mapping_must_not_be_committed:${trackedPath}`);

    const stagedRecord = staged.get(trackedPath);
    if (stagedRecord) {
      if (stagedRecord.mode !== "100644") issues.push(`git_index_file_must_be_regular:${trackedPath}`);
      try {
        const stagedBytes = await gitOutput(repositoryRoot, ["show", `:${trackedPath}`]);
        validateBytes(Buffer.from(stagedBytes), trackedPath, "git_index", issues);
      } catch {
        issues.push(`git_index_file_unreadable:${trackedPath}`);
      }
    }

    const expectedPath = resolve(repositoryRoot, trackedPath);
    try {
      const metadata = await lstat(expectedPath);
      if (!metadata.isFile() || metadata.isSymbolicLink() || await realpath(expectedPath) !== expectedPath) {
        issues.push(`tracked_file_must_be_regular:${trackedPath}`);
        continue;
      }
      const bytes = await readFile(expectedPath);
      validateBytes(bytes, trackedPath, "worktree", issues);
    } catch {
      issues.push(`tracked_file_unreadable:${trackedPath}`);
    }
  }

  if (issues.length > 0) throw new Error([...new Set(issues)].sort().join(","));
  return { status: "repository-boundary-valid" };
}

async function main() {
  await checkRepositoryBoundary();
  process.stdout.write("Repository boundary is valid.\n");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error.message}\n`);
    process.exitCode = 1;
  });
}
