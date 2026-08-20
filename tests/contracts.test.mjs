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

test("TRELLIS source selection narrows evidence without allowing generation", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  const lock = await json(readiness.aiRights.sourceSelectionLock.policyPath);
  const artifact = await json(readiness.aiRights.patchedSourceArtifact.lockPath);
  assert.equal(lock.status, "selection-locked-runtime-blocked");
  assert.equal(lock.source.commit, readiness.aiRights.sourceSelectionLock.sourceCommit);
  assert.equal(lock.source.submodules[0].commit, readiness.aiRights.sourceSelectionLock.flexiCubesCommit);
  assert.equal(lock.selection.fileCount, 53);
  assert.equal(lock.selection.selectionSha256, readiness.aiRights.sourceSelectionLock.selectionSha256);
  assert.equal(lock.policySha256, readiness.aiRights.sourceSelectionLock.policySha256);
  assert.equal(readiness.aiRights.sourceSelectionLock.status, "selection-lock-recorded-local-verification-pass-runtime-blocked");
  assert.equal(readiness.aiRights.sourceSelectionLock.ciReproducible, false);
  assert.equal(lock.generationAllowed, false);
  assert.equal(readiness.aiRights.generationAllowed, false);
  assert.ok(lock.openGates.includes("patchedSourceTreeDigest"));
  assert.ok(lock.openGates.includes("thirdPartyNoticeBundle"));
  assert.ok(lock.openGates.includes("humanRightsSignoff"));
  assert.equal(readiness.aiRights.patchedSourceArtifact.status, "materialized-static-verified-runtime-blocked");
  assert.equal(readiness.aiRights.patchedSourceArtifact.fileCount, 50);
  assert.equal(readiness.aiRights.patchedSourceArtifact.pythonFileCount, 46);
  assert.equal(readiness.aiRights.patchedSourceArtifact.treeSha256, artifact.artifact.treeSha256);
  assert.equal(readiness.aiRights.patchedSourceArtifact.artifactSha256, artifact.artifactSha256);
  assert.equal(readiness.aiRights.patchedSourceArtifact.sourceToArtifactSha256, artifact.sourceToArtifact.sha256);
  assert.equal(readiness.aiRights.patchedSourceArtifact.staticPolicySyntaxVerificationCiReproducible, true);
  assert.equal(readiness.aiRights.patchedSourceArtifact.runtimeImportsExecuted, false);
  assert.equal(readiness.aiRights.patchedSourceArtifact.runtimeImportGateClosed, false);
  assert.equal(readiness.aiRights.patchedSourceArtifact.generationAllowed, false);
  assert.equal(readiness.aiRights.patchedSourceArtifact.gateSnapshot, "historical-at-materialization");
  assert.deepEqual(readiness.aiRights.patchedSourceArtifact.resolvedGatesAtMaterialization, artifact.resolvedGates);
  assert.deepEqual(readiness.aiRights.patchedSourceArtifact.openGatesAtMaterialization, artifact.openGates);
  assert.deepEqual(artifact.resolvedGates, ["patchedSourceTreeDigest"]);
  assert.ok(artifact.openGates.includes("offlineImportRuntimeTest"));
  assert.ok(artifact.openGates.includes("thirdPartyNoticeBundle"));
  assert.ok(artifact.openGates.includes("trellisModelArtifactLock"));
  assert.equal(readiness.resolved.trellisPatchedSourceTreeDigest, true);
  assert.equal(readiness.resolved.trellisStaticPolicySyntaxVerificationCiReproducible, true);
});

