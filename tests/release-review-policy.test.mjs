import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

import { SceneContractError } from "../compiler/scene-contract.mjs";
import {
  parseReleaseReviewPolicy,
  validateReleaseReviewPolicy
} from "../scripts/validate-release-review-policy.mjs";

const root = resolve(import.meta.dirname, "..");
const policyPath = resolve(root, "experiment/warm-modern-meeting-room/release-review-policy.json");

async function policyText() {
  return readFile(policyPath, "utf8");
}

function captureError(operation) {
  try {
    operation();
  } catch (error) {
    assert.ok(error instanceof SceneContractError, error?.stack);
    assert.deepEqual(error.issues, [...error.issues].sort());
    return error;
  }
  assert.fail("expected SceneContractError");
}

function assertDeepFrozen(value) {
  if (!value || typeof value !== "object") return;
  assert.ok(Object.isFrozen(value));
  for (const child of Object.values(value)) assertDeepFrozen(child);
}

test("post-compiler policy requires actual candidate bytes and keeps promotion closed", async () => {
  const report = parseReleaseReviewPolicy(await policyText());
  assert.deepEqual(report, {
    status: "release-review-policy-valid",
    scope: "warm-modern-meeting-room-candidates",
    realityCheckCount: 18,
    captureCheckCount: 24,
    rightsCheckCount: 5,
    stagingCheckCount: 10,
    promotionGate: {
      humanVisualAcceptance: "required",
      automatedEvidenceSubstitutesForHumanAcceptance: false,
      realityGateRequiredBeforePromotion: true,
      captureGateRequiredBeforePromotion: true,
      rightsGateRequiredBeforePromotion: true,
      stagingGateRequiredBeforePromotion: true,
      currentReleaseMayChangeBeforeAcceptance: false,
      reviewReleaseIsCurrent: false,
      publicationReadyBeforeAcceptance: false
    }
  });
  assertDeepFrozen(report);
});

test("policy refuses self-reported evidence and factory execution of candidate code", async () => {
  const policy = JSON.parse(await policyText());
  assert.deepEqual(policy.authority, {
    evidenceProducedBy: "candidate-repository-ci",
    repositoryRevision: "full-commit-sha",
    actualBytesRequired: true,
    selfReportedEvidenceSufficient: false,
    candidateCodeExecutionByFactory: false
  });
  assert.ok(policy.realityGate.requiredChecks.includes("actual-input-bytes-hashed"));
  assert.ok(policy.captureGate.requiredChecks.includes("metrics-computed-from-image-bytes"));
  assert.ok(policy.captureGate.requiredChecks.includes("accepted-config-digest-bound"));
  assert.ok(policy.captureGate.requiredChecks.includes("accepted-config-all-requirements-enforced"));
  assert.ok(policy.captureGate.requiredChecks.includes("per-view-thresholds-passed"));
  assert.ok(policy.captureGate.requiredChecks.includes("aggregate-thresholds-passed"));
});

test("capture policy uses structured argv, one worker and exact clean composition", async () => {
  const policy = JSON.parse(await policyText());
  assert.deepEqual(policy.captureGate.runner, {
    representation: "structured-executable-argv",
    workers: 1,
    environmentBound: true,
    batchesBound: true
  });
  assert.deepEqual(policy.captureGate.cleanPolicy, {
    stripAnchors: true,
    avatarsEnabled: true,
    avatarFallbackCapsulesEnabled: false,
    avatarSeatsEnabled: false
  });
});

test("every required policy list is exact and ordered", async (context) => {
  const paths = [
    "realityGate.requiredInputs",
    "realityGate.requiredChecks",
    "captureGate.requiredInputs",
    "captureGate.optionalInputs",
    "captureGate.requiredChecks",
    "rightsGate.requiredInputs",
    "rightsGate.requiredChecks",
    "stagingGate.requiredChecks"
  ];
  for (const path of paths) await context.test(path, async () => {
    const policy = JSON.parse(await policyText());
    const keys = path.split(".");
    const list = keys.reduce((value, key) => value[key], policy);
    if (list.length === 1) list[0] = "unexpected-input";
    else list.reverse();
    assert.deepEqual(captureError(() => validateReleaseReviewPolicy(policy)).issues, [
      `release_review_policy_list_mismatch:${path}`
    ]);
  });
});

test("schema prevents weakening authority, staging immutability or promotion boundaries", async () => {
  const authority = JSON.parse(await policyText());
  authority.authority.selfReportedEvidenceSufficient = true;
  assert.ok(captureError(() => validateReleaseReviewPolicy(authority)).issues.includes(
    "schema_release_review_policy:authority:selfReportedEvidenceSufficient:const"
  ));

  const staging = JSON.parse(await policyText());
  staging.stagingGate.acceptedReleaseEvidenceMutable = true;
  assert.ok(captureError(() => validateReleaseReviewPolicy(staging)).issues.includes(
    "schema_release_review_policy:stagingGate:acceptedReleaseEvidenceMutable:const"
  ));

  const promotion = JSON.parse(await policyText());
  promotion.promotionGate.publicationReadyBeforeAcceptance = true;
  assert.ok(captureError(() => validateReleaseReviewPolicy(promotion)).issues.includes(
    "schema_release_review_policy:promotionGate:publicationReadyBeforeAcceptance:const"
  ));

  const stagingPrerequisite = JSON.parse(await policyText());
  stagingPrerequisite.promotionGate.stagingGateRequiredBeforePromotion = false;
  assert.ok(captureError(() => validateReleaseReviewPolicy(stagingPrerequisite)).issues.includes(
    "schema_release_review_policy:promotionGate:stagingGateRequiredBeforePromotion:const"
  ));
});

test("canonical parser rejects duplicate keys and noncanonical JSON", async () => {
  const text = await policyText();
  const duplicate = text.replace('  "schemaVersion": 1,', '  "schemaVersion": 1,\n  "schemaVersion": 1,');
  assert.deepEqual(captureError(() => parseReleaseReviewPolicy(duplicate)).issues, ["release_review_policy_duplicate_key"]);
  assert.deepEqual(captureError(() => parseReleaseReviewPolicy(text.slice(0, -1))).issues, ["release_review_policy_encoding_noncanonical"]);
});

test("policy schema names policy rather than unverified release evidence", async () => {
  const schema = JSON.parse(await readFile(resolve(root, "schemas/release-review-policy.schema.json"), "utf8"));
  assert.equal(schema.additionalProperties, false);
  assert.equal(schema.properties.status.const, "post-compiler-review-policy");
  assert.equal(schema.$defs.authority.properties.actualBytesRequired.const, true);
  assert.equal(schema.$defs.authority.properties.selfReportedEvidenceSufficient.const, false);
  assert.equal(schema.$defs.runner.properties.representation.const, "structured-executable-argv");
  assert.equal(schema.$defs.runner.properties.workers.const, 1);
  assert.equal(schema.$defs.stagingGate.properties.acceptedReleaseEvidenceMutable.const, false);
  assert.equal(schema.$defs.promotionGate.properties.stagingGateRequiredBeforePromotion.const, true);
  assert.equal(schema.$defs.promotionGate.properties.publicationReadyBeforeAcceptance.const, false);
});
