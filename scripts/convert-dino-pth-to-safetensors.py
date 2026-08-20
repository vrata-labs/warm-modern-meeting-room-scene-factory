#!/usr/bin/env python3
"""Convert one locked DINO state dict to deterministic safetensors evidence."""

from __future__ import annotations

import argparse
import fcntl
import hashlib
import json
import os
import platform
import stat
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, BinaryIO

import safetensors
import torch
from safetensors.torch import save_file


STATUS = "dino-pth-converted-to-safetensors-with-exact-tensor-equivalence"
IDENTITY_CANONICALIZATION = (
    "SHA-256 of stable JSON for tensors sorted by ASCII name with fields "
    "name,dtype,shape,elementCount,byteLength,dataSha256"
)
LAYOUT_CANONICALIZATION = (
    "SHA-256 of stable JSON for tensors sorted by ASCII name with identity fields "
    "plus safetensors dataOffsets"
)
MAX_TENSORS = 4096
HASH_CHUNK_BYTES = 1024 * 1024
DTYPE_CODES = {
    torch.bool: "BOOL",
    torch.uint8: "U8",
    torch.int8: "I8",
    torch.int16: "I16",
    torch.int32: "I32",
    torch.int64: "I64",
    torch.float16: "F16",
    torch.bfloat16: "BF16",
    torch.float32: "F32",
    torch.float64: "F64",
}


class ConversionError(RuntimeError):
    pass


def sha256_bytes(value: bytes | memoryview) -> str:
    return hashlib.sha256(value).hexdigest()


def stable_json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=True, separators=(",", ":"), sort_keys=True)


def stable_json_sha256(value: Any) -> str:
    return sha256_bytes(stable_json(value).encode("utf-8"))


def canonical_file_sha256(handle: BinaryIO) -> tuple[int, str]:
    handle.seek(0)
    digest = hashlib.sha256()
    total = 0
    while True:
        chunk = handle.read(HASH_CHUNK_BYTES)
        if not chunk:
            break
        total += len(chunk)
        digest.update(chunk)
    return total, digest.hexdigest()


def parse_sha256(value: str, name: str) -> str:
    if len(value) != 64 or any(character not in "0123456789abcdef" for character in value):
        raise ConversionError(f"{name}_invalid")
    return value


def regular_input(path: Path) -> tuple[BinaryIO, os.stat_result]:
    if not path.is_absolute() or "\x00" in str(path):
        raise ConversionError("input_path_invalid")
    flags = os.O_RDONLY | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
    try:
        descriptor = os.open(path, flags)
    except OSError as error:
        raise ConversionError(f"input_open_failed:{error.errno}") from error
    handle = os.fdopen(descriptor, "rb", closefd=True)
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        handle.close()
        raise ConversionError("input_not_regular")
    if path.resolve(strict=True) != path:
        handle.close()
        raise ConversionError("input_symlinked_path_forbidden")
    return handle, metadata


def require_new_output(path: Path, name: str) -> None:
    if not path.is_absolute() or "\x00" in str(path):
        raise ConversionError(f"{name}_path_invalid")
    if path.exists() or path.is_symlink():
        raise ConversionError(f"{name}_already_exists")
    parent = path.parent
    if not parent.is_dir() or parent.resolve(strict=True) != parent:
        raise ConversionError(f"{name}_parent_invalid")
    parent_metadata = parent.stat()
    if parent_metadata.st_uid != os.geteuid() or stat.S_IMODE(parent_metadata.st_mode) & 0o077:
        raise ConversionError(f"{name}_parent_must_be_private_and_owned")