test("TRELLIS publisher Git and LFS identity lock does not claim payload verification", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  const summary = readiness.aiRights.trellisModelArtifact;
  const lock = await json(summary.lockPath);
  assert.equal(lock.status, "publisher-git-lfs-identity-locked-payload-unverified-runtime-blocked");
  assert.equal(lock.source.repository, "https://huggingface.co/microsoft/TRELLIS-image-large");
  assert.equal(lock.source.commit, "25e0d31ffbebe4b5a97464dd851910efc3002d96");
  assert.equal(lock.source.treeOid, "867a6b9c2f0ddd5e72f999640bba55421655c2f9");
  assert.equal(lock.source.objectFormat, "sha1");
  assert.equal(lock.inventory.fileCount, 19);
  assert.equal(lock.inventory.normalBlobCount, 11);
  assert.equal(lock.inventory.lfsPointerCount, 8);
  assert.equal(lock.inventory.inventorySha256, "e3d5763cedba5e2b9680ad4f57af044928a07d8d82fb93f25b27d5eabf2143f1");
  assert.equal(lock.lockSha256, "d0046a083406c02dd67fd508b917750bc52f8e893527b4e39fa71abda0a6baa9");
  assert.equal(lock.selectedPayloads.count, 4);
  assert.equal(lock.selectedPayloads.totalSize, 2664021360);
  assert.equal(lock.boundaries.lfsPayloadsDownloaded, false);
  assert.equal(lock.boundaries.lfsPayloadBytesIndependentlyVerified, false);
  assert.equal(lock.boundaries.weightsIncluded, false);
  assert.equal(lock.boundaries.runtimeExecuted, false);
  assert.equal(lock.boundaries.generationAllowed, false);
  assert.deepEqual(lock.resolvedGates, ["trellisModelArtifactLock"]);
  assert.ok(lock.openGates.includes("trellisModelPayloadBytesVerification"));
  assert.equal(summary.inventorySha256, lock.inventory.inventorySha256);
  assert.equal(summary.lockSha256, lock.lockSha256);
  assert.equal(summary.selectedPayloadBytes, lock.selectedPayloads.totalSize);
  assert.equal(summary.payloadsDownloadedDuringLockPreparation, false);
  assert.equal(summary.payloadBytesVerified, false);
  assert.equal(summary.generationAllowed, false);
  assert.equal(summary.gateSnapshot, "historical-at-model-artifact-lock");
  assert.equal(summary.localVerification.ciReproducible, false);
  assert.equal(summary.localVerification.gitLfsInvokedByVerifier, false);
  assert.deepEqual(summary.localVerification.networkProtocolsAllowedByVerifier, []);
  assert.equal(summary.localVerification.payloadBytesReadByVerifier, false);
  assert.equal(summary.localVerification.runtimeExecutedByVerifier, false);
  assert.deepEqual(summary.resolvedGatesAtLock, lock.resolvedGates);
  assert.deepEqual(summary.openGatesAtLock, lock.openGates);
  assert.equal(readiness.resolved.trellisModelArtifactLock, true);
});

