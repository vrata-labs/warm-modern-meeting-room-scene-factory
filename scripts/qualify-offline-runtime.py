#!/usr/bin/env python3
"""Qualify locked WMMR imports and strict state loads without inference."""

from __future__ import annotations

import argparse
import gc
import hashlib
import importlib
import importlib.metadata
import json
import os
import re
import resource
import stat
import sys
import traceback
from pathlib import Path


PROHIBITED_MODULE_PREFIXES = (
    "diffoctreerast",
    "diff_gaussian_rasterization",
    "nvdiffrast",
    "open3d",
    "plyfile",
    "rembg",
    "torchsparse",
    "trellis.renderers",
    "trellis.representations.gaussian",
    "trellis.representations.radiance_field",
    "trellis.utils.postprocessing_utils",
    "trellis.utils.render_utils",
    "vox2seq",
)
BLOCKED_AUDIT_EVENTS = (
    "os.exec",
    "os.fork",
    "os.forkpty",
    "os.posix_spawn",
    "os.spawn",
    "os.system",
    "socket.__new__",
    "socket.bind",
    "socket.connect",
    "socket.getaddrinfo",
    "subprocess.Popen",
)
PROCESS_AUDIT_EVENTS = ("os.exec", "os.fork", "os.forkpty", "os.posix_spawn", "os.spawn", "os.system", "subprocess.Popen")
SOCKET_AUDIT_EVENTS = ("socket.__new__", "socket.bind", "socket.connect", "socket.getaddrinfo")


def sha256_bytes(value: bytes) -> str:
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
    return sha256_bytes(raw)


def reject_duplicate_keys(pairs):
    value = {}
    for key, nested in pairs:
        if key in value:
            raise RuntimeError(f"duplicate_json_key:{key}")
        value[key] = nested
    return value


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)


def normalized_distribution(value: str) -> str:
    return re.sub(r"[-_.]+", "-", value).lower()


def verify_file(path: Path, expected_size: int, expected_sha256: str) -> None:
    size, digest = sha256_file(path)
    if size != expected_size or digest != expected_sha256:
        raise RuntimeError(f"file_identity_mismatch:{path.name}")


def verify_sources(repository: Path, dino_root: Path) -> dict:
    base = load_json(repository / "experiment/warm-modern-meeting-room/artifact-lock.json")
    revision = load_json(repository / "experiment/warm-modern-meeting-room/artifact-revision-lock.json")
    trellis_root = repository / revision["artifact"]["path"]
    records = {record["path"]: dict(record) for record in base["artifact"]["files"]}
    for replacement in revision["replacements"]:
        records[replacement["path"]].update(size=replacement["size"], sha256=replacement["sha256"])
    actual_paths = sorted(
        path.relative_to(trellis_root).as_posix()
        for path in trellis_root.rglob("*")
        if path.is_file()
    )
    if actual_paths != sorted(records):
        raise RuntimeError("trellis_source_file_set_mismatch")
    if any(path.is_symlink() for path in trellis_root.rglob("*")):
        raise RuntimeError("trellis_source_symlink_forbidden")
    for relative, record in records.items():
        verify_file(trellis_root / relative, record["size"], record["sha256"])

    dino_lock = load_json(repository / "experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json")
    dino_records = dino_lock["runtimeSourceClosure"]["files"]
    actual_dino_paths = sorted(
        path.relative_to(dino_root).as_posix()
        for path in dino_root.rglob("*")
        if path.is_file()
    )
    expected_dino_paths = sorted(record["path"] for record in dino_records)
    if actual_dino_paths != expected_dino_paths:
        raise RuntimeError("dino_source_file_set_mismatch")
    if any(path.is_symlink() for path in dino_root.rglob("*")):
        raise RuntimeError("dino_source_symlink_forbidden")
    for record in dino_records:
        verify_file(
            dino_root / record["path"],
            record["gitBlob"]["size"],
            record["gitBlob"]["sha256"],
        )
    return {
        "trellisRoot": trellis_root,
        "trellisFileCount": len(records),
        "trellisTreeSha256": revision["artifact"]["treeSha256"],
        "dinoFileCount": len(dino_records),
        "dinoSelectionSha256": dino_lock["runtimeSourceClosure"]["selectionSha256"],
        "dinoConstructor": dino_lock["offlineConstructor"],
        "trellisRecords": records,
        "dinoRecords": {record["path"]: record for record in dino_records},
    }


