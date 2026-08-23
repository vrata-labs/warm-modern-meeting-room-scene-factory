#!/usr/bin/env python3
"""Run synthetic weights-only security checks against the locked PyTorch wheel."""

from __future__ import annotations

import argparse
import base64
import csv
import hashlib
import io
import json
import os
import pickle
import stat
import sys
import tarfile
import tempfile
import zipfile
from pathlib import Path
from pathlib import PurePosixPath


EXPECTED_VERSION = "2.7.1+cu118"
EXPECTED_GHSA = "GHSA-53q9-r3pm-6pq6"
EXPECTED_CVE = "CVE-2025-32434"
EXPECTED_FIXED_VERSION = "2.6.0"
EXPECTED_FIX_COMMIT = "8d4b8a920a2172523deb95bf20e8e52d50649c04"
BLOCKED_AUDIT_EVENTS = (
    "os.exec", "os.fork", "os.forkpty", "os.posix_spawn", "os.spawn", "os.system",
    "socket.__new__", "socket.bind", "socket.connect", "socket.getaddrinfo", "subprocess.Popen",
)


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> tuple[int, str]:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise RuntimeError(f"unsafe_file:{path.name}")
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def stable_digest(value) -> str:
    raw = json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":")).encode("ascii")
    return sha256(raw)


def reject_duplicate_keys(pairs):
    value = {}
    for key, nested in pairs:
        if key in value:
            raise RuntimeError(f"duplicate_json_key:{key}")
        value[key] = nested
    return value


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)


def safe_record_path(value: str) -> bool:
    path = PurePosixPath(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and "\\" not in value and "\0" not in value


def expected_digest(encoded: str) -> str:
    algorithm, separator, value = encoded.partition("=")
    if separator != "=" or algorithm != "sha256":
        raise RuntimeError("wheel_record_hash_algorithm_invalid")
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding).hex()


def installed_path(runtime_site: Path, record_path: str) -> Path:
    parts = PurePosixPath(record_path).parts
    data_index = 0 if parts and parts[0].endswith(".data") else None
    if data_index is None:
        relative = parts
    else:
        scheme = parts[data_index + 1]
        suffix = parts[data_index + 2 :]
        if scheme in {"purelib", "platlib", "data", "headers"}:
            relative = suffix
        elif scheme == "scripts":
            relative = ("bin", *suffix)
        else:
            raise RuntimeError(f"unsupported_wheel_data_scheme:{scheme}")
    return runtime_site.joinpath(*relative)


def verify_torch_install(runtime_site: Path, wheel_path: Path, expected_sha256: str) -> dict:
    wheel_size, wheel_sha256 = sha256_file(wheel_path)
    if wheel_sha256 != expected_sha256:
        raise RuntimeError("torch_wheel_sha256_mismatch")
    checked_files = []
    with zipfile.ZipFile(wheel_path) as archive:
        record_names = [
            name for name in archive.namelist()
            if name.endswith(".dist-info/RECORD") and name.count("/") == 1
        ]
        if len(record_names) != 1:
            raise RuntimeError("torch_wheel_record_layout_invalid")
        record_info = archive.getinfo(record_names[0])
        if record_info.file_size > 8 * 1024 * 1024:
            raise RuntimeError("torch_wheel_record_too_large")
        rows = list(csv.reader(io.TextIOWrapper(archive.open(record_info), encoding="utf-8", newline="")))
        if len(rows) > 100000:
            raise RuntimeError("torch_wheel_record_too_many_rows")
    for row in rows:
        if len(row) != 3 or not safe_record_path(row[0]):
            raise RuntimeError("torch_wheel_record_invalid")
        if not row[1]:
            if not row[0].endswith(".dist-info/RECORD"):
                raise RuntimeError("torch_wheel_record_hash_missing")
            continue
        target = installed_path(runtime_site, row[0])
        try:
            target.resolve().relative_to(runtime_site)
        except ValueError as error:
            raise RuntimeError(f"torch_installed_file_outside_runtime_site:{row[0]}") from error
        installed_size, installed_sha256 = sha256_file(target)
        if installed_sha256 != expected_digest(row[1]):
            raise RuntimeError(f"torch_installed_file_hash_mismatch:{row[0]}")
        if row[2] and installed_size != int(row[2]):
            raise RuntimeError(f"torch_installed_file_size_mismatch:{row[0]}")
        checked_files.append({"path": row[0], "sha256": installed_sha256})
    return {
        "filename": wheel_path.name,
        "byteLength": wheel_size,
        "sha256": wheel_sha256,
        "identityVerified": True,
        "checkedInstalledFileCount": len(checked_files),
        "installedFileSetSha256": stable_digest(checked_files),
        "everyHashedWheelRecordMatchedInstalledBytes": True,
    }


