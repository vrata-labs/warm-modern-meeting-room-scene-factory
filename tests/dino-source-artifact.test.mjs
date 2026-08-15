import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  DinoSourceArtifactError,
  canonicalDinoLockDigest,
  canonicalDinoSelectionDigest,
  isAllOfGateResolved,
  parseCanonicalDinoSourceArtifactLock,
  validateDinoSourceArtifactLock,
  validateWmmrDinoSourceArtifactContract,
  verifyDinoPublisherHead,
  verifyDinoSourceSnapshot
} from "../scripts/verify-dino-source-artifact.mjs";
import {
  canonicalGitObjectGraphDigest,
  canonicalGitSourceDigest,
  readVerifiedGitRepositorySnapshot
} from "../scripts/verify-trellis-model-artifact.mjs";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const lockPath = resolve(root, "experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json");

async function json() {
  return JSON.parse(await readFile(lockPath, "utf8"));
}

function seal(lock) {
  lock.lockSha256 = canonicalDinoLockDigest(lock);
  return lock;
}

function hasIssue(error, issue) {
  return error instanceof DinoSourceArtifactError && error.issues.includes(issue);
}

function plainRecord(record) {
  return {
    path: record.path,
    mode: record.mode,
    gitBlob: structuredClone(record.gitBlob)
  };
}

function mockedSnapshot(lock) {
  const records = new Map();
  for (const record of [...lock.runtimeSourceClosure.files, ...lock.evidence.files]) {
    records.set(record.path, plainRecord(record));
  }
  records.set("scripts/lint.sh", {
    path: "scripts/lint.sh",
    mode: "100755",
    gitBlob: {
      oid: "f".repeat(40),
      size: 1,
      sha256: "f".repeat(64)
    }
  });
  for (let index = 0; records.size < 174; index += 1) {
    const hex = (index + 1).toString(16);
    const path = `zz-fixture/${String(index).padStart(3, "0")}.txt`;
    records.set(path, {
      path,
      mode: "100644",
      gitBlob: {
        oid: hex.padStart(40, "0"),
        size: index,
        sha256: hex.padStart(64, "0")
      }
    });
  }
  const files = [...records.values()].sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  const directories = new Set();
  for (const file of files) {
    const segments = file.path.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join("/"));
    }
  }
  return {
    ...structuredClone(lock.source),
    commitObjectCount: 1,
    treeObjectCount: directories.size + 1,
    blobObjectCount: files.length,
    directoryCount: directories.size,
    fileCount: files.length,
    modeCounts: structuredClone(lock.sourceSnapshot.modeCounts),
    executablePaths: structuredClone(lock.sourceSnapshot.executablePaths),
    contentSha256: canonicalGitSourceDigest(files),
    objectGraphSha256: canonicalGitObjectGraphDigest(files),
    files
  };
}

function goodHeadResponse(lock) {
  return {
    statusCode: 200,
    headers: structuredClone(lock.publisherArtifact.head.headers),
    bodyBytesReceived: 0,
    requestMethod: "HEAD",
    redirectsFollowed: 0
  };
}

async function git(directory, ...args) {
  const { stdout } = await execFileAsync("git", ["-C", directory, ...args], { encoding: "utf8" });
  return stdout.trim();
}

test("canonical DINO source and publisher metadata lock is immutable and remains blocked", async () => {
  const canonical = await readFile(lockPath, "utf8");
  const lock = validateWmmrDinoSourceArtifactContract(parseCanonicalDinoSourceArtifactLock(canonical));
  assert.equal(lock.lockSha256, "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9");
  assert.equal(canonicalDinoLockDigest(lock), lock.lockSha256);
  assert.equal(lock.sourceSnapshot.contentSha256, "8615fa3237c4123e4fe7fbb24511fa89ffc1bab74277f78134b6c27ee2971d57");
  assert.equal(lock.sourceSnapshot.objectGraphSha256, "e753c5e96b58032fa597d6d8b4e28163c376a244240fa793b2047a280b919848");
  assert.deepEqual(lock.sourceSnapshot.modeCounts, { "100644": 173, "100755": 1 });
  assert.deepEqual(lock.sourceSnapshot.executablePaths, ["scripts/lint.sh"]);
  assert.equal(lock.runtimeSourceClosure.totalSize, 43510);
  assert.equal(lock.runtimeSourceClosure.selectionSha256, "5d9fe22b05aad04a77e33b20faecf72a176fb0de5d977128127415196f87fd4d");
  assert.equal(canonicalDinoSelectionDigest([...lock.runtimeSourceClosure.files].reverse()), lock.runtimeSourceClosure.selectionSha256);
  assert.equal(lock.evidence.files.find(({ path }) => path === "LICENSE").gitBlob.sha256, "600cc67cc4cb2f5ea317dcfc687ad1c74dc4bec8782bbe9db0afd83513b935b7");
  assert.equal(lock.publisherArtifact.publisherSha256, null);
  assert.equal(lock.publisherArtifact.observedSha256, null);
  assert.deepEqual(lock.resolvedGates, ["dinoSourceGitObjectLock"]);
  assert.ok(lock.openGates.includes("dinoArtifactPayloadBytesVerification"));
  assert.ok(lock.openGates.includes("dinoDerivedRuntimeArtifactLock"));
  assert.ok(lock.openGates.includes("dinoSourceAndArtifactLock"));
  assert.equal(lock.boundaries.generationAllowed, false);
  assert.equal(lock.boundaries.runtimeExecuted, false);
});

