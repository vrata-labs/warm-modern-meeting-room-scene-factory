import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { checkRepositoryBoundary } from "../scripts/check-repository-boundary.mjs";

const execFileAsync = promisify(execFile);

async function git(directory, ...args) {
  await execFileAsync("git", ["-C", directory, ...args]);
}

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-boundary-"));
  await git(directory, "init", "-q");
  await writeFile(join(directory, "README.md"), "# Fixture\n");
  await git(directory, "add", "README.md");
  return directory;
}

test("repository boundary scans force-added node_modules and rejects disguised binaries", async () => {
  const directory = await fixture();
  try {
    assert.deepEqual(await checkRepositoryBoundary(directory), { status: "repository-boundary-valid" });

    await mkdir(join(directory, "node_modules/cache"), { recursive: true });
    await writeFile(join(directory, "node_modules/cache/model.safetensors"), "not-a-model\n");
    await git(directory, "add", "-f", "node_modules/cache/model.safetensors");
    await assert.rejects(
      checkRepositoryBoundary(directory),
      /forbidden_scene_binary:node_modules\/cache\/model\.safetensors/
    );

    await git(directory, "rm", "--cached", "-q", "node_modules/cache/model.safetensors");
    await writeFile(join(directory, "runtime.whl"), "not-a-wheel\n");
    await assert.rejects(
      checkRepositoryBoundary(directory),
      /forbidden_scene_binary:runtime\.whl/
    );
    await rm(join(directory, "runtime.whl"));
    await writeFile(join(directory, "disguised.txt"), Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x00]));
    await git(directory, "add", "disguised.txt");
    await assert.rejects(
      checkRepositoryBoundary(directory),
      /(?:git_index|worktree)_file_must_be_utf8_text:disguised\.txt/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository boundary does not inspect extensionless files in forbidden paths", async (context) => {
  const cases = [
    ["repository path", "node_modules/cache/opaque.txt", "forbidden_repository_path:node_modules/cache/opaque.txt"],
    ["top-level path", "restricted/opaque.txt", "forbidden_experiment_top_level_path:restricted"],
    ["review mapping", "review-alpha.txt", "review_mapping_must_not_be_committed:review-alpha.txt"]
  ];
  for (const [name, path, expectedIssue] of cases) {
    await context.test(name, async () => {
      const directory = await fixture();
      try {
        await mkdir(resolve(directory, path, ".."), { recursive: true });
        await writeFile(join(directory, path), Buffer.from([0x00]));
        await git(directory, "add", "-f", path);
        await assert.rejects(
          checkRepositoryBoundary(directory),
          (error) => error.message.includes(expectedIssue) && !error.message.includes("file_must_be_utf8_text")
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });
  }
});

test("repository boundary validates staged bytes independently from the worktree", async () => {
  const directory = await fixture();
  try {
    await writeFile(join(directory, "payload.txt"), Buffer.from([0x67, 0x6c, 0x54, 0x46, 0x00]));
    await git(directory, "add", "payload.txt");
    await writeFile(join(directory, "payload.txt"), "safe worktree text\n");
    await assert.rejects(
      checkRepositoryBoundary(directory),
      /git_index_file_must_be_utf8_text:payload\.txt/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository boundary rejects oversized text before loading it", async () => {
  const directory = await fixture();
  try {
    await writeFile(join(directory, "oversized.txt"), Buffer.alloc(4 * 1024 * 1024 + 1, 0x41));
    await git(directory, "add", "oversized.txt");
    await assert.rejects(
      checkRepositoryBoundary(directory),
      /git_index_text_file_too_large:oversized\.txt/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("repository boundary rejects textual scene and restricted payload signatures", async () => {
  const cases = [
    ["scene.txt", "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n", "ascii_obj_payload"],
    ["relative-scene.txt", "v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n", "ascii_obj_payload"],
    ["scene.json", JSON.stringify({ asset: { version: "2.0" }, meshes: [] }), "gltf_json_payload"],
    [
      "secret.txt",
      ["-----BEGIN ", "PRIVATE KEY-----\n", "cleared\n", "-----END PRIVATE KEY-----\n"].join(""),
      "private_key_material"
    ],
    ["weights.txt", "A".repeat(4096), "large_base64_payload"],
    ["wrapped-weights.txt", Array.from({ length: 40 }, () => "A".repeat(64)).join("\n"), "large_base64_payload"]
  ];

  for (const [name, contents, issue] of cases) {
    const directory = await fixture();
    try {
      await writeFile(join(directory, name), contents);
      await assert.rejects(
        checkRepositoryBoundary(directory),
        new RegExp(`forbidden_text_artifact:${name.replace(".", "\\.")}:${issue}`)
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
});

test("repository boundary rejects tracked symlinks and forbidden top-level paths", async (context) => {
  const directory = await fixture();
  try {
    try {
      await symlink("README.md", join(directory, "linked.txt"));
    } catch (error) {
      if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
        context.skip(`symlink unavailable: ${error.code}`);
        return;
      }
      throw error;
    }
    await git(directory, "add", "linked.txt");
    await assert.rejects(checkRepositoryBoundary(directory), /tracked_file_must_be_regular:linked\.txt/);

    await git(directory, "rm", "--cached", "-q", "linked.txt");
    await mkdir(join(directory, "assets"));
    await assert.rejects(checkRepositoryBoundary(directory), /forbidden_experiment_top_level_path:assets/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