def verify_models(repository: Path, model_root: Path) -> dict:
    model_lock = load_json(repository / "experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json")
    selected_metadata = [
        record for record in model_lock["inventory"]["files"]
        if record["disposition"] == "selected" and record["role"] in {"model-config", "pipeline-manifest"}
    ]
    for record in selected_metadata:
        verify_file(model_root / record["path"], record["gitBlob"]["size"], record["gitBlob"]["sha256"])
    payload_lock = load_json(repository / "experiment/warm-modern-meeting-room/trellis-payload-bytes-lock.json")
    payloads = payload_lock["payloadSet"]["payloads"]
    for payload in payloads:
        verify_file(model_root / payload["path"], payload["byteLength"], payload["observedSha256"])
    dino_lock = load_json(repository / "experiment/warm-modern-meeting-room/dino-derived-runtime-artifact-lock.json")
    dino_path = model_root / "dinov2_vitl14_reg4_pretrain.safetensors"
    verify_file(dino_path, dino_lock["artifact"]["byteLength"], dino_lock["artifact"]["sha256"])
    return {
        "trellisModelLock": model_lock,
        "trellisPayloads": payloads,
        "dinoLock": dino_lock,
        "dinoPath": dino_path,
        "selectedMetadataCount": len(selected_metadata),
    }


def module_plan(root: Path, package: str) -> list[dict]:
    records = []
    package_root = root / package
    for path in package_root.rglob("*.py"):
        relative = path.relative_to(root).with_suffix("")
        parts = list(relative.parts)
        if parts[-1] == "__init__":
            parts.pop()
        records.append({"module": ".".join(parts), "path": path.relative_to(root).as_posix()})
    unique = {record["module"]: record for record in records}
    return sorted(unique.values(), key=lambda record: (record["module"].count("."), record["module"]))


def verify_module_origins(plans: list[tuple[Path, list[dict]]]) -> list[dict]:
    expected = {
        record["module"]: (root, record["path"])
        for root, records in plans
        for record in records
    }
    loaded_source_modules = sorted(
        name for name in sys.modules
        if name == "trellis" or name.startswith("trellis.") or name == "dinov2" or name.startswith("dinov2.")
    )
    missing = sorted(set(expected) - set(loaded_source_modules))
    unexpected = sorted(set(loaded_source_modules) - set(expected))
    if missing:
        raise RuntimeError(
            "source_module_set_mismatch:missing=" + "|".join(missing) + ":unexpected=" + "|".join(unexpected)
        )
    origins = []
    for name in sorted(expected):
        module = sys.modules[name]
        origin = getattr(module, "__file__", None)
        if not origin:
            raise RuntimeError(f"source_module_origin_missing:{name}")
        root, relative = expected[name]
        actual = Path(origin).resolve()
        expected_path = (root / relative).resolve()
        if actual != expected_path:
            raise RuntimeError(f"source_module_origin_mismatch:{name}")
        origins.append({"kind": "file", "module": name, "path": relative, "sha256": sha256_file(actual)[1]})
    roots_by_package = {records[0]["module"].split(".", 1)[0]: root for root, records in plans if records}
    for name in unexpected:
        module = sys.modules[name]
        namespace_paths = list(getattr(module, "__path__", []))
        root = roots_by_package.get(name.split(".", 1)[0])
        if getattr(module, "__file__", None) is not None or root is None or len(namespace_paths) != 1:
            raise RuntimeError(f"unexpected_source_module_origin:{name}")
        actual = Path(namespace_paths[0]).resolve()
        try:
            relative = actual.relative_to(root).as_posix()
        except ValueError as error:
            raise RuntimeError(f"namespace_module_origin_mismatch:{name}") from error
        if not actual.is_dir() or actual.is_symlink():
            raise RuntimeError(f"namespace_module_origin_unsafe:{name}")
        origins.append({"kind": "namespace", "module": name, "path": relative})
    origins.sort(key=lambda record: record["module"])
    return origins


