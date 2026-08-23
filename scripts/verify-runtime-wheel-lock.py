#!/usr/bin/env python3
"""Build and verify the WMMR production runtime wheel lock."""

from __future__ import annotations

import argparse
import base64
import configparser
import csv
import hashlib
import io
import json
import os
import re
import stat
import sys
import zipfile
from email.parser import BytesParser
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

try:
    from packaging.markers import default_environment
    from packaging.requirements import Requirement
    from packaging.specifiers import SpecifierSet
    from packaging.tags import Tag, compatible_tags, cpython_tags, parse_tag
    from packaging.utils import parse_wheel_filename
except ImportError:
    from pip._vendor.packaging.markers import default_environment
    from pip._vendor.packaging.requirements import Requirement
    from pip._vendor.packaging.specifiers import SpecifierSet
    from pip._vendor.packaging.tags import Tag, compatible_tags, cpython_tags, parse_tag
    from pip._vendor.packaging.utils import parse_wheel_filename


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOCK = ROOT / "experiment/warm-modern-meeting-room/dependency-wheel-hash-lock.json"
INSTALL_ATTESTOR_PATH = ROOT / "scripts/attest-offline-wheel-install.py"
ARTIFACT_REVISION_PATH = "experiment/warm-modern-meeting-room/artifact-revision-lock.json"
ARTIFACT_REVISION_SHA256 = "03a3bc8fdbfd36fc42f46213ef16aad17ff5dd36b75bd245d2a80e96bab7a916"
DINO_SOURCE_PATH = "experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json"
DINO_SOURCE_SHA256 = "d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9"
DINO_RUNTIME_SELECTION_SHA256 = "5d9fe22b05aad04a77e33b20faecf72a176fb0de5d977128127415196f87fd4d"
RESOLVER_IMAGE_DIGEST = "sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7"
DIRECT_REQUIREMENTS = [
    "numpy==2.2.6",
    "pillow==11.3.0",
    "safetensors==0.5.3",
    "spconv-cu118==2.3.8",
    "torch==2.7.1+cu118",
    "xformers==0.0.31.post1",
]
CURRENT_RESOLVED_GATES = [
    "dependencyWheelHashLock",
    "dinoArtifactPayloadBytesVerification",
    "dinoDerivedRuntimeArtifactLock",
    "dinoSourceAndArtifactLock",
    "dinoSourceGitObjectLock",
    "patchedSourceTreeDigest",
    "trellisModelArtifactLock",
    "trellisModelPayloadBytesVerification",
]
CURRENT_OPEN_GATES = [
    "gpuParityAndVramTest",
    "humanRightsSignoff",
    "ociImageDigest",
    "offlineImportRuntimeTest",
    "patchedPytorchQualification",
    "providerTermsSnapshot",
    "sbomAndVulnerabilityReport",
    "thirdPartyNoticeBundle",
]
HEX64 = re.compile(r"^[0-9a-f]{64}$")
PRIVATE_KEYS = re.compile(r"(?:bucket|credential|kms|locator|objectKey|principal|resourceId|secret|token|url)$", re.I)
MAX_LOCK_BYTES = 4 * 1024 * 1024
MAX_WHEELS = 128
MAX_METADATA_BYTES = 2 * 1024 * 1024
MAX_WHEEL_METADATA_BYTES = 64 * 1024


class WheelLockFailure(Exception):
    def __init__(self, issues: list[str]):
        unique = sorted(set(issues))
        super().__init__("runtime_wheel_lock_invalid:" + ",".join(unique))
        self.issues = unique


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def stable_json(value) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"))


def pretty_json(value) -> bytes:
    return (json.dumps(value, ensure_ascii=True, indent=2) + "\n").encode("ascii")


def semantic_digest(lock: dict) -> str:
    semantics = dict(lock)
    semantics.pop("lockSha256", None)
    return sha256_bytes(stable_json(semantics).encode("ascii"))


def reject_duplicate_keys(pairs):
    value = {}
    for key, nested in pairs:
        if key in value:
            raise WheelLockFailure([f"duplicate_json_key:{key}"])
        value[key] = nested
    return value


def load_json(path: Path, *, canonical: bool = False):
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise WheelLockFailure(["unsafe_json_file"])
    if metadata.st_size > MAX_LOCK_BYTES:
        raise WheelLockFailure(["json_file_too_large"])
    raw = path.read_bytes()
    try:
        value = json.loads(raw, object_pairs_hook=reject_duplicate_keys)
    except WheelLockFailure:
        raise
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise WheelLockFailure(["json_parse_failed"]) from error
    if canonical and raw != pretty_json(value):
        raise WheelLockFailure(["lock_not_canonical"])
    return value, raw


def exact_keys(value, expected: set[str], name: str, issues: list[str]) -> None:
    if not isinstance(value, dict):
        issues.append(f"{name}_invalid")
    elif set(value) != expected:
        issues.append(f"{name}_keys_invalid")