test("DINO source and HEAD metadata lock resolves only source identity", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  const summary = readiness.aiRights.dinoSourceArtifactMetadata;
  const lock = await json(summary.lockPath);
  assert.equal(lock.status, "source-git-object-locked-publisher-head-recorded-payload-unverified-runtime-blocked");
  assert.equal(lock.source.repository, "https://github.com/facebookresearch/dinov2.git");
  assert.equal(lock.source.commit, "b8931f7bf91576930313be2c6d6af376033b35f0");
  assert.equal(lock.source.treeOid, "39a04d481b50b484f72b1c43251efc0b2bcb5dd7");
  assert.equal(lock.sourceSnapshot.fileCount, 174);
  assert.equal(lock.sourceSnapshot.directoryCount, 57);
  assert.deepEqual(lock.sourceSnapshot.modeCounts, { "100644": 173, "100755": 1 });
  assert.equal(lock.sourceSnapshot.contentSha256, "8615fa3237c4123e4fe7fbb24511fa89ffc1bab74277f78134b6c27ee2971d57");
  assert.equal(lock.sourceSnapshot.objectGraphSha256, "e753c5e96b58032fa597d6d8b4e28163c376a244240fa793b2047a280b919848");
  assert.equal(lock.runtimeSourceClosure.fileCount, 12);
  assert.equal(lock.runtimeSourceClosure.totalSize, 43510);
  assert.equal(lock.runtimeSourceClosure.selectionSha256, "5d9fe22b05aad04a77e33b20faecf72a176fb0de5d977128127415196f87fd4d");
  assert.equal(lock.lockSha256, "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9");
  assert.equal(lock.publisherArtifact.publisherSha256, null);
  assert.equal(lock.publisherArtifact.observedSha256, null);
  assert.equal(lock.publisherArtifact.head.responseBodyBytesDelivered, false);
  assert.equal(lock.evidence.licenseEvidence.repositoryScopeCaveatStatus, "unresolved-human-review");
  assert.equal(lock.evidence.licenseEvidence.approvalClaim, false);
  assert.deepEqual(lock.resolvedGates, ["dinoSourceGitObjectLock"]);
  assert.ok(lock.openGates.includes("dinoArtifactPayloadBytesVerification"));
  assert.ok(lock.openGates.includes("dinoDerivedRuntimeArtifactLock"));
  assert.ok(lock.openGates.includes("dinoSourceAndArtifactLock"));
  assert.deepEqual(lock.gateComposition.dinoSourceAndArtifactLock, {
    operator: "allOf",
    members: ["dinoSourceGitObjectLock", "dinoArtifactPayloadBytesVerification"]
  });
  assert.equal(summary.normalCiScope, "canonical-lock-semantics-only-no-external-source-or-head");
  assert.equal(summary.sourceLicenseEvidenceStatus, "root-apache-2.0-with-conflicting-repository-readme-human-review");
  assert.equal(summary.weightRightsReviewStatus, "model-card-apache-evidence-only-payload-and-redistribution-unresolved");
  assert.deepEqual(summary.approvalClaims, {
    payloadApproved: false,
    runtimeApproved: false,
    sourceLicenseApproved: false,
    weightLicenseApproved: false
  });
  assert.equal(summary.localVerification.ciReproducible, false);
  assert.equal(summary.localVerification.publisherRequestMethod, "HEAD");
  assert.equal(summary.localVerification.publisherResponseBodyBytesDeliveredToVerifier, false);
  assert.equal(summary.gateSnapshot, "historical-at-dino-metadata-lock");
  assert.deepEqual(summary.resolvedGatesAtLock, lock.resolvedGates);
  assert.deepEqual(summary.openGatesAtLock, lock.openGates);
  assert.deepEqual(readiness.aiRights.currentGateState.resolvedGates, [
    "dinoArtifactPayloadBytesVerification",
    "dinoSourceAndArtifactLock",
    "dinoSourceGitObjectLock",
    "patchedSourceTreeDigest",
    "trellisModelArtifactLock"
  ]);
  assert.ok(!readiness.aiRights.currentGateState.openGates.includes("dinoSourceGitObjectLock"));
  assert.ok(!readiness.aiRights.currentGateState.openGates.includes("dinoArtifactPayloadBytesVerification"));
  assert.ok(readiness.aiRights.currentGateState.openGates.includes("dinoDerivedRuntimeArtifactLock"));
  assert.ok(!readiness.aiRights.currentGateState.openGates.includes("dinoSourceAndArtifactLock"));
  assert.equal(readiness.resolved.dinoSourceGitObjectLock, true);
  assert.equal(readiness.resolved.dinoArtifactPayloadBytesVerification, true);
  assert.equal(readiness.resolved.dinoSourceAndArtifactLock, true);
  assert.equal(readiness.aiRights.generationAllowed, false);
});

