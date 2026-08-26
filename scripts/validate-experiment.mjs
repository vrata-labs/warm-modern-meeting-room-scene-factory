import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { parseCanonicalJsonText, parseSceneContract } from "../compiler/scene-contract.mjs";
import {
  compilerSourceAttestationPaths,
  validateCompilerSourceAttestation
} from "../compiler/compile-room-shell.mjs";
import {
  isAllOfGateResolved,
  loadWmmrDinoSourceArtifactLock
} from "./verify-dino-source-artifact.mjs";
import { loadWmmrDinoPayloadArtifactLock } from "./verify-dino-payload-artifact.mjs";
import { loadWmmrDinoDerivedRuntimeArtifactLock } from "./verify-dino-derived-runtime-artifact.mjs";
import { loadWmmrModelArtifactLock } from "./verify-trellis-model-artifact.mjs";
import { loadWmmrTrellisPayloadArtifactLock } from "./verify-trellis-payload-artifact.mjs";
import { verifyPatchedTree } from "./verify-trellis-patched-tree.mjs";
import { validateWmmrSelectionContract } from "./verify-trellis-source-selection.mjs";

const root = resolve(import.meta.dirname, "..");
const execFileAsync = promisify(execFile);

function assert(condition, code) {
  if (!condition) throw new Error(code);
}

async function json(relativePath) {
  return JSON.parse(await readFile(resolve(root, relativePath), "utf8"));
}