def installed_distribution_inventory(runtime_site: Path) -> list[dict]:
    return sorted(
        (
            {
                "name": distribution.metadata["Name"],
                "normalizedName": normalized_distribution(distribution.metadata["Name"]),
                "version": distribution.version,
            }
            for distribution in importlib.metadata.distributions(path=[str(runtime_site)])
        ),
        key=lambda record: record["normalizedName"],
    )


def verify_attested_runtime_site(runtime_site: Path, install_report: dict) -> None:
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


def tensor_structure(model) -> dict:
    records = []
    for name, value in sorted(model.state_dict().items()):
        records.append({
            "name": name,
            "dtype": str(value.dtype).removeprefix("torch."),
            "shape": list(value.shape),
            "numel": value.numel(),
        })
    return {
        "tensorCount": len(records),
        "totalElements": sum(record["numel"] for record in records),
        "structureSha256": stable_digest(records),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repository", type=Path, required=True)
    parser.add_argument("--runtime-site", type=Path, required=True)
    parser.add_argument("--dino-source", type=Path, required=True)
    parser.add_argument("--model-root", type=Path, required=True)
    parser.add_argument("--dependency-wheel-lock", type=Path, required=True)
    parser.add_argument("--offline-install-report", type=Path, required=True)
    args = parser.parse_args()

    if not sys.flags.isolated or not sys.flags.no_site:
        raise RuntimeError("python_must_run_with_isolated_and_no_site_flags")
    if not sys.dont_write_bytecode:
        raise RuntimeError("python_bytecode_writes_must_be_disabled")
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
    repository = args.repository.resolve()
    runtime_site = args.runtime_site.resolve()
    dino_root = args.dino_source.resolve()
    model_root = args.model_root.resolve()
    dependency_lock = load_json(args.dependency_wheel_lock.resolve())
    install_report_path = args.offline_install_report.resolve()
    install_report_raw = install_report_path.read_bytes()
    install_report_sha256 = sha256_bytes(install_report_raw)
    expected_install_report_sha256 = dependency_lock["resolution"]["offlineInstallReportSha256"]
    if install_report_sha256 != expected_install_report_sha256:
        raise RuntimeError("offline_install_report_digest_mismatch")
    install_report = json.loads(install_report_raw, object_pairs_hook=reject_duplicate_keys)
    if install_report.get("status") != "offline-wheel-install-attestation-pass":
        raise RuntimeError("offline_install_report_status_invalid")
    verify_attested_runtime_site(runtime_site, install_report)
    source = verify_sources(repository, dino_root)
    models = verify_models(repository, model_root)
    observed_isolation = isolation_observation([
        repository,
        runtime_site,
        dino_root,
        model_root,
        install_report_path,
    ])

    for package in ("trellis", "dinov2"):
        if (runtime_site / package).exists():
            raise RuntimeError(f"runtime_site_source_shadow_forbidden:{package}")
    distribution_inventory = installed_distribution_inventory(runtime_site)
    distribution_inventory_sha256 = stable_digest(distribution_inventory)
    if len(distribution_inventory) != dependency_lock["resolution"]["installedDistributionCount"]:
        raise RuntimeError("installed_distribution_count_mismatch")
    if distribution_inventory_sha256 != dependency_lock["resolution"]["installedDistributionInventorySha256"]:
        raise RuntimeError("installed_distribution_inventory_mismatch")

    sys.path[:] = [str(source["trellisRoot"]), str(dino_root), str(runtime_site), *map(str, inherited_stdlib_paths)]
    audit_counts = {event: 0 for event in BLOCKED_AUDIT_EVENTS}
    audit_origins = {}

    def audit(event, _args):
        if event in audit_counts:
            audit_counts[event] += 1
            audit_origins.setdefault(
                event,
                [
                    f"{frame.filename}:{frame.lineno}:{frame.name}"
                    for frame in traceback.extract_stack(limit=10)[:-1]
                ],
            )
            raise RuntimeError(f"blocked_audit_event:{event}")

    sys.addaudithook(audit)
    os.environ["SPCONV_DISABLE_JIT"] = "1"
    os.environ["CUMM_DISABLE_JIT"] = "1"
    os.environ["CUDA_VISIBLE_DEVICES"] = ""

    import torch
    from safetensors.torch import load_file
    try:
        torch_origin = Path(torch.__file__).resolve().relative_to(runtime_site).as_posix()
    except ValueError as error:
        raise RuntimeError("torch_import_origin_outside_runtime_site") from error
    if torch_origin != "torch/__init__.py":
        raise RuntimeError("torch_import_origin_invalid")

    forward_calls = 0

    def blocked_forward(*_args, **_kwargs):
        nonlocal forward_calls
        forward_calls += 1
        raise RuntimeError("model_forward_forbidden")

    original_cuda_lazy_init = torch.cuda._lazy_init

    def blocked_cuda_init():
        raise RuntimeError("cuda_initialization_forbidden")

    torch.cuda._lazy_init = blocked_cuda_init
    torch_hub_invocation_count = 0

    def blocked_torch_hub(*_args, **_kwargs):
        nonlocal torch_hub_invocation_count
        torch_hub_invocation_count += 1
        raise RuntimeError("torch_hub_forbidden")

    for name in ("load", "load_state_dict_from_url"):
        if hasattr(torch.hub, name):
            setattr(torch.hub, name, blocked_torch_hub)

    trellis_plan = module_plan(source["trellisRoot"], "trellis")
    dino_plan = module_plan(dino_root, "dinov2")
    module_plan_records = [*trellis_plan, *dino_plan]
    module_names = [record["module"] for record in module_plan_records]
    imported = []
    for name in module_names:
        importlib.import_module(name)
        imported.append(name)
    module_origins = verify_module_origins([
        (source["trellisRoot"], trellis_plan),
        (dino_root, dino_plan),
    ])
    prohibited_observed = sorted(
        name for name in sys.modules
        if any(name == prefix or name.startswith(prefix + ".") for prefix in PROHIBITED_MODULE_PREFIXES)
    )
    if prohibited_observed:
        raise RuntimeError("prohibited_runtime_module_observed:" + "|".join(prohibited_observed))

    from dinov2.models.vision_transformer import DinoVisionTransformer, vit_large
    import trellis.models as trellis_models

    guarded_classes = [DinoVisionTransformer, *trellis_models.MODEL_CLASSES.values()]
    original_forwards = {model_class: model_class.forward for model_class in guarded_classes}
    for model_class in guarded_classes:
        model_class.forward = blocked_forward

    dino_constructor = source["dinoConstructor"]
    dino_model = vit_large(**dino_constructor["arguments"])
    dino_state = load_file(str(models["dinoPath"]), device="cpu")
    dino_result = dino_model.load_state_dict(dino_state, strict=True)
    if dino_result.missing_keys or dino_result.unexpected_keys:
        raise RuntimeError("dino_strict_load_incompatible")
    dino_structure = tensor_structure(dino_model)
    del dino_state, dino_model
    gc.collect()

    trellis_results = []
    for model_record in models["trellisModelLock"]["pipeline"]["models"]:
        if model_record["disposition"] != "selected":
            continue
        stem = model_root / model_record["stem"]
        model = trellis_models.from_pretrained(str(stem))
        structure = tensor_structure(model)
        trellis_results.append({
            "key": model_record["key"],
            "className": type(model).__name__,
            "configSha256": sha256_file(stem.with_suffix(".json"))[1],
            "payloadSha256": sha256_file(stem.with_suffix(".safetensors"))[1],
            **structure,
            "strict": True,
            "missingKeyCount": 0,
            "unexpectedKeyCount": 0,
        })
        del model
        gc.collect()

    for model_class, original_forward in original_forwards.items():
        model_class.forward = original_forward
    torch.cuda._lazy_init = original_cuda_lazy_init
    if forward_calls != 0 or torch.cuda.is_initialized():
        raise RuntimeError("runtime_boundary_violated")
    expected_cumm_probe = (
        audit_counts["subprocess.Popen"] == 1
        and any("/cumm/constants.py:48:<module>" in frame for frame in audit_origins.get("subprocess.Popen", []))
    )
    unexpected_audit_counts = {
        event: count
        for event, count in audit_counts.items()
        if count and event != "subprocess.Popen"
    }
    if not expected_cumm_probe or unexpected_audit_counts:
        observed = "|".join(f"{event}={count}" for event, count in audit_counts.items() if count)
        origins = "|".join(
            f"{event}={' > '.join(frames)}" for event, frames in audit_origins.items()
        )
        raise RuntimeError(f"blocked_runtime_side_effect_attempted:{observed}:{origins}")
    successful_process_launch_count = sum(audit_counts[event] for event in PROCESS_AUDIT_EVENTS) - 1
    successful_socket_operation_count = sum(audit_counts[event] for event in SOCKET_AUDIT_EVENTS)
    if successful_process_launch_count != 0 or successful_socket_operation_count != 0:
        raise RuntimeError("runtime_side_effect_count_invalid")
    if torch_hub_invocation_count != 0:
        raise RuntimeError("torch_hub_invocation_observed")

    report = {
        "schemaVersion": 1,
        "status": "offline-import-and-strict-load-qualification-pass",
        "environment": {
            "pythonVersion": ".".join(map(str, sys.version_info[:3])),
            "pythonIsolatedMode": True,
            "siteInitializationDisabled": True,
            "bytecodeWritesDisabled": True,
            "pythonPathEnvironmentPresent": False,
            "torchVersion": torch.__version__,
            "torchRelativeImportOrigin": torch_origin,
            "compiledCudaVersion": torch.version.cuda,
            "cudaInitialized": False,
            "installedDistributionCount": len(distribution_inventory),
            "installedDistributionInventorySha256": distribution_inventory_sha256,
            "offlineInstallReportSha256": install_report_sha256,
            "dependencyWheelLockSha256": dependency_lock["lockSha256"],
            "installedFileCount": install_report["installation"]["installedFileCount"],
            "installedFileSetSha256": install_report["installation"]["installedFileSetSha256"],
            "installedDirectoryCount": install_report["installation"]["installedDirectoryCount"],
            "installedDirectorySetSha256": install_report["installation"]["installedDirectorySetSha256"],
        },
        "isolation": observed_isolation,
        "sources": {
            "trellisFileCount": source["trellisFileCount"],
            "trellisTreeSha256": source["trellisTreeSha256"],
            "dinoFileCount": source["dinoFileCount"],
            "dinoSelectionSha256": source["dinoSelectionSha256"],
            "selectedModelMetadataCount": models["selectedMetadataCount"],
        },
        "imports": {
            "expectedModuleCount": len(module_names),
            "importedModuleCount": len(imported),
            "modulePlanSha256": stable_digest(imported),
            "moduleOriginPlanSha256": stable_digest(module_origins),
            "everySourceModuleOriginVerified": True,
            "prohibitedModulePrefixes": list(PROHIBITED_MODULE_PREFIXES),
            "prohibitedModulesObserved": [],
            "blockedAuditEventCounts": audit_counts,
            "blockedCummNvccProbeAttempts": 1,
            "sideEffectObservationScope": "python-audit-events-plus-container-network-and-seccomp-observation",
            "successfulAuditedProcessLaunchCount": successful_process_launch_count,
            "successfulAuditedSocketOperationCount": successful_socket_operation_count,
            "torchHubInvocationCount": torch_hub_invocation_count,
        },
        "strictLoads": {
            "dino": {
                "callable": dino_constructor["callable"],
                "arguments": dino_constructor["arguments"],
                "artifactSha256": models["dinoLock"]["artifact"]["sha256"],
                **dino_structure,
                "strict": True,
                "missingKeyCount": 0,
                "unexpectedKeyCount": 0,
            },
            "trellis": sorted(trellis_results, key=lambda record: record["key"]),
        },
        "resources": {
            "peakRssKiB": resource.getrusage(resource.RUSAGE_SELF).ru_maxrss,
        },
        "boundaries": {
            "runtimeImportsExecuted": True,
            "strictStateDictLoadExecuted": True,
            "modelForwardCalls": 0,
            "inferenceExecuted": False,
            "modelInputUsed": False,
            "cudaExecuted": False,
            "generationExecuted": False,
            "outputArtifactCreated": False,
            "rightsApproved": False,
            "finalProductionOciLocked": False,
            "generationAllowed": False,
        },
    }
    print(json.dumps(report, ensure_ascii=True, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