test("DINO allOf gate composition follows its member truth table", () => {
  const composition = {
    operator: "allOf",
    members: ["dinoSourceGitObjectLock", "dinoArtifactPayloadBytesVerification"]
  };
  assert.equal(isAllOfGateResolved(composition, []), false);
  assert.equal(isAllOfGateResolved(composition, ["dinoSourceGitObjectLock"]), false);
  assert.equal(isAllOfGateResolved(composition, ["dinoArtifactPayloadBytesVerification"]), false);
  assert.equal(isAllOfGateResolved(composition, composition.members), true);
  assert.throws(
    () => isAllOfGateResolved({ operator: "allOf", members: [null] }, [null]),
    (error) => hasIssue(error, "gate_composition_evaluation_invalid")
  );
  assert.throws(
    () => isAllOfGateResolved({ operator: "allOf", members: Array(1) }, []),
    (error) => hasIssue(error, "gate_composition_evaluation_invalid")
  );
});

test("DINO lock parser rejects duplicate keys and non-canonical JSON", async (context) => {
  const canonical = await readFile(lockPath, "utf8");
  for (const [name, contents] of [
    ["duplicate key", canonical.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,')],
    ["spacing", canonical.replace('  "schemaVersion": 1,', '  "schemaVersion" : 1,')]
  ]) {
    await context.test(name, () => {
      assert.throws(
        () => parseCanonicalDinoSourceArtifactLock(contents),
        (error) => hasIssue(error, "lock_json_not_canonical")
      );
    });
  }
});

test("DINO lock rejects source, closure, payload, boundary, and gate drift", async (context) => {
  const original = await json();
  const cases = [
    ["source digest", (lock) => {
      lock.sourceSnapshot.contentSha256 = "0".repeat(64);
    }, "unexpected_source_snapshot", true],
    ["runtime closure", (lock) => {
      lock.runtimeSourceClosure.files[0].gitBlob.sha256 = "0".repeat(64);
    }, "runtime_closure_digest_mismatch", false],
    ["runtime path missing", (lock) => {
      lock.runtimeSourceClosure.files[0].path = null;
    }, "runtime_closure_file_path_unsafe:0", false],
    ["sparse runtime records", (lock) => {
      const files = [...lock.runtimeSourceClosure.files];
      delete files[0];
      lock.runtimeSourceClosure.files = files;
    }, "runtime_closure_file_invalid", false],
    ["exact hub boundary", (lock) => {
      lock.runtimeSourceClosure.files[0].path = "dinov2/hub";
    }, "network_loader_in_runtime_closure:dinov2/hub", false],
    ["malformed runtime record", (lock) => {
      lock.runtimeSourceClosure.files[0] = null;
    }, "runtime_closure_file_invalid", false],
    ["publisher payload hash", (lock) => {
      lock.publisherArtifact.observedSha256 = "0".repeat(64);
    }, "observed_sha256_must_be_null", false],
    ["generation boundary", (lock) => {
      lock.boundaries.generationAllowed = true;
    }, "boundary_must_be_false:generationAllowed", false],
    ["composite resolved", (lock) => {
      lock.resolvedGates.push("dinoSourceAndArtifactLock");
      lock.resolvedGates.sort();
      lock.openGates = lock.openGates.filter((gate) => gate !== "dinoSourceAndArtifactLock");
    }, "resolved_gate_set_invalid", false],
    ["composition weakened", (lock) => {
      lock.gateComposition.dinoSourceAndArtifactLock.operator = "anyOf";
    }, "dino_gate_operator_invalid", false],
    ["derived artifact gate removed", (lock) => {
      lock.openGates = lock.openGates.filter((gate) => gate !== "dinoDerivedRuntimeArtifactLock");
    }, "derived_runtime_artifact_gate_not_open", false]
  ];
  for (const [name, mutate, expectedIssue, wmmrOnly] of cases) {
    await context.test(name, () => {
      const lock = structuredClone(original);
      mutate(lock);
      seal(lock);
      assert.throws(
        () => wmmrOnly ? validateWmmrDinoSourceArtifactContract(lock) : validateDinoSourceArtifactLock(lock),
        (error) => hasIssue(error, expectedIssue)
      );
    });
  }
});

test("candidate runtime source selection is exact and excludes network loaders and broad hub imports", async () => {
  const lock = validateWmmrDinoSourceArtifactContract(await json());
  const paths = lock.runtimeSourceClosure.files.map(({ path }) => path);
  assert.equal(paths.length, 12);
  assert.ok(paths.includes("dinov2/models/vision_transformer.py"));
  assert.ok(paths.includes("dinov2/layers/block.py"));
  assert.ok(!paths.includes("hubconf.py"));
  assert.ok(!paths.some((path) => path.startsWith("dinov2/hub/")));
  assert.deepEqual(lock.runtimeSourceClosure.excludedNetworkLoaderPaths, ["dinov2/hub", "hubconf.py"]);
  assert.equal(lock.offlineConstructor.callable, "dinov2.models.vision_transformer.vit_large");
  assert.deepEqual(lock.offlineConstructor.arguments, {
    img_size: 518,
    patch_size: 14,
    init_values: 1,
    ffn_layer: "mlp",
    block_chunks: 0,
    num_register_tokens: 4,
    interpolate_antialias: true,
    interpolate_offset: 0
  });
  assert.equal(lock.offlineConstructor.stateLoad.strict, true);
  assert.equal(lock.offlineConstructor.torchHubAllowed, false);
  assert.equal(lock.offlineConstructor.networkAllowed, false);
});

test("source snapshot verification derives all aggregates and selected records without network", async () => {
  const lock = await json();
  const snapshot = mockedSnapshot(lock);
  const syntheticLock = structuredClone(lock);
  Object.assign(syntheticLock.sourceSnapshot, {
    treeObjectCount: snapshot.treeObjectCount,
    blobObjectCount: snapshot.blobObjectCount,
    directoryCount: snapshot.directoryCount,
    fileCount: snapshot.fileCount,
    modeCounts: snapshot.modeCounts,
    executablePaths: snapshot.executablePaths,
    contentSha256: snapshot.contentSha256,
    objectGraphSha256: snapshot.objectGraphSha256
  });
  seal(syntheticLock);
  const result = verifyDinoSourceSnapshot(syntheticLock, snapshot);
  assert.equal(result.fileCount, 174);
  assert.equal(result.treeObjectCount, snapshot.treeObjectCount);
  assert.equal(result.runtimeSelectionSha256, lock.runtimeSourceClosure.selectionSha256);
  assert.equal(result.evidenceSha256, lock.evidence.evidenceSha256);
  assert.equal(result.payloadBytesReadByVerifier, false);
  assert.deepEqual(result.networkProtocolsAllowedByVerifier, []);
  assert.equal(result.runtimeExecutedByVerifier, false);
  assert.equal(result.generationAllowed, false);

  const changed = structuredClone(snapshot);
  changed.files.find(({ path }) => path === "dinov2/layers/attention.py").gitBlob.sha256 = "0".repeat(64);
  assert.throws(
    () => verifyDinoSourceSnapshot(syntheticLock, changed),
    (error) => hasIssue(error, "runtime_closure_record_mismatch:dinov2/layers/attention.py")
  );

  const unselectedChanged = structuredClone(snapshot);
  unselectedChanged.files.find(({ path }) => path.startsWith("zz-fixture/000")).gitBlob.sha256 = "0".repeat(64);
  assert.throws(
    () => verifyDinoSourceSnapshot(syntheticLock, unselectedChanged),
    (error) => hasIssue(error, "snapshot_content_digest_not_derived")
  );

  const unselectedOidChanged = structuredClone(snapshot);
  unselectedOidChanged.files.find(({ path }) => path.startsWith("zz-fixture/000")).gitBlob.oid = "0".repeat(40);
  assert.throws(
    () => verifyDinoSourceSnapshot(syntheticLock, unselectedOidChanged),
    (error) => hasIssue(error, "snapshot_object_graph_digest_not_derived")
  );

  const sparseSnapshot = structuredClone(snapshot);
  delete sparseSnapshot.files[0];
  assert.throws(
    () => verifyDinoSourceSnapshot(syntheticLock, sparseSnapshot),
    (error) => hasIssue(error, "snapshot_file_invalid:0")
  );
});

test("HEAD-only verifier accepts exact observed metadata and makes no payload hash claim", async () => {
  const lock = await json();
  let calls = 0;
  const result = await verifyDinoPublisherHead(lock, {
    requestImpl: async (url, options) => {
      calls += 1;
      assert.equal(url, lock.publisherArtifact.url);
      assert.equal(options.method, "HEAD");
      assert.equal(options.maxRedirects, 0);
      assert.equal(options.headers.range, undefined);
      assert.equal(options.headers.Range, undefined);
      assert.equal(options.headers["accept-encoding"], "identity");
      assert.ok(options.timeoutMs > 0 && options.timeoutMs <= 30_000);
      return goodHeadResponse(lock);
    }
  });
  assert.equal(calls, 1);
  assert.equal(result.requestMethod, "HEAD");
  assert.equal(result.redirectsFollowed, 0);
  assert.equal(result.publisherSha256, null);
  assert.equal(result.observedSha256, null);
  assert.equal(result.responseBodyBytesDeliveredToVerifier, false);
  assert.equal(result.getFallbackAllowed, false);
  assert.equal(result.rangeFallbackAllowed, false);
});

test("HEAD-only verifier rejects mismatch, redirect, body, and GET substitution without fallback", async (context) => {
  const lock = await json();
  const cases = [
    ["header mismatch", (response) => {
      response.headers["content-length"] = "1";
    }, "publisher_head_header_mismatch:content-length"],
    ["redirect", (response) => {
      response.statusCode = 302;
      response.headers.location = publisherUrlForTest(lock);
    }, "publisher_head_redirect_forbidden"],
    ["body", (response) => {
      response.bodyBytesReceived = 1;
    }, "publisher_head_unexpected_body"],
    ["GET substitution", (response) => {
      response.requestMethod = "GET";
    }, "publisher_head_response_method_invalid"],
    ["native duplicate header", (response) => {
      response.rawHeaders = Object.entries(response.headers).flatMap(([name, value]) => [name, value]);
      response.rawHeaders.push("ETag", "\"conflicting\"");
    }, "publisher_head_response_header_duplicate:etag"],
    ["forbidden representation header", (response) => {
      response.headers["content-encoding"] = "gzip";
    }, "publisher_head_forbidden_header:content-encoding"]
  ];
  for (const [name, mutate, expectedIssue] of cases) {
    await context.test(name, async () => {
      let calls = 0;
      await assert.rejects(
        verifyDinoPublisherHead(lock, {
          requestImpl: async (_url, options) => {
            calls += 1;
            assert.equal(options.method, "HEAD");
            const response = goodHeadResponse(lock);
            mutate(response);
            return response;
          }
        }),
        (error) => hasIssue(error, expectedIssue)
      );
      assert.equal(calls, 1);
    });
  }
});

function publisherUrlForTest(lock) {
  return lock.publisherArtifact.url;
}

test("exported generic Git snapshot reader retains hardened object-only behavior", async () => {
  const directory = await mkdtemp(join(tmpdir(), "wmmr-dino-git-"));
  const source = join(directory, "source");
  const clone = join(directory, "no-checkout");
  await mkdir(source);
  try {
    await git(source, "init", "-q", "--object-format=sha1");
    await mkdir(join(source, "nested"));
    await writeFile(join(source, "alpha.txt"), "alpha\n");
    await writeFile(join(source, "nested", "tool.sh"), "#!/bin/sh\nexit 0\n");
    await chmod(join(source, "nested", "tool.sh"), 0o755);
    await git(source, "add", "alpha.txt", "nested/tool.sh");
    await git(source, "update-index", "--chmod=+x", "nested/tool.sh");
    await git(
      source,
      "-c", "user.name=DINO Source Test",
      "-c", "user.email=dino-source-test@example.invalid",
      "commit", "-q", "-m", "Synthetic source snapshot"
    );
    await execFileAsync("git", ["clone", "-q", "--no-checkout", source, clone]);
    const expectedSource = {
      repository: await git(clone, "config", "--get", "remote.origin.url"),
      commit: await git(clone, "rev-parse", "HEAD"),
      treeOid: await git(clone, "rev-parse", "HEAD^{tree}"),
      objectFormat: "sha1"
    };
    const commands = [];
    const execFileImpl = (file, args, options, callback) => {
      assert.equal(file, "git");
      assert.deepEqual(args.slice(0, 2), ["-C", clone]);
      assert.equal(options.env.GIT_ALLOW_PROTOCOL, "");
      assert.equal(options.env.GIT_CONFIG_GLOBAL, process.platform === "win32" ? "NUL" : "/dev/null");
      assert.equal(options.env.GIT_CONFIG_NOSYSTEM, "1");
      assert.equal(options.env.GIT_NO_LAZY_FETCH, "1");
      assert.equal(options.env.Git_Dir, undefined);
      commands.push(args.slice(2));
      return execFile(file, args, options, callback);
    };
    const previous = process.env.Git_Dir;
    process.env.Git_Dir = join(source, ".git");
    let snapshot;
    try {
      snapshot = await readVerifiedGitRepositorySnapshot(expectedSource, clone, { execFileImpl });
    } finally {
      if (previous === undefined) delete process.env.Git_Dir;
      else process.env.Git_Dir = previous;
    }
    assert.equal(snapshot.commitObjectCount, 1);
    assert.equal(snapshot.treeObjectCount, 2);
    assert.equal(snapshot.blobObjectCount, 2);
    assert.equal(snapshot.directoryCount, 1);
    assert.equal(snapshot.fileCount, 2);
    assert.deepEqual(snapshot.modeCounts, { "100644": 1, "100755": 1 });
    assert.deepEqual(snapshot.executablePaths, ["nested/tool.sh"]);
    assert.equal(snapshot.contentSha256, canonicalGitSourceDigest(snapshot.files));
    assert.equal(snapshot.objectGraphSha256, canonicalGitObjectGraphDigest(snapshot.files));
    const expectedDigest = createHash("sha256")
      .update(`alpha.txt\x00100644\x006\x00${createHash("sha256").update("alpha\n").digest("hex")}\n`)
      .update(`nested/tool.sh\x00100755\x0017\x00${createHash("sha256").update("#!/bin/sh\nexit 0\n").digest("hex")}\n`)
      .digest("hex");
    assert.equal(snapshot.contentSha256, expectedDigest);
    assert.ok(commands.every(([command]) => ["cat-file", "config", "rev-parse"].includes(command)));
    assert.ok(commands.every((command) => !command.some((arg) => ["checkout", "fetch", "show", "status"].includes(arg))));
    await assert.rejects(
      readVerifiedGitRepositorySnapshot(expectedSource, clone, { maxBlobBytes: 1 }),
      /repository_blob_size_limit_exceeded/
    );
    await assert.rejects(
      readVerifiedGitRepositorySnapshot(expectedSource, clone, { maxFileCount: Number.NaN }),
      /repository_verification_limit_invalid:maxFileCount/
    );
    await assert.rejects(
      readVerifiedGitRepositorySnapshot(expectedSource, clone, { maxBlobBytes: 17 * 1024 * 1024 }),
      /repository_verification_limit_invalid:maxBlobBytes/
    );
    commands.length = 0;
    await assert.rejects(
      readVerifiedGitRepositorySnapshot(expectedSource, clone, { execFileImpl, maxFileCount: 1 }),
      /repository_file_count_exceeded:2/
    );
    assert.ok(commands.every((command) => !(command[0] === "cat-file" && command[1] === "blob")));
    const delayedExecFileImpl = (file, args, options, callback) => execFile(
      file,
      args,
      options,
      (error, stdout, stderr) => setTimeout(() => callback(error, stdout, stderr), 150)
    );
    await assert.rejects(
      readVerifiedGitRepositorySnapshot(expectedSource, clone, {
        execFileImpl: delayedExecFileImpl,
        operationTimeoutMs: 100
      }),
      /repository_verification_deadline_exceeded/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
