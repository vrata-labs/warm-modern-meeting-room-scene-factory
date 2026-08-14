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

test("readiness opens metadata reference work but blocks generation", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  assert.equal(readiness.storage.status, "ready");
  assert.deepEqual(readiness.stageRules.stage1WorkBlockedUntil, []);
  assert.deepEqual(readiness.stageRules.stage1ExitBlockedUntil, []);
  assert.deepEqual(readiness.stageRules.stage2RightsAndComputePreparationBlockedUntil, []);
  assert.equal(readiness.resolved.styleBibleApproved, true);
  assert.equal(readiness.resolved.stage1ArtDirectionGateGreen, true);
  assert.equal(readiness.stage1.artDirectionApproval.scope, "principles-and-measurable-rules-only");
  assert.equal(readiness.stage1.artDirectionApproval.modelInputsApproved, false);
  assert.equal(readiness.stage1.artDirectionApproval.aiGenerationAllowed, false);
  assert.equal(readiness.aiRights.verdict, "blocked");
  assert.equal(readiness.aiRights.generationAllowed, false);
  assert.ok(readiness.stageRules.probeExecutionBlockedUntil.includes("aiRightsFinalApproval"));
  assert.ok(readiness.stageRules.probeExecutionBlockedUntil.includes("gpuQuotaApproval"));
  assert.ok(readiness.stageRules.probeExecutionBlockedUntil.includes("gpuBudgetApproval"));
  assert.ok(readiness.stageRules.probeExecutionBlockedUntil.includes("gpuLaunchApproval"));
});

test("restricted storage is private, encrypted, and bounded", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  assert.equal(readiness.storage.hardQuotaBytes, 10 * 1024 * 1024 * 1024);
  assert.deepEqual(readiness.storage.anonymousAccess, { read: false, list: false, configRead: false });
  assert.equal(readiness.storage.staticKeyAuthEnabled, false);
  assert.equal(readiness.storage.encryption.mode, "SSE-KMS");
  assert.equal(readiness.storage.encryption.algorithm, "AES-256");
  assert.equal(readiness.storage.encryption.keyDeletionProtection, true);
  assert.equal(readiness.storage.approval.status, "approved-for-stage1-reference-handling");
});

test("reference ledger summaries match policy classifications", async () => {
  const ledger = await json("experiment/warm-modern-meeting-room/reference-ledger.json");
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  const modelInputs = ledger.records.filter(({ modelInputAllowed }) => modelInputAllowed);
  const retrieved = ledger.records.filter(({ retrieved }) => retrieved);
  assert.equal(ledger.records.length, 16);
  assert.equal(ledger.records.filter(({ selected }) => selected).length, 12);
  assert.equal(ledger.records.filter(({ classification }) => classification === "rejected").length, 4);
  assert.equal(new Set(ledger.records.filter(({ selected }) => selected).map(({ category }) => category)).size, 8);
  assert.ok(ledger.records.every(({ retrieved, classification, restrictedStorageRecord }) => !retrieved || (["human-only", "model-input"].includes(classification) && restrictedStorageRecord === "recorded-out-of-band")));
  assert.ok(modelInputs.every(({ classification }) => classification === "model-input"));
  assert.equal(modelInputs.length, 0);
  assert.equal(ledger.selectedCount, ledger.records.filter(({ selected }) => selected).length);
  assert.equal(ledger.rejectedCount, ledger.records.filter(({ classification }) => classification === "rejected").length);
  assert.equal(ledger.modelInputCount, modelInputs.length);
  assert.equal(readiness.stage1.retrievedReferenceCount, retrieved.length);
  assert.equal(readiness.stage1.approvedModelInputCount, modelInputs.length);
  assert.equal(readiness.aiRights.modelInputCount, modelInputs.length);
});

test("GPU policy has a hard timeout and no created experiment resource", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  assert.equal(readiness.compute.primaryPreemptible, true);
  assert.equal(readiness.compute.firstRunMaximumMinutes, 120);
  assert.equal(readiness.compute.proposedCampaignHardCapRub, 1000);
  assert.equal(readiness.compute.budgetApproval, "pending-explicit-launch-approval");
  assert.equal(readiness.compute.gpuQuota, "zero-all-exposed-gpu-families");
  assert.equal(readiness.compute.quotaRequestCreated, false);
  assert.equal(readiness.compute.quotaRequestBlocker, "quota-manager-api-alpha-flag-not-enabled");
  assert.equal(readiness.compute.independentTeardownGuard, "implementation-ready-pending-provider-fixture");
  assert.ok(readiness.stageRules.probeExecutionBlockedUntil.includes("independentTeardownGuard"));
  assert.equal(readiness.compute.experimentGpuResourcesCreated, false);
});

test("platform evidence distinguishes CI from optional image publication", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  assert.match(readiness.platform.planCommit, /^[0-9a-f]{40}$/);
  assert.equal(readiness.resolved.platformPlanCiGreen, true);
  assert.equal(readiness.platform.dockerPublish.requiredForDocsOnlyChange, false);
  assert.equal(readiness.platform.dockerPublish.stagingDeployStarted, false);
});