def normalized_distribution(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def safe_filename(value: str) -> bool:
    return bool(value) and value == Path(value).name and value.isascii() and not any(char in value for char in ("/", "\\", "\0"))


def safe_relative_path(value: str) -> bool:
    parts = Path(value).parts
    return bool(value) and value.isascii() and not Path(value).is_absolute() and ".." not in parts and "\\" not in value and "\0" not in value


def installed_relative_path(record_path: str) -> str:
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
            raise WheelLockFailure([f"unsupported_wheel_data_scheme:{scheme}"])
    value = PurePosixPath(*relative).as_posix()
    if not safe_relative_path(value):
        raise WheelLockFailure(["wheel_record_path_invalid"])
    return value


def record_sha256(encoded: str) -> str:
    algorithm, separator, value = encoded.partition("=")
    if separator != "=" or algorithm != "sha256":
        raise WheelLockFailure(["wheel_record_hash_algorithm_invalid"])
    padding = "=" * ((4 - len(value) % 4) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding).hex()
    except ValueError as error:
        raise WheelLockFailure(["wheel_record_hash_invalid"]) from error


def expected_installed_files(wheels: list[dict], wheelhouse: Path) -> tuple[dict[str, str], dict[str, str], int]:
    direct_distributions = {
        normalized_distribution(re.split(r"[<>=!~\[\s]", value, maxsplit=1)[0])
        for value in DIRECT_REQUIREMENTS
    }
    hashed = {}
    generated = {}
    checked_count = 0
    for wheel in wheels:
        path = wheelhouse / wheel["filename"]
        with zipfile.ZipFile(path) as archive:
            record_names = [name for name in archive.namelist() if name.endswith(".dist-info/RECORD") and name.count("/") == 1]
            if len(record_names) != 1:
                raise WheelLockFailure([f"wheel_record_layout_invalid:{wheel['filename']}"])
            record_info = archive.getinfo(record_names[0])
            if record_info.file_size > 8 * 1024 * 1024:
                raise WheelLockFailure([f"wheel_record_too_large:{wheel['filename']}"])
            rows = list(csv.reader(io.TextIOWrapper(archive.open(record_info), encoding="utf-8", newline="")))
            if len(rows) > 100000:
                raise WheelLockFailure([f"wheel_record_too_many_rows:{wheel['filename']}"])
            entry_point_names = [name for name in archive.namelist() if name.endswith(".dist-info/entry_points.txt") and name.count("/") == 1]
            scripts = []
            if entry_point_names:
                if len(entry_point_names) != 1 or archive.getinfo(entry_point_names[0]).file_size > 1024 * 1024:
                    raise WheelLockFailure([f"wheel_entry_points_invalid:{wheel['filename']}"])
                parser = configparser.ConfigParser(interpolation=None, strict=True)
                parser.optionxform = str
                parser.read_string(archive.read(entry_point_names[0]).decode("utf-8"))
                for section in ("console_scripts", "gui_scripts"):
                    if parser.has_section(section):
                        scripts.extend(f"bin/{name}" for name in parser[section])
        dist_info = record_names[0].rsplit("/", 1)[0]
        generated[f"{dist_info}/RECORD"] = "pip-generated-record"
        generated[f"{dist_info}/INSTALLER"] = "pip-generated-installer"
        if wheel["distribution"] in direct_distributions:
            generated[f"{dist_info}/REQUESTED"] = "pip-generated-requested"
        for relative in scripts:
            if not safe_relative_path(relative):
                raise WheelLockFailure([f"wheel_entry_point_name_invalid:{wheel['filename']}"])
            generated[relative] = "pip-generated-entry-point"
        for row in rows:
            if len(row) != 3 or not safe_relative_path(row[0]):
                raise WheelLockFailure([f"wheel_record_invalid:{wheel['filename']}"])
            if not row[1]:
                if not row[0].endswith(".dist-info/RECORD"):
                    raise WheelLockFailure([f"wheel_record_hash_missing:{wheel['filename']}"])
                continue
            relative = installed_relative_path(row[0])
            digest = record_sha256(row[1])
            if relative in hashed and hashed[relative] != digest:
                raise WheelLockFailure([f"installed_file_collision:{relative}"])
            hashed[relative] = digest
            checked_count += 1
    if set(hashed).intersection(generated):
        raise WheelLockFailure(["generated_wheel_file_collision"])
    return hashed, generated, checked_count


def inventory_digest(wheels: list[dict]) -> str:
    return sha256_bytes(stable_json(wheels).encode("ascii"))


def target_tags() -> set[Tag]:
    platforms = [f"manylinux_2_{minor}_x86_64" for minor in range(28, 4, -1)]
    platforms.extend(["manylinux2014_x86_64", "manylinux2010_x86_64", "manylinux1_x86_64", "linux_x86_64"])
    return set(cpython_tags((3, 12), platforms=platforms)) | set(
        compatible_tags((3, 12), interpreter="cp312", platforms=platforms)
    )


def dependency_issues(wheels: list[dict]) -> list[str]:
    issues = []
    by_distribution = {wheel["distribution"]: wheel for wheel in wheels}
    compatible = target_tags()
    environment = default_environment()
    environment.update({
        "implementation_name": "cpython",
        "implementation_version": "3.12.11",
        "python_full_version": "3.12.11",
        "python_version": "3.12",
        "platform_machine": "x86_64",
        "platform_python_implementation": "CPython",
        "platform_system": "Linux",
        "platform_release": "",
        "platform_version": "",
        "platform_node": "",
        "platform_processor": "x86_64",
        "os_name": "posix",
        "sys_platform": "linux",
    })
    direct = []
    selected_extras = {}
    for value in DIRECT_REQUIREMENTS:
        requirement = Requirement(value)
        normalized = normalized_distribution(requirement.name)
        direct.append(normalized)
        selected_extras[normalized] = set(requirement.extras)
        wheel = by_distribution.get(normalized)
        if wheel is None or not requirement.specifier.contains(wheel["version"], prereleases=True):
            issues.append(f"direct_requirement_unsatisfied:{normalized}")
    if len(direct) != len(set(direct)):
        issues.append("direct_requirement_duplicate")

    changed = True
    while changed:
        changed = False
        for wheel in wheels:
            extras = {"", *selected_extras.get(wheel["distribution"], set())}
            for value in wheel["requiresDist"]:
                try:
                    requirement = Requirement(value)
                except ValueError:
                    continue
                if requirement.marker is not None and not any(
                    requirement.marker.evaluate({**environment, "extra": extra}) for extra in extras
                ):
                    continue
                required_name = normalized_distribution(requirement.name)
                before = set(selected_extras.get(required_name, set()))
                selected_extras.setdefault(required_name, set()).update(requirement.extras)
                changed = changed or selected_extras[required_name] != before

    for wheel in wheels:
        try:
            _, filename_version, _, filename_tags = parse_wheel_filename(wheel["filename"])
        except ValueError:
            issues.append(f"wheel_filename_parse_failed:{wheel['filename']}")
            continue
        if str(filename_version) != wheel["version"]:
            issues.append(f"wheel_filename_version_mismatch:{wheel['filename']}")
        metadata_tags = set()
        try:
            for value in wheel["tags"]:
                metadata_tags.update(parse_tag(value))
        except ValueError:
            issues.append(f"wheel_metadata_tag_parse_failed:{wheel['filename']}")
            continue
        if filename_tags != metadata_tags:
            issues.append(f"wheel_filename_metadata_tags_mismatch:{wheel['filename']}")
        if not filename_tags.intersection(compatible):
            issues.append(f"wheel_target_unsupported:{wheel['filename']}")
        requires_python = wheel.get("requiresPython")
        if requires_python:
            try:
                if not SpecifierSet(requires_python).contains("3.12.11", prereleases=True):
                    issues.append(f"wheel_python_unsupported:{wheel['filename']}")
            except ValueError:
                issues.append(f"wheel_requires_python_invalid:{wheel['filename']}")

        extras = {"", *selected_extras.get(wheel["distribution"], set())}
        for value in wheel["requiresDist"]:
            try:
                requirement = Requirement(value)
            except ValueError:
                issues.append(f"wheel_requirement_parse_failed:{wheel['filename']}")
                continue
            active = requirement.marker is None or any(
                requirement.marker.evaluate({**environment, "extra": extra}) for extra in extras
            )
            if not active:
                continue
            required_name = normalized_distribution(requirement.name)
            installed = by_distribution.get(required_name)
            if installed is None:
                issues.append(f"transitive_requirement_missing:{wheel['distribution']}:{required_name}")
            elif requirement.specifier and not requirement.specifier.contains(installed["version"], prereleases=True):
                issues.append(f"transitive_requirement_conflict:{wheel['distribution']}:{required_name}")
    return issues


def read_wheel_record(path: Path) -> dict:
    metadata = path.lstat()
    if not stat.S_ISREG(metadata.st_mode) or path.is_symlink():
        raise WheelLockFailure([f"unsafe_wheel:{path.name}"])
    if not safe_filename(path.name) or not path.name.endswith(".whl"):
        raise WheelLockFailure([f"invalid_wheel_filename:{path.name}"])
    size, digest = sha256_file(path)
    try:
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            metadata_names = [
                name for name in names
                if name.endswith(".dist-info/METADATA") and name.count("/") == 1
            ]
            wheel_names = [
                name for name in names
                if name.endswith(".dist-info/WHEEL") and name.count("/") == 1
            ]
            if len(metadata_names) != 1 or len(wheel_names) != 1:
                raise WheelLockFailure([f"wheel_metadata_layout_invalid:{path.name}"])
            metadata_info = archive.getinfo(metadata_names[0])
            wheel_info = archive.getinfo(wheel_names[0])
            if metadata_info.file_size > MAX_METADATA_BYTES or wheel_info.file_size > MAX_WHEEL_METADATA_BYTES:
                raise WheelLockFailure([f"wheel_metadata_too_large:{path.name}"])
            metadata_bytes = archive.read(metadata_info)
            wheel_bytes = archive.read(wheel_info)
    except zipfile.BadZipFile as error:
        raise WheelLockFailure([f"wheel_zip_invalid:{path.name}"]) from error

    metadata_message = BytesParser().parsebytes(metadata_bytes)
    wheel_message = BytesParser().parsebytes(wheel_bytes)
    name = metadata_message.get("Name")
    version = metadata_message.get("Version")
    tags = sorted(wheel_message.get_all("Tag", []))
    requires_dist = sorted(metadata_message.get_all("Requires-Dist", []))
    if not name or not version or not tags:
        raise WheelLockFailure([f"wheel_metadata_fields_missing:{path.name}"])
    return {
        "distribution": normalized_distribution(name),
        "version": version,
        "filename": path.name,
        "byteLength": size,
        "sha256": digest,
        "metadataSha256": sha256_bytes(metadata_bytes),
        "wheelMetadataSha256": sha256_bytes(wheel_bytes),
        "requiresPython": metadata_message.get("Requires-Python"),
        "requiresDist": requires_dist,
        "tags": tags,
    }


def inspect_wheelhouse(path: Path) -> list[dict]:
    root_metadata = path.lstat()
    if not stat.S_ISDIR(root_metadata.st_mode) or path.is_symlink():
        raise WheelLockFailure(["unsafe_wheelhouse"])
    entries = sorted(path.iterdir(), key=lambda entry: entry.name)
    if not entries or len(entries) > MAX_WHEELS:
        raise WheelLockFailure(["wheelhouse_count_invalid"])
    if any(entry.suffix != ".whl" for entry in entries):
        raise WheelLockFailure(["wheelhouse_extra_entry"])
    wheels = [read_wheel_record(entry) for entry in entries]
    distributions = [wheel["distribution"] for wheel in wheels]
    if len(distributions) != len(set(distributions)):
        raise WheelLockFailure(["duplicate_normalized_distribution"])
    return wheels


def validate_resolver_report(path: Path, wheels: list[dict]) -> str:
    report, raw = load_json(path)
    issues = []
    if report.get("pip_version") != "25.0.1":
        issues.append("resolver_report_pip_version_invalid")
    environment = report.get("environment", {})
    if environment.get("python_full_version") != "3.12.11" or environment.get("implementation_name") != "cpython":
        issues.append("resolver_report_python_target_invalid")
    expected = {wheel["filename"]: wheel for wheel in wheels}
    direct_distributions = {Requirement(value).name for value in DIRECT_REQUIREMENTS}
    direct_distributions = {normalized_distribution(value) for value in direct_distributions}
    observed = {}
    requested = set()
    for item in report.get("install", []):
        download = item.get("download_info", {})
        parsed_url = urlparse(download.get("url", ""))
        filename = unquote(parsed_url.path.rsplit("/", 1)[-1])
        archive_hash = download.get("archive_info", {}).get("hash", "")
        metadata = item.get("metadata", {})
        distribution = normalized_distribution(metadata.get("name", ""))
        if parsed_url.scheme != "file" or parsed_url.netloc or unquote(parsed_url.path) != f"/wheelhouse/{filename}":
            issues.append("resolver_report_download_origin_invalid")
        if item.get("is_yanked") is not False or item.get("is_direct") is not False:
            issues.append("resolver_report_install_record_invalid")
        if metadata.get("version") != expected.get(filename, {}).get("version") or distribution != expected.get(filename, {}).get("distribution"):
            issues.append("resolver_report_metadata_identity_invalid")
        if download.get("archive_info", {}).get("hashes") != {"sha256": archive_hash.removeprefix("sha256=")}:
            issues.append("resolver_report_archive_hashes_invalid")
        if item.get("requested") is True:
            requested.add(distribution)
        elif item.get("requested") is not False:
            issues.append("resolver_report_requested_flag_invalid")
        if filename in observed:
            issues.append("resolver_report_duplicate_wheel")
        observed[filename] = archive_hash.removeprefix("sha256=")
    if set(observed) != set(expected):
        issues.append("resolver_report_wheel_set_mismatch")
    for filename, digest in observed.items():
        if digest != expected.get(filename, {}).get("sha256"):
            issues.append("resolver_report_wheel_hash_mismatch")
    if requested != direct_distributions:
        issues.append("resolver_report_direct_requirements_invalid")
    if issues:
        raise WheelLockFailure(issues)
    return sha256_bytes(raw)


def validate_offline_install_report(
    path: Path,
    wheels: list[dict],
    inventory_sha256: str,
    wheelhouse: Path,
) -> tuple[str, dict]:
    report, raw = load_json(path)
    issues = []
    exact_keys(report, {"boundaries", "installation", "python", "schemaVersion", "status", "wheelhouse"}, "offline_install_report", issues)
    if report.get("schemaVersion") != 1:
        issues.append("offline_install_report_schema_invalid")
    if report.get("status") != "offline-wheel-install-attestation-pass":
        issues.append("offline_install_report_status_invalid")
    if report.get("python") != {
        "implementation": "cpython",
        "majorMinor": "3.12",
        "isolated": True,
        "siteInitializationDisabled": True,
    }:
        issues.append("offline_install_report_python_invalid")
    if report.get("wheelhouse") != {
        "wheelCount": len(wheels),
        "totalByteLength": sum(wheel["byteLength"] for wheel in wheels),
        "wheelInventorySha256": inventory_sha256,
        "everyWheelIdentityVerified": True,
        "sdistsPresent": False,
    }:
        issues.append("offline_install_report_wheelhouse_invalid")
    installation = report.get("installation", {})
    exact_keys(installation, {
        "checkedWheelRecordCount", "directUrlRecordCount", "distributionCount",
        "distributionInventorySha256", "distributions", "everyHashedWheelRecordMatchedInstalledBytes",
        "installedDirectoryCount", "installedDirectorySetSha256", "installedDirectories",
        "installedFileCount", "installedFileSetSha256", "installedFiles", "sourceBuildEvidenceObserved",
    }, "offline_install_report_installation", issues)
    expected_distributions = sorted(
        ({"normalizedName": wheel["distribution"], "version": wheel["version"]} for wheel in wheels),
        key=lambda record: record["normalizedName"],
    )
    observed_distributions = [
        {"normalizedName": record.get("normalizedName"), "version": record.get("version")}
        for record in installation.get("distributions", [])
    ]
    if observed_distributions != expected_distributions:
        issues.append("offline_install_report_distribution_set_invalid")
    if any(not isinstance(record, dict) or set(record) != {"name", "normalizedName", "version"} for record in installation.get("distributions", [])):
        issues.append("offline_install_report_distribution_record_invalid")
    if installation.get("distributionInventorySha256") != sha256_bytes(
        stable_json(installation.get("distributions", [])).encode("ascii")
    ):
        issues.append("offline_install_report_distribution_digest_invalid")
    if installation.get("distributionCount") != len(wheels):
        issues.append("offline_install_report_distribution_count_invalid")
    for field in ("distributionInventorySha256", "installedFileSetSha256"):
        if not HEX64.fullmatch(installation.get(field, "")):
            issues.append(f"offline_install_report_{field}_invalid")
    installed_files = installation.get("installedFiles", [])
    if any(
        not isinstance(record, dict)
        or set(record) != {"path", "role", "sha256"}
        or not safe_relative_path(record.get("path", ""))
        or not HEX64.fullmatch(record.get("sha256", ""))
        for record in installed_files
    ):
        issues.append("offline_install_report_file_record_invalid")
    installed_paths = [record.get("path") for record in installed_files if isinstance(record, dict)]
    if installed_paths != sorted(installed_paths) or len(installed_paths) != len(set(installed_paths)):
        issues.append("offline_install_report_file_paths_invalid")
    expected_hashed, expected_generated, expected_checked_count = expected_installed_files(wheels, wheelhouse)
    if installation.get("checkedWheelRecordCount") != expected_checked_count:
        issues.append("offline_install_report_record_count_invalid")
    observed_by_path = {
        record["path"]: record
        for record in installed_files
        if isinstance(record, dict) and isinstance(record.get("path"), str)
    }
    if set(observed_by_path) != set(expected_hashed) | set(expected_generated):
        issues.append("offline_install_report_complete_file_set_invalid")
    for relative, digest in expected_hashed.items():
        if observed_by_path.get(relative) != {"path": relative, "role": "wheel-record", "sha256": digest}:
            issues.append("offline_install_report_wheel_file_identity_invalid")
            break
    known_generated_hashes = {
        "pip-generated-installer": sha256_bytes(b"pip\n"),
        "pip-generated-requested": sha256_bytes(b""),
    }
    for relative, role in expected_generated.items():
        record = observed_by_path.get(relative, {})
        if record.get("role") != role or not HEX64.fullmatch(record.get("sha256", "")):
            issues.append("offline_install_report_generated_file_invalid")
            break
        if role in known_generated_hashes and record.get("sha256") != known_generated_hashes[role]:
            issues.append("offline_install_report_generated_marker_invalid")
            break
    expected_directories = sorted({
        PurePosixPath(relative).parents[index].as_posix()
        for relative in set(expected_hashed) | set(expected_generated)
        for index in range(len(PurePosixPath(relative).parents) - 1)
    })
    if installation.get("installedDirectories") != expected_directories:
        issues.append("offline_install_report_directory_set_invalid")
    if installation.get("installedDirectoryCount") != len(expected_directories):
        issues.append("offline_install_report_directory_count_invalid")
    if installation.get("installedDirectorySetSha256") != sha256_bytes(stable_json(expected_directories).encode("ascii")):
        issues.append("offline_install_report_directory_digest_invalid")
    if installation.get("installedFileCount") != len(installed_files):
        issues.append("offline_install_report_file_count_invalid")
    if installation.get("installedFileSetSha256") != sha256_bytes(stable_json(installed_files).encode("ascii")):
        issues.append("offline_install_report_file_set_digest_invalid")
    if installation.get("everyHashedWheelRecordMatchedInstalledBytes") is not True:
        issues.append("offline_install_report_file_match_invalid")
    if installation.get("directUrlRecordCount") != 0 or installation.get("sourceBuildEvidenceObserved") is not False:
        issues.append("offline_install_report_source_boundary_invalid")
    if report.get("boundaries") != {
        "networkRequestInitiated": False,
        "runtimeImportsExecuted": False,
        "modelArtifactsRead": False,
        "generationAllowed": False,
    }:
        issues.append("offline_install_report_boundaries_invalid")
    if issues:
        raise WheelLockFailure(issues)
    return sha256_bytes(raw), installation


def contains_private_locator(value, key: str = "") -> bool:
    if isinstance(value, dict):
        return any(PRIVATE_KEYS.search(nested_key) or contains_private_locator(nested, nested_key) for nested_key, nested in value.items())
    if isinstance(value, list):
        return any(contains_private_locator(nested, key) for nested in value)
    if isinstance(value, str):
        return value.startswith(("s3://", "gs://")) or "storage.yandexcloud.net" in value
    return False


def validate_lock(lock: dict) -> dict:
    issues: list[str] = []
    exact_keys(lock, {
        "boundaries", "gateEffect", "gateSnapshot", "lockSha256", "normalCi", "openGates",
        "resolution", "resolvedGates", "restrictedStorage", "runtimeContract", "schemaVersion",
        "status", "wheelSet",
    }, "lock", issues)
    if lock.get("schemaVersion") != 1:
        issues.append("schema_version_invalid")
    if lock.get("status") != "production-runtime-wheel-identities-and-offline-resolution-locked-runtime-blocked":
        issues.append("status_invalid")
    if not HEX64.fullmatch(lock.get("lockSha256", "")):
        issues.append("lock_digest_invalid")
    elif lock["lockSha256"] != semantic_digest(lock):
        issues.append("lock_digest_mismatch")
    if contains_private_locator(lock):
        issues.append("private_locator_forbidden")

    contract = lock.get("runtimeContract", {})
    exact_keys(contract, {"artifactRevisionLock", "dinoSourceLock", "target"}, "runtime_contract", issues)
    if contract.get("artifactRevisionLock") != {"path": ARTIFACT_REVISION_PATH, "artifactSha256": ARTIFACT_REVISION_SHA256}:
        issues.append("artifact_revision_contract_invalid")
    if contract.get("dinoSourceLock") != {
        "path": DINO_SOURCE_PATH,
        "lockSha256": DINO_SOURCE_SHA256,
        "runtimeSelectionSha256": DINO_RUNTIME_SELECTION_SHA256,
    }:
        issues.append("dino_source_contract_invalid")
    if contract.get("target") != {
        "implementation": "cpython",
        "pythonVersion": "3.12.11",
        "pythonTag": "cp312",
        "abi": "cp312-or-abi3",
        "platform": "linux-x86_64-manylinux_2_28",
        "cudaRuntime": "11.8",
    }:
        issues.append("runtime_target_invalid")

    wheel_set = lock.get("wheelSet", {})
    exact_keys(wheel_set, {"count", "directRequirements", "representation", "totalByteLength", "wheelInventorySha256", "wheels"}, "wheel_set", issues)
    wheels = wheel_set.get("wheels", [])
    if wheel_set.get("representation") != "complete-direct-and-transitive-binary-wheel-set":
        issues.append("wheel_representation_invalid")
    if wheel_set.get("directRequirements") != DIRECT_REQUIREMENTS:
        issues.append("direct_requirements_invalid")
    if not isinstance(wheels, list) or not wheels or len(wheels) > MAX_WHEELS:
        issues.append("wheel_records_invalid")
        wheels = []
    filenames = []
    distributions = []
    for wheel in wheels:
        exact_keys(wheel, {
            "byteLength", "distribution", "filename", "metadataSha256", "requiresDist", "requiresPython",
            "sha256", "tags", "version", "wheelMetadataSha256",
        }, "wheel", issues)
        filenames.append(wheel.get("filename"))
        distributions.append(wheel.get("distribution"))
        if not safe_filename(wheel.get("filename", "")) or not wheel.get("filename", "").endswith(".whl"):
            issues.append("wheel_filename_invalid")
        if not isinstance(wheel.get("byteLength"), int) or wheel.get("byteLength", -1) < 1:
            issues.append("wheel_size_invalid")
        for field in ("sha256", "metadataSha256", "wheelMetadataSha256"):
            if not HEX64.fullmatch(wheel.get(field, "")):
                issues.append(f"wheel_{field}_invalid")
        if wheel.get("distribution") != normalized_distribution(wheel.get("distribution", "")):
            issues.append("wheel_distribution_not_normalized")
        if not isinstance(wheel.get("requiresDist"), list) or wheel["requiresDist"] != sorted(set(wheel["requiresDist"])):
            issues.append("wheel_requires_dist_invalid")
        if not isinstance(wheel.get("tags"), list) or not wheel["tags"] or wheel["tags"] != sorted(set(wheel["tags"])):
            issues.append("wheel_tags_invalid")
    if filenames != sorted(filenames) or len(filenames) != len(set(filenames)):
        issues.append("wheel_filenames_not_unique_sorted")
    if len(distributions) != len(set(distributions)):
        issues.append("wheel_distributions_not_unique")
    if wheel_set.get("count") != len(wheels):
        issues.append("wheel_count_mismatch")
    if wheel_set.get("totalByteLength") != sum(wheel.get("byteLength", 0) for wheel in wheels):
        issues.append("wheel_total_size_mismatch")
    if wheel_set.get("wheelInventorySha256") != inventory_digest(wheels):
        issues.append("wheel_inventory_digest_mismatch")
    issues.extend(dependency_issues(wheels))

    resolution = lock.get("resolution", {})
    exact_keys(resolution, {
        "conflictCount", "imageDigest", "missingDependencyCount",
        "offlineInstallAttestor", "offlineInstallReportSha256", "offlineNoIndexInstallOperatorAttested",
        "offlineWheelhouseResolutionReportVerified",
        "installedDirectoryCount", "installedDirectorySetSha256", "installedDistributionCount",
        "installedDistributionInventorySha256", "installedFileCount", "installedFileSetSha256",
        "checkedWheelRecordCount", "pipVersion", "resolver", "resolverReportSha256", "sdistsAllowed",
        "sourceBuildsAllowed", "unsupportedWheelCount",
    }, "resolution", issues)
    if resolution.get("resolver") != "pip" or resolution.get("pipVersion") != "25.0.1":
        issues.append("resolver_identity_invalid")
    if resolution.get("imageDigest") != RESOLVER_IMAGE_DIGEST:
        issues.append("resolver_image_invalid")
    if (
        resolution.get("offlineNoIndexInstallOperatorAttested") is not True
        or resolution.get("offlineWheelhouseResolutionReportVerified") is not True
    ):
        issues.append("resolution_evidence_invalid")
    if resolution.get("sourceBuildsAllowed") is not False or resolution.get("sdistsAllowed") is not False:
        issues.append("binary_only_boundary_invalid")
    if any(resolution.get(field) != 0 for field in ("missingDependencyCount", "conflictCount", "unsupportedWheelCount")):
        issues.append("resolution_failure_count_nonzero")
    if not HEX64.fullmatch(resolution.get("resolverReportSha256", "")):
        issues.append("resolver_report_digest_invalid")
    if resolution.get("offlineInstallAttestor") != {
        "path": "scripts/attest-offline-wheel-install.py",
        "sourceSha256": sha256_file(INSTALL_ATTESTOR_PATH)[1],
    }:
        issues.append("offline_install_attestor_binding_invalid")
    for field in ("offlineInstallReportSha256", "installedDirectorySetSha256", "installedDistributionInventorySha256", "installedFileSetSha256"):
        if not HEX64.fullmatch(resolution.get(field, "")):
            issues.append(f"resolution_{field}_invalid")
    if resolution.get("installedDistributionCount") != len(wheels):
        issues.append("installed_distribution_count_invalid")
    if not isinstance(resolution.get("installedFileCount"), int) or resolution.get("installedFileCount") < len(wheels):
        issues.append("installed_file_count_invalid")
    if not isinstance(resolution.get("installedDirectoryCount"), int) or resolution.get("installedDirectoryCount") < 1:
        issues.append("installed_directory_count_invalid")
    if not isinstance(resolution.get("checkedWheelRecordCount"), int) or resolution.get("checkedWheelRecordCount") < len(wheels):
        issues.append("checked_wheel_record_count_invalid")

    storage = lock.get("restrictedStorage", {})
    exact_keys(storage, {"evidenceScope", "fullReadbackVerified", "operatorRecord", "retainedAtVerification"}, "restricted_storage", issues)
    exact_keys(storage.get("operatorRecord", {}), {"rawRecordSha256", "schemaVersion", "visibility"}, "operator_record", issues)
    if storage.get("evidenceScope") != "operator-attested-point-in-time" or storage.get("retainedAtVerification") is not True or storage.get("fullReadbackVerified") is not True:
        issues.append("restricted_storage_evidence_invalid")
    if storage.get("operatorRecord", {}).get("schemaVersion") != 3 or storage.get("operatorRecord", {}).get("visibility") != "restricted-evidence-retention":
        issues.append("operator_record_identity_invalid")
    if not HEX64.fullmatch(storage.get("operatorRecord", {}).get("rawRecordSha256", "")):
        issues.append("operator_record_digest_invalid")

    normal_ci = lock.get("normalCi", {})
    if normal_ci != {
        "scope": "canonical-public-lock-only/no-wheel-or-restricted-record-access",
        "wheelAccessAllowed": False,
        "restrictedRecordAccessAllowed": False,
        "networkRequestInitiatedByVerifier": False,
        "wheelVerificationCoverage": "synthetic-fixtures-only",
    }:
        issues.append("normal_ci_boundary_invalid")
    boundaries = lock.get("boundaries", {})
    exact_keys(boundaries, {
        "finalProductionOciLocked", "generationAllowed", "gpuExecuted", "offlineInstallationOperatorAttested",
        "modelArtifactsRead", "modelInputUsed", "patchedPytorchQualified", "rightsApproved",
        "runtimeImportsExecuted", "sourceBuildExecuted",
    }, "boundaries", issues)
    if boundaries.get("offlineInstallationOperatorAttested") is not True:
        issues.append("offline_install_claim_missing")
    for field in set(boundaries) - {"offlineInstallationOperatorAttested"}:
        if boundaries.get(field) is not False:
            issues.append(f"boundary_must_be_false:{field}")
    if lock.get("gateSnapshot") != "historical-at-dependency-wheel-lock":
        issues.append("gate_snapshot_invalid")
    if lock.get("resolvedGates") != CURRENT_RESOLVED_GATES or lock.get("openGates") != CURRENT_OPEN_GATES:
        issues.append("gate_snapshot_sets_invalid")
    if lock.get("gateEffect") != {
        "directlyResolvedGates": ["dependencyWheelHashLock"],
        "doesNotResolveCompositeGates": True,
        "doesNotResolveOtherGates": True,
    }:
        issues.append("gate_effect_invalid")
    if issues:
        raise WheelLockFailure(issues)
    return lock


def verify_wheelhouse(
    lock: dict,
    wheelhouse: Path,
    resolver_report: Path | None = None,
    offline_install_report: Path | None = None,
) -> dict:
    wheels = inspect_wheelhouse(wheelhouse)
    if wheels != lock["wheelSet"]["wheels"]:
        raise WheelLockFailure(["wheelhouse_inventory_mismatch"])
    if resolver_report is not None:
        report_digest = validate_resolver_report(resolver_report, wheels)
        if report_digest != lock["resolution"]["resolverReportSha256"]:
            raise WheelLockFailure(["resolver_report_digest_mismatch"])
    if offline_install_report is not None:
        report_digest, installation = validate_offline_install_report(
            offline_install_report,
            wheels,
            lock["wheelSet"]["wheelInventorySha256"],
            wheelhouse,
        )
        if report_digest != lock["resolution"]["offlineInstallReportSha256"]:
            raise WheelLockFailure(["offline_install_report_digest_mismatch"])
        if installation["installedFileSetSha256"] != lock["resolution"]["installedFileSetSha256"]:
            raise WheelLockFailure(["offline_install_file_set_digest_mismatch"])
        if installation["installedDirectoryCount"] != lock["resolution"]["installedDirectoryCount"] or installation["installedDirectorySetSha256"] != lock["resolution"]["installedDirectorySetSha256"]:
            raise WheelLockFailure(["offline_install_directory_set_mismatch"])
    return {
        "schemaVersion": 1,
        "status": "production-runtime-wheel-identities-verified",
        "wheelCount": len(wheels),
        "totalByteLength": sum(wheel["byteLength"] for wheel in wheels),
        "wheelInventorySha256": inventory_digest(wheels),
        "wheelBytesRead": True,
        "networkRequestInitiated": False,
        "generationAllowed": False,
    }


def build_lock(
    wheelhouse: Path,
    resolver_report: Path,
    offline_install_report: Path,
    operator_record_sha256: str,
) -> dict:
    if not HEX64.fullmatch(operator_record_sha256):
        raise WheelLockFailure(["operator_record_digest_invalid"])
    wheels = inspect_wheelhouse(wheelhouse)
    resolver_report_sha256 = validate_resolver_report(resolver_report, wheels)
    wheel_inventory_sha256 = inventory_digest(wheels)
    offline_install_report_sha256, installation = validate_offline_install_report(
        offline_install_report,
        wheels,
        wheel_inventory_sha256,
        wheelhouse,
    )
    lock = {
        "schemaVersion": 1,
        "lockSha256": "",
        "status": "production-runtime-wheel-identities-and-offline-resolution-locked-runtime-blocked",
        "runtimeContract": {
            "artifactRevisionLock": {"path": ARTIFACT_REVISION_PATH, "artifactSha256": ARTIFACT_REVISION_SHA256},
            "dinoSourceLock": {
                "path": DINO_SOURCE_PATH,
                "lockSha256": DINO_SOURCE_SHA256,
                "runtimeSelectionSha256": DINO_RUNTIME_SELECTION_SHA256,
            },
            "target": {
                "implementation": "cpython",
                "pythonVersion": "3.12.11",
                "pythonTag": "cp312",
                "abi": "cp312-or-abi3",
                "platform": "linux-x86_64-manylinux_2_28",
                "cudaRuntime": "11.8",
            },
        },
        "wheelSet": {
            "representation": "complete-direct-and-transitive-binary-wheel-set",
            "directRequirements": DIRECT_REQUIREMENTS,
            "count": len(wheels),
            "totalByteLength": sum(wheel["byteLength"] for wheel in wheels),
            "wheelInventorySha256": wheel_inventory_sha256,
            "wheels": wheels,
        },
        "resolution": {
            "resolver": "pip",
            "pipVersion": "25.0.1",
            "imageDigest": RESOLVER_IMAGE_DIGEST,
            "offlineNoIndexInstallOperatorAttested": True,
            "offlineWheelhouseResolutionReportVerified": True,
            "sourceBuildsAllowed": False,
            "sdistsAllowed": False,
            "missingDependencyCount": 0,
            "conflictCount": 0,
            "unsupportedWheelCount": 0,
            "resolverReportSha256": resolver_report_sha256,
            "offlineInstallAttestor": {
                "path": "scripts/attest-offline-wheel-install.py",
                "sourceSha256": sha256_file(INSTALL_ATTESTOR_PATH)[1],
            },
            "offlineInstallReportSha256": offline_install_report_sha256,
            "installedDistributionCount": installation["distributionCount"],
            "installedDistributionInventorySha256": installation["distributionInventorySha256"],
            "installedDirectoryCount": installation["installedDirectoryCount"],
            "installedDirectorySetSha256": installation["installedDirectorySetSha256"],
            "installedFileCount": installation["installedFileCount"],
            "checkedWheelRecordCount": installation["checkedWheelRecordCount"],
            "installedFileSetSha256": installation["installedFileSetSha256"],
        },
        "restrictedStorage": {
            "evidenceScope": "operator-attested-point-in-time",
            "retainedAtVerification": True,
            "fullReadbackVerified": True,
            "operatorRecord": {
                "schemaVersion": 3,
                "visibility": "restricted-evidence-retention",
                "rawRecordSha256": operator_record_sha256,
            },
        },
        "normalCi": {
            "scope": "canonical-public-lock-only/no-wheel-or-restricted-record-access",
            "wheelAccessAllowed": False,
            "restrictedRecordAccessAllowed": False,
            "networkRequestInitiatedByVerifier": False,
            "wheelVerificationCoverage": "synthetic-fixtures-only",
        },
        "boundaries": {
            "offlineInstallationOperatorAttested": True,
            "sourceBuildExecuted": False,
            "runtimeImportsExecuted": False,
            "patchedPytorchQualified": False,
            "modelArtifactsRead": False,
            "modelInputUsed": False,
            "gpuExecuted": False,
            "finalProductionOciLocked": False,
            "rightsApproved": False,
            "generationAllowed": False,
        },
        "gateSnapshot": "historical-at-dependency-wheel-lock",
        "resolvedGates": CURRENT_RESOLVED_GATES,
        "openGates": CURRENT_OPEN_GATES,
        "gateEffect": {
            "directlyResolvedGates": ["dependencyWheelHashLock"],
            "doesNotResolveCompositeGates": True,
            "doesNotResolveOtherGates": True,
        },
    }
    lock["lockSha256"] = semantic_digest(lock)
    validate_lock(lock)
    return lock


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--lock", type=Path, default=DEFAULT_LOCK)
    parser.add_argument("--lock-only", action="store_true")
    parser.add_argument("--wheelhouse", type=Path)
    parser.add_argument("--resolver-report", type=Path)
    parser.add_argument("--offline-install-report", type=Path)
    parser.add_argument("--build", action="store_true")
    parser.add_argument("--output", type=Path)
    parser.add_argument("--operator-record-sha256")
    args = parser.parse_args()

    if args.build:
        if not args.wheelhouse or not args.resolver_report or not args.offline_install_report or not args.output or not args.operator_record_sha256:
            parser.error("--build requires --wheelhouse, --resolver-report, --offline-install-report, --output, and --operator-record-sha256")
        lock = build_lock(
            args.wheelhouse.resolve(),
            args.resolver_report.resolve(),
            args.offline_install_report.resolve(),
            args.operator_record_sha256,
        )
        args.output.write_bytes(pretty_json(lock))
        sys.stdout.write(stable_json({
            "status": "runtime-wheel-lock-built",
            "lockSha256": lock["lockSha256"],
            "wheelCount": lock["wheelSet"]["count"],
            "totalByteLength": lock["wheelSet"]["totalByteLength"],
            "wheelInventorySha256": lock["wheelSet"]["wheelInventorySha256"],
        }) + "\n")
        return

    lock, _ = load_json(args.lock.resolve(), canonical=True)
    validate_lock(lock)
    result = {
        "schemaVersion": 1,
        "status": "canonical-public-runtime-wheel-lock-verified",
        "lockSha256": lock["lockSha256"],
        "wheelCount": lock["wheelSet"]["count"],
        "wheelInventorySha256": lock["wheelSet"]["wheelInventorySha256"],
        "wheelBytesRead": False,
        "networkRequestInitiated": False,
        "generationAllowed": False,
    }
    if args.wheelhouse:
        result.update(verify_wheelhouse(
            lock,
            args.wheelhouse.resolve(),
            args.resolver_report.resolve() if args.resolver_report else None,
            args.offline_install_report.resolve() if args.offline_install_report else None,
        ))
    elif not args.lock_only:
        parser.error("use --lock-only or provide --wheelhouse")
    sys.stdout.write(stable_json(result) + "\n")


if __name__ == "__main__":
    try:
        main()
    except WheelLockFailure as error:
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(1) from None
