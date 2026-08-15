import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  isAllOfGateResolved,
  loadWmmrDinoSourceArtifactLock
} from "./verify-dino-source-artifact.mjs";
import { loadWmmrModelArtifactLock } from "./verify-trellis-model-artifact.mjs";
import { verifyPatchedTree } from "./verify-trellis-patched-tree.mjs";
import { validateWmmrSelectionContract } from "./verify-trellis-source-selection.mjs";

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
const sourceSelection = validateWmmrSelectionContract(await json(readiness.aiRights.sourceSelectionLock.policyPath));
assert(readiness.aiRights.sourceSelectionLock.status === "selection-lock-recorded-local-verification-pass-runtime-blocked", "source_selection_status_invalid");
assert(readiness.aiRights.sourceSelectionLock.sourceCommit === sourceSelection.source.commit, "source_selection_commit_mismatch");
assert(readiness.aiRights.sourceSelectionLock.flexiCubesCommit === sourceSelection.source.submodules[0].commit, "source_selection_submodule_mismatch");
assert(readiness.aiRights.sourceSelectionLock.fileCount === sourceSelection.selection.fileCount, "source_selection_file_count_mismatch");
assert(readiness.aiRights.sourceSelectionLock.selectionSha256 === sourceSelection.selection.selectionSha256, "source_selection_digest_mismatch");
assert(readiness.aiRights.sourceSelectionLock.policySha256 === sourceSelection.policySha256, "source_selection_policy_digest_mismatch");
assert(readiness.aiRights.sourceSelectionLock.ciReproducible === false, "source_selection_ci_claim_invalid");
assert(readiness.aiRights.sourceSelectionLock.generationAllowed === false, "source_selection_must_not_allow_generation");
assert(sourceSelection.openGates.includes("patchedSourceTreeDigest"), "source_selection_missing_patched_tree_gate");
assert(sourceSelection.openGates.includes("thirdPartyNoticeBundle"), "source_selection_missing_notice_gate");
assert(sourceSelection.openGates.includes("humanRightsSignoff"), "source_selection_missing_human_signoff_gate");
const patchedSource = await verifyPatchedTree();
const artifactLock = await json(readiness.aiRights.patchedSourceArtifact.lockPath);
assert(readiness.aiRights.patchedSourceArtifact.status === "materialized-static-verified-runtime-blocked", "patched_source_status_invalid");
assert(readiness.aiRights.patchedSourceArtifact.treePath === artifactLock.artifact.path, "patched_source_tree_path_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.fileCount === artifactLock.artifact.fileCount, "patched_source_file_count_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.pythonFileCount === 46, "patched_source_python_file_count_invalid");
assert(readiness.aiRights.patchedSourceArtifact.treeSha256 === artifactLock.artifact.treeSha256, "patched_source_tree_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.artifactSha256 === artifactLock.artifactSha256, "patched_source_artifact_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.sourceSelectionSha256 === sourceSelection.selection.selectionSha256, "patched_source_selection_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.sourcePolicySha256 === sourceSelection.policySha256, "patched_source_policy_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.sourceToArtifactSha256 === artifactLock.sourceToArtifact.sha256, "patched_source_mapping_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.staticPolicySyntaxVerificationCiReproducible === true, "patched_source_static_verification_not_reproducible");
assert(readiness.aiRights.patchedSourceArtifact.runtimeImportsExecuted === false, "patched_source_runtime_claim_invalid");
assert(readiness.aiRights.patchedSourceArtifact.runtimeImportGateClosed === false, "patched_source_runtime_gate_must_remain_open");
assert(readiness.aiRights.patchedSourceArtifact.generationAllowed === false, "patched_source_generation_must_remain_blocked");
assert(readiness.aiRights.patchedSourceArtifact.gateSnapshot === "historical-at-materialization", "patched_source_gate_snapshot_invalid");
assert(JSON.stringify(readiness.aiRights.patchedSourceArtifact.resolvedGatesAtMaterialization) === JSON.stringify(artifactLock.resolvedGates), "patched_source_resolved_gates_mismatch");
assert(JSON.stringify(readiness.aiRights.patchedSourceArtifact.openGatesAtMaterialization) === JSON.stringify(artifactLock.openGates), "patched_source_open_gates_mismatch");
assert(patchedSource.artifactSha256 === artifactLock.artifactSha256, "patched_source_verifier_artifact_mismatch");
assert(patchedSource.treeSha256 === artifactLock.artifact.treeSha256, "patched_source_verifier_tree_mismatch");
assert(patchedSource.staticVerification.verificationKind === "static-policy-and-syntax", "patched_source_verification_kind_invalid");
assert(patchedSource.staticVerification.runtimeImportsExecuted === false, "patched_source_runtime_import_claim_invalid");
assert(artifactLock.openGates.includes("offlineImportRuntimeTest"), "patched_source_runtime_gate_removed");
assert(artifactLock.openGates.includes("thirdPartyNoticeBundle"), "patched_source_full_notice_gate_removed");
const modelArtifact = await loadWmmrModelArtifactLock(resolve(root, readiness.aiRights.trellisModelArtifact.lockPath));
assert(readiness.aiRights.trellisModelArtifact.status === modelArtifact.status, "model_artifact_status_mismatch");
assert(readiness.aiRights.trellisModelArtifact.sourceRepository === modelArtifact.source.repository, "model_artifact_repository_mismatch");
assert(readiness.aiRights.trellisModelArtifact.sourceCommit === modelArtifact.source.commit, "model_artifact_commit_mismatch");
assert(readiness.aiRights.trellisModelArtifact.treeOid === modelArtifact.source.treeOid, "model_artifact_tree_mismatch");
assert(readiness.aiRights.trellisModelArtifact.objectFormat === modelArtifact.source.objectFormat, "model_artifact_object_format_mismatch");
assert(readiness.aiRights.trellisModelArtifact.fileCount === modelArtifact.inventory.fileCount, "model_artifact_file_count_mismatch");
assert(readiness.aiRights.trellisModelArtifact.normalBlobCount === modelArtifact.inventory.normalBlobCount, "model_artifact_normal_blob_count_mismatch");
assert(readiness.aiRights.trellisModelArtifact.lfsPointerCount === modelArtifact.inventory.lfsPointerCount, "model_artifact_pointer_count_mismatch");
assert(readiness.aiRights.trellisModelArtifact.inventorySha256 === modelArtifact.inventory.inventorySha256, "model_artifact_inventory_digest_mismatch");
assert(readiness.aiRights.trellisModelArtifact.lockSha256 === modelArtifact.lockSha256, "model_artifact_lock_digest_mismatch");
assert(readiness.aiRights.trellisModelArtifact.selectedPayloadCount === modelArtifact.selectedPayloads.count, "model_artifact_selected_payload_count_mismatch");
assert(readiness.aiRights.trellisModelArtifact.selectedPayloadBytes === modelArtifact.selectedPayloads.totalSize, "model_artifact_selected_payload_bytes_mismatch");
assert(readiness.aiRights.trellisModelArtifact.payloadsDownloadedDuringLockPreparation === false, "model_artifact_payload_download_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.payloadBytesVerified === false, "model_artifact_payload_verification_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.generationAllowed === false, "model_artifact_generation_must_remain_blocked");
assert(readiness.aiRights.trellisModelArtifact.localVerification.status === "pass", "model_artifact_local_verification_missing");
assert(readiness.aiRights.trellisModelArtifact.localVerification.method === "git-object-only-no-checkout", "model_artifact_verification_method_invalid");
assert(/^2026-08-15T\d{2}:\d{2}:\d{2}Z$/.test(readiness.aiRights.trellisModelArtifact.localVerification.verifiedAt), "model_artifact_verification_timestamp_invalid");
assert(readiness.aiRights.trellisModelArtifact.localVerification.ciReproducible === false, "model_artifact_external_verification_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.localVerification.worktreeRequired === false, "model_artifact_worktree_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.localVerification.gitLfsInvokedByVerifier === false, "model_artifact_git_lfs_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.localVerification.networkFallbackAllowed === false, "model_artifact_network_fallback_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.localVerification.networkProtocolsAllowedByVerifier.length === 0, "model_artifact_network_protocol_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.localVerification.payloadBytesReadByVerifier === false, "model_artifact_payload_read_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.localVerification.runtimeExecutedByVerifier === false, "model_artifact_runtime_claim_invalid");
assert(readiness.aiRights.trellisModelArtifact.gateSnapshot === "historical-at-model-artifact-lock", "model_artifact_gate_snapshot_invalid");
assert(JSON.stringify(readiness.aiRights.trellisModelArtifact.resolvedGatesAtLock) === JSON.stringify(modelArtifact.resolvedGates), "model_artifact_resolved_gates_mismatch");
assert(JSON.stringify(readiness.aiRights.trellisModelArtifact.openGatesAtLock) === JSON.stringify(modelArtifact.openGates), "model_artifact_open_gates_mismatch");
assert(modelArtifact.openGates.includes("trellisModelPayloadBytesVerification"), "model_payload_verification_gate_missing");
const dinoArtifact = await loadWmmrDinoSourceArtifactLock(
  resolve(root, readiness.aiRights.dinoSourceArtifactMetadata.lockPath)
);
const dinoSummary = readiness.aiRights.dinoSourceArtifactMetadata;
assert(dinoSummary.status === dinoArtifact.status, "dino_artifact_status_mismatch");
assert(dinoSummary.sourceRepository === dinoArtifact.source.repository, "dino_artifact_repository_mismatch");
assert(dinoSummary.sourceCommit === dinoArtifact.source.commit, "dino_artifact_commit_mismatch");
assert(dinoSummary.treeOid === dinoArtifact.source.treeOid, "dino_artifact_tree_mismatch");
assert(dinoSummary.objectFormat === dinoArtifact.source.objectFormat, "dino_artifact_object_format_mismatch");
assert(dinoSummary.fileCount === dinoArtifact.sourceSnapshot.fileCount, "dino_artifact_file_count_mismatch");
assert(dinoSummary.directoryCount === dinoArtifact.sourceSnapshot.directoryCount, "dino_artifact_directory_count_mismatch");
assert(dinoSummary.sourceContentSha256 === dinoArtifact.sourceSnapshot.contentSha256, "dino_artifact_source_digest_mismatch");
assert(dinoSummary.sourceObjectGraphSha256 === dinoArtifact.sourceSnapshot.objectGraphSha256, "dino_artifact_object_graph_digest_mismatch");
assert(dinoSummary.runtimeClosureFileCount === dinoArtifact.runtimeSourceClosure.fileCount, "dino_runtime_closure_count_mismatch");
assert(dinoSummary.runtimeClosureBytes === dinoArtifact.runtimeSourceClosure.totalSize, "dino_runtime_closure_size_mismatch");
assert(dinoSummary.runtimeSelectionSha256 === dinoArtifact.runtimeSourceClosure.selectionSha256, "dino_runtime_closure_digest_mismatch");
assert(dinoSummary.evidenceFileCount === dinoArtifact.evidence.fileCount, "dino_evidence_count_mismatch");
assert(dinoSummary.evidenceSha256 === dinoArtifact.evidence.evidenceSha256, "dino_evidence_digest_mismatch");
assert(dinoSummary.lockSha256 === dinoArtifact.lockSha256, "dino_lock_digest_mismatch");
assert(dinoSummary.publisherArtifactUrl === dinoArtifact.publisherArtifact.url, "dino_publisher_url_mismatch");
assert(dinoSummary.publisherContentLength === Number(dinoArtifact.publisherArtifact.head.headers["content-length"]), "dino_publisher_size_mismatch");
assert(dinoSummary.publisherSha256 === null && dinoArtifact.publisherArtifact.publisherSha256 === null, "dino_publisher_hash_claim_invalid");
assert(dinoSummary.observedSha256 === null && dinoArtifact.publisherArtifact.observedSha256 === null, "dino_observed_hash_claim_invalid");
assert(dinoSummary.payloadBytesDownloaded === false, "dino_payload_download_claim_invalid");
assert(dinoSummary.payloadBytesVerified === false, "dino_payload_verification_claim_invalid");
assert(dinoSummary.runtimeExecuted === false, "dino_runtime_claim_invalid");
assert(dinoSummary.generationAllowed === false, "dino_generation_must_remain_blocked");
assert(dinoSummary.licenseReviewStatus === "unresolved-human-review-repository-scope-caveat", "dino_license_review_status_invalid");
assert(dinoSummary.sourceLicenseEvidenceStatus === "root-apache-2.0-with-conflicting-repository-readme-human-review", "dino_source_license_status_invalid");
assert(dinoSummary.weightRightsReviewStatus === "model-card-apache-evidence-only-payload-and-redistribution-unresolved", "dino_weight_rights_status_invalid");
assert(dinoSummary.normalCiScope === "canonical-lock-semantics-only-no-external-source-or-head", "dino_normal_ci_scope_invalid");
assert(JSON.stringify(dinoSummary.approvalClaims) === JSON.stringify({
  payloadApproved: false,
  runtimeApproved: false,
  sourceLicenseApproved: false,
  weightLicenseApproved: false
}), "dino_approval_claim_invalid");
assert(dinoSummary.localVerification.status === "pass", "dino_local_verification_missing");
assert(dinoSummary.localVerification.method === "git-object-only-no-checkout-plus-head-only", "dino_local_verification_method_invalid");
assert(/^2026-08-15T\d{2}:\d{2}:\d{2}Z$/.test(dinoSummary.localVerification.verifiedAt), "dino_local_verification_timestamp_invalid");
assert(dinoSummary.localVerification.ciReproducible === false, "dino_external_verification_claim_invalid");
assert(dinoSummary.localVerification.sourceWorktreeRequired === false, "dino_source_worktree_claim_invalid");
assert(dinoSummary.localVerification.sourceNetworkFallbackAllowed === false, "dino_source_network_fallback_claim_invalid");
assert(Array.isArray(dinoSummary.localVerification.sourceNetworkProtocolsAllowedByVerifier)
  && dinoSummary.localVerification.sourceNetworkProtocolsAllowedByVerifier.length === 0,
"dino_source_network_protocol_claim_invalid");
assert(dinoSummary.localVerification.publisherRequestMethod === "HEAD", "dino_publisher_method_claim_invalid");
assert(dinoSummary.localVerification.publisherRedirectsAllowed === false, "dino_publisher_redirect_claim_invalid");
assert(dinoSummary.localVerification.publisherGetFallbackAllowed === false, "dino_publisher_get_claim_invalid");
assert(dinoSummary.localVerification.publisherRangeFallbackAllowed === false, "dino_publisher_range_claim_invalid");
assert(dinoSummary.localVerification.publisherResponseBodyBytesDeliveredToVerifier === false, "dino_response_body_delivery_claim_invalid");
assert(dinoSummary.localVerification.runtimeExecutedByVerifier === false, "dino_verifier_runtime_claim_invalid");
assert(dinoSummary.gateSnapshot === "historical-at-dino-metadata-lock", "dino_gate_snapshot_invalid");
assert(JSON.stringify(dinoSummary.resolvedGatesAtLock) === JSON.stringify(dinoArtifact.resolvedGates), "dino_resolved_gates_mismatch");
assert(JSON.stringify(dinoSummary.openGatesAtLock) === JSON.stringify(dinoArtifact.openGates), "dino_open_gates_mismatch");
assert(dinoArtifact.resolvedGates.length === 1 && dinoArtifact.resolvedGates[0] === "dinoSourceGitObjectLock", "dino_source_gate_not_singly_resolved");
assert(dinoArtifact.openGates.includes("dinoArtifactPayloadBytesVerification"), "dino_payload_gate_missing");
assert(dinoArtifact.openGates.includes("dinoSourceAndArtifactLock"), "dino_composite_gate_missing");
assert(dinoArtifact.gateComposition.dinoSourceAndArtifactLock.operator === "allOf", "dino_gate_composition_invalid");
const expectedCurrentResolvedGates = [
  "dinoSourceGitObjectLock",
  "patchedSourceTreeDigest",
  "trellisModelArtifactLock"
];
const expectedCurrentOpenGates = [
  "dependencyWheelHashLock",
  "dinoArtifactPayloadBytesVerification",
  "dinoDerivedRuntimeArtifactLock",
  "dinoSourceAndArtifactLock",
  "gpuParityAndVramTest",
  "humanRightsSignoff",
  "ociImageDigest",
  "offlineImportRuntimeTest",
  "patchedPytorchQualification",
  "providerTermsSnapshot",
  "sbomAndVulnerabilityReport",
  "thirdPartyNoticeBundle",
  "trellisModelPayloadBytesVerification"
];
assert(JSON.stringify(readiness.aiRights.currentGateState.resolvedGates) === JSON.stringify(expectedCurrentResolvedGates), "current_ai_rights_resolved_gates_invalid");
assert(JSON.stringify(readiness.aiRights.currentGateState.openGates) === JSON.stringify(expectedCurrentOpenGates), "current_ai_rights_open_gates_invalid");
const currentResolvedGates = new Set(readiness.aiRights.currentGateState.resolvedGates);
const currentOpenGates = new Set(readiness.aiRights.currentGateState.openGates);
for (const [gate, composition] of Object.entries(dinoArtifact.gateComposition)) {
  for (const member of composition.members) {
    assert(currentResolvedGates.has(member) !== currentOpenGates.has(member), `current_gate_member_state_invalid:${member}`);
  }
  const compositeResolved = isAllOfGateResolved(composition, readiness.aiRights.currentGateState.resolvedGates);
  assert(currentResolvedGates.has(gate) === compositeResolved, `current_composite_resolved_state_invalid:${gate}`);
  assert(currentOpenGates.has(gate) === !compositeResolved, `current_composite_open_state_invalid:${gate}`);
}
assert(!currentOpenGates.has("trellisModelArtifactLock"), "resolved_model_artifact_gate_still_open");
assert(readiness.compute.primaryPreemptible === true, "gpu_probe_must_be_preemptible");
assert(readiness.compute.experimentGpuResourcesCreated === false, "gpu_resource_created_before_gate");
assert(readiness.compute.gpuQuota === "zero-all-exposed-gpu-families", "gpu_quota_evidence_invalid");
assert(readiness.compute.quotaRequestCreated === false, "gpu_quota_request_unexpectedly_created");
assert(readiness.compute.quotaRequestBlocker === "quota-manager-api-alpha-flag-not-enabled", "gpu_quota_request_blocker_invalid");
assert(readiness.compute.budgetApproval === "pending-explicit-launch-approval", "gpu_budget_must_require_approval");
assert(readiness.compute.independentTeardownGuard === "implementation-ready-pending-provider-fixture", "gpu_teardown_guard_invalid");
assert(readiness.stageRules.stage1WorkBlockedUntil.length === 0, "stage_1_work_must_be_unblocked");
assert(readiness.stageRules.stage1ExitBlockedUntil.length === 0, "stage_1_exit_must_be_unblocked");
assert(readiness.stageRules.stage2RightsAndComputePreparationBlockedUntil.length === 0, "stage_2_preparation_must_be_unblocked");
assert(readiness.resolved.styleBibleApproved === true, "style_bible_not_approved");
assert(readiness.resolved.stage1ArtDirectionGateGreen === true, "stage_1_art_direction_gate_not_green");
assert(readiness.resolved.trellisPatchedSourceTreeDigest === true, "patched_source_tree_digest_not_resolved");
assert(readiness.resolved.trellisStaticPolicySyntaxVerificationCiReproducible === true, "patched_source_static_verification_not_resolved");
assert(readiness.resolved.trellisModelArtifactLock === true, "model_artifact_lock_not_resolved");
assert(readiness.resolved.dinoSourceGitObjectLock === true, "dino_source_git_object_lock_not_resolved");
assert(!Object.hasOwn(readiness.blocked, "styleBibleApproval"), "resolved_style_gate_must_not_remain_blocked");
assert(!readiness.stageRules.probeExecutionBlockedUntil.includes("styleBibleApproval"), "resolved_style_gate_still_blocks_probe");
assert(readiness.stageRules.probeExecutionBlockedUntil.includes("aiRightsFinalApproval"), "probe_missing_rights_gate");
assert(readiness.stageRules.probeExecutionBlockedUntil.includes("gpuQuotaApproval"), "probe_missing_gpu_quota_gate");
assert(readiness.stageRules.probeExecutionBlockedUntil.includes("gpuBudgetApproval"), "probe_missing_gpu_budget_gate");
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
assert(modelInputReferences.length === 0, "model_inputs_must_remain_unapproved");
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
assert(styleBible.status === "approved-art-direction-gate", "unexpected_style_bible_status");
assert(styleBible.approval.status === "approved", "style_bible_approval_missing");
assert(styleBible.approval.ownerRole === "experiment-sponsor", "style_bible_approval_owner_invalid");
assert(styleBible.approval.scope === "principles-and-measurable-rules-only", "style_bible_approval_scope_invalid");
assert(styleBible.approval.referenceImagesLicensed === false, "style_bible_must_not_license_references");
assert(styleBible.approval.modelInputsApproved === false, "style_bible_must_not_approve_model_inputs");
assert(styleBible.approval.aiGenerationAllowed === false, "style_bible_must_not_allow_generation");
assert(JSON.stringify(readiness.stage1.artDirectionApproval) === JSON.stringify(styleBible.approval), "style_bible_readiness_approval_mismatch");
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
