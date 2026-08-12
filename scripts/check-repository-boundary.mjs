import { readdir } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "..");
const ignoredDirectories = new Set([".git", "node_modules"]);
const forbiddenTopLevel = new Set(["assets", "source", "sources", "provenance", "raw-outputs", "restricted"]);
const forbiddenExtensions = new Set([".bin", ".blend", ".exr", ".glb", ".gltf", ".hdr", ".jpeg", ".jpg", ".ktx2", ".png", ".webp"]);

function posix(path) {
  return path.split(sep).join("/");
}

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

for (const entry of await readdir(root, { withFileTypes: true })) {
  if (entry.isDirectory() && !ignoredDirectories.has(entry.name) && forbiddenTopLevel.has(entry.name)) {
    throw new Error(`forbidden_experiment_top_level_path:${entry.name}`);
  }
}

for (const file of await walk(root)) {
  const path = posix(relative(root, file));
  if (forbiddenExtensions.has(extname(file).toLowerCase())) throw new Error(`forbidden_scene_binary:${path}`);
  if (/alpha|beta/i.test(path)) throw new Error(`review_mapping_must_not_be_committed:${path}`);
}

process.stdout.write("Repository boundary is valid.\n");
