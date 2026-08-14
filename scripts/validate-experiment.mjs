import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
assert(readiness.schemaVersion === 2, "invalid_readiness_schema");
assert(/^[0-9a-f]{40}$/.test(readiness.platform.validatorCommit), "invalid_platform_validator_commit");
assert(/^[0-9a-f]{40}$/.test(readiness.platform.planCommit), "invalid_platform_plan_commit");
assert(readiness.platform.dockerPublish.requiredForDocsOnlyChange === false, "docs_only_change_must_not_require_docker_publish");
assert(readiness.platform.dockerPublish.attempts === 2, "invalid_docker_publish_attempt_count");
assert(readiness.platform.dockerPublish.stagingDeployStarted === false, "docs_only_change_must_not_start_staging_deploy");
assert(readiness.repositories.experiment.repository === "vrata-labs/warm-modern-meeting-room-scene-factory", "invalid_experiment_repository");
assert(/^[0-9a-f]{40}$/.test(readiness.repositories.experiment.initialCommit), "invalid_experiment_initial_commit");
assert(readiness.repositories.candidate01.repository.endsWith("candidate-01"), "invalid_candidate_01_repository");
assert(readiness.repositories.candidate02.repository.endsWith("candidate-02"), "invalid_candidate_02_repository");
assert(readiness.repositories.candidate01.repository !== readiness.repositories.candidate02.repository, "candidate_repositories_must_differ");
assert(/^[0-9a-f]{40}$/.test(readiness.repositories.candidate01.initialCommit), "invalid_candidate_01_initial_commit");
assert(/^[0-9a-f]{40}$/.test(readiness.repositories.candidate02.initialCommit), "invalid_candidate_02_initial_commit");
assert(readiness.toolchain.blenderVersion === "4.5.12 LTS", "invalid_blender_version");
assert(/^[0-9a-f]{64}$/.test(readiness.toolchain.linuxArchiveSha256), "invalid_blender_checksum");
assert(/^[0-9a-f]{64}$/.test(readiness.toolchain.linuxBinarySha256), "invalid_blender_binary_checksum");
assert(/^[0-9a-f]{12}$/.test(readiness.toolchain.blenderBuildHash), "invalid_blender_build_hash");
assert(readiness.resolved.blenderBinaryVerified === true, "blender_binary_not_verified");
assert(readiness.resolved.experimentRepositoryCiGreen === true, "experiment_repository_ci_not_green");
assert(readiness.resolved.candidateRepositoryCiGreen === true, "candidate_repository_ci_not_green");
assert(readiness.resolved.mainBranchProtectionEnabled === true, "main_branch_protection_not_enabled");
assert(readiness.resolved.platformPlanMerged === true, "platform_plan_not_merged");
assert(readiness.resolved.platformPlanCiGreen === true, "platform_plan_ci_not_green");
assert(readiness.resolved.fullShaCdnFixture.commit === readiness.historicalAssetsRepository.commit, "cdn_fixture_commit_mismatch");
assert(readiness.resolved.fullShaCdnFixture.accessControlAllowOrigin === "*", "cdn_fixture_cors_invalid");
assert(readiness.resolved.fullShaCdnFixture.cacheControl.includes("immutable"), "cdn_fixture_cache_not_immutable");
assert(readiness.resolved.fullShaCdnFixture.sceneJsonContentType.startsWith("application/json"), "cdn_fixture_scene_json_content_type_invalid");
assert(readiness.resolved.fullShaCdnFixture.sceneGlbContentType === "model/gltf-binary", "cdn_fixture_scene_glb_content_type_invalid");
assert(/^[0-9a-f]{64}$/.test(readiness.resolved.fullShaCdnFixture.sceneJsonSha256), "cdn_fixture_scene_json_checksum_invalid");
assert(/^[0-9a-f]{64}$/.test(readiness.resolved.fullShaCdnFixture.sceneGlbSha256), "cdn_fixture_scene_glb_checksum_invalid");
assert(readiness.storage.status === "ready", "restricted_storage_not_ready");
assert(readiness.storage.hardQuotaBytes === 10737418240, "restricted_storage_quota_invalid");
assert(Object.values(readiness.storage.anonymousAccess).every((value) => value === false), "restricted_storage_must_be_private");
assert(readiness.storage.staticKeyAuthEnabled === false, "restricted_storage_static_keys_not_disabled");
assert(readiness.storage.encryption.mode === "SSE-KMS", "restricted_storage_encryption_invalid");
assert(readiness.storage.encryption.algorithm === "AES-256", "restricted_storage_algorithm_invalid");
assert(readiness.storage.encryption.keyDeletionProtection === true, "restricted_storage_key_not_protected");
assert(readiness.storage.approval.status === "approved-for-stage1-reference-handling", "restricted_storage_approval_missing");
assert(readiness.storage.approval.ownerRole === readiness.storage.ownerRole, "restricted_storage_approval_owner_mismatch");
assert(readiness.aiRights.ownerRole === "experiment-sponsor", "ai_rights_owner_missing");
assert(readiness.aiRights.verdict === "blocked", "ai_generation_must_remain_blocked");
assert(readiness.aiRights.generationAllowed === false, "ai_generation_unexpectedly_allowed");
assert(readiness.compute.primaryPreemptible === true, "gpu_probe_must_be_preemptible");
assert(readiness.compute.experimentGpuResourcesCreated === false, "gpu_resource_created_before_gate");
assert(readiness.compute.gpuQuota === "zero-all-exposed-gpu-families", "gpu_quota_evidence_invalid");
assert(readiness.compute.quotaRequestCreated === false, "gpu_quota_request_unexpectedly_created");
assert(readiness.compute.quotaRequestBlocker === "quota-manager-api-alpha-flag-not-enabled", "gpu_quota_request_blocker_invalid");
assert(readiness.compute.budgetApproval === "pending-explicit-launch-approval", "gpu_budget_must_require_approval");
assert(readiness.compute.independentTeardownGuard === "blocked-pending-folder-scoped-provider-janitor", "gpu_teardown_guard_invalid");
assert(readiness.stageRules.stage1WorkBlockedUntil.length === 0, "stage_1_work_must_be_unblocked");
assert(readiness.stageRules.stage1ExitBlockedUntil.includes("styleBibleApproval"), "stage_1_exit_missing_style_gate");
assert(readiness.stageRules.stage2RightsAndComputePreparationBlockedUntil.length === 0, "stage_2_preparation_must_be_unblocked");
assert(readiness.stageRules.probeExecutionBlockedUntil.includes("aiRightsFinalApproval"), "probe_missing_rights_gate");
assert(readiness.stageRules.probeExecutionBlockedUntil.includes("gpuLaunchApproval"), "probe_missing_launch_gate");
assert(readiness.stageRules.probeExecutionBlockedUntil.includes("independentTeardownGuard"), "probe_missing_teardown_gate");