async function canonicalJson(relativePath, label) {
  return parseCanonicalJsonText(await readFile(resolve(root, relativePath), "utf8"), label);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

async function sha256(relativePath) {
  return createHash("sha256").update(await readFile(resolve(root, relativePath))).digest("hex");
}

const readiness = await canonicalJson("experiment/warm-modern-meeting-room/readiness.json", "readiness");
const conceptGate = await json("experiment/warm-modern-meeting-room/concept-gate.json");
const compilerSourceSha256 = validateCompilerSourceAttestation(Object.fromEntries(await Promise.all(
  compilerSourceAttestationPaths.map(async (path) => [path, await sha256(path)])
)));
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
assert(readiness.resolved.stage3ContractDiagnostics === true, "stage3_contract_diagnostics_not_resolved");
assert(readiness.stage3.status === "exterior-construction-contract-fixture-validated", "stage3_status_invalid");
assert(readiness.stage3.schemaEngine === "Ajv 8.17.1 with ajv-formats 3.0.1", "stage3_schema_engine_invalid");
assert(readiness.stage3.negativeFixtureCount === 6, "stage3_negative_fixture_count_invalid");
assert(readiness.stage3.stableDiagnostics === true, "stage3_stable_diagnostics_missing");
assert(readiness.stage3.roomShellEntrypointPath === "compiler/compile-room-shell.mjs", "stage3_room_shell_entrypoint_invalid");
assert(readiness.stage3.roomShellBlenderAdapterPath === "compiler/blender-room-shell.py", "stage3_room_shell_adapter_invalid");
assert(readiness.stage3.roomShellCompilerImplemented === true, "stage3_room_shell_compiler_missing");
assert(readiness.stage3.roomShellSyntheticFixtureOnly === true, "stage3_room_shell_fixture_boundary_missing");
assert(readiness.stage3.syntheticRoomShellRemainsFixtureLocked === true, "stage3_synthetic_room_shell_fixture_lock_missing");
assert(readiness.stage3.roomShellExactBlenderIntegrationTest === true, "stage3_room_shell_blender_test_missing");
assert(readiness.stage3.roomOpeningsCompilerImplemented === true, "stage3_room_openings_compiler_missing");
assert(readiness.stage3.roomOpeningsSyntheticFixtureOnly === true, "stage3_room_openings_fixture_boundary_missing");
assert(readiness.stage3.syntheticRoomOpeningsRemainFixtureLocked === true, "stage3_synthetic_room_openings_fixture_lock_missing");
assert(readiness.stage3.roomOpeningCount === 2, "stage3_room_opening_count_invalid");
assert(readiness.stage3.roomOpeningFrameObjectCount === 7, "stage3_room_opening_frame_count_invalid");
assert(readiness.stage3.roomOpeningRevealObjectCount === 3, "stage3_room_opening_reveal_count_invalid");
assert(readiness.stage3.roomOpeningSillObjectCount === 1, "stage3_room_opening_sill_count_invalid");
assert(readiness.stage3.roomProfilesCompilerImplemented === true, "stage3_room_profiles_compiler_missing");
assert(readiness.stage3.roomBaseboardDetailCount === 4, "stage3_room_baseboard_detail_count_invalid");
assert(readiness.stage3.roomBaseboardObjectCount === 5, "stage3_room_baseboard_object_count_invalid");
assert(readiness.stage3.roomMaterialZonesCompiled === true, "stage3_room_material_zones_missing");
assert(readiness.stage3.roomMaterialRecipeCount === 3, "stage3_room_material_recipe_count_invalid");
assert(readiness.stage3.roomMaterialZoneCount === 22, "stage3_room_material_zone_count_invalid");
assert(readiness.stage3.roomMaterialAssignmentCount === 19, "stage3_room_material_assignment_count_invalid");
assert(readiness.stage3.roomUvUnits === "meters-divided-by-textureScaleM", "stage3_room_uv_units_invalid");
assert(readiness.stage3.roomTextureImagesCompiled === false, "stage3_room_textures_must_remain_uncompiled");
assert(readiness.stage3.syntheticGlbExporterImplemented === true, "stage3_synthetic_glb_exporter_missing");
assert(readiness.stage3.syntheticGlbStructuralValidation === true, "stage3_synthetic_glb_validation_missing");
assert(readiness.stage3.syntheticGlbConsecutiveRunCount === 2, "stage3_synthetic_glb_run_count_invalid");
assert(readiness.stage3.syntheticGlbByteIdenticalVerified === true, "stage3_synthetic_glb_reproducibility_missing");
assert(readiness.stage3.syntheticReproducibilityReportImplemented === true, "stage3_synthetic_reproducibility_report_missing");
assert(readiness.stage3.syntheticReproducibilityEntrypointPath === "compiler/verify-room-reproducibility.mjs", "stage3_synthetic_reproducibility_entrypoint_invalid");
assert(readiness.stage3.approvedCandidateSpecificationCreated === true, "approved_candidate_specification_missing");
assert(readiness.stage3.approvedCandidateArchitectureCompilerImplemented === true, "approved_candidate_architecture_compiler_missing");
assert(readiness.stage3.approvedCandidateArchitectureCompileApi === "compileApprovedCandidateArchitecture", "approved_candidate_architecture_compile_api_invalid");
assert(readiness.stage3.approvedCandidateArchitectureReproducibilityApi === "verifyApprovedCandidateArchitectureReproducibility", "approved_candidate_architecture_reproducibility_api_invalid");
assert(readiness.stage3.approvedCandidateGitBlobInputCount === 6, "approved_candidate_git_blob_input_count_invalid");
assert(readiness.stage3.approvedCandidateGitBlobSourceLocked === true, "approved_candidate_git_blob_source_not_locked");
assert(readiness.stage3.approvedCandidateCurrentCommit === "26d3af6e2720576113431c22b9443533b919f390", "approved_candidate_current_commit_invalid");
assert(readiness.stage3.approvedCandidateCurrentTreeOid === "f9974b153861112cd5b53bcbdc5d5530227edbe1", "approved_candidate_current_tree_invalid");
assert(readiness.stage3.approvedCandidateCurrentValidatorCommit === "c3157b65c739bf784d5b8654e0808a3c3a84f611", "approved_candidate_current_validator_invalid");
assert(readiness.stage3.approvedCandidateArchitectureBaselineCommit === "df564befcd65cb51a345fa9d315e40cadef6e563"
  && readiness.stage3.approvedCandidateArchitectureBaselineGitBlobInputCount === 4, "approved_candidate_architecture_baseline_invalid");
assert(readiness.stage3.approvedCandidateComponentBaselineCommit === "8fec157a37bf619797f1ff200ccc32f611f94c18"
  && readiness.stage3.approvedCandidateComponentBaselineTreeOid === "2b0b3ecf36f80cad2301e325e821fd1bf48d3606"
  && readiness.stage3.approvedCandidateComponentBaselineValidatorCommit === "60617c021a8434f6687af038706b411e2e4b265c"
  && readiness.stage3.approvedCandidateComponentBaselineGitBlobInputCount === 5, "approved_candidate_component_baseline_invalid");
assert(readiness.stage3.approvedCandidateArchitectureSemanticSha256 === "ae24faad5306191667195c0157db9cd5c6d800875492cdf242fe32d1ff962b33",
  "approved_candidate_architecture_semantic_digest_invalid");
assert(stableStringify(readiness.stage3.approvedCandidateCompilerSourceSha256) === stableStringify(compilerSourceSha256),
  "approved_candidate_compiler_source_attestation_invalid");
assert(readiness.stage3.approvedCandidateArchitectureMeshCount === 19, "approved_candidate_architecture_mesh_count_invalid");
assert(readiness.stage3.approvedCandidateArchitectureMaterialCount === 3, "approved_candidate_architecture_material_count_invalid");
assert(readiness.stage3.approvedCandidateArchitectureGlbByteIdenticalVerified === true, "approved_candidate_architecture_reproducibility_missing");
assert(readiness.stage3.approvedCandidateArchitectureGlbSha256 === "85ff61f70d56fad104c3621aa325e3ece2fe1e47ca66eb015339884c3a69bf66", "approved_candidate_architecture_glb_digest_invalid");
assert(readiness.stage3.approvedCandidateArchitectureGlbByteLength === 38536, "approved_candidate_architecture_glb_size_invalid");
assert(readiness.stage3.approvedCandidateArchitectureReopenInspectionSha256 === "64587b5fa28b02560084960d4e48c28ca6706222a2b59ce940bae9d2039b0618", "approved_candidate_architecture_reopen_digest_invalid");
assert(readiness.stage3.approvedCandidateArchitectureBinaryByteLength === 17376, "approved_candidate_architecture_binary_size_invalid");
assert(readiness.stage3.approvedCandidateArchitectureDecodedVertexCount === 528
  && readiness.stage3.approvedCandidateArchitectureDecodedIndexCount === 852
  && readiness.stage3.approvedCandidateArchitectureDecodedTriangleCount === 284
  && readiness.stage3.approvedCandidateArchitectureDistinctPositionCount === 176, "approved_candidate_architecture_geometry_evidence_invalid");
assert(readiness.stage3.approvedCandidateComponentsCompilerImplemented === true, "approved_candidate_components_compiler_missing");
assert(readiness.stage3.approvedCandidateComponentsCompileApi === "compileApprovedCandidateComponents", "approved_candidate_components_compile_api_invalid");
assert(readiness.stage3.approvedCandidateComponentsReproducibilityApi === "verifyApprovedCandidateComponentsReproducibility", "approved_candidate_components_reproducibility_api_invalid");
assert(readiness.stage3.approvedCandidateComponentsSpecified === true
  && readiness.stage3.approvedCandidateComponentsCompiled === true, "approved_candidate_components_claim_invalid");
assert(readiness.stage3.approvedCandidateComponentCount === 11
  && readiness.stage3.approvedCandidateComponentPartObjectCount === 38
  && readiness.stage3.approvedCandidateComponentMeshCount === 57
  && readiness.stage3.approvedCandidateComponentMaterialCount === 5, "approved_candidate_component_inventory_invalid");
assert(readiness.stage3.approvedCandidateComponentGlbByteIdenticalVerified === true
  && readiness.stage3.approvedCandidateComponentGlbSha256 === "a6e67219590ae4bbc1e887f97f9a7c071c924943223a90ef3560bdd7b06e5c69"
  && readiness.stage3.approvedCandidateComponentGlbByteLength === 557976, "approved_candidate_component_glb_evidence_invalid");
assert(readiness.stage3.approvedCandidateComponentBlendByteLength === 1279979
  && JSON.stringify(readiness.stage3.approvedCandidateComponentBlendSha256) === JSON.stringify([
    "a6de320caa4a297d56bbda916f395c735c901e90e39d023b27a28a297be2c4bf",
    "62748e1ed54ccdca034abc4849f269227ec6de46ecd7174e647bc1597f0f6cec"
  ])
  && readiness.stage3.approvedCandidateComponentBlendByteIdentical === false, "approved_candidate_component_blend_evidence_invalid");
assert(readiness.stage3.approvedCandidateComponentReopenInspectionSha256 === "5a1014f9fad8f12929d43d7fae0fd8155274754dc514db6590151bbbcda5e810", "approved_candidate_component_reopen_evidence_invalid");
assert(readiness.stage3.approvedCandidateComponentBinaryByteLength === 485448
  && readiness.stage3.approvedCandidateComponentDecodedVertexCount === 15120
  && readiness.stage3.approvedCandidateComponentDecodedIndexCount === 22284
  && readiness.stage3.approvedCandidateComponentDecodedTriangleCount === 7428
  && readiness.stage3.approvedCandidateComponentDistinctPositionCount === 3824
  && readiness.stage3.approvedCandidateComponentDecodedNormalCount === 15120
  && readiness.stage3.approvedCandidateComponentObjectVertexCount === 3824
  && readiness.stage3.approvedCandidateComponentObjectFaceCount === 3858, "approved_candidate_component_geometry_evidence_invalid");
assert(stableStringify(readiness.stage3.approvedCandidateComponentKhronosValidation) === stableStringify({
  package: "gltf-validator",
  version: "2.0.0-dev.3.10",
  errors: 0,
  warnings: 0,
  infos: 57,
  hints: 0
}), "approved_candidate_component_khronos_validation_invalid");
assert(readiness.stage3.approvedCandidateComponentModifiersApplied === true
  && readiness.stage3.approvedCandidateComponentRemainingModifierCount === 0, "approved_candidate_component_modifier_evidence_invalid");
assert(readiness.stage3.approvedCandidateMediaSurfaceSourceLoaderApi === "loadApprovedCandidateMediaSurfaceSource"
  && readiness.stage3.approvedCandidateMediaSurfacesCompileApi === "compileApprovedCandidateMediaSurfaces"
  && readiness.stage3.approvedCandidateMediaSurfacesReproducibilityApi === "verifyApprovedCandidateMediaSurfacesReproducibility"
  && readiness.stage3.approvedCandidateMediaSurfaceInputKind === "approved-candidate-media-surfaces", "approved_candidate_media_surface_api_invalid");
assert(readiness.stage3.approvedCandidateMediaSurfacesSpecified === true
  && readiness.stage3.approvedCandidateMediaSurfacesCompiled === true
  && readiness.stage3.approvedCandidateMediaSurfaceCount === 2, "approved_candidate_media_surface_projection_claim_invalid");
assert(readiness.stage3.approvedCandidateMediaSurfaceProjectionSha256 === "352b31af533049d7fe84f1ecb55643db85e7258ceff1e2d87be8f8785e38a4fb"
  && readiness.stage3.approvedCandidateMediaSurfaceProjectionByteLength === 1022
  && readiness.stage3.approvedCandidateMediaSurfaceProjectionRepresentation === "platform-runtime-plane"
  && readiness.stage3.approvedCandidateMediaSurfaceProjectionByteIdenticalVerified === true
  && readiness.stage3.approvedCandidateMediaSurfacePurposeIncluded === false, "approved_candidate_media_surface_projection_evidence_invalid");
assert(readiness.stage3.approvedCandidateMediaSurfaceOutputAtomicNoClobber === true
  && readiness.stage3.approvedCandidateMediaSurfaceRepositoryRootsRejected === true, "approved_candidate_media_surface_output_safety_invalid");
assert(readiness.stage3.exteriorConstructionSchemaPath === "schemas/exterior-constructions.schema.json"
  && readiness.stage3.exteriorConstructionValidFixturePath === "tests/fixtures/exterior-construction/exterior-constructions.valid.json"
  && readiness.stage3.exteriorConstructionValidatorApi === "parseExteriorConstructionContract"
  && readiness.stage3.exteriorConstructionContractImplemented === true
  && readiness.stage3.exteriorConstructionContractStatus === "fixture-validated-awaiting-candidate-source"
  && readiness.stage3.exteriorConstructionFixtureOnly === true
  && readiness.stage3.exteriorConstructionObjectCount === 4
  && readiness.stage3.exteriorConstructionMaterialCount === 3
  && readiness.stage3.exteriorConstructionNegativeFixtureCount === 4, "exterior_construction_contract_claim_invalid");
assert(readiness.stage3.approvedCandidateExteriorSpecified === false
  && readiness.stage3.approvedCandidateExteriorCompiled === false
  && readiness.stage3.approvedCandidateLightingCompiled === false, "approved_candidate_out_of_scope_compile_claim_invalid");
assert(readiness.stage3.approvedCandidateReleaseArtifactsCreated === false
  && readiness.stage3.approvedCandidateArtifactBytesIncludedInRepository === false, "approved_candidate_media_surface_release_boundary_invalid");
assert(readiness.stage3.blenderCompilerImplemented === false, "stage3_must_not_claim_full_candidate_blender_compiler");
assert(readiness.stage3.byteIdenticalExportsVerified === false, "stage3_must_not_claim_final_candidate_export_reproducibility");
assert(readiness.stage3.finalCandidateGlbVerified === false, "stage3_must_not_claim_final_candidate_glb");
assert(readiness.stage3.publicationReady === false, "stage3_must_not_claim_publication_readiness");
assert(conceptGate.status === "low-fidelity-concept-selected", "concept_gate_status_invalid");
assert(conceptGate.gate?.conceptCount === 3
  && JSON.stringify(conceptGate.gate?.anonymousLabels) === JSON.stringify(["1", "2", "3"])
  && conceptGate.gate?.selectedConceptId === "concept-03"
  && conceptGate.gate?.selectedRevisionId === "concept-03-functional", "concept_gate_selection_invalid");
assert(conceptGate.concepts?.length === 3 && new Set(conceptGate.concepts.map(({ id }) => id)).size === 3, "concept_gate_concept_set_invalid");
assert(new Set(conceptGate.concepts.map(({ previewSha256 }) => previewSha256)).size === 3, "concept_gate_preview_set_invalid");
assert(conceptGate.concepts?.filter(({ selected }) => selected).length === 1, "concept_gate_must_select_exactly_one");
const selectedConcept = conceptGate.concepts?.find(({ selected }) => selected);
assert(selectedConcept?.id === "concept-03" && selectedConcept.revisions?.length === 2, "concept_gate_revision_invalid");
assert(selectedConcept.revisions[0]?.id === "concept-03-corrected"
  && selectedConcept.revisions[0]?.previewSha256 === "f52b3722e71dd231ebe80424f0411e9771670fa37aff01eebbce42ff7d4c0a21"
  && selectedConcept.revisions[0]?.approved === false
  && selectedConcept.revisions[1]?.id === "concept-03-functional"
  && selectedConcept.revisions[1]?.previewSha256 === "cd7456afb5c9c10ebf3d4a16fdb5173af2c68a9faf9ce2798ec8238e257309c7"
  && selectedConcept.revisions[1]?.approved === true, "concept_gate_preview_digest_invalid");
assert(conceptGate.assignment?.candidateRepository === "vrata-labs/warm-modern-meeting-room-candidate-01", "concept_gate_candidate_invalid");
assert(conceptGate.assignment?.candidateMergeCommit === "df564befcd65cb51a345fa9d315e40cadef6e563", "concept_gate_candidate_commit_invalid");
const boundaryKeys = ["approvedCandidateSpecificationCreated", "assetRightsCleared", "modelInputUsed", "previewBinariesIncludedInPublicRepositories", "publicationReady", "referenceImagesUsed", "releaseArtifactsCreated"];
assert(JSON.stringify(Object.keys(conceptGate.boundaries ?? {}).sort()) === JSON.stringify(boundaryKeys)
  && conceptGate.boundaries.approvedCandidateSpecificationCreated === true
  && boundaryKeys.filter((key) => key !== "approvedCandidateSpecificationCreated").every((key) => conceptGate.boundaries[key] === false), "concept_gate_boundaries_invalid");
assert(readiness.asOf === "2026-08-26", "readiness_date_invalid");
assert(readiness.candidateConceptGate.status === "exact-candidate-specification-validated", "candidate_concept_gate_status_invalid");
assert(readiness.candidateConceptGate.conceptCount === conceptGate.gate.conceptCount
  && readiness.candidateConceptGate.selectedConceptId === conceptGate.gate.selectedConceptId
  && readiness.candidateConceptGate.selectedRevisionId === conceptGate.gate.selectedRevisionId
  && readiness.candidateConceptGate.selectedConceptPreviewSha256 === selectedConcept.revisions[1].previewSha256
  && readiness.candidateConceptGate.candidateRepository === conceptGate.assignment.candidateRepository
  && readiness.candidateConceptGate.candidateMergeCommit === conceptGate.assignment.candidateMergeCommit
  && readiness.candidateConceptGate.candidatePostMergeCiRun === conceptGate.assignment.candidatePostMergeCiRun, "candidate_concept_gate_readiness_drift");
assert(boundaryKeys.every((key) => readiness.candidateConceptGate[key] === conceptGate.boundaries[key]), "candidate_concept_gate_boundary_drift");
assert(readiness.candidateConceptGate.sceneContractValidatorCommit === "fa9767913fc3cc2b1d06fc00c44ed6a26369b219"
  && readiness.candidateConceptGate.specificationSha256 === "29d76ca0feaefd4bf9cac9ebd25113c601e358c939778c4a0f43f3f94b58e0dd"
  && readiness.candidateConceptGate.assetLedgerSha256 === "389335100442f2f6806d84be7074cb7a7c60022b588b6a7b4df9a05778dec80d"
  && readiness.candidateConceptGate.generationLedgerSha256 === "42d49a3ad4f0f2a0b6f490461a30ed27a904396d51c34c9742862e02ba818930", "candidate_scene_contract_lock_invalid");
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
assert(readiness.aiRights.verdict === "allow-pruned-probe", "ai_internal_probe_verdict_invalid");
assert(readiness.aiRights.generationAllowed === true, "ai_internal_probe_not_allowed");
assert(readiness.aiRights.generationScope === "internal-pruned-mesh-probe-with-project-authored-inputs", "ai_generation_scope_invalid");
const generationProbeSummary = readiness.aiRights.gpuGenerationProbe;
const generationProbeLock = await json(generationProbeSummary.lockPath);
const { lockSha256: generationProbeLockSha256, ...generationProbePayload } = generationProbeLock;
assert(generationProbeLockSha256 === createHash("sha256").update(stableStringify(generationProbePayload)).digest("hex"), "generation_probe_self_digest_invalid");
assert(generationProbeSummary.lockSha256 === generationProbeLockSha256, "generation_probe_readiness_digest_mismatch");
assert(generationProbeLock.status === "internal-gpu-generation-probe-pass", "generation_probe_status_invalid");
assert(generationProbeLock.generation.status === "gpu-generation-probe-pass", "generation_result_status_invalid");
assert(generationProbeLock.generation.rawMesh.vertexCount === generationProbeSummary.vertexCount, "generation_probe_vertex_count_mismatch");
assert(generationProbeLock.generation.rawMesh.faceCount === generationProbeSummary.faceCount, "generation_probe_face_count_mismatch");
assert(generationProbeLock.generation.prohibitedModulesObserved.length === 0, "generation_probe_prohibited_module_observed");
assert(generationProbeLock.boundaries.generationExecuted === true, "generation_probe_execution_missing");
assert(generationProbeLock.boundaries.generatedBinaryAddedToPublicGit === false, "generation_probe_binary_publication_claim_invalid");
assert(generationProbeLock.boundaries.productionPublicationApproved === false, "generation_probe_production_approval_claim_invalid");
assert(generationProbeLock.source.reproductionHarness.sha256 === await sha256(generationProbeLock.source.reproductionHarness.path), "generation_probe_harness_digest_mismatch");
assert(generationProbeLock.input.generatorSha256 === await sha256(generationProbeLock.input.generatorPath), "generation_probe_input_generator_digest_mismatch");
assert(generationProbeLock.reviewArtifacts.preparationScriptSha256 === await sha256(generationProbeLock.reviewArtifacts.preparationScriptPath), "generation_probe_preparation_script_digest_mismatch");
assert(!/(?:bucket|objectKey|storageLocator|serviceAccountId|kmsKeyId|publicIp)/i.test(JSON.stringify(generationProbeLock)), "generation_probe_private_locator_published");
const windowTrimProbeSummary = readiness.aiRights.gpuWindowTrimGenerationProbe;
const windowTrimProbeLock = await json(windowTrimProbeSummary.lockPath);
const { lockSha256: windowTrimProbeLockSha256, ...windowTrimProbePayload } = windowTrimProbeLock;
assert(windowTrimProbeLockSha256 === createHash("sha256").update(stableStringify(windowTrimProbePayload)).digest("hex"), "window_trim_probe_self_digest_invalid");
assert(windowTrimProbeSummary.lockSha256 === windowTrimProbeLockSha256, "window_trim_probe_readiness_digest_mismatch");
assert(windowTrimProbeLock.status === "internal-gpu-component-generation-probe-pass", "window_trim_probe_status_invalid");
assert(windowTrimProbeLock.component === "window-and-trim-assembly", "window_trim_probe_component_invalid");
assert(windowTrimProbeLock.generation.status === "gpu-generation-probe-pass", "window_trim_generation_result_status_invalid");
assert(windowTrimProbeLock.generation.rawMesh.vertexCount === windowTrimProbeSummary.vertexCount, "window_trim_probe_vertex_count_mismatch");
assert(windowTrimProbeLock.generation.rawMesh.faceCount === windowTrimProbeSummary.faceCount, "window_trim_probe_face_count_mismatch");
assert(windowTrimProbeLock.reviewArtifacts.optimizedGlb.triangleCount === windowTrimProbeSummary.optimizedTriangleCount, "window_trim_probe_optimized_triangle_count_mismatch");
assert(windowTrimProbeLock.reviewArtifacts.validatorReport.errors === 0 && windowTrimProbeLock.reviewArtifacts.validatorReport.warnings === 0, "window_trim_probe_validator_failed");
assert(windowTrimProbeLock.generation.prohibitedModulesObserved.length === 0, "window_trim_probe_prohibited_module_observed");
assert(windowTrimProbeLock.restrictedRetention.fullReadbackHashesMatched === true, "window_trim_probe_readback_missing");
assert(windowTrimProbeLock.restrictedRetention.incompleteMultipartUploadCount === 0, "window_trim_probe_multipart_upload_remaining");
assert(windowTrimProbeLock.boundaries.generationExecuted === true, "window_trim_probe_execution_missing");
assert(windowTrimProbeLock.boundaries.generatedBinaryAddedToPublicGit === false, "window_trim_probe_binary_publication_claim_invalid");
assert(windowTrimProbeLock.boundaries.productionPublicationApproved === false, "window_trim_probe_production_approval_claim_invalid");
assert(windowTrimProbeLock.source.reproductionHarness.sha256 === await sha256(windowTrimProbeLock.source.reproductionHarness.path), "window_trim_probe_harness_digest_mismatch");
assert(windowTrimProbeLock.input.generatorSha256 === await sha256(windowTrimProbeLock.input.generatorPath), "window_trim_probe_input_generator_digest_mismatch");
assert(windowTrimProbeLock.reviewArtifacts.preparationScriptSha256 === await sha256(windowTrimProbeLock.reviewArtifacts.preparationScriptPath), "window_trim_probe_preparation_script_digest_mismatch");
assert(!/(?:bucket|objectKey|storageLocator|serviceAccountId|kmsKeyId|publicIp)/i.test(JSON.stringify(windowTrimProbeLock)), "window_trim_probe_private_locator_published");
assert(readiness.aiRights.gpuComponentProbeFeasibility.status === "green-two-of-three-component-probes-passed", "component_probe_feasibility_status_invalid");
assert(readiness.aiRights.gpuComponentProbeFeasibility.successfulCount >= readiness.aiRights.gpuComponentProbeFeasibility.requiredSuccessfulCount, "component_probe_feasibility_threshold_not_met");
assert(readiness.aiRights.gpuComponentProbeFeasibility.productionPublicationApproved === false, "component_probe_feasibility_must_not_approve_publication");
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
assert(readiness.aiRights.patchedSourceArtifact.status === "materialized-static-verified-constructor-allocation-deferred-runtime-blocked", "patched_source_status_invalid");
assert(readiness.aiRights.patchedSourceArtifact.treePath === artifactLock.artifact.path, "patched_source_tree_path_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.fileCount === artifactLock.artifact.fileCount, "patched_source_file_count_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.pythonFileCount === 46, "patched_source_python_file_count_invalid");
assert(readiness.aiRights.patchedSourceArtifact.treeSha256 === artifactLock.artifact.treeSha256, "patched_source_tree_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.artifactSha256 === artifactLock.artifactSha256, "patched_source_artifact_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.sourceSelectionSha256 === sourceSelection.selection.selectionSha256, "patched_source_selection_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.sourcePolicySha256 === sourceSelection.policySha256, "patched_source_policy_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.sourceToArtifactSha256 === artifactLock.sourceToArtifact.sha256, "patched_source_mapping_digest_mismatch");
assert(readiness.aiRights.patchedSourceArtifact.constructorDeviceAllocationDeferred === true, "patched_source_constructor_allocation_not_deferred");
assert(readiness.aiRights.patchedSourceArtifact.staticPolicySyntaxVerificationCiReproducible === true, "patched_source_static_verification_not_reproducible");
assert(readiness.aiRights.patchedSourceArtifact.runtimeImportsExecuted === false, "patched_source_runtime_claim_invalid");
assert(readiness.aiRights.patchedSourceArtifact.runtimeImportGateClosed === false, "patched_source_runtime_gate_must_remain_open");
assert(readiness.aiRights.patchedSourceArtifact.generationAllowed === false, "patched_source_generation_must_remain_blocked");
assert(readiness.aiRights.patchedSourceArtifact.gateSnapshot === "historical-at-artifact-revision", "patched_source_gate_snapshot_invalid");
assert(JSON.stringify(readiness.aiRights.patchedSourceArtifact.resolvedGatesAtRevision) === JSON.stringify(artifactLock.resolvedGates), "patched_source_resolved_gates_mismatch");
assert(JSON.stringify(readiness.aiRights.patchedSourceArtifact.openGatesAtRevision) === JSON.stringify(artifactLock.openGates), "patched_source_open_gates_mismatch");
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
const trellisPayload = await loadWmmrTrellisPayloadArtifactLock(
  resolve(root, readiness.aiRights.trellisPayloadBytes.lockPath)
);
const trellisPayloadSummary = readiness.aiRights.trellisPayloadBytes;
assert(trellisPayloadSummary.status === trellisPayload.status, "trellis_payload_status_mismatch");
assert(trellisPayloadSummary.lockSha256 === trellisPayload.lockSha256, "trellis_payload_lock_digest_mismatch");
assert(trellisPayloadSummary.modelArtifactLockPath === trellisPayload.modelArtifactLock.path, "trellis_payload_model_lock_path_mismatch");
assert(trellisPayloadSummary.modelArtifactLockSha256 === trellisPayload.modelArtifactLock.lockSha256, "trellis_payload_model_lock_digest_mismatch");
assert(trellisPayloadSummary.modelArtifactLockPath === readiness.aiRights.trellisModelArtifact.lockPath, "trellis_payload_historical_model_path_mismatch");
assert(trellisPayloadSummary.modelArtifactLockSha256 === readiness.aiRights.trellisModelArtifact.lockSha256, "trellis_payload_historical_model_digest_mismatch");
assert(trellisPayloadSummary.publisherRepository === trellisPayload.modelArtifactLock.publisherRepository, "trellis_payload_publisher_repository_mismatch");
assert(trellisPayloadSummary.publisherCommit === trellisPayload.modelArtifactLock.publisherCommit, "trellis_payload_publisher_commit_mismatch");
assert(trellisPayloadSummary.representation === trellisPayload.payloadSet.representation, "trellis_payload_representation_mismatch");
assert(trellisPayloadSummary.payloadCount === trellisPayload.payloadSet.count, "trellis_payload_count_mismatch");
assert(trellisPayloadSummary.totalByteLength === trellisPayload.payloadSet.totalByteLength, "trellis_payload_total_mismatch");
assert(trellisPayloadSummary.publisherPointerHashesMatched === true
  && trellisPayload.payloadSet.payloads.every((payload) => (
    payload.hashesMatch === true && payload.publisherLfsOidSha256 === payload.observedSha256
  )),
"trellis_payload_publisher_pointer_hash_mismatch");
assert(trellisPayloadSummary.payloadBytesVerified === true, "trellis_payload_bytes_not_verified");
assert(trellisPayloadSummary.retainedInRestrictedStorageAtVerification === true, "trellis_payload_not_retained_at_verification");
assert(trellisPayloadSummary.storageEvidenceScope === trellisPayload.restrictedStorage.evidenceScope, "trellis_payload_storage_evidence_scope_invalid");
assert(trellisPayloadSummary.fullReadbackVerified === trellisPayload.restrictedStorage.fullReadback.everyObjectMatchedPayloadIdentity, "trellis_payload_readback_mismatch");
assert(trellisPayloadSummary.operatorRecordVersion === trellisPayload.restrictedStorage.operatorRecord.schemaVersion, "trellis_payload_operator_record_version_mismatch");
assert(trellisPayloadSummary.operatorRecordVisibility === trellisPayload.restrictedStorage.operatorRecord.visibility, "trellis_payload_operator_record_visibility_mismatch");
assert(trellisPayloadSummary.operatorRecordRawSha256 === trellisPayload.restrictedStorage.operatorRecord.rawRecordSha256, "trellis_payload_operator_record_digest_mismatch");
assert(trellisPayloadSummary.externalRecordAt === "2026-08-20T12:46:45Z", "trellis_payload_external_record_time_invalid");
assert(trellisPayloadSummary.localPayloadDeletionVerifiedAt === "2026-08-20T12:44:28Z", "trellis_payload_local_deletion_time_invalid");
assert(!Object.hasOwn(trellisPayload, "externalRecordAt")
  && !Object.hasOwn(trellisPayload, "localPayloadDeletionVerifiedAt"),
"trellis_payload_lock_must_be_timestamp_free");
assert(trellisPayloadSummary.uploadRetrySummary === "canned-acl-rejected-before-transfer-and-four-incomplete-multipart-uploads-aborted-before-explicit-put-object-success", "trellis_payload_retry_summary_invalid");
assert(trellisPayloadSummary.normalCiScope === trellisPayload.normalCi.scope, "trellis_payload_normal_ci_scope_mismatch");
assert(trellisPayloadSummary.normalCiScope === "canonical-public-lock-and-historical-relationship-only/no-payload-or-restricted-record-access", "trellis_payload_normal_ci_scope_invalid");
assert(trellisPayload.normalCi.realPayloadHashesReproducible === false, "trellis_payload_normal_ci_hash_reproduction_claim_invalid");
assert(trellisPayload.normalCi.networkFallbackAllowedByVerifier === false, "trellis_payload_network_fallback_claim_invalid");
assert(trellisPayload.normalCi.streamingVerificationCoverage === "synthetic-fixtures-only", "trellis_payload_normal_ci_fixture_scope_invalid");
assert(trellisPayloadSummary.safetensorsParsed === false && trellisPayload.boundaries.safetensorsParsed === false, "trellis_payload_parsing_claim_invalid");
assert(trellisPayloadSummary.deserialized === false && trellisPayload.boundaries.deserialized === false, "trellis_payload_deserialization_claim_invalid");
assert(trellisPayloadSummary.runtimeExecuted === false && trellisPayload.boundaries.runtimeExecuted === false, "trellis_payload_runtime_claim_invalid");
assert(trellisPayloadSummary.modelInputUsed === false && trellisPayload.boundaries.modelInputUsed === false, "trellis_payload_model_input_claim_invalid");
assert(trellisPayloadSummary.generationAllowed === false && trellisPayload.boundaries.generationAllowed === false, "trellis_payload_generation_claim_invalid");
assert(JSON.stringify(trellisPayloadSummary.approvalClaims) === JSON.stringify({
  humanSignoffApproved: false,
  payloadApproved: false,
  rightsApproved: false,
  runtimeApproved: false,
  weightLicenseApproved: false
}), "trellis_payload_approval_claim_invalid");
assert(trellisPayloadSummary.gateSnapshot === trellisPayload.gateSnapshot, "trellis_payload_gate_snapshot_invalid");
assert(JSON.stringify(trellisPayloadSummary.resolvedGatesAtLock) === JSON.stringify(trellisPayload.resolvedGates), "trellis_payload_resolved_gates_mismatch");
assert(JSON.stringify(trellisPayloadSummary.openGatesAtLock) === JSON.stringify(trellisPayload.openGates), "trellis_payload_open_gates_mismatch");
assert(JSON.stringify(trellisPayload.gateEffect.directlyResolvedGates) === JSON.stringify(["trellisModelPayloadBytesVerification"]), "trellis_payload_direct_gate_effect_invalid");
assert(trellisPayload.gateEffect.doesNotResolveCompositeGates === true, "trellis_payload_composite_gate_effect_invalid");
assert(!Object.hasOwn(trellisPayload, "gateComposition"), "trellis_payload_composite_gate_forbidden");
assert(readiness.aiRights.trellisModelArtifact.payloadBytesVerified === false
  && modelArtifact.boundaries.lfsPayloadBytesIndependentlyVerified === false,
"trellis_historical_payload_claims_mutated");
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
const dinoPayload = await loadWmmrDinoPayloadArtifactLock(
  resolve(root, readiness.aiRights.dinoPayloadBytes.lockPath)
);
const dinoPayloadSummary = readiness.aiRights.dinoPayloadBytes;
assert(dinoPayloadSummary.status === dinoPayload.status, "dino_payload_status_mismatch");
assert(dinoPayloadSummary.lockSha256 === dinoPayload.lockSha256, "dino_payload_lock_digest_mismatch");
assert(dinoPayloadSummary.sourceMetadataLockPath === dinoPayload.sourceMetadataLock.path, "dino_payload_source_lock_path_mismatch");
assert(dinoPayloadSummary.sourceMetadataLockSha256 === dinoPayload.sourceMetadataLock.lockSha256, "dino_payload_source_lock_digest_mismatch");
assert(dinoPayloadSummary.sourceMetadataLockPath === dinoSummary.lockPath, "dino_payload_historical_source_path_mismatch");
assert(dinoPayloadSummary.sourceMetadataLockSha256 === dinoSummary.lockSha256, "dino_payload_historical_source_digest_mismatch");
assert(dinoPayloadSummary.publisherUrlTransitivelyBound === true
  && dinoPayload.sourceMetadataLock.publisherUrlTransitivelyBound === true,
"dino_payload_publisher_url_binding_invalid");
assert(!Object.hasOwn(dinoPayload, "publisherArtifact"), "dino_payload_lock_must_not_duplicate_publisher_url");
assert(dinoPayloadSummary.representation === dinoPayload.payload.representation, "dino_payload_representation_mismatch");
assert(dinoPayloadSummary.byteLength === dinoPayload.payload.byteLength, "dino_payload_size_mismatch");
assert(dinoPayloadSummary.observedSha256 === dinoPayload.payload.observedSha256, "dino_payload_observed_hash_mismatch");
assert(dinoPayloadSummary.publisherSha256 === null && dinoPayload.payload.publisherSha256 === null, "dino_payload_publisher_hash_claim_invalid");
assert(dinoPayloadSummary.payloadBytesVerified === true, "dino_payload_bytes_not_verified");
assert(dinoPayloadSummary.retainedInRestrictedStorageAtVerification === true, "dino_payload_not_retained_at_verification");
assert(dinoPayloadSummary.storageEvidenceScope === dinoPayload.restrictedStorage.evidenceScope, "dino_payload_storage_evidence_scope_invalid");
assert(dinoPayloadSummary.contentAddressSha256 === dinoPayload.restrictedStorage.contentAddress.digest, "dino_payload_content_address_mismatch");
assert(dinoPayloadSummary.fullReadbackVerified === dinoPayload.restrictedStorage.fullReadback.matchedPayloadIdentity, "dino_payload_readback_mismatch");
assert(dinoPayloadSummary.operatorRecordVersion === dinoPayload.restrictedStorage.operatorRecord.schemaVersion, "dino_payload_operator_record_version_mismatch");
assert(dinoPayloadSummary.operatorRecordVisibility === dinoPayload.restrictedStorage.operatorRecord.visibility, "dino_payload_operator_record_visibility_mismatch");
assert(dinoPayloadSummary.operatorRecordRawSha256 === dinoPayload.restrictedStorage.operatorRecord.rawRecordSha256, "dino_payload_operator_record_digest_mismatch");
assert(dinoPayloadSummary.externalVerifiedAt === "2026-08-20T09:04:22Z", "dino_payload_external_verification_time_invalid");
assert(dinoPayloadSummary.payloadUploadedAt === "2026-08-20T08:46:24Z", "dino_payload_upload_time_invalid");
assert(!Object.hasOwn(dinoPayload, "externalVerifiedAt") && !Object.hasOwn(dinoPayload, "payloadUploadedAt"), "dino_payload_lock_must_be_timestamp_free");
assert(dinoPayloadSummary.normalCiScope === dinoPayload.normalCi.scope, "dino_payload_normal_ci_scope_mismatch");
assert(dinoPayloadSummary.normalCiScope === "canonical-public-lock-only/no-payload-or-restricted-record-access", "dino_payload_normal_ci_scope_invalid");
assert(dinoPayloadSummary.deserialized === false && dinoPayload.boundaries.deserialized === false, "dino_payload_deserialization_claim_invalid");
assert(dinoPayloadSummary.runtimeExecuted === false && dinoPayload.boundaries.runtimeExecuted === false, "dino_payload_runtime_claim_invalid");
assert(dinoPayloadSummary.generationAllowed === false && dinoPayload.boundaries.generationAllowed === false, "dino_payload_generation_claim_invalid");
assert(JSON.stringify(dinoPayloadSummary.approvalClaims) === JSON.stringify({
  derivedArtifactApproved: false,
  humanSignoffApproved: false,
  payloadApproved: false,
  publisherSha256Verified: false,
  rightsApproved: false,
  runtimeApproved: false,
  sourceLicenseApproved: false,
  weightLicenseApproved: false
}), "dino_payload_approval_claim_invalid");
assert(dinoPayloadSummary.gateSnapshot === dinoPayload.gateSnapshot, "dino_payload_gate_snapshot_invalid");
assert(JSON.stringify(dinoPayloadSummary.resolvedGatesAtLock) === JSON.stringify(dinoPayload.resolvedGates), "dino_payload_resolved_gates_mismatch");
assert(JSON.stringify(dinoPayloadSummary.openGatesAtLock) === JSON.stringify(dinoPayload.openGates), "dino_payload_open_gates_mismatch");
assert(JSON.stringify(dinoPayload.gateEffect.directlyResolvedGates) === JSON.stringify(["dinoArtifactPayloadBytesVerification"]), "dino_payload_direct_gate_effect_invalid");
assert(JSON.stringify(dinoPayload.gateEffect.mechanicallyResolvedCompositeGates) === JSON.stringify(["dinoSourceAndArtifactLock"]), "dino_payload_mechanical_gate_effect_invalid");
assert(dinoSummary.payloadBytesDownloaded === false && dinoSummary.payloadBytesVerified === false, "dino_historical_claims_mutated");
assert(dinoPayloadSummary.payloadBytesVerified === true, "dino_current_payload_claim_missing");
const {
  lock: dinoDerived,
  manifest: dinoDerivedManifest
} = await loadWmmrDinoDerivedRuntimeArtifactLock(
  resolve(root, readiness.aiRights.dinoDerivedRuntimeArtifact.lockPath)
);
const dinoDerivedSummary = readiness.aiRights.dinoDerivedRuntimeArtifact;
assert(dinoDerivedSummary.status === dinoDerived.status, "dino_derived_status_mismatch");
assert(dinoDerivedSummary.lockSha256 === dinoDerived.lockSha256, "dino_derived_lock_digest_mismatch");
assert(dinoDerivedSummary.tensorManifestPath === dinoDerived.tensorManifest.path, "dino_derived_manifest_path_mismatch");
assert(dinoDerivedSummary.tensorManifestSha256 === dinoDerivedManifest.manifestSha256, "dino_derived_manifest_digest_mismatch");
assert(dinoDerivedSummary.payloadLockPath === dinoDerived.payloadBytesLock.path, "dino_derived_payload_path_mismatch");
assert(dinoDerivedSummary.payloadLockSha256 === dinoDerived.payloadBytesLock.lockSha256, "dino_derived_payload_digest_mismatch");
assert(dinoDerivedSummary.payloadLockPath === dinoPayloadSummary.lockPath, "dino_derived_historical_payload_path_mismatch");
assert(dinoDerivedSummary.payloadLockSha256 === dinoPayloadSummary.lockSha256, "dino_derived_historical_payload_digest_mismatch");
assert(dinoDerivedSummary.payloadByteLength === dinoDerived.payloadBytesLock.payloadByteLength, "dino_derived_payload_size_mismatch");
assert(dinoDerivedSummary.payloadSha256 === dinoDerived.payloadBytesLock.payloadObservedSha256, "dino_derived_payload_sha256_mismatch");
assert(dinoDerivedSummary.artifactFormat === dinoDerived.artifact.format, "dino_derived_artifact_format_mismatch");
assert(dinoDerivedSummary.artifactByteLength === dinoDerived.artifact.byteLength, "dino_derived_artifact_size_mismatch");
assert(dinoDerivedSummary.artifactSha256 === dinoDerived.artifact.sha256, "dino_derived_artifact_sha256_mismatch");
assert(dinoDerivedSummary.artifactHeaderByteLength === dinoDerived.artifact.headerByteLength, "dino_derived_header_size_mismatch");
assert(dinoDerivedSummary.artifactHeaderSha256 === dinoDerived.artifact.headerSha256, "dino_derived_header_sha256_mismatch");
assert(dinoDerivedSummary.tensorCount === dinoDerivedManifest.tensorCount, "dino_derived_tensor_count_mismatch");
assert(dinoDerivedSummary.totalTensorByteLength === dinoDerivedManifest.totalTensorByteLength, "dino_derived_tensor_bytes_mismatch");
assert(dinoDerivedSummary.tensorIdentitySha256 === dinoDerivedManifest.tensorIdentitySha256, "dino_derived_tensor_identity_mismatch");
assert(dinoDerivedSummary.tensorLayoutSha256 === dinoDerivedManifest.tensorLayoutSha256, "dino_derived_tensor_layout_mismatch");
assert(dinoDerivedSummary.converterPath === dinoDerived.conversion.converter.path, "dino_derived_converter_path_mismatch");
assert(dinoDerivedSummary.converterSha256 === dinoDerived.conversion.converter.sourceSha256, "dino_derived_converter_sha256_mismatch");
assert(dinoDerivedSummary.conversionImageDigest === dinoDerived.conversion.environment.conversionImageDigest, "dino_derived_image_digest_mismatch");
assert(dinoDerivedSummary.pytorchVersion === dinoDerived.conversion.environment.pytorchVersion, "dino_derived_pytorch_version_mismatch");
assert(dinoDerivedSummary.weightsOnly === true && dinoDerived.conversion.options.weightsOnly === true, "dino_derived_weights_only_missing");
assert(dinoDerivedSummary.sealedInputCopy === true
  && dinoDerived.conversion.options.sealedInputCopy === true,
"dino_derived_sealed_input_missing");
assert(dinoDerivedSummary.conversionMemoryLimitBytes === dinoDerived.conversion.isolation.memoryLimitBytes, "dino_derived_memory_limit_mismatch");
assert(dinoDerivedSummary.conversionCpuLimit === dinoDerived.conversion.isolation.cpuLimit, "dino_derived_cpu_limit_mismatch");
assert(dinoDerivedSummary.conversionPidsLimit === dinoDerived.conversion.isolation.pidsLimit, "dino_derived_pids_limit_mismatch");
assert(dinoDerivedSummary.conversionRunCount === 2 && dinoDerived.conversion.reproducibility.runCount === 2, "dino_derived_run_count_invalid");
assert(dinoDerivedSummary.artifactByteIdenticalAcrossRuns === true
  && dinoDerived.conversion.reproducibility.artifactByteIdentical === true,
"dino_derived_reproducibility_invalid");
assert(JSON.stringify(dinoDerivedSummary.conversionEvidenceRawSha256) === JSON.stringify(
  dinoDerived.conversion.reproducibility.reports.map(({ rawRecordSha256 }) => rawRecordSha256)
), "dino_derived_conversion_evidence_mismatch");
assert(dinoDerivedSummary.operatorRecordRawSha256 === dinoDerived.restrictedStorage.operatorRecord.rawRecordSha256, "dino_derived_operator_record_mismatch");
assert(dinoDerivedSummary.fullReadbackVerified === dinoDerived.restrictedStorage.fullReadback.matchedArtifactIdentity, "dino_derived_readback_mismatch");
assert(dinoDerivedSummary.incompleteMultipartUploads === 0, "dino_derived_multipart_invalid");
assert(dinoDerivedSummary.deserializedWithWeightsOnly === true, "dino_derived_deserialization_record_missing");
assert(dinoDerivedSummary.strictStateDictLoadExecuted === false
  && dinoDerived.boundaries.strictStateDictLoadExecuted === false,
"dino_derived_strict_load_claim_invalid");
assert(dinoDerivedSummary.offlineImportRuntimeExecuted === false
  && dinoDerived.boundaries.offlineImportRuntimeExecuted === false,
"dino_derived_offline_import_claim_invalid");
assert(dinoDerivedSummary.modelRuntimeExecuted === false
  && dinoDerived.boundaries.modelRuntimeExecuted === false,
"dino_derived_runtime_claim_invalid");
assert(dinoDerivedSummary.modelInputUsed === false
  && dinoDerived.boundaries.modelInputUsed === false,
"dino_derived_model_input_claim_invalid");
assert(dinoDerivedSummary.generationAllowed === false
  && dinoDerived.boundaries.generationAllowed === false,
"dino_derived_generation_claim_invalid");
assert(JSON.stringify(dinoDerivedSummary.approvalClaims) === JSON.stringify({
  humanSignoffApproved: false,
  rightsApproved: false,
  runtimeApproved: false,
  sourceWeightRuntimeCompatibilityApproved: false,
  weightLicenseApproved: false
}), "dino_derived_approval_claim_invalid");
assert(dinoPayload.openGates.includes("dinoDerivedRuntimeArtifactLock"), "dino_historical_derived_gate_mutated");
assert(JSON.stringify(dinoDerivedSummary.resolvedGatesAtLock) === JSON.stringify(dinoDerived.resolvedGates), "dino_derived_resolved_gates_mismatch");
assert(JSON.stringify(dinoDerivedSummary.openGatesAtLock) === JSON.stringify(dinoDerived.openGates), "dino_derived_open_gates_mismatch");
assert(JSON.stringify(dinoDerived.gateEffect.directlyResolvedGates) === JSON.stringify(["dinoDerivedRuntimeArtifactLock"]), "dino_derived_direct_gate_effect_invalid");
await execFileAsync(process.env.PYTHON ?? "python3", ["scripts/verify-runtime-wheel-lock.py", "--lock-only"], {
  cwd: root,
  maxBuffer: 4 * 1024 * 1024
});
await execFileAsync(process.env.PYTHON ?? "python3", ["scripts/verify-patched-pytorch-lock.py"], {
  cwd: root,
  maxBuffer: 4 * 1024 * 1024
});
await execFileAsync(process.env.PYTHON ?? "python3", ["scripts/verify-offline-runtime-lock.py"], {
  cwd: root,
  maxBuffer: 4 * 1024 * 1024
});
const dependencySummary = readiness.aiRights.dependencyWheelHashLock;
const dependencyLock = await json(dependencySummary.lockPath);
assert(dependencySummary.status === dependencyLock.status, "dependency_lock_status_mismatch");
assert(dependencySummary.lockSha256 === dependencyLock.lockSha256, "dependency_lock_digest_mismatch");
assert(dependencySummary.wheelCount === dependencyLock.wheelSet.count, "dependency_wheel_count_mismatch");
assert(dependencySummary.totalByteLength === dependencyLock.wheelSet.totalByteLength, "dependency_wheel_bytes_mismatch");
assert(dependencySummary.wheelInventorySha256 === dependencyLock.wheelSet.wheelInventorySha256, "dependency_inventory_digest_mismatch");
assert(dependencySummary.offlineNoIndexInstallOperatorAttested === true, "dependency_offline_install_attestation_missing");
assert(dependencySummary.offlineWheelhouseResolutionReportVerified === true, "dependency_offline_resolution_report_missing");
assert(dependencySummary.sourceBuildsAllowed === false, "dependency_source_build_boundary_invalid");
assert(dependencySummary.operatorRecordRawSha256 === dependencyLock.restrictedStorage.operatorRecord.rawRecordSha256, "dependency_operator_record_mismatch");
assert(JSON.stringify(dependencySummary.resolvedGatesAtLock) === JSON.stringify(dependencyLock.resolvedGates), "dependency_resolved_gates_mismatch");
assert(JSON.stringify(dependencySummary.openGatesAtLock) === JSON.stringify(dependencyLock.openGates), "dependency_open_gates_mismatch");
const pytorchSummary = readiness.aiRights.patchedPytorchQualification;
const pytorchLock = await json(pytorchSummary.lockPath);
assert(pytorchSummary.status === pytorchLock.status, "pytorch_qualification_status_mismatch");
assert(pytorchSummary.lockSha256 === pytorchLock.lockSha256, "pytorch_qualification_digest_mismatch");
assert(pytorchSummary.dependencyWheelLockSha256 === dependencyLock.lockSha256, "pytorch_dependency_binding_mismatch");
assert(pytorchSummary.torchVersion === pytorchLock.qualificationEnvironment.torchVersion, "pytorch_version_mismatch");
assert(pytorchSummary.torchWheelSha256 === pytorchLock.dependencyWheelLock.torchWheel.sha256, "pytorch_wheel_digest_mismatch");
assert(pytorchSummary.safeWeightsOnlyRoundTrip === true, "pytorch_safe_round_trip_missing");
assert(pytorchSummary.legacyTarRejectedBeforeUnpickling === true, "pytorch_legacy_tar_rejection_missing");
assert(pytorchSummary.sideEffectObserved === false, "pytorch_side_effect_observed");
assert(JSON.stringify(pytorchSummary.resolvedGatesAtLock) === JSON.stringify(pytorchLock.resolvedGates), "pytorch_resolved_gates_mismatch");
assert(JSON.stringify(pytorchSummary.openGatesAtLock) === JSON.stringify(pytorchLock.openGates), "pytorch_open_gates_mismatch");
const offlineSummary = readiness.aiRights.offlineRuntimeQualification;
const offlineLock = await json(offlineSummary.lockPath);
assert(offlineSummary.status === offlineLock.status, "offline_runtime_status_mismatch");
assert(offlineSummary.lockSha256 === offlineLock.lockSha256, "offline_runtime_digest_mismatch");
assert(offlineSummary.wheelInventorySha256 === offlineLock.prerequisites.dependencyWheelLock.wheelInventorySha256, "offline_runtime_wheel_binding_mismatch");
assert(offlineSummary.trellisTreeSha256 === offlineLock.sourceMaterialization.trellisTreeSha256, "offline_runtime_trellis_binding_mismatch");
assert(offlineSummary.dinoSelectionSha256 === offlineLock.sourceMaterialization.dinoSelectionSha256, "offline_runtime_dino_binding_mismatch");
assert(offlineSummary.expectedModuleCount === offlineLock.imports.expectedModuleCount, "offline_runtime_expected_import_count_mismatch");
assert(offlineSummary.importedModuleCount === offlineLock.imports.importedModuleCount, "offline_runtime_import_count_mismatch");
assert(offlineSummary.dinoStrictLoadPassed === true && offlineLock.strictLoads.dino.missingKeyCount === 0 && offlineLock.strictLoads.dino.unexpectedKeyCount === 0, "offline_runtime_dino_strict_load_invalid");
assert(offlineSummary.trellisStrictLoadCount === offlineLock.strictLoads.trellis.length, "offline_runtime_trellis_load_count_mismatch");
assert(offlineLock.imports.successfulAuditedProcessLaunchCount === 0 && offlineLock.imports.successfulAuditedSocketOperationCount === 0, "offline_runtime_side_effect_boundary_invalid");
assert(offlineSummary.prohibitedModulesObserved.length === 0, "offline_runtime_prohibited_module_observed");
assert(offlineSummary.runtimeImportsExecuted === true && offlineSummary.strictStateDictLoadExecuted === true, "offline_runtime_positive_evidence_missing");
assert(offlineSummary.inferenceExecuted === false && offlineSummary.modelInputUsed === false && offlineSummary.cudaExecuted === false && offlineSummary.generationAllowed === false, "offline_runtime_boundary_invalid");
assert(JSON.stringify(offlineSummary.resolvedGatesAtLock) === JSON.stringify(offlineLock.resolvedGates), "offline_runtime_resolved_gates_mismatch");
assert(JSON.stringify(offlineSummary.openGatesAtLock) === JSON.stringify(offlineLock.openGates), "offline_runtime_open_gates_mismatch");
const expectedCurrentResolvedGates = [
  "dependencyWheelHashLock",
  "dinoArtifactPayloadBytesVerification",
  "dinoDerivedRuntimeArtifactLock",
  "dinoSourceAndArtifactLock",
  "dinoSourceGitObjectLock",
  "gpuParityAndVramTest",
  "humanRightsSignoff",
  "offlineImportRuntimeTest",
  "patchedPytorchQualification",
  "patchedSourceTreeDigest",
  "trellisModelArtifactLock",
  "trellisModelPayloadBytesVerification"
];
const expectedCurrentOpenGates = [
  "ociImageDigest",
  "providerTermsSnapshot",
  "sbomAndVulnerabilityReport",
  "thirdPartyNoticeBundle",
  "productionRightsSignoff"
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
assert(readiness.compute.experimentGpuResourcesCreated === false, "gpu_probe_resource_still_exists");
assert(readiness.compute.gpuQuota === "compute.instanceT4Gpus.count=1", "gpu_quota_evidence_invalid");
assert(readiness.compute.quotaRequestCreated === true, "gpu_quota_request_missing");
assert(readiness.compute.quotaRequestBlocker === null, "gpu_quota_request_blocker_not_cleared");
assert(readiness.compute.budgetApproval === "approved-for-2026-08-23-internal-probe", "gpu_budget_approval_missing");
assert(readiness.compute.independentTeardownGuard === "local-delete-daemon-plus-guest-watchdog-verified", "gpu_teardown_guard_invalid");
assert(readiness.compute.probeResourcesRemaining === 0, "gpu_probe_teardown_incomplete");
assert(readiness.stageRules.stage1WorkBlockedUntil.length === 0, "stage_1_work_must_be_unblocked");
assert(readiness.stageRules.stage1ExitBlockedUntil.length === 0, "stage_1_exit_must_be_unblocked");
assert(readiness.stageRules.stage2RightsAndComputePreparationBlockedUntil.length === 0, "stage_2_preparation_must_be_unblocked");
assert(readiness.resolved.styleBibleApproved === true, "style_bible_not_approved");
assert(readiness.resolved.stage1ArtDirectionGateGreen === true, "stage_1_art_direction_gate_not_green");
assert(readiness.resolved.trellisPatchedSourceTreeDigest === true, "patched_source_tree_digest_not_resolved");
assert(readiness.resolved.trellisStaticPolicySyntaxVerificationCiReproducible === true, "patched_source_static_verification_not_resolved");
assert(readiness.resolved.trellisModelArtifactLock === true, "model_artifact_lock_not_resolved");
assert(readiness.resolved.dinoSourceGitObjectLock === true, "dino_source_git_object_lock_not_resolved");
assert(readiness.resolved.dinoArtifactPayloadBytesVerification === true, "dino_payload_bytes_gate_not_resolved");
assert(readiness.resolved.dinoDerivedRuntimeArtifactLock === true, "dino_derived_runtime_artifact_gate_not_resolved");
assert(readiness.resolved.dinoSourceAndArtifactLock === true, "dino_source_and_artifact_gate_not_resolved");
assert(readiness.resolved.trellisModelPayloadBytesVerification === true, "trellis_payload_bytes_gate_not_resolved");
assert(readiness.resolved.dependencyWheelHashLock === true, "dependency_wheel_gate_not_resolved");
assert(readiness.resolved.patchedPytorchQualification === true, "patched_pytorch_gate_not_resolved");
assert(readiness.resolved.offlineImportRuntimeTest === true, "offline_runtime_gate_not_resolved");
assert(readiness.resolved.gpuParityAndVramTest === true, "gpu_parity_gate_not_resolved");
assert(readiness.resolved.humanRightsSignoff === true, "internal_probe_signoff_not_resolved");
assert(readiness.resolved.gpuGenerationProbe === true, "gpu_generation_probe_not_resolved");
assert(readiness.resolved.gpuWindowTrimGenerationProbe === true, "window_trim_generation_probe_not_resolved");
assert(readiness.resolved.greenAiFeasibilityGate === true, "ai_feasibility_gate_not_closed_after_two_successful_probes");
assert(!Object.hasOwn(readiness.blocked, "styleBibleApproval"), "resolved_style_gate_must_not_remain_blocked");
assert(!readiness.stageRules.probeExecutionBlockedUntil.includes("styleBibleApproval"), "resolved_style_gate_still_blocks_probe");
assert(readiness.stageRules.probeExecutionBlockedUntil.length === 0, "completed_probe_must_not_remain_blocked");
assert(readiness.stageRules.stage3BlockedUntil.length === 0, "stage_3_must_be_unblocked_after_second_successful_probe");

const [sceneFixtureText, assetLedgerFixtureText, generationLedgerFixtureText] = await Promise.all([
  readFile(resolve(root, readiness.stage3.validFixturePath), "utf8"),
  readFile(resolve(root, readiness.stage3.validAssetLedgerFixturePath), "utf8"),
  readFile(resolve(root, readiness.stage3.validGenerationLedgerFixturePath), "utf8")
]);
const sceneContractReport = parseSceneContract({
  sceneText: sceneFixtureText,
  assetLedgerText: assetLedgerFixtureText,
  generationLedgerText: generationLedgerFixtureText
});
assert(sceneContractReport.status === "stage3-scene-contract-valid", "stage3_scene_contract_invalid");
assert(sceneContractReport.specificationSha256 === "7835eb45004e91f29daf6ee6e6c4b7cb34ad081f4a90f234f38732f4daf92a91", "stage3_scene_fixture_digest_mismatch");
assert(sceneContractReport.assetLedgerSha256 === "bc8dc412b38eb85c7a46cb96a5292f806e430fcfa2956f188d39a07fcd9f6d85", "stage3_asset_fixture_digest_mismatch");
assert(sceneContractReport.generationLedgerSha256 === "39ef74d47488966b8e9b4df9541ba039085260a2a8fb75d9add3804558491c51", "stage3_generation_fixture_digest_mismatch");

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
assert(readiness.aiRights.referenceModelInputCount === modelInputReferences.length, "ai_rights_reference_model_input_count_mismatch");
assert(readiness.aiRights.modelInputCount === modelInputReferences.length + readiness.aiRights.projectAuthoredModelInputCount, "ai_rights_model_input_count_mismatch");
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

const candidateLock = await canonicalJson("experiment/warm-modern-meeting-room/candidate-lock.json", "candidate_lock");
assert(candidateLock.schemaVersion === 2, "invalid_candidate_lock_schema");
assert(candidateLock.status === "candidate-01-exact-media-surface-specification-pinned", "invalid_candidate_lock_status");
assert(candidateLock.platformValidatorCommit === readiness.platform.validatorCommit, "candidate_lock_platform_mismatch");
for (const [id, expectedRepository] of [
  ["candidate01", readiness.repositories.candidate01.repository],
  ["candidate02", readiness.repositories.candidate02.repository]
]) {
  const candidate = candidateLock.candidates[id];
  assert(candidate.repository === expectedRepository, `candidate_lock_repository_mismatch:${id}`);
  if (candidate.commit !== null) assert(/^[0-9a-f]{40}$/.test(candidate.commit), `invalid_candidate_commit:${id}`);
}
const candidate01 = candidateLock.candidates.candidate01;
assert(candidate01.commit === readiness.stage3.approvedCandidateCurrentCommit, "candidate_01_current_commit_mismatch");
assert(candidate01.treeOid === readiness.stage3.approvedCandidateCurrentTreeOid, "candidate_01_current_tree_mismatch");
assert(candidate01.sceneContractValidatorCommit === readiness.stage3.approvedCandidateCurrentValidatorCommit, "candidate_01_current_validator_mismatch");
for (const [lockKey, readinessKey] of [
  ["specificationSha256", "approvedCandidateCurrentSpecificationSha256"],
  ["assetLedgerSha256", "approvedCandidateCurrentAssetLedgerSha256"],
  ["generationLedgerSha256", "approvedCandidateCurrentGenerationLedgerSha256"],
  ["componentConstructionSha256", "approvedCandidateCurrentComponentConstructionSha256"],
  ["componentConstructionRawSha256", "approvedCandidateCurrentComponentConstructionRawSha256"],
  ["mediaSurfaceConstructionSha256", "approvedCandidateCurrentMediaSurfaceConstructionSha256"],
  ["mediaSurfaceConstructionRawSha256", "approvedCandidateCurrentMediaSurfaceConstructionRawSha256"]
]) assert(candidate01[lockKey] === readiness.stage3[readinessKey], `candidate_01_current_contract_mismatch:${lockKey}`);
assert(Object.keys(candidate01.inputBlobs).length === 6
  && Object.values(candidate01.inputBlobs).every((blob) => /^[0-9a-f]{40}$/.test(blob.gitBlobOid)
    && /^[0-9a-f]{64}$/.test(blob.rawSha256)
    && Number.isSafeInteger(blob.byteLength) && blob.byteLength > 0), "candidate_01_input_blob_lock_invalid");
assert(JSON.stringify(candidate01.acceptedInputSha256) === JSON.stringify([
  "978d0c7d75dd73d9c4d4419daa2f1530b0fdfac26c0eee1bcd7ef4e76501272a",
  "f32327442d015f4c89942bf752e959d6c0abc24613c72f32a8ba4c2b2b29d5d1",
  "0bdf11ca588d700c8a721d60cb503215c29ce021b48708302b8b9da45ec1036b"
]), "candidate_01_accepted_inputs_invalid");
assert(JSON.stringify(candidate01.counts) === JSON.stringify({
  assetRecordCount: 3,
  generationRecordCount: 0,
  familyCount: 4,
  partCount: 38,
  overrideCount: 2,
  componentCount: 11,
  resolvedComponentCount: 11,
  materialCount: 5,
  resolvedMaterialCount: 4,
  seatCount: 8,
  surfaceCount: 2,
  resolvedSurfaceCount: 2
}), "candidate_01_media_surface_counts_invalid");
assert(stableStringify(candidate01.mediaSurfaceProjectionEvidence) === stableStringify({
  sha256: readiness.stage3.approvedCandidateMediaSurfaceProjectionSha256,
  byteLength: readiness.stage3.approvedCandidateMediaSurfaceProjectionByteLength,
  mediaSurfaceCount: readiness.stage3.approvedCandidateMediaSurfaceCount,
  representation: readiness.stage3.approvedCandidateMediaSurfaceProjectionRepresentation,
  byteIdentical: readiness.stage3.approvedCandidateMediaSurfaceProjectionByteIdenticalVerified
}), "candidate_01_media_surface_projection_evidence_invalid");
assert(Object.values(candidate01.boundaries).every((value) => value === false)
  && candidate01.release === null, "candidate_01_current_boundaries_invalid");
const architectureBaseline = candidate01.architectureBaseline;
assert(architectureBaseline.commit === readiness.candidateConceptGate.candidateMergeCommit, "candidate_01_architecture_baseline_commit_mismatch");
for (const key of ["sceneContractValidatorCommit", "specificationSha256", "assetLedgerSha256", "generationLedgerSha256"]) {
  assert(architectureBaseline[key] === readiness.candidateConceptGate[key], `candidate_01_architecture_baseline_contract_mismatch:${key}`);
}
assert(Object.keys(architectureBaseline.inputBlobs).length === 4, "candidate_01_architecture_baseline_blob_count_invalid");
assert(architectureBaseline.semanticEvidence.schemaVersion === 1
  && architectureBaseline.semanticEvidence.contract === "f1-architecture-objects-materials-v1"
  && architectureBaseline.semanticEvidence.sha256 === readiness.stage3.approvedCandidateArchitectureSemanticSha256
  && architectureBaseline.semanticEvidence.objectCount === readiness.stage3.approvedCandidateArchitectureMeshCount
  && architectureBaseline.semanticEvidence.materialCount === readiness.stage3.approvedCandidateArchitectureMaterialCount,
"candidate_01_architecture_baseline_semantic_evidence_invalid");
assert(architectureBaseline.glbEvidence.sha256 === readiness.stage3.approvedCandidateArchitectureGlbSha256
  && architectureBaseline.glbEvidence.byteLength === readiness.stage3.approvedCandidateArchitectureGlbByteLength
  && architectureBaseline.glbEvidence.reopenInspectionSha256 === readiness.stage3.approvedCandidateArchitectureReopenInspectionSha256
  && architectureBaseline.glbEvidence.meshCount === readiness.stage3.approvedCandidateArchitectureMeshCount
  && architectureBaseline.glbEvidence.materialCount === readiness.stage3.approvedCandidateArchitectureMaterialCount, "candidate_01_architecture_baseline_glb_evidence_invalid");
const componentBaseline = candidate01.componentBaseline;
assert(componentBaseline.commit === readiness.stage3.approvedCandidateComponentBaselineCommit
  && componentBaseline.treeOid === readiness.stage3.approvedCandidateComponentBaselineTreeOid
  && componentBaseline.sceneContractValidatorCommit === readiness.stage3.approvedCandidateComponentBaselineValidatorCommit
  && Object.keys(componentBaseline.inputBlobs).length === readiness.stage3.approvedCandidateComponentBaselineGitBlobInputCount,
"candidate_01_component_baseline_source_invalid");
for (const [lockKey, readinessKey] of [
  ["specificationSha256", "approvedCandidateComponentBaselineSpecificationSha256"],
  ["assetLedgerSha256", "approvedCandidateComponentBaselineAssetLedgerSha256"],
  ["generationLedgerSha256", "approvedCandidateComponentBaselineGenerationLedgerSha256"],
  ["componentConstructionSha256", "approvedCandidateComponentBaselineConstructionSha256"],
  ["componentConstructionRawSha256", "approvedCandidateComponentBaselineConstructionRawSha256"]
]) assert(componentBaseline[lockKey] === readiness.stage3[readinessKey], `candidate_01_component_baseline_contract_mismatch:${lockKey}`);
assert(JSON.stringify(componentBaseline.counts) === JSON.stringify({
  assetRecordCount: 2,
  generationRecordCount: 0,
  familyCount: 4,
  partCount: 38,
  overrideCount: 2,
  componentCount: 11,
  resolvedComponentCount: 11,
  materialCount: 5,
  resolvedMaterialCount: 4,
  seatCount: 8
}), "candidate_01_component_baseline_counts_invalid");
assert(componentBaseline.componentGlbEvidence.sha256 === readiness.stage3.approvedCandidateComponentGlbSha256
  && componentBaseline.componentGlbEvidence.byteLength === readiness.stage3.approvedCandidateComponentGlbByteLength
  && componentBaseline.componentGlbEvidence.reopenInspectionSha256 === readiness.stage3.approvedCandidateComponentReopenInspectionSha256
  && componentBaseline.componentGlbEvidence.meshCount === readiness.stage3.approvedCandidateComponentMeshCount
  && componentBaseline.componentGlbEvidence.materialCount === readiness.stage3.approvedCandidateComponentMaterialCount
  && componentBaseline.componentGlbEvidence.decodedNormalCount === readiness.stage3.approvedCandidateComponentDecodedNormalCount
  && componentBaseline.componentGlbEvidence.architectureSemanticSha256 === readiness.stage3.approvedCandidateArchitectureSemanticSha256
  && stableStringify(componentBaseline.componentGlbEvidence.khronosValidator) === stableStringify(readiness.stage3.approvedCandidateComponentKhronosValidation),
"candidate_01_component_baseline_glb_evidence_invalid");
assert(!Object.hasOwn(candidate01, "componentGlbEvidence"), "candidate_01_component_glb_must_not_bind_current_commit");
assert(candidateLock.candidates.candidate02.commit === readiness.repositories.candidate02.initialCommit, "candidate_02_lock_initial_commit_mismatch");

const sceneSpecSchema = await json("schemas/scene-spec.schema.json");
assert(sceneSpecSchema.properties.sceneId.pattern.includes("candidate-(01|02)"), "scene_spec_not_candidate_scoped");
assert(sceneSpecSchema.properties.seats.minItems === 8 && sceneSpecSchema.properties.seats.maxItems === 8, "scene_spec_must_require_eight_seats");
assert(sceneSpecSchema.properties.mediaSurfaces.minItems === 2 && sceneSpecSchema.properties.mediaSurfaces.maxItems === 2, "scene_spec_must_require_two_surfaces");
const surfaceIds = sceneSpecSchema.$defs.surface.properties.surfaceId.enum;
assert(JSON.stringify(surfaceIds) === JSON.stringify(["debug-main", "whiteboard-wall"]), "invalid_required_surfaces");
const exteriorConstructionSchema = await json("schemas/exterior-constructions.schema.json");
assert(exteriorConstructionSchema.properties.strategy.const === "project-authored-geometry", "exterior_construction_strategy_invalid");
assert(exteriorConstructionSchema.$defs.object.properties.geometry.const === "beveled-box", "exterior_construction_geometry_invalid");
assert(exteriorConstructionSchema.properties.objects.minItems === 4
  && exteriorConstructionSchema.properties.objects.maxItems === 12, "exterior_construction_object_bounds_invalid");

process.stdout.write("Experiment contracts are valid.\n");
