import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { access, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import {
  TrellisModelArtifactError,
  canonicalInventoryDigest,
  canonicalLfsPointerBytes,
  canonicalLockDigest,
  parseCanonicalLfsPointer,
  parseCanonicalModelArtifactLock,
  validateModelArtifactLock,
  validateWmmrModelArtifactContract,
  verifyModelArtifactRepository
} from "../scripts/verify-trellis-model-artifact.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, "experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json");
const lfsVersion = "https://git-lfs.github.com/spec/v1";
const pipelineModels = [
  {
    key: "slat_decoder_gs",
    stem: "ckpts/slat_dec_gs_swin8_B_64l8gs32_fp16",
    className: "SLatGaussianDecoder",
    disposition: "ignored-appearance"
  },
  {
    key: "slat_decoder_mesh",
    stem: "ckpts/slat_dec_mesh_swin8_B_64l8m256c_fp16",
    className: "SLatMeshDecoder",
    disposition: "selected"
  },
  {
    key: "slat_decoder_rf",
    stem: "ckpts/slat_dec_rf_swin8_B_64l8r16_fp16",
    className: "SLatRadianceFieldDecoder",
    disposition: "ignored-appearance"
  },
  {
    key: "slat_flow_model",
    stem: "ckpts/slat_flow_img_dit_L_64l8p2_fp16",
    className: "SLatFlowModel",
    disposition: "selected"
  },
  {
    key: "sparse_structure_decoder",
    stem: "ckpts/ss_dec_conv3d_16l8_fp16",
    className: "SparseStructureDecoder",
    disposition: "selected"
  },
  {
    key: "sparse_structure_flow_model",
    stem: "ckpts/ss_flow_img_dit_L_16l8_fp16",
    className: "SparseStructureFlowModel",
    disposition: "selected"
  }
];
const unreferencedModels = [
  {
    stem: "ckpts/slat_enc_swin8_B_64l8_fp16",
    className: "SLatEncoder",
    disposition: "ignored-unreferenced"
  },
  {
    stem: "ckpts/ss_enc_conv3d_16l8_fp16",
    className: "SparseStructureEncoder",
    disposition: "ignored-unreferenced"
  }
];

async function json(path = lockPath) {
  return JSON.parse(await readFile(path, "utf8"));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function gitBlobOid(bytes) {
  return createHash("sha1")
    .update(Buffer.from(`blob ${bytes.byteLength}\0`, "ascii"))
    .update(bytes)
    .digest("hex");
}

function seal(lock, { inventory = false } = {}) {
  if (inventory) lock.inventory.inventorySha256 = canonicalInventoryDigest(lock.inventory.files);
  lock.lockSha256 = canonicalLockDigest(lock);
  return lock;
}

function hasIssue(error, issue) {
  return error instanceof TrellisModelArtifactError && error.issues.includes(issue);
}

async function git(directory, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", directory, ...args], { encoding: "utf8" });
  return stdout.trim();
}

async function gitBuffer(directory, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", directory, ...args], { encoding: null });
  return Buffer.from(stdout);
}

function syntheticPipeline() {
  return {
    name: "TrellisImageTo3DPipeline",
    args: {
      models: Object.fromEntries(pipelineModels.map(({ key, stem }) => [key, stem])),
      slat_normalization: {
        mean: [0, 1, 2, 3, 4, 5, 6, 7],
        std: [1, 1, 1, 1, 1, 1, 1, 1]
      },
      image_cond_model: "dinov2_vitl14_reg"
    }
  };
}

function buildSyntheticContents({ mutatePipeline, mutateContents, configClassOverrides = {} } = {}) {
  const contents = new Map([
    [".gitattributes", Buffer.from("*.safetensors filter=lfs diff=lfs merge=lfs -text\n")],
    ["README.md", Buffer.from("---\nlicense: mit\n---\n# Fixture\n")]
  ]);
  const lfsByStem = new Map();
  const allModels = [
    ...pipelineModels.map(({ stem, className, disposition }) => ({ stem, className, disposition })),
    ...unreferencedModels
  ];
  for (const [index, model] of allModels.entries()) {
    const modelClass = configClassOverrides[model.stem] ?? model.className;
    contents.set(`${model.stem}.json`, Buffer.from(`${JSON.stringify({ name: modelClass, args: {} })}\n`));
    const lfs = {
      version: lfsVersion,
      oidSha256: sha256(`payload:${model.stem}`),
      payloadSize: 1000 + index
    };
    lfsByStem.set(model.stem, lfs);
    contents.set(`${model.stem}.safetensors`, canonicalLfsPointerBytes(lfs));
  }
  const pipeline = syntheticPipeline();
  mutatePipeline?.(pipeline);
  contents.set("pipeline.json", Buffer.from(`${JSON.stringify(pipeline)}\n`));
  mutateContents?.(contents);
  return { contents, lfsByStem, allModels };
}

function buildSyntheticLock(contents, lfsByStem, allModels) {
  const modelByStem = new Map(allModels.map((model) => [model.stem, model]));
  const files = [...contents]
    .map(([path, bytes]) => {
      let role;
      let disposition;
      if (path === ".gitattributes") {
        role = "lfs-rules";
        disposition = "evidence-only";
      } else if (path === "README.md") {
        role = "model-card";
        disposition = "evidence-only";
      } else if (path === "pipeline.json") {
        role = "pipeline-manifest";
        disposition = "selected";
      } else {
        const stem = path.replace(/\.(?:json|safetensors)$/, "");
        const model = modelByStem.get(stem);
        role = path.endsWith(".json") ? "model-config" : "model-payload-pointer";
        disposition = model.disposition;
      }
      const record = {
        path,
        mode: "100644",
        role,
        disposition,
        gitBlob: {
          oid: gitBlobOid(bytes),
          size: bytes.byteLength,
          sha256: sha256(bytes)
        }
      };
      if (role === "model-config") record.modelClass = modelByStem.get(path.slice(0, -5)).className;
      if (role === "model-payload-pointer") record.lfs = lfsByStem.get(path.slice(0, -".safetensors".length));
      return record;
    })
    .sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const selectedPointers = files.filter(({ role, disposition }) => role === "model-payload-pointer" && disposition === "selected");
  const lock = {
    schemaVersion: 1,
    lockSha256: "0".repeat(64),
    status: "publisher-git-lfs-identity-locked-payload-unverified-runtime-blocked",
    source: {
      repository: "fixture-origin-pending",
      commit: "0".repeat(40),
      treeOid: "0".repeat(40),
      objectFormat: "sha1"
    },
    modelCardEvidence: {
      path: "README.md",
      frontMatterLicense: "mit",
      normalizedLicense: "MIT",
      standaloneLicenseFileAbsent: true,
      caveat: "Fixture metadata is not a payload license."
    },
    inventory: {
      canonicalization: "SHA-256 of stable JSON for complete inventory records sorted by ASCII path",
      fileCount: files.length,
      normalBlobCount: files.length - files.filter(({ role }) => role === "model-payload-pointer").length,
      lfsPointerCount: files.filter(({ role }) => role === "model-payload-pointer").length,
      inventorySha256: canonicalInventoryDigest(files),
      files
    },
    pipeline: {
      path: "pipeline.json",
      className: "TrellisImageTo3DPipeline",
      models: structuredClone(pipelineModels),
      imageConditioning: {
        model: "dinov2_vitl14_reg",
        normalizationMeanLength: 8,
        normalizationStdLength: 8
      }
    },
    selectedPayloads: {
      count: selectedPointers.length,
      totalSize: selectedPointers.reduce((total, { lfs }) => total + lfs.payloadSize, 0),
      payloads: selectedPointers.map((pointer) => ({
        id: pointer.path.split("/").at(-1).replace(/\.safetensors$/, ""),
        path: pointer.path,
        oidSha256: pointer.lfs.oidSha256,
        payloadSize: pointer.lfs.payloadSize
      })).sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0)
    },
    boundaries: {
      cloudResourcesCreated: false,
      generationAllowed: false,
      lfsPayloadBytesIndependentlyVerified: false,
      lfsPayloadsDownloaded: false,
      modelInputsDownloaded: false,
      runtimeExecuted: false,
      weightsIncluded: false
    },
    resolvedGates: ["fixtureArtifactLock"],
    openGates: ["fixturePayloadBytesVerification"],
    gateMeanings: {
      fixtureArtifactLock: "Fixture Git object and pointer identity only.",
      fixturePayloadBytesVerification: "Fixture payload bytes remain unverified."
    }
  };
  return lock;
}

async function createSyntheticFixture({
  mutatePipeline,
  mutateContents,
  configClassOverrides,
  mutateTree,
  mutateRootTree,
  createCommit,
  objectOnlyRepository = false
} = {}) {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-trellis-model-"));
  const source = join(directory, "source");
  const clone = join(directory, "no-checkout");
  const objectInputs = join(directory, "object-inputs");
  await mkdir(source);
  await mkdir(objectInputs);
  await git(source, "init", "-q", "--object-format=sha1");
  const fixture = buildSyntheticContents({ mutatePipeline, mutateContents, configClassOverrides });
  const lock = buildSyntheticLock(fixture.contents, fixture.lfsByStem, fixture.allModels);
  let objectIndex = 0;
  async function storeObject(type, bytes, { literally = false } = {}) {
    const input = join(objectInputs, `${type}-${objectIndex}`);
    objectIndex += 1;
    await writeFile(input, bytes);
    return git(source, "hash-object", "-w", "-t", type, ...(literally ? ["--literally"] : []), input);
  }
  const storeBlob = (bytes) => storeObject("blob", bytes);
  const oidByPath = new Map();
  for (const [path, bytes] of fixture.contents) {
    const oid = await storeBlob(bytes);
    oidByPath.set(path, oid);
    assert.equal(oid, lock.inventory.files.find((file) => file.path === path).gitBlob.oid);
    await git(source, "update-index", "--add", "--cacheinfo", `100644,${oid},${path}`);
  }
  await mutateTree?.({ source, oidByPath, storeBlob, git });
  const indexTreeOid = await git(source, "write-tree");
  const treeOid = await mutateRootTree?.({ source, treeOid: indexTreeOid, storeObject, git, gitBuffer }) ?? indexTreeOid;
  const commit = createCommit
    ? await createCommit({ source, treeOid, storeObject, git })
    : await git(
      source,
      "-c", "user.name=Model Artifact Test",
      "-c", "user.email=model-artifact-test@example.invalid",
      "commit-tree", treeOid,
      "-m", "Synthetic model artifact fixture"
    );
  if (objectOnlyRepository) {
    await git(source, "config", "--local", "remote.origin.url", source);
    lock.source.repository = source;
    lock.source.commit = commit;
    lock.source.treeOid = treeOid;
    seal(lock);
    return { directory, source, clone: source, lock };
  }
  await git(source, "update-ref", "refs/heads/main", commit);
  await git(source, "symbolic-ref", "HEAD", "refs/heads/main");
  await execFileAsync("git", ["clone", "-q", "--no-checkout", source, clone]);
  lock.source.repository = await git(clone, "remote", "get-url", "origin");
  lock.source.commit = commit;
  lock.source.treeOid = treeOid;
  seal(lock);
  return { directory, source, clone, lock };
}

test("exact TRELLIS model artifact lock is internally consistent and remains blocked", async () => {
  const lock = validateWmmrModelArtifactContract(await json());
  assert.equal(lock.lockSha256, "d0046a083406c02dd67fd508b917750bc52f8e893527b4e39fa71abda0a6baa9");
  assert.equal(lock.inventory.inventorySha256, "e3d5763cedba5e2b9680ad4f57af044928a07d8d82fb93f25b27d5eabf2143f1");
  assert.equal(canonicalLockDigest(lock), lock.lockSha256);
  assert.equal(canonicalInventoryDigest([...lock.inventory.files].reverse()), lock.inventory.inventorySha256);
  assert.equal(lock.inventory.fileCount, 19);
  assert.equal(lock.inventory.normalBlobCount, 11);
  assert.equal(lock.inventory.lfsPointerCount, 8);
  assert.equal(lock.selectedPayloads.count, 4);
  assert.equal(lock.selectedPayloads.totalSize, 2664021360);
  assert.deepEqual(lock.resolvedGates, ["trellisModelArtifactLock"]);
  assert.ok(lock.openGates.includes("trellisModelPayloadBytesVerification"));
  assert.equal(lock.boundaries.lfsPayloadsDownloaded, false);
  assert.equal(lock.boundaries.lfsPayloadBytesIndependentlyVerified, false);
  assert.equal(lock.boundaries.runtimeExecuted, false);
  assert.equal(lock.boundaries.generationAllowed, false);
});

test("model artifact lock parser rejects non-canonical JSON and duplicate keys", async (context) => {
  const canonical = await readFile(lockPath, "utf8");
  assert.deepEqual(parseCanonicalModelArtifactLock(canonical), JSON.parse(canonical));
  for (const [name, contents] of [
    ["duplicate key", canonical.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,')],
    ["non-canonical spacing", canonical.replace('  "schemaVersion": 1,', '  "schemaVersion" : 1,')]
  ]) {
    await context.test(name, () => {
      assert.throws(
        () => parseCanonicalModelArtifactLock(contents),
        (error) => hasIssue(error, "lock_json_not_canonical")
      );
    });
  }
});

test("model artifact verifier CLI does not skip execution through a symlink", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-model-cli-"));
  const link = join(directory, "verify-model.mjs");
  try {
    await symlink(resolve(root, "scripts/verify-trellis-model-artifact.mjs"), link);
    await assert.rejects(
      execFileAsync(process.execPath, [link], { encoding: "utf8" }),
      (error) => error.code === 1 && error.stderr.includes("usage: node scripts/verify-trellis-model-artifact.mjs")
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("lock validation rejects self, inventory, source, gate, and boundary drift", async (context) => {
  const original = await json();
  await context.test("self digest", () => {
    const lock = structuredClone(original);
    lock.status = "changed";
    assert.throws(() => validateModelArtifactLock(lock), (error) => hasIssue(error, "lock_digest_mismatch"));
  });
  await context.test("inventory digest", () => {
    const lock = structuredClone(original);
    lock.inventory.files[0].gitBlob.sha256 = "0".repeat(64);
    seal(lock);
    assert.throws(() => validateModelArtifactLock(lock), (error) => hasIssue(error, "inventory_digest_mismatch"));
  });
  await context.test("anchored source", () => {
    const lock = structuredClone(original);
    lock.source.commit = "b".repeat(40);
    seal(lock);
    assert.throws(() => validateWmmrModelArtifactContract(lock), (error) => hasIssue(error, "unexpected_source_commit"));
  });
  await context.test("anchored gates", () => {
    const lock = structuredClone(original);
    lock.openGates = lock.openGates.filter((gate) => gate !== "dependencyWheelHashLock");
    seal(lock);
    assert.throws(() => validateWmmrModelArtifactContract(lock), (error) => hasIssue(error, "unexpected_open_gate_set"));
  });
  await context.test("closed boundary", () => {
    const lock = structuredClone(original);
    lock.boundaries.runtimeExecuted = true;
    seal(lock);
    assert.throws(() => validateModelArtifactLock(lock), (error) => hasIssue(error, "boundary_must_be_false:runtimeExecuted"));
  });
  await context.test("non-object inventory record", () => {
    const lock = structuredClone(original);
    lock.inventory.files[0] = null;
    assert.throws(
      () => validateModelArtifactLock(lock),
      (error) => hasIssue(error, "inventory_file_not_object:0")
    );
  });
  await context.test("unsafe selected payload total", () => {
    const lock = structuredClone(original);
    lock.selectedPayloads.totalSize = Number.MAX_SAFE_INTEGER + 1;
    seal(lock);
    assert.throws(
      () => validateModelArtifactLock(lock),
      (error) => hasIssue(error, "selected_payload_total_invalid")
    );
  });
});

test("canonical LFS parser rejects BOM, CRLF, extra lines, uppercase OIDs, leading-zero sizes, and raw payloads", async (context) => {
  const valid = "version https://git-lfs.github.com/spec/v1\noid sha256:"
    + `${"a".repeat(64)}\nsize 42\n`;
  assert.deepEqual(parseCanonicalLfsPointer(Buffer.from(valid)), {
    version: lfsVersion,
    oidSha256: "a".repeat(64),
    payloadSize: 42
  });
  const cases = [
    ["UTF-8 BOM", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(valid)])],
    ["CRLF", valid.replaceAll("\n", "\r\n")],
    ["extra line", `${valid}extra\n`],
    ["uppercase OID", valid.replace("a".repeat(64), "A".repeat(64))],
    ["leading-zero size", valid.replace("size 42", "size 042")],
    ["raw payload", "safetensors payload bytes"]
  ];
  for (const [name, contents] of cases) {
    await context.test(name, () => {
      assert.throws(
        () => parseCanonicalLfsPointer(Buffer.from(contents)),
        (error) => error instanceof TrellisModelArtifactError
      );
    });
  }
});

test("lock validation rejects selected and ignored disposition errors", async (context) => {
  const original = await json();
  const cases = [
    ["selected pointer ignored", "ckpts/ss_dec_conv3d_16l8_fp16.safetensors", "ignored-appearance"],
    ["appearance pointer selected", "ckpts/slat_dec_gs_swin8_B_64l8gs32_fp16.safetensors", "selected"],
    ["encoder pointer selected", "ckpts/ss_enc_conv3d_16l8_fp16.safetensors", "selected"]
  ];
  for (const [name, path, disposition] of cases) {
    await context.test(name, () => {
      const lock = structuredClone(original);
      lock.inventory.files.find((file) => file.path === path).disposition = disposition;
      seal(lock, { inventory: true });
      assert.throws(
        () => validateModelArtifactLock(lock),
        (error) => error instanceof TrellisModelArtifactError
          && error.issues.some((issue) => issue.startsWith("model_pair_disposition_mismatch:"))
      );
    });
  }
});

test("lock validation rejects missing, extra, swapped, and traversal pipeline semantics", async (context) => {
  const original = await json();
  const cases = [
    ["missing", (lock) => lock.pipeline.models.pop(), "pipeline_model_stem_set_invalid"],
    ["extra", (lock) => lock.pipeline.models.push({
      key: "zz_extra",
      stem: lock.pipeline.models[0].stem,
      className: lock.pipeline.models[0].className,
      disposition: lock.pipeline.models[0].disposition
    }), "pipeline_model_stem_duplicate:"],
    ["swapped", (lock) => {
      const first = lock.pipeline.models[0].stem;
      lock.pipeline.models[0].stem = lock.pipeline.models[1].stem;
      lock.pipeline.models[1].stem = first;
    }, "pipeline_model_class_mismatch:"],
    ["traversal key", (lock) => {
      lock.pipeline.models[0].key = "../slat_decoder_gs";
    }, "pipeline_model_key_invalid:"],
    ["traversal stem", (lock) => {
      lock.pipeline.models[0].stem = "ckpts/../escape";
    }, "pipeline_model_stem_invalid:"]
  ];
  for (const [name, mutate, issuePrefix] of cases) {
    await context.test(name, () => {
      const lock = structuredClone(original);
      mutate(lock);
      seal(lock);
      assert.throws(
        () => validateModelArtifactLock(lock),
        (error) => error instanceof TrellisModelArtifactError
          && error.issues.some((issue) => issue.startsWith(issuePrefix))
      );
    });
  }
});

test("WMMR anchor rejects config class, DINO name, and normalization contract drift", async (context) => {
  const original = await json();
  const cases = [
    ["config class", (lock) => {
      const config = lock.inventory.files.find(({ path }) => path === "ckpts/ss_dec_conv3d_16l8_fp16.json");
      config.modelClass = "WrongDecoder";
      lock.pipeline.models.find(({ key }) => key === "sparse_structure_decoder").className = "WrongDecoder";
    }],
    ["DINO name", (lock) => {
      lock.pipeline.imageConditioning.model = "dinov2_wrong";
    }],
    ["mean length", (lock) => {
      lock.pipeline.imageConditioning.normalizationMeanLength = 7;
    }],
    ["std length", (lock) => {
      lock.pipeline.imageConditioning.normalizationStdLength = 9;
    }]
  ];
  for (const [name, mutate] of cases) {
    await context.test(name, () => {
      const lock = structuredClone(original);
      mutate(lock);
      seal(lock, { inventory: true });
      assert.throws(
        () => validateWmmrModelArtifactContract(lock),
        (error) => error instanceof TrellisModelArtifactError
      );
    });
  }
});

test("synthetic no-checkout verifier reads committed objects with an execFile Git allowlist", async () => {
  const fixture = await createSyntheticFixture();
  try {
    await assert.rejects(access(join(fixture.clone, "pipeline.json")), { code: "ENOENT" });
    const commands = [];
    const execFileImpl = (file, args, options, callback) => {
      assert.equal(file, "git");
      assert.equal(args[0], "-C");
      assert.equal(args[1], fixture.clone);
      for (const [name, value] of Object.entries({
        GIT_ALLOW_PROTOCOL: "",
        GIT_CONFIG_COUNT: "0",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_NO_REPLACE_OBJECTS: "1",
        GIT_NO_LAZY_FETCH: "1",
        GIT_LFS_SKIP_SMUDGE: "1",
        GIT_OPTIONAL_LOCKS: "0",
        GIT_PROTOCOL_FROM_USER: "0",
        GIT_TERMINAL_PROMPT: "0"
      })) {
        assert.equal(options.env[name], value);
      }
      assert.equal(options.env.GIT_DIR, undefined);
      assert.equal(options.env.GIT_COMMON_DIR, undefined);
      assert.equal(options.env.GIT_ALTERNATE_OBJECT_DIRECTORIES, undefined);
      commands.push(args.slice(2));
      return execFile(file, args, options, callback);
    };
    const result = await verifyModelArtifactRepository(fixture.lock, fixture.clone, { execFileImpl });
    assert.equal(result.fileCount, 19);
    assert.equal(result.lfsPointerCount, 8);
    assert.equal(result.lfsPayloadBytesReadByVerifier, false);
    assert.equal(result.gitLfsInvokedByVerifier, false);
    assert.equal(result.networkFallbackAllowed, false);
    assert.deepEqual(result.networkProtocolsAllowedByVerifier, []);
    assert.equal(result.runtimeExecutedByVerifier, false);
    assert.equal(result.generationAllowed, false);
    assert.ok(commands.some((args) => args[0] === "config"));
    assert.ok(commands.some((args) => args[0] === "cat-file" && args[1] === "commit"));
    assert.ok(commands.some((args) => args[0] === "cat-file" && args[1] === "tree"));
    assert.ok(commands.every((args) => ["config", "rev-parse", "cat-file"].includes(args[0])));
    assert.ok(commands.every((args) => !args.includes("HEAD")));
    assert.ok(commands.every((args) => !args.some((arg) => ["checkout", "git-lfs", "show", "status"].includes(arg))));
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier ignores hostile ambient Git environment and URL rewrites", async () => {
  const fixture = await createSyntheticFixture();
  const environment = {
    GIT_ALTERNATE_OBJECT_DIRECTORIES: join(fixture.source, ".git", "objects"),
    GIT_COMMON_DIR: join(fixture.source, ".git"),
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_GLOBAL: join(fixture.directory, "hostile-global-config"),
    GIT_CONFIG_KEY_0: "remote.origin.url",
    GIT_CONFIG_NOSYSTEM: "0",
    GIT_CONFIG_VALUE_0: "https://attacker.invalid/model",
    GIT_DIR: join(fixture.source, ".git"),
    Git_Object_Directory: join(fixture.source, ".git", "objects"),
    git_work_tree: fixture.source
  };
  const previous = new Map(Object.keys(environment).map((name) => [name, process.env[name]]));
  try {
    await git(
      fixture.clone,
      "config",
      "--local",
      "url.https://attacker.invalid/.insteadOf",
      fixture.lock.source.repository
    );
    Object.assign(process.env, environment);
    const result = await verifyModelArtifactRepository(fixture.lock, fixture.clone);
    assert.equal(result.repository, fixture.lock.source.repository);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("synthetic repository and verifier stay SHA-1 under an ambient SHA-256 default", async () => {
  const previous = process.env.GIT_DEFAULT_HASH;
  let fixture;
  try {
    process.env.GIT_DEFAULT_HASH = "sha256";
    fixture = await createSyntheticFixture();
    const result = await verifyModelArtifactRepository(fixture.lock, fixture.clone);
    assert.equal(result.objectFormat, "sha1");
  } finally {
    if (previous === undefined) delete process.env.GIT_DEFAULT_HASH;
    else process.env.GIT_DEFAULT_HASH = previous;
    if (fixture) await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier rejects duplicate direct and included origin URLs", async (context) => {
  for (const [name, addOrigin] of [
    ["direct", async (fixture) => {
      await git(fixture.clone, "config", "--local", "--add", "remote.origin.url", "https://attacker.invalid/model");
    }],
    ["included", async (fixture) => {
      const includePath = join(fixture.directory, "included-origin.config");
      await writeFile(includePath, '[remote "origin"]\n\turl = https://attacker.invalid/model\n');
      await git(fixture.clone, "config", "--local", "include.path", includePath);
    }]
  ]) {
    await context.test(name, async () => {
      const fixture = await createSyntheticFixture();
      try {
        await addOrigin(fixture);
        await assert.rejects(
          verifyModelArtifactRepository(fixture.lock, fixture.clone),
          (error) => hasIssue(error, "repository_origin_count_invalid:2")
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("repository verifier does not lazy-fetch omitted blobs from a reachable partial-clone remote", async () => {
  const fixture = await createSyntheticFixture();
  const partialClone = join(fixture.directory, "partial-clone");
  try {
    await git(fixture.source, "config", "uploadpack.allowFilter", "true");
    const repository = pathToFileURL(fixture.source).href;
    await execFileAsync(
      "git",
      ["clone", "-q", "--no-checkout", "--filter=blob:none", repository, partialClone],
      { env: { ...process.env, GIT_LFS_SKIP_SMUDGE: "1" } }
    );
    const lock = structuredClone(fixture.lock);
    lock.source.repository = repository;
    seal(lock);
    await assert.rejects(
      verifyModelArtifactRepository(lock, partialClone),
      (error) => error instanceof TrellisModelArtifactError
        && error.issues.some((issue) => issue.startsWith("repository_blob_object_unreadable:"))
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier independently checks commit, tree, and blob object identities", async (context) => {
  const fixture = await createSyntheticFixture();
  const mutateCommandOutput = (matches, mutate) => (file, args, options, callback) => execFile(
    file,
    args,
    options,
    (error, stdout, stderr) => {
      if (error || !matches(args.slice(2))) return callback(error, stdout, stderr);
      return callback(null, mutate(Buffer.from(stdout)), stderr);
    }
  );
  const flipLastByte = (bytes) => {
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    return changed;
  };
  try {
    await context.test("commit", async () => {
      const execFileImpl = mutateCommandOutput(
        (command) => command[0] === "cat-file" && command[1] === "commit",
        flipLastByte
      );
      await assert.rejects(
        verifyModelArtifactRepository(fixture.lock, fixture.clone, { execFileImpl }),
        (error) => hasIssue(error, "commit_object_oid_mismatch")
      );
    });
    await context.test("tree", async () => {
      const commands = [];
      const mutateTreeOutput = mutateCommandOutput(
        (command) => command[0] === "cat-file" && command[1] === "tree",
        (bytes) => {
          const changed = Buffer.from(bytes);
          changed[0] = changed[0] === 0x31 ? 0x30 : 0x31;
          return changed;
        }
      );
      const execFileImpl = (file, args, options, callback) => {
        commands.push(args.slice(2));
        return mutateTreeOutput(file, args, options, callback);
      };
      await assert.rejects(
        verifyModelArtifactRepository(fixture.lock, fixture.clone, { execFileImpl }),
        (error) => hasIssue(error, "tree_object_oid_mismatch:.")
      );
      assert.deepEqual(commands.at(-1), ["cat-file", "tree", fixture.lock.source.treeOid]);
    });
    await context.test("blob even when raw SHA-256 is relocked", async () => {
      const lock = structuredClone(fixture.lock);
      const expected = lock.inventory.files.find(({ path }) => path === ".gitattributes");
      const tampered = Buffer.from("*.safetensors filter=lfs diff=lfs merge=lfs -text ");
      assert.equal(tampered.byteLength, expected.gitBlob.size);
      expected.gitBlob.sha256 = sha256(tampered);
      seal(lock, { inventory: true });
      const execFileImpl = mutateCommandOutput(
        (command) => command[0] === "cat-file" && command[1] === "blob" && command[2] === expected.gitBlob.oid,
        () => tampered
      );
      await assert.rejects(
        verifyModelArtifactRepository(lock, fixture.clone, { execFileImpl }),
        (error) => hasIssue(error, "repository_blob_object_oid_mismatch:.gitattributes")
      );
    });
    await context.test("raw SHA-256 before subsequent objects", async () => {
      const lock = structuredClone(fixture.lock);
      const expected = lock.inventory.files.find(({ path }) => path === ".gitattributes");
      expected.gitBlob.sha256 = "0".repeat(64);
      seal(lock, { inventory: true });
      const commands = [];
      const execFileImpl = (file, args, options, callback) => {
        commands.push(args.slice(2));
        return execFile(file, args, options, callback);
      };
      await assert.rejects(
        verifyModelArtifactRepository(lock, fixture.clone, { execFileImpl }),
        (error) => hasIssue(error, "repository_blob_sha256_mismatch:.gitattributes")
      );
      assert.deepEqual(commands.at(-1), ["cat-file", "blob", expected.gitBlob.oid]);
    });
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier rejects an extra empty tree", async () => {
  const fixture = await createSyntheticFixture({
    mutateRootTree: async ({ source, treeOid, storeObject, gitBuffer: readGitObject }) => {
      const emptyTreeOid = await storeObject("tree", Buffer.alloc(0));
      const rootTree = await readGitObject(source, "cat-file", "tree", treeOid);
      const emptyEntry = Buffer.concat([
        Buffer.from("40000 zz-empty\0", "ascii"),
        Buffer.from(emptyTreeOid, "hex")
      ]);
      return storeObject("tree", Buffer.concat([rootTree, emptyEntry]));
    }
  });
  try {
    await assert.rejects(
      verifyModelArtifactRepository(fixture.lock, fixture.clone),
      (error) => hasIssue(error, "repository_directory_extra:zz-empty")
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier rejects noncanonical raw tree encodings", async (context) => {
  const cases = [
    ["high-bit mode", "tree_mode_invalid:.", (rootTree) => {
      const changed = Buffer.from(rootTree);
      for (let index = 0; index < 6; index += 1) changed[index] |= 0x80;
      return changed;
    }],
    ["unsorted entries", "tree_entries_not_sorted:.", (rootTree) => {
      const firstEntryEnd = rootTree.indexOf(0) + 21;
      return Buffer.concat([rootTree.subarray(firstEntryEnd), rootTree.subarray(0, firstEntryEnd)]);
    }],
    ["BOM-prefixed path", "tree_path_unsafe:\ufeff.gitattributes", (rootTree) => {
      const modeEnd = rootTree.indexOf(0x20);
      return Buffer.concat([
        rootTree.subarray(0, modeEnd + 1),
        Buffer.from([0xef, 0xbb, 0xbf]),
        rootTree.subarray(modeEnd + 1)
      ]);
    }]
  ];
  for (const [name, expectedIssue, mutate] of cases) {
    await context.test(name, async () => {
      const fixture = await createSyntheticFixture({
        mutateRootTree: async ({ source, treeOid, storeObject, gitBuffer: readGitObject }) => {
          const rootTree = await readGitObject(source, "cat-file", "tree", treeOid);
          return storeObject("tree", mutate(rootTree), { literally: true });
        }
      });
      try {
        await assert.rejects(
          verifyModelArtifactRepository(fixture.lock, fixture.clone),
          (error) => hasIssue(error, expectedIssue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("repository verifier rejects a correctly hashed commit without an author", async () => {
  const fixture = await createSyntheticFixture({
    createCommit: ({ treeOid, storeObject }) => storeObject(
      "commit",
      Buffer.from(`tree ${treeOid}\ncommitter Model Artifact Test <model-artifact-test@example.invalid> 0 +0000\n\nMalformed fixture\n`),
      { literally: true }
    )
  });
  try {
    await assert.rejects(
      verifyModelArtifactRepository(fixture.lock, fixture.clone),
      (error) => hasIssue(error, "commit_author_header_invalid")
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier rejects malformed commit header ordering and encoding", async (context) => {
  const identity = "Model Artifact Test <model-artifact-test@example.invalid> 0 +0000";
  const cases = [
    ["tree continuation", "commit_header_continuation_invalid", (treeOid) => Buffer.from(
      `tree ${treeOid}\n unexpected-continuation\nauthor ${identity}\ncommitter ${identity}\n\nMalformed fixture\n`
    )],
    ["committer before author", "commit_author_header_invalid", (treeOid) => Buffer.from(
      `tree ${treeOid}\ncommitter ${identity}\nauthor ${identity}\n\nMalformed fixture\n`
    )],
    ["angle bracket in author name", "commit_author_header_invalid", (treeOid) => Buffer.from(
      `tree ${treeOid}\nauthor A <B> <a@example.invalid> 0 +0000\ncommitter ${identity}\n\nMalformed fixture\n`
    )],
    ["UTF-8 BOM", "commit_tree_header_mismatch", (treeOid) => Buffer.concat([
      Buffer.from([0xef, 0xbb, 0xbf]),
      Buffer.from(`tree ${treeOid}\nauthor ${identity}\ncommitter ${identity}\n\nMalformed fixture\n`)
    ])]
  ];
  for (const [name, expectedIssue, commitBytes] of cases) {
    await context.test(name, async () => {
      const fixture = await createSyntheticFixture({
        createCommit: ({ treeOid, storeObject }) => storeObject(
          "commit",
          commitBytes(treeOid),
          { literally: true }
        ),
        objectOnlyRepository: name === "UTF-8 BOM"
      });
      try {
        await assert.rejects(
          verifyModelArtifactRepository(fixture.lock, fixture.clone),
          (error) => hasIssue(error, expectedIssue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("repository verifier rejects duplicate JSON keys in manifests and configs", async (context) => {
  const cases = [
    ["pipeline", "pipeline.json", (contents) => {
      const path = "pipeline.json";
      contents.set(path, Buffer.from(contents.get(path).toString("utf8").replace(
        '{"name":',
        '{"name":"TrellisImageTo3DPipeline","name":'
      )));
    }],
    ["config", "ckpts/ss_dec_conv3d_16l8_fp16.json", (contents) => {
      const path = "ckpts/ss_dec_conv3d_16l8_fp16.json";
      contents.set(path, Buffer.from(contents.get(path).toString("utf8").replace(
        '{"name":',
        '{"name":"SparseStructureDecoder","name":'
      )));
    }]
  ];
  for (const [name, path, mutateContents] of cases) {
    await context.test(name, async () => {
      const fixture = await createSyntheticFixture({ mutateContents });
      try {
        await assert.rejects(
          verifyModelArtifactRepository(fixture.lock, fixture.clone),
          (error) => hasIssue(error, `repository_json_duplicate_key:${path}`)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("repository verifier fails closed when a committed blob object is unavailable", async () => {
  const fixture = await createSyntheticFixture();
  try {
    const missingOid = fixture.lock.inventory.files.find(({ path }) => path === "pipeline.json").gitBlob.oid;
    const execFileImpl = (file, args, options, callback) => {
      const command = args.slice(2);
      if (command[0] === "cat-file" && command[1] === "-t" && command[2] === missingOid) {
        assert.equal(options.env.GIT_NO_LAZY_FETCH, "1");
        const error = new Error("synthetic missing object");
        error.code = 128;
        callback(error, Buffer.alloc(0), Buffer.from("fatal: missing object\n"));
        return undefined;
      }
      return execFile(file, args, options, callback);
    };
    await assert.rejects(
      verifyModelArtifactRepository(fixture.lock, fixture.clone, { execFileImpl }),
      (error) => hasIssue(error, "repository_blob_object_unreadable:pipeline.json")
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier rejects missing, extra, mode, symlink, directory, and gitlink entries", async (context) => {
  const cases = [
    ["missing", async ({ source, git: runGit }) => {
      await runGit(source, "update-index", "--force-remove", "pipeline.json");
    }, "repository_entry_missing:pipeline.json"],
    ["extra", async ({ source, storeBlob, git: runGit }) => {
      const oid = await storeBlob(Buffer.from("extra\n"));
      await runGit(source, "update-index", "--add", "--cacheinfo", `100644,${oid},unexpected.txt`);
    }, "repository_entry_extra:unexpected.txt"],
    ["executable mode", async ({ source, oidByPath, git: runGit }) => {
      await runGit(source, "update-index", "--cacheinfo", `100755,${oidByPath.get("pipeline.json")},pipeline.json`);
    }, "repository_entry_mode_invalid:pipeline.json"],
    ["symlink mode", async ({ source, oidByPath, git: runGit }) => {
      await runGit(source, "update-index", "--cacheinfo", `120000,${oidByPath.get("pipeline.json")},pipeline.json`);
    }, "repository_entry_mode_invalid:pipeline.json"],
    ["directory in file slot", async ({ source, storeBlob, git: runGit }) => {
      await runGit(source, "update-index", "--force-remove", "pipeline.json");
      const oid = await storeBlob(Buffer.from("nested\n"));
      await runGit(source, "update-index", "--add", "--cacheinfo", `100644,${oid},pipeline.json/child`);
    }, "repository_entry_missing:pipeline.json"],
    ["gitlink", async ({ source, oidByPath, git: runGit }) => {
      const dummyTree = await runGit(source, "write-tree");
      const dummyCommit = await runGit(
        source,
        "-c", "user.name=Model Artifact Test",
        "-c", "user.email=model-artifact-test@example.invalid",
        "commit-tree", dummyTree,
        "-m", "Dummy gitlink target"
      );
      assert.ok(oidByPath.has("pipeline.json"));
      await runGit(source, "update-index", "--cacheinfo", `160000,${dummyCommit},pipeline.json`);
    }, "repository_entry_mode_invalid:pipeline.json"]
  ];
  for (const [name, mutateTree, expectedIssue] of cases) {
    await context.test(name, async () => {
      const fixture = await createSyntheticFixture({ mutateTree });
      try {
        await assert.rejects(
          verifyModelArtifactRepository(fixture.lock, fixture.clone),
          (error) => hasIssue(error, expectedIssue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("repository verifier rejects missing, extra, swapped, and traversal pipeline model mappings", async (context) => {
  const cases = [
    ["missing", (pipeline) => {
      delete pipeline.args.models.slat_decoder_gs;
    }, "pipeline_model_keys_mismatch"],
    ["extra", (pipeline) => {
      pipeline.args.models.unexpected_model = pipeline.args.models.slat_decoder_gs;
    }, "pipeline_model_keys_mismatch"],
    ["swapped", (pipeline) => {
      const first = pipeline.args.models.slat_decoder_gs;
      pipeline.args.models.slat_decoder_gs = pipeline.args.models.slat_decoder_mesh;
      pipeline.args.models.slat_decoder_mesh = first;
    }, "pipeline_model_stem_mismatch:slat_decoder_gs"],
    ["traversal key", (pipeline) => {
      pipeline.args.models["../slat_decoder_gs"] = pipeline.args.models.slat_decoder_gs;
      delete pipeline.args.models.slat_decoder_gs;
    }, "pipeline_actual_key_unsafe:../slat_decoder_gs"],
    ["traversal stem", (pipeline) => {
      pipeline.args.models.slat_decoder_gs = "ckpts/../escape";
    }, "pipeline_actual_stem_unsafe:slat_decoder_gs"]
  ];
  for (const [name, mutatePipeline, expectedIssue] of cases) {
    await context.test(name, async () => {
      const fixture = await createSyntheticFixture({ mutatePipeline });
      try {
        await assert.rejects(
          verifyModelArtifactRepository(fixture.lock, fixture.clone),
          (error) => hasIssue(error, expectedIssue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});

test("repository verifier rejects config class mismatch", async () => {
  const stem = "ckpts/ss_dec_conv3d_16l8_fp16";
  const fixture = await createSyntheticFixture({ configClassOverrides: { [stem]: "WrongDecoder" } });
  try {
    await assert.rejects(
      verifyModelArtifactRepository(fixture.lock, fixture.clone),
      (error) => hasIssue(error, `config_class_mismatch:${stem}.json`)
    );
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("repository verifier rejects pipeline class, DINO name, and normalization mismatch", async (context) => {
  const cases = [
    ["pipeline class", (pipeline) => {
      pipeline.name = "WrongPipeline";
    }, "pipeline_class_mismatch"],
    ["DINO name", (pipeline) => {
      pipeline.args.image_cond_model = "dinov2_wrong";
    }, "pipeline_image_conditioning_model_mismatch"],
    ["mean length", (pipeline) => {
      pipeline.args.slat_normalization.mean.pop();
    }, "pipeline_normalization_mean_mismatch"],
    ["std length", (pipeline) => {
      pipeline.args.slat_normalization.std.push(1);
    }, "pipeline_normalization_std_mismatch"]
  ];
  for (const [name, mutatePipeline, expectedIssue] of cases) {
    await context.test(name, async () => {
      const fixture = await createSyntheticFixture({ mutatePipeline });
      try {
        await assert.rejects(
          verifyModelArtifactRepository(fixture.lock, fixture.clone),
          (error) => hasIssue(error, expectedIssue)
        );
      } finally {
        await rm(fixture.directory, { recursive: true, force: true });
      }
    });
  }
});