test("DINO raw payload identity is independently locked without approval or runtime claims", async () => {
  const readiness = await json("experiment/warm-modern-meeting-room/readiness.json");
  const historical = readiness.aiRights.dinoSourceArtifactMetadata;
  const summary = readiness.aiRights.dinoPayloadBytes;
  const lock = await json(summary.lockPath);
  assert.equal(lock.status, "raw-publisher-payload-identity-verified-restricted-retained-runtime-and-rights-blocked");
  assert.equal(lock.lockSha256, "72da7b8d42e33ba0f7632018cf9766e93ac5e62892b51023b755ce25db56f55b");
  assert.deepEqual(lock.sourceMetadataLock, {
    path: "experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json",
    lockSha256: "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9",
    publisherUrlTransitivelyBound: true
  });
  assert.equal(lock.sourceMetadataLock.path, historical.lockPath);
  assert.equal(lock.sourceMetadataLock.lockSha256, historical.lockSha256);
  assert.equal(lock.payload.representation, "raw-opaque-pth-publisher-response-body");
  assert.equal(lock.payload.byteLength, 1217607321);
  assert.equal(lock.payload.observedSha256, "36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51");
  assert.equal(lock.payload.publisherSha256, null);
  assert.deepEqual(lock.payload.independentHashTools, ["openssl", "sha256sum"]);
  assert.deepEqual(lock.acquisition.preAcquisitionHead, {
    method: "HEAD",
    matchedSourceMetadataLockExactly: true
  });
  assert.equal(lock.acquisition.get.method, "GET");
  assert.equal(lock.acquisition.get.status, 200);
  assert.equal(lock.acquisition.get.redirectsFollowed, 0);
  assert.equal(lock.acquisition.get.rangeRequested, false);
  assert.equal(lock.acquisition.get.acceptEncoding, "identity");
  assert.equal(lock.acquisition.get.responseBlockCount, 1);
  assert.deepEqual(lock.acquisition.get.headers, {
    "accept-ranges": "bytes",
    "content-length": "1217607321",
    "content-type": "binary/octet-stream",
    etag: "\"b6cbe2bf3ce2f370d5a67bcd465144b0-146\"",
    "last-modified": "Fri, 27 Oct 2023 10:37:32 GMT",
    "x-amz-server-side-encryption": "AES256",
    "x-amz-version-id": "HLmbhvcd2hPq9CNLwMvwswbRlzZRuOeA"
  });
  assert.deepEqual(lock.acquisition.get.absentHeaders, [
    "content-encoding",
    "content-range",
    "location",
    "transfer-encoding"
  ]);
  assert.equal(lock.restrictedStorage.contentAddress.digest, lock.payload.observedSha256);
  assert.deepEqual(lock.restrictedStorage.encryption, { mode: "SSE-KMS", algorithm: "AES-256" });
  assert.equal(lock.restrictedStorage.versioningEnabled, false);
  assert.equal(lock.restrictedStorage.objectAcl, "owner-only");
  assert.equal(lock.restrictedStorage.bucketAclEntryCount, 0);
  assert.equal(lock.restrictedStorage.evidenceScope, "operator-attested-point-in-time");
  assert.equal(lock.restrictedStorage.staticKeyAuthEnabled, false);
  assert.deepEqual(lock.restrictedStorage.anonymousAccess, { read: false, list: false, configRead: false });
  assert.deepEqual(lock.restrictedStorage.liveUnauthenticatedHttpStatus, { read: 403, list: 403, configRead: 403 });
  assert.equal(lock.restrictedStorage.fullReadback.matchedPayloadIdentity, true);
  assert.equal(lock.restrictedStorage.incompleteMultipartUploads, 0);
  assert.equal(lock.restrictedStorage.knownLocalPayloadCopiesDeleted, true);
  assert.equal(lock.restrictedStorage.operatorRecord.rawRecordSha256, "55d6dcbe1321068ac82a4c2e2f07f2faabd803e86693ec809044724b5d6a91da");
  assert.equal(lock.restrictedStorage.operatorRecord.locatorPublished, false);
  assert.equal(lock.normalCi.scope, "canonical-public-lock-only/no-payload-or-restricted-record-access");
  assert.equal(lock.normalCi.networkRequestInitiatedByVerifier, false);
  assert.equal(lock.normalCi.payloadAccessAllowed, false);
  assert.ok(Object.values(lock.boundaries).every((value) => value === false));
  assert.deepEqual(lock.gateEffect.directlyResolvedGates, ["dinoArtifactPayloadBytesVerification"]);
  assert.deepEqual(lock.gateEffect.mechanicallyResolvedCompositeGates, ["dinoSourceAndArtifactLock"]);
  const currentResolved = new Set(readiness.aiRights.currentGateState.resolvedGates);
  assert.ok(lock.gateComposition.dinoSourceAndArtifactLock.members.every((gate) => currentResolved.has(gate)));
  assert.ok(currentResolved.has("dinoSourceAndArtifactLock"));
  assert.equal(lock.gateSnapshot, "historical-at-dino-payload-bytes-lock");
  assert.deepEqual(summary.resolvedGatesAtLock, lock.resolvedGates);
  assert.deepEqual(summary.openGatesAtLock, lock.openGates);
  assert.equal(summary.observedSha256, lock.payload.observedSha256);
  assert.equal(summary.publisherSha256, null);
  assert.equal(summary.payloadBytesVerified, true);
  assert.equal(summary.externalVerifiedAt, "2026-08-20T09:04:22Z");
  assert.equal(summary.payloadUploadedAt, "2026-08-20T08:46:24Z");
  assert.deepEqual(summary.approvalClaims, {
    derivedArtifactApproved: false,
    humanSignoffApproved: false,
    payloadApproved: false,
    publisherSha256Verified: false,
    rightsApproved: false,
    runtimeApproved: false,
    sourceLicenseApproved: false,
    weightLicenseApproved: false
  });
  assert.equal(historical.observedSha256, null);
  assert.equal(historical.payloadBytesVerified, false);
  assert.deepEqual(historical.resolvedGatesAtLock, ["dinoSourceGitObjectLock"]);
  assert.ok(historical.openGatesAtLock.includes("dinoArtifactPayloadBytesVerification"));
  assert.ok(historical.openGatesAtLock.includes("dinoSourceAndArtifactLock"));
  assert.equal(readiness.aiRights.verdict, "blocked");
  assert.equal(readiness.aiRights.generationAllowed, false);
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