def sealed_input_copy(
    source: BinaryIO,
    source_metadata: os.stat_result,
    expected_bytes: int,
    expected_sha256: str,
) -> BinaryIO:
    if not hasattr(os, "memfd_create") or not hasattr(os, "MFD_ALLOW_SEALING"):
        raise ConversionError("sealed_memfd_not_supported")
    descriptor = os.memfd_create(
        "dino-pth-verified-input",
        os.MFD_CLOEXEC | os.MFD_ALLOW_SEALING,
    )
    digest = hashlib.sha256()
    total = 0
    try:
        source.seek(0)
        while True:
            chunk = source.read(HASH_CHUNK_BYTES)
            if not chunk:
                break
            total += len(chunk)
            if total > expected_bytes:
                raise ConversionError("input_byte_length_mismatch")
            digest.update(chunk)
            view = memoryview(chunk)
            while view:
                written = os.write(descriptor, view)
                if written <= 0:
                    raise ConversionError("sealed_input_copy_write_failed")
                view = view[written:]
        if total != expected_bytes:
            raise ConversionError("input_byte_length_mismatch")
        if digest.hexdigest() != expected_sha256:
            raise ConversionError("input_sha256_mismatch")
        after_copy = os.fstat(source.fileno())
        if (
            after_copy.st_dev != source_metadata.st_dev
            or after_copy.st_ino != source_metadata.st_ino
            or after_copy.st_size != source_metadata.st_size
            or after_copy.st_mtime_ns != source_metadata.st_mtime_ns
            or after_copy.st_ctime_ns != source_metadata.st_ctime_ns
        ):
            raise ConversionError("input_changed_during_copy")
        seals = fcntl.F_SEAL_WRITE | fcntl.F_SEAL_GROW | fcntl.F_SEAL_SHRINK | fcntl.F_SEAL_SEAL
        fcntl.fcntl(descriptor, fcntl.F_ADD_SEALS, seals)
        os.lseek(descriptor, 0, os.SEEK_SET)
        return os.fdopen(descriptor, "rb", closefd=True)
    except BaseException:
        os.close(descriptor)
        raise