def verify_attested_runtime_site(runtime_site: Path, install_report: dict) -> dict:
    expected_records = install_report.get("installation", {}).get("installedFiles", [])
    expected = {
        record["path"]: record["sha256"]
        for record in expected_records
        if isinstance(record, dict) and set(record) == {"path", "role", "sha256"}
    }
    if len(expected) != len(expected_records):
        raise RuntimeError("offline_install_report_file_records_invalid")
    actual = {}
    actual_directories = []
    for path in runtime_site.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(f"runtime_site_symlink_forbidden:{path.relative_to(runtime_site).as_posix()}")
        if path.is_file():
            relative = path.relative_to(runtime_site).as_posix()
            actual[relative] = sha256_file(path)[1]
        elif path.is_dir():
            actual_directories.append(path.relative_to(runtime_site).as_posix())
        else:
            raise RuntimeError(f"runtime_site_special_file_forbidden:{path.relative_to(runtime_site).as_posix()}")
    if actual != expected:
        raise RuntimeError("runtime_site_attested_file_set_mismatch")
    if stable_digest(expected_records) != install_report["installation"]["installedFileSetSha256"]:
        raise RuntimeError("offline_install_report_file_set_digest_invalid")
    actual_directories.sort()
    if actual_directories != install_report["installation"]["installedDirectories"]:
        raise RuntimeError("runtime_site_attested_directory_set_mismatch")
    if stable_digest(actual_directories) != install_report["installation"]["installedDirectorySetSha256"]:
        raise RuntimeError("offline_install_report_directory_set_digest_invalid")
    return {
        "offlineInstallReportSha256": install_report["reportSha256"],
        "installedFileCount": len(expected_records),
        "installedFileSetSha256": install_report["installation"]["installedFileSetSha256"],
        "installedDirectoryCount": len(actual_directories),
        "installedDirectorySetSha256": install_report["installation"]["installedDirectorySetSha256"],
        "everyAttestedRuntimeFileRehashed": True,
    }


def isolation_observation(input_paths: list[Path]) -> dict:
    status = {}
    for line in Path("/proc/self/status").read_text(encoding="utf-8").splitlines():
        if ":" in line:
            key, value = line.split(":", 1)
            status[key] = value.strip()
    credential_prefixes = ("AWS_", "AZURE_", "GOOGLE_", "YC_", "YANDEX_")
    observed = {
        "effectiveUid": os.geteuid(),
        "effectiveGid": os.getegid(),
        "effectiveCapabilitiesHex": status.get("CapEff", ""),
        "noNewPrivileges": status.get("NoNewPrivs") == "1",
        "seccompMode": int(status.get("Seccomp", "0")),
        "seccompFilterCount": int(status.get("Seccomp_filters", "0")),
        "networkInterfaces": sorted(path.name for path in Path("/sys/class/net").iterdir()),
        "rootFilesystemReadOnly": bool(os.statvfs("/").f_flag & os.ST_RDONLY),
        "inputsReadOnly": all(bool(os.statvfs(path).f_flag & os.ST_RDONLY) for path in input_paths),
        "cloudCredentialsObserved": any(key.startswith(credential_prefixes) for key in os.environ),
    }
    if observed != {
        "effectiveUid": 1000,
        "effectiveGid": 1000,
        "effectiveCapabilitiesHex": "0000000000000000",
        "noNewPrivileges": True,
        "seccompMode": 2,
        "seccompFilterCount": 1,
        "networkInterfaces": ["lo"],
        "rootFilesystemReadOnly": True,
        "inputsReadOnly": True,
        "cloudCredentialsObserved": False,
    }:
        raise RuntimeError("container_isolation_observation_invalid")
    return observed