const referenceLedger = await json("experiment/warm-modern-meeting-room/reference-ledger.json");
assert(referenceLedger.schemaVersion === 1, "invalid_reference_ledger_schema");
assert(referenceLedger.records.length === 16, "invalid_reference_record_count");
const selectedReferences = referenceLedger.records.filter(({ selected }) => selected);
const rejectedReferences = referenceLedger.records.filter(({ classification }) => classification === "rejected");
const modelInputReferences = referenceLedger.records.filter(({ modelInputAllowed }) => modelInputAllowed);
const retrievedReferences = referenceLedger.records.filter(({ retrieved }) => retrieved);
const allowedReferenceClassifications = new Set(["metadata-only", "human-only", "model-input", "rejected"]);
const requiredReferenceCategories = new Set(["architecture", "windows-doors", "ceiling-acoustics", "materials", "furniture", "lighting", "exterior", "lived-in-detail"]);
assert(referenceLedger.selectedCount === selectedReferences.length, "selected_reference_summary_mismatch");
assert(referenceLedger.rejectedCount === rejectedReferences.length, "rejected_reference_summary_mismatch");
assert(referenceLedger.modelInputCount === modelInputReferences.length, "model_input_summary_mismatch");
assert(referenceLedger.retrievalStatus === (retrievedReferences.length === 0 ? "metadata-only-no-source-images-retrieved" : "restricted-files-recorded-out-of-band"), "reference_retrieval_status_mismatch");
assert(readiness.stage1.referenceRecordCount === referenceLedger.records.length, "readiness_reference_count_mismatch");
assert(readiness.stage1.selectedReferenceCount === selectedReferences.length, "readiness_selected_reference_count_mismatch");
assert(readiness.stage1.rejectedReferenceCount === rejectedReferences.length, "readiness_rejected_reference_count_mismatch");
assert(readiness.stage1.retrievedReferenceCount === retrievedReferences.length, "readiness_retrieved_reference_count_mismatch");
assert(readiness.stage1.approvedModelInputCount === modelInputReferences.length, "readiness_model_input_count_mismatch");
assert(readiness.aiRights.modelInputCount === modelInputReferences.length, "ai_rights_model_input_count_mismatch");
assert(new Set(referenceLedger.records.map(({ id }) => id)).size === referenceLedger.records.length, "duplicate_reference_id");
assert(referenceLedger.records.every(({ url }) => /^https:\/\//.test(url)), "reference_url_must_be_https");
assert(referenceLedger.records.every(({ classification }) => allowedReferenceClassifications.has(classification)), "unknown_reference_classification");
assert(referenceLedger.records.every(({ category }) => requiredReferenceCategories.has(category)), "unknown_reference_category");
assert(new Set(selectedReferences.map(({ category }) => category)).size === requiredReferenceCategories.size, "reference_categories_incomplete");
assert(rejectedReferences.every(({ selected, retrieved, rejectionReason }) => selected === false && retrieved === false && typeof rejectionReason === "string"), "rejected_reference_invalid");
assert(selectedReferences.every(({ classification }) => classification !== "rejected"), "rejected_reference_selected");
assert(modelInputReferences.every(({ classification }) => classification === "model-input"), "model_input_classification_invalid");
assert(referenceLedger.records.every(({ retrieved, classification, restrictedStorageRecord }) => !retrieved || (["human-only", "model-input"].includes(classification) && restrictedStorageRecord === "recorded-out-of-band")), "retrieved_reference_storage_record_missing");

const styleBible = await json("experiment/warm-modern-meeting-room/style-bible.json");
assert(styleBible.schemaVersion === 1, "invalid_style_bible_schema");
assert(styleBible.status === "draft-pending-art-direction-gate", "unexpected_style_bible_status");
assert(styleBible.materials.roughnessRange[0] >= 0 && styleBible.materials.roughnessRange[1] <= 1, "invalid_roughness_range");
assert(styleBible.lighting.fixtureTemperatureK[0] >= 2700 && styleBible.lighting.fixtureTemperatureK[1] <= 3000, "invalid_fixture_temperature");
assert(new Set(styleBible.forbidden).size === styleBible.forbidden.length, "duplicate_forbidden_style_rule");

const functionalContract = await json("experiment/warm-modern-meeting-room/functional-contract.json");
assert(functionalContract.schemaVersion === 1, "invalid_functional_contract_schema");
assert(functionalContract.spawn.id === "main", "invalid_functional_contract_spawn");
assert(functionalContract.seating.count === 8, "functional_contract_must_require_eight_seats");
assert(functionalContract.seating.idSuffixes.length === 8, "functional_contract_seat_ids_missing");
assert(new Set(functionalContract.seating.idSuffixes).size === 8, "functional_contract_seat_ids_duplicate");
assert(
  JSON.stringify(functionalContract.mediaSurfaces.map(({ surfaceId }) => surfaceId).sort()) === JSON.stringify(["debug-main", "whiteboard-wall"]),
  "functional_contract_surfaces_invalid"
);
assert(
  JSON.stringify(functionalContract.reviewViews.map(({ id }) => id)) === JSON.stringify(["entry", "participant", "presenter", "diagonal-overview"]),
  "functional_contract_review_views_invalid"
);

const candidateLock = await json("experiment/warm-modern-meeting-room/candidate-lock.json");
assert(candidateLock.schemaVersion === 1, "invalid_candidate_lock_schema");
assert(candidateLock.platformValidatorCommit === readiness.platform.validatorCommit, "candidate_lock_platform_mismatch");
for (const [id, expectedRepository] of [
  ["candidate01", readiness.repositories.candidate01.repository],
  ["candidate02", readiness.repositories.candidate02.repository]
]) {
  const candidate = candidateLock.candidates[id];
  assert(candidate.repository === expectedRepository, `candidate_lock_repository_mismatch:${id}`);
  if (candidate.commit !== null) assert(/^[0-9a-f]{40}$/.test(candidate.commit), `invalid_candidate_commit:${id}`);
}
assert(candidateLock.candidates.candidate01.commit === readiness.repositories.candidate01.initialCommit, "candidate_01_lock_initial_commit_mismatch");
assert(candidateLock.candidates.candidate02.commit === readiness.repositories.candidate02.initialCommit, "candidate_02_lock_initial_commit_mismatch");

const sceneSpecSchema = await json("schemas/scene-spec.schema.json");
assert(sceneSpecSchema.properties.sceneId.pattern.includes("candidate-(01|02)"), "scene_spec_not_candidate_scoped");
assert(sceneSpecSchema.properties.seats.minItems === 8 && sceneSpecSchema.properties.seats.maxItems === 8, "scene_spec_must_require_eight_seats");
assert(sceneSpecSchema.properties.mediaSurfaces.minItems === 2 && sceneSpecSchema.properties.mediaSurfaces.maxItems === 2, "scene_spec_must_require_two_surfaces");
const surfaceIds = sceneSpecSchema.$defs.surface.properties.surfaceId.enum;
assert(JSON.stringify(surfaceIds) === JSON.stringify(["debug-main", "whiteboard-wall"]), "invalid_required_surfaces");

process.stdout.write("Experiment contracts are valid.\n");
