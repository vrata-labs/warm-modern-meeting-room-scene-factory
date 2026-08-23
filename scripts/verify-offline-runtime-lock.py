#!/usr/bin/env python3
"""Verify the canonical WMMR offline runtime qualification lock."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOCK = ROOT / "experiment/warm-modern-meeting-room/offline-runtime-qualification-lock.json"
HARNESS = ROOT / "scripts/qualify-offline-runtime.py"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
MAX_JSON_BYTES = 4 * 1024 * 1024
REFERENCE_LOCKS = {
    "artifactRevisionLock": ("experiment/warm-modern-meeting-room/artifact-revision-lock.json", "artifactSha256"),
    "dependencyWheelLock": ("experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json", "lockSha256"),
    "patchedPytorchLock": ("experiment/warm-modern-meeting-room/patched-pytorch-qualification-lock.json", "lockSha256"),
    "dinoSourceLock": ("experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json", "lockSha256"),
    "dinoDerivedLock": ("experiment/warm-modern-meeting-room/dino-derived-runtime-artifact-lock.json", "lockSha256"),
    "trellisModelLock": ("experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json", "lockSha256"),
    "trellisPayloadLock": ("experiment/warm-modern-meeting-room/trellis-payload-bytes-lock.json", "lockSha256"),
}
EXPECTED_DINO_STRICT_LOAD = {
    "callable": "dinov2.models.vision_transformer.vit_large",
    "arguments": {
        "block_chunks": 0, "ffn_layer": "mlp", "img_size": 518, "init_values": 1,
        "interpolate_antialias": True, "interpolate_offset": 0, "num_register_tokens": 4, "patch_size": 14,
    },
    "artifactSha256": "30e20dce587ad621a8dfc20e4ed66198d2998974928d44f06a6baf7732503dcc",
    "tensorCount": 344, "totalElements": 304372736,
    "structureSha256": "5edf3994b1d63144d8f6469582dfb5c9d17256191f658fefdd042b3d18e8c73d",
    "strict": True, "missingKeyCount": 0, "unexpectedKeyCount": 0,
}
EXPECTED_TRELLIS_STRICT_LOADS = [
    {
        "key": "slat_decoder_mesh", "className": "SLatMeshDecoder",
        "configSha256": "293900795cb69cc972d1a20a4940ee12f7e007952c2ae92d128dda91b96ac317",
        "payloadSha256": "3e87aba94b5786407eb06d0502c1ed0885a0027a3f2b8537bfe15b0a92c01859",
        "tensorCount": 120, "totalElements": 90926693,
        "structureSha256": "0585830ef3b10683c2ba14ff8d7ee9305d4c5d34587dae52a13575a6fc1a66b2",
        "strict": True, "missingKeyCount": 0, "unexpectedKeyCount": 0,
    },
    {
        "key": "slat_flow_model", "className": "SLatFlowModel",
        "configSha256": "c0a9bd57227f55cf75ff02562c27bb05c50174f06955f56a79dea2982fd7a8f9",
        "payloadSha256": "693fb2a58ad497bd222007301eeec49d14d60f8c12d2f2f00c221fa747b4c66c",
        "tensorCount": 526, "totalElements": 600432520,
        "structureSha256": "88e92ddcc04d7a676a93e779428905a70318182352571d0b2c0ebde022496f36",
        "strict": True, "missingKeyCount": 0, "unexpectedKeyCount": 0,
    },
    {
        "key": "sparse_structure_decoder", "className": "SparseStructureDecoder",
        "configSha256": "646781293f1cda74720de85d1cef50a957fb4aebd9a4bd014e454e32f2330ac5",
        "payloadSha256": "1c76d4a40519aa2d711cc263a8404105231ac26db31d946bed48b84fee79009a",
        "tensorCount": 74, "totalElements": 73671201,
        "structureSha256": "cbd3b529c739a1198d447b242cab1f9290e4860cd8620dfc2b1d7fbee2a6fb54",
        "strict": True, "missingKeyCount": 0, "unexpectedKeyCount": 0,
    },
    {
        "key": "sparse_structure_flow_model", "className": "SparseStructureFlowModel",
        "configSha256": "bf69161da7ece9a87394dd4441f0cfa6d4261696a214a8f68388c81fa9a6b5b7",
        "payloadSha256": "96dc6bfd4136fd950af564dd16b4ae533c9ba6af8f26c670646b2a9f2789b1db",
        "tensorCount": 489, "totalElements": 559737864,
        "structureSha256": "26ec6ff7e323cde6d6d9498e94ecc0b1290909968e1203c6480474d6bc915147",
        "strict": True, "missingKeyCount": 0, "unexpectedKeyCount": 0,
    },
]


class OfflineRuntimeFailure(Exception):
    def __init__(self, issues: list[str]):
        self.issues = sorted(set(issues))
        super().__init__("offline_runtime_lock_invalid:" + ",".join(self.issues))


def stable_json(value) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def pretty_json(value) -> bytes:
    return (json.dumps(value, ensure_ascii=True, indent=2) + "\n").encode("ascii")


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def semantic_digest(lock: dict) -> str:
    value = dict(lock)
    value.pop("lockSha256", None)
    return sha256(stable_json(value).encode("ascii"))


def duplicate_keys(pairs):
    value = {}
    for key, nested in pairs:
        if key in value:
            raise OfflineRuntimeFailure([f"duplicate_json_key:{key}"])
        value[key] = nested
    return value


def load(path: Path, *, canonical: bool = False):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_size > MAX_JSON_BYTES:
        raise OfflineRuntimeFailure(["unsafe_json_file"])
    raw = path.read_bytes()
    try:
        value = json.loads(raw, object_pairs_hook=duplicate_keys)
    except OfflineRuntimeFailure:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise OfflineRuntimeFailure(["json_parse_failed"]) from error
    if canonical and raw != pretty_json(value):
        raise OfflineRuntimeFailure(["lock_not_canonical"])
    return value, raw


def validate(lock: dict) -> dict:
    issues = []
    expected_top_level = {
        "boundaries", "environment", "gateEffect", "gateSnapshot", "harness", "imports", "isolation",
        "lockSha256", "normalCi", "openGates", "prerequisites", "resolvedGates", "restrictedStorage",
        "schemaVersion", "sourceMaterialization", "status", "strictLoads",
    }
    if not isinstance(lock, dict) or set(lock) != expected_top_level:
        issues.append("lock_keys_invalid")
    if lock.get("schemaVersion") != 1:
        issues.append("schema_version_invalid")
    if lock.get("status") != "locked-offline-imports-and-strict-state-loads-qualified-generation-blocked":
        issues.append("status_invalid")
    if not HEX64.fullmatch(lock.get("lockSha256", "")) or lock.get("lockSha256") != semantic_digest(lock):
        issues.append("lock_digest_invalid")
    prerequisites = lock.get("prerequisites", {})
    if set(prerequisites) != set(REFERENCE_LOCKS):
        issues.append("prerequisite_set_invalid")
    referenced_locks = {}
    for name, (relative, digest_field) in REFERENCE_LOCKS.items():
        referenced, _ = load(ROOT / relative, canonical=True)
        referenced_locks[name] = referenced
        semantic_value = dict(referenced)
        semantic_value.pop(digest_field, None)
        if referenced.get(digest_field) != sha256(stable_json(semantic_value).encode("ascii")):
            issues.append(f"prerequisite_digest_invalid:{name}")
        record = prerequisites.get(name, {})
        if record.get("path") != relative or record.get(digest_field) != referenced.get(digest_field):
            issues.append(f"prerequisite_binding_invalid:{name}")
    if prerequisites.get("artifactRevisionLock", {}).get("treeSha256") != lock.get("sourceMaterialization", {}).get("trellisTreeSha256"):
        issues.append("trellis_tree_binding_invalid")
    dependency_lock, _ = load(ROOT / REFERENCE_LOCKS["dependencyWheelLock"][0])
    if prerequisites.get("dependencyWheelLock", {}).get("wheelInventorySha256") != dependency_lock.get("wheelSet", {}).get("wheelInventorySha256"):
        issues.append("wheel_inventory_binding_invalid")
    environment = lock.get("environment", {})
    expected_environment_keys = {
        "bytecodeWritesDisabled", "compiledCudaVersion", "cudaInitialized", "dependencyWheelLockSha256", "installedDistributionCount",
        "installedDirectoryCount", "installedDirectorySetSha256", "installedDistributionInventorySha256",
        "installedFileSetSha256", "offlineInstallReportSha256", "installedFileCount", "peakRssKiB",
        "pythonIsolatedMode", "pythonPathEnvironmentPresent", "pythonVersion",
        "qualificationBaseImageDigest", "siteInitializationDisabled", "torchRelativeImportOrigin", "torchVersion",
    }
    if not isinstance(environment, dict) or set(environment) != expected_environment_keys:
        issues.append("environment_keys_invalid")
    if environment.get("qualificationBaseImageDigest") != dependency_lock.get("resolution", {}).get("imageDigest"):
        issues.append("runtime_image_binding_invalid")
    if environment.get("dependencyWheelLockSha256") != dependency_lock.get("lockSha256"):
        issues.append("runtime_dependency_lock_binding_invalid")
    if environment.get("pythonVersion") != dependency_lock.get("runtimeContract", {}).get("target", {}).get("pythonVersion"):
        issues.append("runtime_python_binding_invalid")
    if environment.get("installedDistributionCount") != dependency_lock.get("resolution", {}).get("installedDistributionCount") or environment.get("installedDistributionInventorySha256") != dependency_lock.get("resolution", {}).get("installedDistributionInventorySha256"):
        issues.append("runtime_environment_binding_invalid")
    if environment.get("offlineInstallReportSha256") != dependency_lock.get("resolution", {}).get("offlineInstallReportSha256") or environment.get("installedFileSetSha256") != dependency_lock.get("resolution", {}).get("installedFileSetSha256"):
        issues.append("runtime_install_attestation_binding_invalid")
    if environment.get("installedFileCount") != dependency_lock.get("resolution", {}).get("installedFileCount"):
        issues.append("runtime_install_file_count_invalid")
    if environment.get("installedDirectoryCount") != dependency_lock.get("resolution", {}).get("installedDirectoryCount") or environment.get("installedDirectorySetSha256") != dependency_lock.get("resolution", {}).get("installedDirectorySetSha256"):
        issues.append("runtime_install_directory_binding_invalid")
    if environment.get("pythonIsolatedMode") is not True or environment.get("siteInitializationDisabled") is not True or environment.get("bytecodeWritesDisabled") is not True or environment.get("pythonPathEnvironmentPresent") is not False:
        issues.append("runtime_python_isolation_invalid")
    if environment.get("torchRelativeImportOrigin") != "torch/__init__.py" or environment.get("cudaInitialized") is not False:
        issues.append("runtime_import_environment_invalid")
    patched_environment = referenced_locks.get("patchedPytorchLock", {}).get("qualificationEnvironment", {})
    if environment.get("torchVersion") != patched_environment.get("torchVersion") or environment.get("compiledCudaVersion") != patched_environment.get("compiledCudaVersion"):
        issues.append("runtime_pytorch_binding_invalid")
    if not isinstance(environment.get("peakRssKiB"), int) or environment.get("peakRssKiB") < 1:
        issues.append("runtime_peak_rss_invalid")
    source_materialization = lock.get("sourceMaterialization", {})
    if set(source_materialization) != {
        "dinoFileCount", "dinoSelectionSha256", "selectedModelMetadataCount", "trellisFileCount", "trellisTreeSha256",
    }:
        issues.append("source_materialization_keys_invalid")
    if source_materialization != {
        "trellisFileCount": 50,
        "trellisTreeSha256": prerequisites.get("artifactRevisionLock", {}).get("treeSha256"),
        "dinoFileCount": 12,
        "dinoSelectionSha256": referenced_locks.get("dinoSourceLock", {}).get("runtimeSourceClosure", {}).get("selectionSha256"),
        "selectedModelMetadataCount": 5,
    }:
        issues.append("source_materialization_binding_invalid")
    imports = lock.get("imports", {})
    expected_import_keys = {
        "blockedAuditEventCounts", "blockedCummNvccProbeAttempts", "everySourceModuleOriginVerified",
        "expectedModuleCount", "importedModuleCount", "moduleOriginPlanSha256", "modulePlanSha256",
        "prohibitedModulePrefixes", "prohibitedModulesObserved", "sideEffectObservationScope",
        "successfulAuditedProcessLaunchCount", "successfulAuditedSocketOperationCount", "torchHubInvocationCount",
    }
    if not isinstance(imports, dict) or set(imports) != expected_import_keys:
        issues.append("imports_keys_invalid")
    if imports.get("expectedModuleCount") != 58 or imports.get("importedModuleCount") != 58:
        issues.append("import_count_invalid")
    if imports.get("modulePlanSha256") != "943a62d4e4bc34b231d0fc70d40815ba3936d1e059dde62d3cf5ac071cc2cba0" or imports.get("moduleOriginPlanSha256") != "ed486f816642a26e94bd60b9e9cb664d1591fd50c990972fb3c4d00164df08a9" or imports.get("everySourceModuleOriginVerified") is not True:
        issues.append("source_module_origin_evidence_invalid")
    if imports.get("prohibitedModulePrefixes") != [
        "diffoctreerast", "diff_gaussian_rasterization", "nvdiffrast", "open3d", "plyfile", "rembg",
        "torchsparse", "trellis.renderers", "trellis.representations.gaussian",
        "trellis.representations.radiance_field", "trellis.utils.postprocessing_utils",
        "trellis.utils.render_utils", "vox2seq",
    ]:
        issues.append("prohibited_module_policy_invalid")
    if imports.get("prohibitedModulesObserved") != [] or imports.get("successfulAuditedProcessLaunchCount") != 0 or imports.get("successfulAuditedSocketOperationCount") != 0 or imports.get("torchHubInvocationCount") != 0:
        issues.append("runtime_side_effect_boundary_invalid")
    if imports.get("sideEffectObservationScope") != "python-audit-events-plus-container-network-and-seccomp-observation":
        issues.append("runtime_side_effect_scope_invalid")
    if imports.get("blockedCummNvccProbeAttempts") != 1:
        issues.append("cumm_probe_evidence_invalid")
    if imports.get("blockedAuditEventCounts") != {
        "os.exec": 0, "os.fork": 0, "os.forkpty": 0, "os.posix_spawn": 0, "os.spawn": 0, "os.system": 0, "socket.__new__": 0,
        "socket.bind": 0, "socket.connect": 0, "socket.getaddrinfo": 0, "subprocess.Popen": 1,
    }:
        issues.append("audit_event_counts_invalid")
    strict_loads = lock.get("strictLoads", {})
    dino = strict_loads.get("dino", {})
    if dino != EXPECTED_DINO_STRICT_LOAD:
        issues.append("dino_strict_load_invalid")
    trellis = strict_loads.get("trellis", [])
    if trellis != EXPECTED_TRELLIS_STRICT_LOADS:
        issues.append("trellis_strict_load_set_invalid")
    harness = lock.get("harness", {})
    if set(harness) != {"path", "reportSha256", "sourceSha256"}:
        issues.append("harness_keys_invalid")
    if harness.get("path") != "scripts/qualify-offline-runtime.py" or harness.get("sourceSha256") != sha256(HARNESS.read_bytes()):
        issues.append("harness_binding_invalid")
    if not HEX64.fullmatch(harness.get("reportSha256", "")):
        issues.append("harness_report_digest_invalid")
    if lock.get("isolation") != {
        "networkNamespace": "none", "cloudCredentialsPassed": False, "rootFilesystemReadOnly": True,
        "inputsReadOnly": True, "nonRoot": True, "capabilitiesDropped": True, "noNewPrivileges": True,
        "pythonIsolatedMode": True, "siteInitializationDisabled": True, "bytecodeWritesDisabled": True,
        "memoryLimitBytes": 15032385536, "cpuLimit": 4, "pidsLimit": 128,
        "observed": {
            "effectiveUid": 1000, "effectiveGid": 1000,
            "effectiveCapabilitiesHex": "0000000000000000", "noNewPrivileges": True,
            "seccompMode": 2, "seccompFilterCount": 1,
            "networkInterfaces": ["lo"], "rootFilesystemReadOnly": True,
            "inputsReadOnly": True, "cloudCredentialsObserved": False,
        },
    }:
        issues.append("isolation_contract_invalid")
    if lock.get("normalCi") != {
        "scope": "canonical-public-lock-and-harness-only/no-wheel-model-report-or-restricted-record-access",
        "realRuntimeExecuted": False, "modelArtifactAccessAllowed": False,
        "restrictedRecordAccessAllowed": False, "networkRequestInitiatedByVerifier": False,
        "runtimeVerificationCoverage": "synthetic-protocol-fixtures-only",
    }:
        issues.append("normal_ci_boundary_invalid")
    restricted = lock.get("restrictedStorage", {})
    if set(restricted) != {"evidenceScope", "operatorRecord", "reportReadbackVerified"}:
        issues.append("restricted_storage_keys_invalid")
    if restricted.get("evidenceScope") != "operator-attested-point-in-time" or restricted.get("reportReadbackVerified") is not True:
        issues.append("restricted_storage_evidence_invalid")
    operator_record = restricted.get("operatorRecord", {})
    if set(operator_record) != {"rawRecordSha256", "schemaVersion", "visibility"}:
        issues.append("restricted_operator_record_keys_invalid")
    if operator_record.get("schemaVersion") != 3 or operator_record.get("visibility") != "restricted-evidence-retention" or not HEX64.fullmatch(operator_record.get("rawRecordSha256", "")):
        issues.append("restricted_operator_record_invalid")
    boundaries = lock.get("boundaries", {})
    if set(boundaries) != {
        "cudaExecuted", "finalProductionOciLocked", "generationAllowed", "generationExecuted",
        "inferenceExecuted", "modelForwardCalls", "modelInputUsed", "modelPayloadCopiesDeletedAfterQualification",
        "outputArtifactCreated", "rightsApproved", "runtimeImportsExecuted", "strictStateDictLoadExecuted",
    }:
        issues.append("boundaries_keys_invalid")
    if boundaries.get("runtimeImportsExecuted") is not True or boundaries.get("strictStateDictLoadExecuted") is not True or boundaries.get("modelPayloadCopiesDeletedAfterQualification") is not True:
        issues.append("positive_runtime_evidence_missing")
    for field in (
        "inferenceExecuted", "modelInputUsed", "cudaExecuted", "generationExecuted", "outputArtifactCreated",
        "finalProductionOciLocked", "rightsApproved", "generationAllowed",
    ):
        if boundaries.get(field) is not False:
            issues.append(f"boundary_must_be_false:{field}")
    if boundaries.get("modelForwardCalls") != 0:
        issues.append("model_forward_boundary_invalid")
    expected_resolved = [
        "dependencyWheelHashLock", "dinoArtifactPayloadBytesVerification", "dinoDerivedRuntimeArtifactLock",
        "dinoSourceAndArtifactLock", "dinoSourceGitObjectLock", "offlineImportRuntimeTest",
        "patchedPytorchQualification", "patchedSourceTreeDigest", "trellisModelArtifactLock",
        "trellisModelPayloadBytesVerification",
    ]
    expected_open = [
        "gpuParityAndVramTest", "humanRightsSignoff", "ociImageDigest", "providerTermsSnapshot",
        "sbomAndVulnerabilityReport", "thirdPartyNoticeBundle",
    ]
    if lock.get("gateSnapshot") != "historical-at-offline-runtime-qualification" or lock.get("resolvedGates") != expected_resolved or lock.get("openGates") != expected_open:
        issues.append("gate_snapshot_invalid")
    if lock.get("gateEffect") != {
        "directlyResolvedGates": ["offlineImportRuntimeTest"],
        "doesNotResolveCompositeGates": True,
        "doesNotResolveOtherGates": True,
    }:
        issues.append("gate_effect_invalid")
    if issues:
        raise OfflineRuntimeFailure(issues)
    return lock


def validate_report(lock: dict, report: dict, raw: bytes) -> None:
    issues = []
    if not isinstance(report, dict) or set(report) != {"boundaries", "environment", "imports", "isolation", "resources", "schemaVersion", "sources", "status", "strictLoads"}:
        issues.append("report_keys_invalid")
    if report.get("schemaVersion") != 1:
        issues.append("report_schema_invalid")
    if sha256(raw) != lock["harness"]["reportSha256"]:
        issues.append("report_digest_mismatch")
    if report.get("status") != "offline-import-and-strict-load-qualification-pass":
        issues.append("report_status_invalid")
    expected_environment = {key: value for key, value in lock["environment"].items() if key not in {"qualificationBaseImageDigest", "peakRssKiB"}}
    if report.get("environment") != expected_environment:
        issues.append("report_environment_mismatch")
    if report.get("sources") != lock.get("sourceMaterialization"):
        issues.append("report_sources_mismatch")
    if report.get("imports") != lock.get("imports"):
        issues.append("report_imports_mismatch")
    if report.get("isolation") != lock.get("isolation", {}).get("observed"):
        issues.append("report_isolation_mismatch")
    if report.get("strictLoads") != lock.get("strictLoads"):
        issues.append("report_strict_loads_mismatch")
    if report.get("resources") != {"peakRssKiB": lock["environment"]["peakRssKiB"]}:
        issues.append("report_resources_mismatch")
    if report.get("boundaries") != {key: value for key, value in lock["boundaries"].items() if key != "modelPayloadCopiesDeletedAfterQualification"}:
        issues.append("report_boundaries_mismatch")
    if issues:
        raise OfflineRuntimeFailure(issues)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--print-semantic-digest", action="store_true")
    args = parser.parse_args()
    lock, _ = load(args.lock.resolve(), canonical=not args.print_semantic_digest)
    if args.print_semantic_digest:
        print(semantic_digest(lock))
        return
    validate(lock)
    if args.report:
        report, raw = load(args.report.resolve())
        validate_report(lock, report, raw)
    print(stable_json({
        "schemaVersion": 1,
        "status": "offline-runtime-qualification-lock-verified",
        "lockSha256": lock["lockSha256"],
        "realReportRead": bool(args.report),
        "networkRequestInitiated": False,
        "generationAllowed": False,
    }))


if __name__ == "__main__":
    try:
        main()
    except OfflineRuntimeFailure as error:
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(1) from None
