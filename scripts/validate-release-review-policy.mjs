import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import Ajv2020 from "ajv/dist/2020.js";

import { parseCanonicalJsonText, SceneContractError } from "../compiler/scene-contract.mjs";

const schema = JSON.parse(readFileSync(new URL("../schemas/release-review-policy.schema.json", import.meta.url), "utf8"));
const validateSchema = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const expectedLists = Object.freeze({
  "realityGate.requiredInputs": Object.freeze([
    "accepted-source-lock",
    "validator-source",
    "scene-reality-contract",
    "user-scenarios-contract",
    "scene-manifest",
    "release-glb",
    "release-asset-ledger"
  ]),
  "realityGate.requiredChecks": Object.freeze([
    "actual-input-bytes-hashed",
    "accepted-source-lock-bound",
    "scene-release-identity-bound",
    "object-part-inventory-exact",
    "unknown-objects-rejected",
    "support-graph-rooted-acyclic",
    "support-contact-per-edge",
    "scale-range-per-object",
    "clearance-gates-evaluated",
    "extras-metrics-evaluated",
    "runtime-seat-bindings-exact",
    "runtime-media-bindings-exact",
    "glb-part-set-exact",
    "glb-node-identity-stable",
    "glb-geometry-evaluated",
    "manifest-runtime-bindings-exact",
    "deterministic-report",
    "report-digest-bound"
  ]),
  "captureGate.requiredInputs": Object.freeze([
    "accepted-source-lock",
    "visual-parity-config",
    "release-glb",
    "reference-images",
    "runtime-capture-images",
    "capture-binding",
    "runtime-diagnostics",
    "visual-report",
    "platform-repository"
  ]),
  "captureGate.optionalInputs": Object.freeze([
    "platform-patch"
  ]),
  "captureGate.requiredChecks": Object.freeze([
    "actual-input-bytes-hashed",
    "accepted-config-digest-bound",
    "accepted-config-all-requirements-enforced",
    "release-glb-bound",
    "platform-full-sha-checked-out",
    "platform-patch-digest-applied-when-specified",
    "runner-executable-argv-bound",
    "workers-exactly-one",
    "environment-exact",
    "view-batches-cover-config-exactly-once",
    "clean-policy-exact",
    "render-settings-exact",
    "runtime-state-loaded",
    "runtime-failure-reason-null",
    "runtime-missing-assets-empty",
    "runtime-asset-byte-count-exact",
    "runtime-inventory-exact",
    "capture-files-digest-bound",
    "metrics-computed-from-image-bytes",
    "per-view-thresholds-passed",
    "aggregate-metrics-recomputed",
    "aggregate-thresholds-passed",
    "deterministic-report",
    "report-digest-bound"
  ]),
  "rightsGate.requiredInputs": Object.freeze([
    "rights-verdict",
    "release-asset-ledger"
  ]),
  "rightsGate.requiredChecks": Object.freeze([
    "actual-input-bytes-hashed",
    "decision-approved",
    "used-asset-closure-exact",
    "screenshot-rights-approved",
    "release-redistribution-approved"
  ]),
  "stagingGate.requiredChecks": Object.freeze([
    "review-room-url-binds-exact-merge-sha",
    "review-room-isolated-from-current-release",
    "current-release-unchanged",
    "affected-room-loaded",
    "affected-room-missing-assets-empty",
    "baseline-rooms-loaded",
    "selector-navigation-works",
    "staging-smoke-suite-run",
    "staging-smoke-suite-passed-or-approved-waiver",
    "suite-deviations-explicitly-attributed"
  ])
});

function schemaIssues(errors) {
  return (errors ?? []).map((error) => {
    const path = error.instancePath ? error.instancePath.replaceAll("/", ":") : ":root";
    return `schema_release_review_policy${path}:${error.keyword}`;
  });
}

function listAt(policy, path) {
  return path.split(".").reduce((value, key) => value[key], policy);
}

function frozenClone(value) {
  if (Array.isArray(value)) return Object.freeze(value.map(frozenClone));
  if (value && typeof value === "object") {
    return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, child]) => [key, frozenClone(child)])));
  }
  return value;
}

export function validateReleaseReviewPolicy(policy) {
  const issues = [];
  if (!validateSchema(policy)) issues.push(...schemaIssues(validateSchema.errors));
  if (issues.length !== 0) throw new SceneContractError(issues);
  for (const [path, expected] of Object.entries(expectedLists)) {
    if (JSON.stringify(listAt(policy, path)) !== JSON.stringify(expected)) issues.push(`release_review_policy_list_mismatch:${path}`);
  }
  if (issues.length !== 0) throw new SceneContractError(issues);
  return frozenClone({
    status: "release-review-policy-valid",
    scope: policy.scope,
    realityCheckCount: policy.realityGate.requiredChecks.length,
    captureCheckCount: policy.captureGate.requiredChecks.length,
    rightsCheckCount: policy.rightsGate.requiredChecks.length,
    stagingCheckCount: policy.stagingGate.requiredChecks.length,
    promotionGate: policy.promotionGate
  });
}

export function parseReleaseReviewPolicy(text) {
  const policy = parseCanonicalJsonText(text, "release_review_policy");
  if (`${JSON.stringify(policy, null, 2)}\n` !== text) throw new SceneContractError(["release_review_policy_encoding_noncanonical"]);
  return validateReleaseReviewPolicy(policy);
}

async function main() {
  const path = process.argv[2];
  if (process.argv.length !== 3 || !path) throw new Error("usage: node scripts/validate-release-review-policy.mjs <policy-path>");
  const report = parseReleaseReviewPolicy(await readFile(path, "utf8"));
  process.stdout.write(`Release review policy is valid: ${report.realityCheckCount} reality, ${report.captureCheckCount} capture, ${report.stagingCheckCount} staging checks.\n`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
