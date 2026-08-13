import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");

async function json(path) {
  return JSON.parse(await readFile(resolve(root, path), "utf8"));
}

test("candidate lock keeps repositories independent", async () => {
  const lock = await json("experiment/warm-modern-meeting-room/candidate-lock.json");
  const repositories = Object.values(lock.candidates).map(({ repository }) => repository);
  assert.equal(new Set(repositories).size, 2);
  assert.ok(repositories.every((repository) => /^vrata-labs\/warm-modern-meeting-room-candidate-0[12]$/.test(repository)));
});

test("scene specification requires the shared functional contract", async () => {
  const schema = await json("schemas/scene-spec.schema.json");
  assert.equal(schema.properties.seats.minItems, 8);
  assert.equal(schema.properties.seats.maxItems, 8);
  assert.deepEqual(schema.$defs.surface.properties.surfaceId.enum, ["debug-main", "whiteboard-wall"]);
  assert.equal(schema.$defs.anchor.properties.id.const, "main");
});

test("functional contract reserves neutral anchors and semantic views", async () => {
  const contract = await json("experiment/warm-modern-meeting-room/functional-contract.json");
  assert.equal(contract.spawn.id, "main");
  assert.equal(contract.seating.count, 8);
  assert.equal(new Set(contract.seating.idSuffixes).size, 8);
  assert.deepEqual(contract.reviewViews.map(({ id }) => id), ["entry", "participant", "presenter", "diagonal-overview"]);
});

test("readiness keeps unresolved human decisions explicit", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  assert.equal(readiness.blocked.aiRightsOwner, null);
  assert.equal(readiness.blocked.gpuBudgetCap, null);
  assert.equal(readiness.blocked.restrictedStorage, null);
  assert.ok(readiness.stageRules.stage2BlockedUntil.includes("aiRightsOwner"));
  assert.ok(readiness.stageRules.stage2BlockedUntil.includes("gpuBudgetCap"));
});

test("platform evidence distinguishes CI from optional image publication", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  assert.match(readiness.platform.planCommit, /^[0-9a-f]{40}$/);
  assert.equal(readiness.resolved.platformPlanCiGreen, true);
  assert.equal(readiness.platform.dockerPublish.requiredForDocsOnlyChange, false);
  assert.equal(readiness.platform.dockerPublish.stagingDeployStarted, false);
});
