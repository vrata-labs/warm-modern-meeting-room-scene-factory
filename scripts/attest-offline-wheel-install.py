#!/usr/bin/env python3
"""Attest that an isolated runtime site was installed from the exact wheel lock."""

from __future__ import annotations

import argparse
import base64
import configparser
import csv
import hashlib
import io
import json
import re
import stat
import sys
import zipfile
from importlib.metadata import distributions
from pathlib import Path, PurePosixPath


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
    return hashlib.sha256(raw).hexdigest()


def reject_duplicate_keys(pairs):
    value = {}
    for key, nested in pairs:
        if key in value:
            raise RuntimeError(f"duplicate_json_key:{key}")
        value[key] = nested
    return value


def normalized_distribution(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def safe_record_path(value: str) -> bool:
    path = PurePosixPath(value)
    return bool(value) and not path.is_absolute() and ".." not in path.parts and "\\" not in value and "\0" not in value


def installed_path(runtime_site: Path, record_path: str) -> Path:
    parts = PurePosixPath(record_path).parts
    data_index = 0 if parts and parts[0].endswith(".data") else None
    if data_index is None:
        relative = parts
    else:
        scheme = parts[data_index + 1]
        suffix = parts[data_index + 2 :]
        if scheme in {"purelib", "platlib"}:
            relative = suffix
        elif scheme == "scripts":
            relative = ("bin", *suffix)
        elif scheme in {"data", "headers"}:
            relative = suffix
        else:
            raise RuntimeError(f"unsupported_wheel_data_scheme:{scheme}")
    return runtime_site.joinpath(*relative)


def direct_distribution(requirement: str) -> str:
    return normalized_distribution(re.split(r"[<>=!~\[\s]", requirement, maxsplit=1)[0])


def expected_digest(encoded: str) -> str:
    algorithm, separator, value = encoded.partition("=")
    if separator != "=" or algorithm != "sha256":
        raise RuntimeError("wheel_record_hash_algorithm_invalid")
    padding = "=" * ((4 - len(value) % 4) % 4)
    return base64.urlsafe_b64decode(value + padding).hex()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--runtime-site", type=Path, required=True)
    parser.add_argument("--wheelhouse", type=Path, required=True)
    parser.add_argument("--wheel-lock", type=Path, required=True)
    args = parser.parse_args()
    if not sys.flags.isolated or not sys.flags.no_site:
        raise RuntimeError("python_must_run_with_isolated_and_no_site_flags")
    for root, label in ((args.runtime_site, "runtime_site"), (args.wheelhouse, "wheelhouse")):
        metadata = root.lstat()
        if not stat.S_ISDIR(metadata.st_mode) or root.is_symlink():
            raise RuntimeError(f"unsafe_{label}")
    runtime_site = args.runtime_site.resolve()
    wheelhouse = args.wheelhouse.resolve()
    lock = json.loads(
        args.wheel_lock.resolve().read_text(encoding="utf-8"),
        object_pairs_hook=reject_duplicate_keys,
    )
    wheels = lock["wheelSet"]["wheels"]
    direct_distributions = {direct_distribution(value) for value in lock["wheelSet"]["directRequirements"]}
    expected_filenames = [record["filename"] for record in wheels]
    actual_filenames = sorted(path.name for path in wheelhouse.iterdir())
    if actual_filenames != expected_filenames:
        raise RuntimeError("wheelhouse_file_set_mismatch")

    installed_files = {}
    generated_files = {}
    checked_record_count = 0
    for wheel in wheels:
        wheel_path = wheelhouse / wheel["filename"]
        size, digest = sha256_file(wheel_path)
        if size != wheel["byteLength"] or digest != wheel["sha256"]:
            raise RuntimeError(f"wheel_identity_mismatch:{wheel['filename']}")
        with zipfile.ZipFile(wheel_path) as archive:
            record_names = [
                name for name in archive.namelist()
                if name.endswith(".dist-info/RECORD") and name.count("/") == 1
            ]
            if len(record_names) != 1:
                raise RuntimeError(f"wheel_record_layout_invalid:{wheel['filename']}")
            record_info = archive.getinfo(record_names[0])
            if record_info.file_size > 8 * 1024 * 1024:
                raise RuntimeError(f"wheel_record_too_large:{wheel['filename']}")
            rows = list(csv.reader(io.TextIOWrapper(archive.open(record_info), encoding="utf-8", newline="")))
            if len(rows) > 100000:
                raise RuntimeError(f"wheel_record_too_many_rows:{wheel['filename']}")
            entry_point_names = [
                name for name in archive.namelist()
                if name.endswith(".dist-info/entry_points.txt") and name.count("/") == 1
            ]
            generated_scripts = []
            if entry_point_names:
                if len(entry_point_names) != 1 or archive.getinfo(entry_point_names[0]).file_size > 1024 * 1024:
                    raise RuntimeError(f"wheel_entry_points_invalid:{wheel['filename']}")
                entry_points = configparser.ConfigParser(interpolation=None, strict=True)
                entry_points.optionxform = str
                entry_points.read_string(archive.read(entry_point_names[0]).decode("utf-8"))
                for section in ("console_scripts", "gui_scripts"):
                    if entry_points.has_section(section):
                        for name in entry_points[section]:
                            if not name or name != Path(name).name or not name.isascii():
                                raise RuntimeError(f"wheel_entry_point_name_invalid:{wheel['filename']}")
                            generated_scripts.append(f"bin/{name}")
        dist_info = record_names[0].rsplit("/", 1)[0]
        generated_files[f"{dist_info}/RECORD"] = "record"
        generated_files[f"{dist_info}/INSTALLER"] = "installer"
        if wheel["distribution"] in direct_distributions:
            generated_files[f"{dist_info}/REQUESTED"] = "requested"
        for relative in generated_scripts:
            generated_files[relative] = "entry-point"
        for row in rows:
            if len(row) != 3 or not safe_record_path(row[0]):
                raise RuntimeError(f"wheel_record_invalid:{wheel['filename']}")
            if not row[1]:
                if not row[0].endswith(".dist-info/RECORD"):
                    raise RuntimeError(f"wheel_record_hash_missing:{wheel['filename']}")
                continue
            target = installed_path(runtime_site, row[0])
            try:
                relative_target = target.resolve().relative_to(runtime_site).as_posix()
            except ValueError as error:
                raise RuntimeError(f"installed_file_outside_runtime_site:{row[0]}") from error
            installed_size, installed_sha256 = sha256_file(target)
            if installed_sha256 != expected_digest(row[1]):
                raise RuntimeError(f"installed_file_hash_mismatch:{row[0]}")
            if row[2] and installed_size != int(row[2]):
                raise RuntimeError(f"installed_file_size_mismatch:{row[0]}")
            previous = installed_files.get(relative_target)
            if previous is not None and previous != installed_sha256:
                raise RuntimeError(f"installed_file_collision:{relative_target}")
            installed_files[relative_target] = installed_sha256
            checked_record_count += 1

    actual_files = {}
    actual_directories = []
    for path in runtime_site.rglob("*"):
        if path.is_symlink():
            raise RuntimeError(f"runtime_site_symlink_forbidden:{path.relative_to(runtime_site).as_posix()}")
        if path.is_file():
            relative = path.relative_to(runtime_site).as_posix()
            actual_files[relative] = sha256_file(path)[1]
        elif path.is_dir():
            actual_directories.append(path.relative_to(runtime_site).as_posix())
        else:
            raise RuntimeError(f"runtime_site_special_file_forbidden:{path.relative_to(runtime_site).as_posix()}")
    expected_paths = set(installed_files) | set(generated_files)
    if set(actual_files) != expected_paths:
        missing = sorted(expected_paths - set(actual_files))
        extra = sorted(set(actual_files) - expected_paths)
        raise RuntimeError(
            "runtime_site_file_set_mismatch:missing=" + "|".join(missing) + ":extra=" + "|".join(extra)
        )
    expected_directories = sorted({
        PurePosixPath(relative).parents[index].as_posix()
        for relative in expected_paths
        for index in range(len(PurePosixPath(relative).parents) - 1)
    })
    actual_directories.sort()
    if actual_directories != expected_directories:
        raise RuntimeError("runtime_site_directory_set_mismatch")
    for relative, kind in generated_files.items():
        raw = (runtime_site / relative).read_bytes()
        if kind == "installer" and raw != b"pip\n":
            raise RuntimeError(f"pip_installer_marker_invalid:{relative}")
        if kind == "requested" and raw != b"":
            raise RuntimeError(f"pip_requested_marker_invalid:{relative}")

    installed = sorted(
        (
            {
                "name": distribution.metadata["Name"],
                "normalizedName": normalized_distribution(distribution.metadata["Name"]),
                "version": distribution.version,
            }
            for distribution in distributions(path=[str(runtime_site)])
        ),
        key=lambda record: record["normalizedName"],
    )
    expected_distributions = sorted(
        ({"normalizedName": wheel["distribution"], "version": wheel["version"]} for wheel in wheels),
        key=lambda record: record["normalizedName"],
    )
    observed_distributions = [
        {"normalizedName": record["normalizedName"], "version": record["version"]}
        for record in installed
    ]
    if observed_distributions != expected_distributions:
        raise RuntimeError("installed_distribution_set_mismatch")
    direct_url_records = list(runtime_site.glob("*.dist-info/direct_url.json"))
    if direct_url_records:
        raise RuntimeError("direct_url_install_forbidden")

    installed_file_records = [
        {
            "path": path,
            "sha256": actual_files[path],
            "role": "wheel-record" if path in installed_files else f"pip-generated-{generated_files[path]}",
        }
        for path in sorted(actual_files)
    ]
    report = {
        "schemaVersion": 1,
        "status": "offline-wheel-install-attestation-pass",
        "python": {
            "implementation": sys.implementation.name,
            "majorMinor": ".".join(map(str, sys.version_info[:2])),
            "isolated": bool(sys.flags.isolated),
            "siteInitializationDisabled": bool(sys.flags.no_site),
        },
        "wheelhouse": {
            "wheelCount": len(wheels),
            "totalByteLength": sum(wheel["byteLength"] for wheel in wheels),
            "wheelInventorySha256": lock["wheelSet"]["wheelInventorySha256"],
            "everyWheelIdentityVerified": True,
            "sdistsPresent": False,
        },
        "installation": {
            "distributionCount": len(installed),
            "distributionInventorySha256": stable_digest(installed),
            "distributions": installed,
            "checkedWheelRecordCount": checked_record_count,
            "installedFileCount": len(installed_file_records),
            "installedFileSetSha256": stable_digest(installed_file_records),
            "installedFiles": installed_file_records,
            "installedDirectoryCount": len(actual_directories),
            "installedDirectorySetSha256": stable_digest(actual_directories),
            "installedDirectories": actual_directories,
            "everyHashedWheelRecordMatchedInstalledBytes": True,
            "directUrlRecordCount": 0,
            "sourceBuildEvidenceObserved": False,
        },
        "boundaries": {
            "networkRequestInitiated": False,
            "runtimeImportsExecuted": False,
            "modelArtifactsRead": False,
            "generationAllowed": False,
        },
    }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
