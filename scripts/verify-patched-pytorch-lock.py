#!/usr/bin/env python3
"""Verify the canonical WMMR patched PyTorch qualification lock."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOCK = ROOT / "experiment/warm-modern-meeting-room/patched-pytorch-qualification-lock.json"
DEPENDENCY_LOCK = ROOT / "experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json"
HARNESS = ROOT / "scripts/qualify-patched-pytorch.py"
HEX64 = re.compile(r"^[0-9a-f]{64}$")
MAX_JSON_BYTES = 4 * 1024 * 1024
RESOLVED = [
    "dependencyWheelHashLock", "dinoArtifactPayloadBytesVerification", "dinoDerivedRuntimeArtifactLock",
    "dinoSourceAndArtifactLock", "dinoSourceGitObjectLock", "patchedPytorchQualification",
    "patchedSourceTreeDigest", "trellisModelArtifactLock", "trellisModelPayloadBytesVerification",
]
OPEN = [
    "gpuParityAndVramTest", "humanRightsSignoff", "ociImageDigest", "offlineImportRuntimeTest",
    "providerTermsSnapshot", "sbomAndVulnerabilityReport", "thirdPartyNoticeBundle",
]


class QualificationFailure(Exception):
    def __init__(self, issues: list[str]):
        self.issues = sorted(set(issues))
        super().__init__("patched_pytorch_lock_invalid:" + ",".join(self.issues))


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
            raise QualificationFailure([f"duplicate_json_key:{key}"])
        value[key] = nested
    return value


def load(path: Path, *, canonical: bool = False):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink() or metadata.st_size > MAX_JSON_BYTES:
        raise QualificationFailure(["unsafe_json_file"])
    raw = path.read_bytes()
    try:
        value = json.loads(raw, object_pairs_hook=duplicate_keys)
    except QualificationFailure:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise QualificationFailure(["json_parse_failed"]) from error
    if canonical and raw != pretty_json(value):
        raise QualificationFailure(["lock_not_canonical"])
    return value, raw


def exact(value, keys: set[str], name: str, issues: list[str]) -> None:
    if not isinstance(value, dict) or set(value) != keys:
        issues.append(f"{name}_keys_invalid")


def validate(lock: dict, dependency: dict, harness_bytes: bytes) -> dict:
    issues = []
    exact(lock, {
        "advisory", "boundaries", "dependencyWheelLock", "gateEffect", "gateSnapshot", "harness",
        "isolation", "lockSha256", "normalCi", "openGates", "qualificationEnvironment",
        "resolvedGates", "restrictedStorage", "schemaVersion", "securityQualification", "status",
    }, "lock", issues)
    if lock.get("schemaVersion") != 1:
        issues.append("schema_version_invalid")
    if lock.get("status") != "locked-pytorch-wheel-synthetic-weights-only-security-qualified-runtime-blocked":
        issues.append("status_invalid")
    if not HEX64.fullmatch(lock.get("lockSha256", "")) or lock.get("lockSha256") != semantic_digest(lock):
        issues.append("lock_digest_invalid")

    torch_wheels = [wheel for wheel in dependency.get("wheelSet", {}).get("wheels", []) if wheel.get("distribution") == "torch"]
    expected_dependency = {
        "path": "experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json",
        "lockSha256": dependency.get("lockSha256"),
        "wheelInventorySha256": dependency.get("wheelSet", {}).get("wheelInventorySha256"),
        "torchWheel": {
            "filename": torch_wheels[0].get("filename") if len(torch_wheels) == 1 else None,
            "byteLength": torch_wheels[0].get("byteLength") if len(torch_wheels) == 1 else None,
            "sha256": torch_wheels[0].get("sha256") if len(torch_wheels) == 1 else None,
        },
    }
    if lock.get("dependencyWheelLock") != expected_dependency:
        issues.append("dependency_wheel_binding_invalid")
    if lock.get("advisory") != {
        "ghsa": "GHSA-53q9-r3pm-6pq6", "cve": "CVE-2025-32434",
        "source": "https://api.github.com/advisories/GHSA-53q9-r3pm-6pq6",
        "snapshotSha256": "02aa69900e4b0eb2ee2f05f0d9fc0257f66598bbdc9eee587a1468ba2bf493ff",
        "affectedVersions": "<2.6.0", "firstPatchedVersion": "2.6.0",
        "fixCommit": "8d4b8a920a2172523deb95bf20e8e52d50649c04",
    }:
        issues.append("advisory_contract_invalid")
    harness = lock.get("harness", {})
    if set(harness) != {"path", "reportSha256", "sourceSha256"}:
        issues.append("harness_keys_invalid")
    if harness.get("path") != "scripts/qualify-patched-pytorch.py" or harness.get("sourceSha256") != sha256(harness_bytes):
        issues.append("harness_binding_invalid")
    if not HEX64.fullmatch(harness.get("reportSha256", "")):
        issues.append("harness_report_digest_invalid")
    environment = lock.get("qualificationEnvironment", {})
    exact(environment, {
        "compiledCudaVersion", "imageDigest", "installedDistributionCount",
        "installedDirectoryCount", "installedDirectorySetSha256", "installedDistributionInventorySha256",
        "installedFileCount", "installedFileSetSha256",
        "offlineInstallReportSha256", "platform", "pythonVersion", "torchConfigSha256",
        "torchGitVersion", "torchImportOrigin", "torchVersion", "torchWheelInstalledFileCount",
        "torchWheelInstalledFileSetSha256",
    }, "qualification_environment", issues)
    if environment.get("imageDigest") != dependency.get("resolution", {}).get("imageDigest"):
        issues.append("qualification_image_digest_invalid")
    dependency_target = dependency.get("runtimeContract", {}).get("target", {})
    if environment.get("platform") != dependency_target.get("platform") or environment.get("pythonVersion") != dependency_target.get("pythonVersion"):
        issues.append("qualification_target_invalid")
    if environment.get("torchVersion") != "2.7.1+cu118" or environment.get("compiledCudaVersion") != "11.8":
        issues.append("qualification_torch_version_invalid")
    if environment.get("torchGitVersion") != "e2d141dbde55c2a4370fac5165b0561b6af4798b" or environment.get("torchImportOrigin") != "torch/__init__.py":
        issues.append("qualification_torch_identity_invalid")
    if environment.get("installedDistributionCount") != dependency.get("resolution", {}).get("installedDistributionCount") or environment.get("installedDistributionInventorySha256") != dependency.get("resolution", {}).get("installedDistributionInventorySha256"):
        issues.append("qualification_installation_binding_invalid")
    if environment.get("installedFileCount") != dependency.get("resolution", {}).get("installedFileCount") or environment.get("installedFileSetSha256") != dependency.get("resolution", {}).get("installedFileSetSha256") or environment.get("offlineInstallReportSha256") != dependency.get("resolution", {}).get("offlineInstallReportSha256"):
        issues.append("qualification_runtime_site_binding_invalid")
    if environment.get("installedDirectoryCount") != dependency.get("resolution", {}).get("installedDirectoryCount") or environment.get("installedDirectorySetSha256") != dependency.get("resolution", {}).get("installedDirectorySetSha256"):
        issues.append("qualification_runtime_directory_binding_invalid")
    if not HEX64.fullmatch(environment.get("torchConfigSha256", "")) or not HEX64.fullmatch(environment.get("torchWheelInstalledFileSetSha256", "")):
        issues.append("qualification_digest_invalid")
    if not isinstance(environment.get("torchWheelInstalledFileCount"), int) or environment.get("torchWheelInstalledFileCount") < 1:
        issues.append("qualification_file_count_invalid")
    qualification = lock.get("securityQualification", {})
    if qualification != {
        "safeSyntheticStateDictLoadedWithWeightsOnly": True,
        "safeSyntheticStateDictMatched": True,
        "legacyTarRejectedBeforeUnpickling": True,
        "legacyTarSideEffectObserved": False,
        "unsafeTorchLoadExecuted": False,
        "cveClassification": "unaffected-version-and-regression-pass",
    }:
        issues.append("security_qualification_invalid")
    isolation = lock.get("isolation", {})
    if isolation != {
        "networkAllowed": False, "cloudCredentialsPassed": False, "rootFilesystemReadOnly": True,
        "nonRoot": True, "capabilitiesDropped": True, "noNewPrivileges": True, "pidsLimit": 64,
        "memoryLimitBytes": 4294967296, "cpuLimit": 2,
        "observed": {
            "effectiveUid": 1000, "effectiveGid": 1000,
            "effectiveCapabilitiesHex": "0000000000000000", "noNewPrivileges": True,
            "seccompMode": 2, "seccompFilterCount": 1,
            "networkInterfaces": ["lo"], "rootFilesystemReadOnly": True,
            "inputsReadOnly": True, "cloudCredentialsObserved": False,
        },
    }:
        issues.append("isolation_contract_invalid")
    boundaries = lock.get("boundaries", {})
    if boundaries != {
        "applicationRuntimeImported": False, "modelArtifactsRead": False,
        "strictStateDictLoadExecuted": False, "inferenceExecuted": False, "gpuExecuted": False,
        "modelInputUsed": False, "allVulnerabilitiesCleared": False, "finalProductionOciLocked": False,
        "rightsApproved": False, "generationAllowed": False,
    }:
        issues.append("boundary_claim_invalid")
    if lock.get("gateSnapshot") != "historical-at-patched-pytorch-qualification" or lock.get("resolvedGates") != RESOLVED or lock.get("openGates") != OPEN:
        issues.append("gate_snapshot_invalid")
    if lock.get("gateEffect") != {
        "directlyResolvedGates": ["patchedPytorchQualification"],
        "doesNotResolveCompositeGates": True,
        "doesNotResolveOtherGates": True,
    }:
        issues.append("gate_effect_invalid")
    normal_ci = lock.get("normalCi", {})
    if normal_ci != {
        "scope": "canonical-public-lock-and-harness-only/no-wheel-report-or-restricted-record-access",
        "realWheelAccessAllowed": False, "realReportAccessAllowed": False,
        "restrictedRecordAccessAllowed": False, "networkRequestInitiatedByVerifier": False,
        "qualificationCoverage": "synthetic-protocol-fixtures-only",
    }:
        issues.append("normal_ci_boundary_invalid")
    restricted = lock.get("restrictedStorage", {})
    if set(restricted) != {"evidenceScope", "fullReadbackVerified", "operatorRecord"}:
        issues.append("restricted_storage_keys_invalid")
    operator = restricted.get("operatorRecord", {})
    if set(operator) != {"rawRecordSha256", "schemaVersion", "visibility"}:
        issues.append("operator_record_keys_invalid")
    operator_digest = operator.get("rawRecordSha256", "")
    if (
        not HEX64.fullmatch(operator_digest)
        or restricted.get("evidenceScope") != "operator-attested-point-in-time"
        or restricted.get("fullReadbackVerified") is not True
        or operator.get("schemaVersion") != 3
        or operator.get("visibility") != "restricted-evidence-retention"
    ):
        issues.append("restricted_storage_evidence_invalid")
    if issues:
        raise QualificationFailure(issues)
    return lock


def validate_report(lock: dict, report: dict, advisory_raw: bytes | None) -> None:
    issues = []
    exact(report, {
        "advisory", "boundaries", "checks", "isolation", "python", "runtimeSite", "schemaVersion",
        "sideEffects", "status", "torch", "wheel",
    }, "qualification_report", issues)
    if report.get("schemaVersion") != 1:
        issues.append("qualification_report_schema_invalid")
    if report.get("status") != "patched-pytorch-synthetic-security-qualification-pass":
        issues.append("qualification_report_status_invalid")
    environment = lock["qualificationEnvironment"]
    if report.get("python") != {
        "implementation": "cpython", "version": environment["pythonVersion"],
        "isolated": True, "siteInitializationDisabled": True,
    }:
        issues.append("qualification_report_python_invalid")
    if report.get("torch") != {
        "version": environment["torchVersion"], "gitVersion": environment["torchGitVersion"],
        "compiledCudaVersion": environment["compiledCudaVersion"],
        "configSha256": environment["torchConfigSha256"], "relativeImportOrigin": environment["torchImportOrigin"],
    }:
        issues.append("qualification_report_torch_identity_mismatch")
    expected_wheel = dict(lock["dependencyWheelLock"]["torchWheel"])
    expected_wheel.update({
        "identityVerified": True,
        "checkedInstalledFileCount": environment["torchWheelInstalledFileCount"],
        "installedFileSetSha256": environment["torchWheelInstalledFileSetSha256"],
        "everyHashedWheelRecordMatchedInstalledBytes": True,
    })
    if report.get("wheel") != expected_wheel:
        issues.append("qualification_report_wheel_binding_invalid")
    if report.get("runtimeSite") != {
        "dependencyWheelLockSha256": lock["dependencyWheelLock"]["lockSha256"],
        "offlineInstallReportSha256": environment["offlineInstallReportSha256"],
        "installedFileCount": environment["installedFileCount"],
        "installedFileSetSha256": environment["installedFileSetSha256"],
        "installedDirectoryCount": environment["installedDirectoryCount"],
        "installedDirectorySetSha256": environment["installedDirectorySetSha256"],
        "everyAttestedRuntimeFileRehashed": True,
    }:
        issues.append("qualification_report_runtime_site_invalid")
    if report.get("isolation") != lock["isolation"]["observed"]:
        issues.append("qualification_report_isolation_invalid")
    if report.get("sideEffects") != {
        "observationScope": "python-audit-events-plus-container-network-and-seccomp-observation",
        "blockedAuditEventCounts": {
            "os.exec": 0, "os.fork": 0, "os.forkpty": 0, "os.posix_spawn": 0, "os.spawn": 0,
            "os.system": 0, "socket.__new__": 0, "socket.bind": 0, "socket.connect": 0,
            "socket.getaddrinfo": 0, "subprocess.Popen": 0,
        },
        "successfulAuditedProcessLaunchCount": 0,
        "successfulAuditedSocketOperationCount": 0,
    }:
        issues.append("qualification_report_side_effect_boundary_invalid")
    if report.get("advisory") != {
        "ghsa": lock["advisory"]["ghsa"], "cve": lock["advisory"]["cve"],
        "firstPatchedVersion": lock["advisory"]["firstPatchedVersion"], "fixCommit": lock["advisory"]["fixCommit"],
    }:
        issues.append("qualification_report_advisory_invalid")
    expected_checks = {key: value for key, value in lock["securityQualification"].items() if key != "cveClassification"}
    if report.get("checks") != expected_checks:
        issues.append("qualification_report_security_check_invalid")
    if report.get("boundaries") != {
        "applicationRuntimeImported": False, "modelArtifactsRead": False,
        "strictStateDictLoadExecuted": False, "inferenceExecuted": False, "gpuExecuted": False,
        "modelInputUsed": False, "generationAllowed": False,
    }:
        issues.append("qualification_report_boundaries_invalid")
    if advisory_raw is not None and sha256(advisory_raw) != lock["advisory"]["snapshotSha256"]:
        issues.append("advisory_snapshot_digest_mismatch")
    if issues:
        raise QualificationFailure(issues)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--advisory-snapshot", type=Path)
    parser.add_argument("--print-semantic-digest", action="store_true")
    args = parser.parse_args()
    lock, _ = load(args.lock.resolve(), canonical=not args.print_semantic_digest)
    if args.print_semantic_digest:
        print(semantic_digest(lock))
        return
    dependency, _ = load(DEPENDENCY_LOCK, canonical=True)
    if dependency.get("lockSha256") != semantic_digest(dependency):
        raise QualificationFailure(["dependency_lock_digest_invalid"])
    validate(lock, dependency, HARNESS.read_bytes())
    if args.report:
        report, report_raw = load(args.report.resolve())
        if sha256(report_raw) != lock["harness"]["reportSha256"]:
            raise QualificationFailure(["qualification_report_digest_mismatch"])
        advisory_raw = args.advisory_snapshot.resolve().read_bytes() if args.advisory_snapshot else None
        validate_report(lock, report, advisory_raw)
    print(stable_json({
        "schemaVersion": 1,
        "status": "patched-pytorch-qualification-lock-verified",
        "lockSha256": lock["lockSha256"],
        "realReportRead": bool(args.report),
        "networkRequestInitiated": False,
        "generationAllowed": False,
    }))


if __name__ == "__main__":
    try:
        main()
    except QualificationFailure as error:
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(1) from None