def add_tar_member(archive: tarfile.TarFile, name: str, value: bytes) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(value)
    info.mode = 0o600
    archive.addfile(info, io.BytesIO(value))


class SentinelPayload:
    def __init__(self, sentinel: Path):
        self.sentinel = sentinel

    def __reduce__(self):
        return os.system, (f"touch {self.sentinel}",)


def build_legacy_tar(path: Path, sentinel: Path) -> None:
    storages = pickle.dumps(0, protocol=2) + pickle.dumps([], protocol=2)
    tensors = pickle.dumps(0, protocol=2)
    payload = pickle.dumps(SentinelPayload(sentinel), protocol=2)
    with tarfile.open(path, "w", format=tarfile.PAX_FORMAT) as archive:
        add_tar_member(archive, "storages", storages)
        add_tar_member(archive, "tensors", tensors)
        add_tar_member(archive, "pickle", payload)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-site", type=Path, required=True)
    parser.add_argument("--torch-wheel", type=Path, required=True)
    parser.add_argument("--expected-wheel-sha256", required=True)
    parser.add_argument("--dependency-wheel-lock", type=Path, required=True)
    parser.add_argument("--offline-install-report", type=Path, required=True)
    args = parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_site:
        raise RuntimeError("python_must_run_with_isolated_and_no_site_flags")
    if "PYTHONPATH" in os.environ:
        raise RuntimeError("pythonpath_environment_forbidden")
    base_prefix = Path(sys.base_prefix).resolve()
    inherited_stdlib_paths = [Path(path).resolve() for path in sys.path]
    if (
        not inherited_stdlib_paths
        or any(path != base_prefix and base_prefix not in path.parents for path in inherited_stdlib_paths)
        or any("site-packages" in path.parts or "dist-packages" in path.parts for path in inherited_stdlib_paths)
    ):
        raise RuntimeError("ambient_python_path_forbidden")
    if args.runtime_site.is_symlink() or not args.runtime_site.is_dir():
        raise RuntimeError("unsafe_runtime_site")
    runtime_site = args.runtime_site.resolve()
    wheel_path = args.torch_wheel.resolve()
    dependency_lock = load_json(args.dependency_wheel_lock.resolve())
    install_report_path = args.offline_install_report.resolve()
    install_report_raw = install_report_path.read_bytes()
    install_report_sha256 = sha256(install_report_raw)
    if install_report_sha256 != dependency_lock["resolution"]["offlineInstallReportSha256"]:
        raise RuntimeError("offline_install_report_digest_mismatch")
    install_report = json.loads(install_report_raw, object_pairs_hook=reject_duplicate_keys)
    install_report["reportSha256"] = install_report_sha256
    runtime_site_identity = verify_attested_runtime_site(runtime_site, install_report)
    runtime_site_identity["dependencyWheelLockSha256"] = dependency_lock["lockSha256"]
    wheel = verify_torch_install(runtime_site, wheel_path, args.expected_wheel_sha256)
    observed_isolation = isolation_observation([runtime_site, wheel_path, args.dependency_wheel_lock.resolve(), install_report_path])
    audit_counts = {event: 0 for event in BLOCKED_AUDIT_EVENTS}

    def audit(event, _args):
        if event in audit_counts:
            audit_counts[event] += 1
            raise RuntimeError(f"blocked_audit_event:{event}")

    sys.addaudithook(audit)
    sys.path[:] = [str(runtime_site), *map(str, inherited_stdlib_paths)]
    import torch
    if any(audit_counts.values()):
        raise RuntimeError("blocked_side_effect_attempt_observed")

    if torch.__version__ != EXPECTED_VERSION:
        raise RuntimeError(f"unexpected_torch_version:{torch.__version__}")
    torch_origin = Path(torch.__file__).resolve()
    try:
        relative_torch_origin = torch_origin.relative_to(runtime_site).as_posix()
    except ValueError as error:
        raise RuntimeError("torch_import_origin_outside_runtime_site") from error
    with tempfile.TemporaryDirectory(prefix="wmmr-pytorch-qualification-") as temporary:
        root = Path(temporary)
        safe_path = root / "safe.pt"
        legacy_path = root / "legacy-malicious.tar"
        sentinel = root / "unsafe-side-effect"

        expected = {"weight": torch.arange(8, dtype=torch.float32).reshape(2, 4)}
        torch.save(expected, safe_path)
        loaded = torch.load(safe_path, map_location="cpu", weights_only=True)
        safe_matched = set(loaded) == set(expected) and torch.equal(loaded["weight"], expected["weight"])
        if not safe_matched:
            raise RuntimeError("safe_weights_only_round_trip_failed")

        build_legacy_tar(legacy_path, sentinel)
        legacy_error = None
        try:
            torch.load(legacy_path, map_location="cpu", weights_only=True)
        except RuntimeError as error:
            legacy_error = str(error)
        if legacy_error is None or "Cannot use ``weights_only=True`` with files saved in the legacy .tar format" not in legacy_error:
            raise RuntimeError("legacy_tar_not_fail_closed")
        if sentinel.exists():
            raise RuntimeError("legacy_tar_side_effect_observed")
        if any(audit_counts.values()):
            raise RuntimeError("blocked_side_effect_attempt_observed")

        config = torch.__config__.show().encode("utf-8")
        report = {
            "schemaVersion": 1,
            "status": "patched-pytorch-synthetic-security-qualification-pass",
            "torch": {
                "version": torch.__version__,
                "gitVersion": torch.version.git_version,
                "compiledCudaVersion": torch.version.cuda,
                "configSha256": sha256(config),
                "relativeImportOrigin": relative_torch_origin,
            },
            "python": {
                "implementation": sys.implementation.name,
                "version": ".".join(map(str, sys.version_info[:3])),
                "isolated": bool(sys.flags.isolated),
                "siteInitializationDisabled": bool(sys.flags.no_site),
            },
            "wheel": wheel,
            "runtimeSite": runtime_site_identity,
            "isolation": observed_isolation,
            "sideEffects": {
                "observationScope": "python-audit-events-plus-container-network-and-seccomp-observation",
                "blockedAuditEventCounts": audit_counts,
                "successfulAuditedProcessLaunchCount": 0,
                "successfulAuditedSocketOperationCount": 0,
            },
            "advisory": {
                "ghsa": EXPECTED_GHSA,
                "cve": EXPECTED_CVE,
                "firstPatchedVersion": EXPECTED_FIXED_VERSION,
                "fixCommit": EXPECTED_FIX_COMMIT,
            },
            "checks": {
                "safeSyntheticStateDictLoadedWithWeightsOnly": True,
                "safeSyntheticStateDictMatched": True,
                "legacyTarRejectedBeforeUnpickling": True,
                "legacyTarSideEffectObserved": False,
                "unsafeTorchLoadExecuted": False,
            },
            "boundaries": {
                "applicationRuntimeImported": False,
                "modelArtifactsRead": False,
                "strictStateDictLoadExecuted": False,
                "inferenceExecuted": False,
                "gpuExecuted": False,
                "modelInputUsed": False,
                "generationAllowed": False,
            },
        }
        print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