def write_exclusive_text(path: Path, value: str) -> None:
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    descriptor = os.open(path, flags, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8", closefd=True) as handle:
        handle.write(value)
        handle.flush()
        os.fsync(handle.fileno())


def source_sha256() -> str:
    source_path = Path(__file__).resolve(strict=True)
    return sha256_bytes(source_path.read_bytes())


def tensor_bytes(tensor: torch.Tensor) -> memoryview:
    byte_tensor = tensor.reshape(-1).view(torch.uint8)
    return memoryview(byte_tensor.numpy())


def tensor_identity(name: str, tensor: torch.Tensor) -> dict[str, Any]:
    if not name or not name.isascii() or not name.isprintable():
        raise ConversionError("tensor_name_invalid")
    if tensor.layout != torch.strided:
        raise ConversionError(f"tensor_layout_unsupported:{name}")
    if tensor.device.type != "cpu":
        raise ConversionError(f"tensor_device_not_cpu:{name}")
    if tensor.dtype not in DTYPE_CODES:
        raise ConversionError(f"tensor_dtype_unsupported:{name}")
    normalized = tensor.detach().contiguous()
    shape = list(normalized.shape)
    element_count = normalized.numel()
    byte_length = element_count * normalized.element_size()
    raw = tensor_bytes(normalized)
    if raw.nbytes != byte_length:
        raise ConversionError(f"tensor_byte_length_mismatch:{name}")
    return {
        "name": name,
        "dtype": DTYPE_CODES[normalized.dtype],
        "shape": shape,
        "elementCount": element_count,
        "byteLength": byte_length,
        "dataSha256": sha256_bytes(raw),
    }


def normalize_state_dict(value: Any) -> tuple[dict[str, torch.Tensor], list[dict[str, Any]]]:
    if not isinstance(value, dict):
        raise ConversionError("payload_not_state_dict")
    if len(value) == 0 or len(value) > MAX_TENSORS:
        raise ConversionError("tensor_count_invalid")
    names = list(value.keys())
    if any(not isinstance(name, str) for name in names):
        raise ConversionError("non_string_state_dict_key")
    if names != sorted(names):
        names = sorted(names)
    tensors: dict[str, torch.Tensor] = {}
    records: list[dict[str, Any]] = []
    for name in names:
        tensor = value[name]
        if type(tensor) is not torch.Tensor:
            raise ConversionError(f"non_tensor_state_dict_value:{name}")
        normalized = tensor.detach().cpu().contiguous()
        tensors[name] = normalized
        records.append(tensor_identity(name, normalized))
    return tensors, records


def read_safetensors_manifest(path: Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    with path.open("rb") as handle:
        raw_header_length = handle.read(8)
        if len(raw_header_length) != 8:
            raise ConversionError("safetensors_header_length_missing")
        header_length = int.from_bytes(raw_header_length, "little", signed=False)
        if header_length <= 0 or header_length > 16 * 1024 * 1024:
            raise ConversionError("safetensors_header_length_invalid")
        header_bytes = handle.read(header_length)
        if len(header_bytes) != header_length:
            raise ConversionError("safetensors_header_truncated")
        try:
            header = json.loads(header_bytes.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError) as error:
            raise ConversionError("safetensors_header_invalid") from error
        if not isinstance(header, dict) or "__metadata__" in header:
            raise ConversionError("safetensors_metadata_forbidden")
        data_start = 8 + header_length
        file_size = os.fstat(handle.fileno()).st_size
        data_length = file_size - data_start
        entries = []
        for name, entry in header.items():
            if not isinstance(name, str) or not name or not name.isascii() or not name.isprintable():
                raise ConversionError("safetensors_tensor_name_invalid")
            entry = header[name]
            if not isinstance(entry, dict) or set(entry) != {"data_offsets", "dtype", "shape"}:
                raise ConversionError(f"safetensors_tensor_entry_invalid:{name}")
            offsets = entry["data_offsets"]
            shape = entry["shape"]
            if (
                not isinstance(offsets, list)
                or len(offsets) != 2
                or any(type(offset) is not int for offset in offsets)
                or offsets[0] < 0
                or offsets[1] < offsets[0]
                or offsets[1] > data_length
            ):
                raise ConversionError(f"safetensors_offsets_invalid:{name}")
            if not isinstance(shape, list) or any(type(dimension) is not int or dimension < 0 for dimension in shape):
                raise ConversionError(f"safetensors_shape_invalid:{name}")
            entries.append((name, entry))
        expected_offset = 0
        for name, entry in sorted(entries, key=lambda item: item[1]["data_offsets"][0]):
            if entry["data_offsets"][0] != expected_offset:
                raise ConversionError(f"safetensors_offsets_invalid:{name}")
            expected_offset = entry["data_offsets"][1]
        if expected_offset != data_length:
            raise ConversionError("safetensors_data_section_not_fully_covered")

        records = []
        for name, entry in sorted(entries, key=lambda item: item[0]):
            offsets = entry["data_offsets"]
            shape = entry["shape"]
            byte_length = offsets[1] - offsets[0]
            handle.seek(data_start + offsets[0])
            digest = hashlib.sha256()
            remaining = byte_length
            while remaining:
                chunk = handle.read(min(HASH_CHUNK_BYTES, remaining))
                if not chunk:
                    raise ConversionError(f"safetensors_tensor_truncated:{name}")
                digest.update(chunk)
                remaining -= len(chunk)
            element_count = 1
            for dimension in shape:
                element_count *= dimension
            records.append(
                {
                    "name": name,
                    "dtype": entry["dtype"],
                    "shape": shape,
                    "elementCount": element_count,
                    "byteLength": byte_length,
                    "dataSha256": digest.hexdigest(),
                    "dataOffsets": offsets,
                }
            )
        observed_file_bytes, observed_file_sha256 = canonical_file_sha256(handle)
        if observed_file_bytes != file_size:
            raise ConversionError("safetensors_file_size_changed")
    return {
        "byteLength": file_size,
        "sha256": observed_file_sha256,
        "headerByteLength": header_length,
        "headerSha256": sha256_bytes(header_bytes),
        "dataByteLength": data_length,
        "metadata": "absent",
    }, records


def identity_projection(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    fields = ("name", "dtype", "shape", "elementCount", "byteLength", "dataSha256")
    return [{field: record[field] for field in fields} for record in records]


def verify_exact_equivalence(
    source_records: list[dict[str, Any]], derived_records: list[dict[str, Any]]
) -> dict[str, Any]:
    source_identity = identity_projection(source_records)
    derived_identity = identity_projection(derived_records)
    source_digest = stable_json_sha256(source_identity)
    derived_digest = stable_json_sha256(derived_identity)
    if source_identity != derived_identity or source_digest != derived_digest:
        raise ConversionError("tensor_equivalence_mismatch")
    return {
        "comparison": "exact-key-dtype-shape-and-canonical-byte-sha256",
        "sourceTensorIdentitySha256": source_digest,
        "derivedTensorIdentitySha256": derived_digest,
        "keySetMatched": True,
        "dtypeMatched": True,
        "shapeMatched": True,
        "tensorBytesMatched": True,
        "missingTensorCount": 0,
        "extraTensorCount": 0,
        "nonTensorEntryCount": 0,
        "mismatchCount": 0,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(allow_abbrev=False)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--evidence", required=True, type=Path)
    parser.add_argument("--expected-input-bytes", required=True, type=int)
    parser.add_argument("--expected-input-sha256", required=True)
    parser.add_argument("--expected-converter-sha256", required=True)
    parser.add_argument("--expected-python-version", required=True)
    parser.add_argument("--expected-pytorch-version", required=True)
    parser.add_argument("--expected-safetensors-version", required=True)
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    os.umask(0o077)
    if sys.byteorder != "little":
        raise ConversionError("little_endian_host_required")
    expected_input_sha256 = parse_sha256(args.expected_input_sha256, "expected_input_sha256")
    expected_converter_sha256 = parse_sha256(args.expected_converter_sha256, "expected_converter_sha256")
    if args.expected_input_bytes <= 0:
        raise ConversionError("expected_input_bytes_invalid")
    if platform.python_version() != args.expected_python_version:
        raise ConversionError("python_version_mismatch")
    if torch.__version__ != args.expected_pytorch_version:
        raise ConversionError("pytorch_version_mismatch")
    if safetensors.__version__ != args.expected_safetensors_version:
        raise ConversionError("safetensors_version_mismatch")
    if source_sha256() != expected_converter_sha256:
        raise ConversionError("converter_sha256_mismatch")

    input_path = args.input.absolute()
    output_path = args.output.absolute()
    evidence_path = args.evidence.absolute()
    require_new_output(output_path, "output")
    require_new_output(evidence_path, "evidence")
    if output_path == evidence_path:
        raise ConversionError("output_paths_must_differ")
    temp_output = output_path.with_name(f".{output_path.name}.partial")
    if temp_output.exists() or temp_output.is_symlink():
        raise ConversionError("partial_output_already_exists")

    input_handle, input_metadata = regular_input(input_path)
    try:
        sealed_input = sealed_input_copy(
            input_handle,
            input_metadata,
            args.expected_input_bytes,
            expected_input_sha256,
        )
    finally:
        input_handle.close()
    try:
        state_dict = torch.load(sealed_input, map_location="cpu", weights_only=True)
        input_bytes = args.expected_input_bytes
        input_sha256 = expected_input_sha256
    finally:
        sealed_input.close()

    tensors, source_records = normalize_state_dict(state_dict)
    try:
        save_file(tensors, temp_output)
        os.chmod(temp_output, 0o600)
        artifact, derived_records = read_safetensors_manifest(temp_output)
        equivalence = verify_exact_equivalence(source_records, derived_records)
        layout_digest = stable_json_sha256(derived_records)
        os.link(temp_output, output_path, follow_symlinks=False)
        temp_output.unlink()
    finally:
        if temp_output.exists():
            temp_output.unlink()

    completed_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
    report = {
        "schemaVersion": 1,
        "status": STATUS,
        "completedAt": completed_at,
        "converter": {
            "sha256": expected_converter_sha256,
            "weightsOnly": True,
            "mapLocation": "cpu",
            "keyTransformation": "identity",
            "dtypeTransformation": "identity",
            "layoutTransformation": "contiguous-c-order",
            "outputMetadata": "absent",
            "sealedInputCopy": True,
        },
        "environment": {
            "pythonVersion": platform.python_version(),
            "pytorchVersion": torch.__version__,
            "safetensorsVersion": safetensors.__version__,
            "byteOrder": sys.byteorder,
        },
        "input": {
            "representation": "raw-opaque-pth-publisher-response-body",
            "byteLength": input_bytes,
            "sha256": input_sha256,
        },
        "artifact": {
            "format": "safetensors",
            **artifact,
        },
        "tensorManifest": {
            "identityCanonicalization": IDENTITY_CANONICALIZATION,
            "layoutCanonicalization": LAYOUT_CANONICALIZATION,
            "tensorCount": len(derived_records),
            "totalTensorByteLength": sum(record["byteLength"] for record in derived_records),
            "identitySha256": equivalence["derivedTensorIdentitySha256"],
            "layoutSha256": layout_digest,
            "tensors": derived_records,
        },
        "tensorEquivalence": equivalence,
        "boundaries": {
            "conversionExecuted": True,
            "generationExecuted": False,
            "modelInputUsed": False,
            "modelRuntimeExecuted": False,
            "networkRequiredByConverter": False,
            "strictStateDictLoadExecuted": False,
            "torchHubInvoked": False,
        },
    }
    write_exclusive_text(evidence_path, json.dumps(report, ensure_ascii=True, indent=2) + "\n")
    print(
        json.dumps(
            {
                "schemaVersion": 1,
                "status": STATUS,
                "artifactByteLength": artifact["byteLength"],
                "artifactSha256": artifact["sha256"],
                "tensorCount": len(derived_records),
                "tensorIdentitySha256": equivalence["derivedTensorIdentitySha256"],
                "tensorLayoutSha256": layout_digest,
                "evidenceSha256": sha256_bytes(evidence_path.read_bytes()),
                "generationExecuted": False,
                "modelRuntimeExecuted": False,
            },
            ensure_ascii=True,
            separators=(",", ":"),
            sort_keys=True,
        )
    )


if __name__ == "__main__":
    try:
        main()
    except ConversionError as error:
        print(f"dino_conversion_failed:{error}", file=sys.stderr)
        raise SystemExit(1) from error
