#!/usr/bin/env python3
"""Run one locked WMMR image-to-mesh GPU probe and emit binary PLY."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import math
import os
import struct
import sys
import time
from pathlib import Path


PROHIBITED_MODULE_PREFIXES = (
    "diffoctreerast", "diff_gaussian_rasterization", "nvdiffrast", "rembg",
    "trellis.renderers", "trellis.representations.gaussian", "trellis.representations.radiance_field",
    "trellis.utils.postprocessing_utils", "trellis.utils.render_utils",
)


def sha256_file(path: Path) -> tuple[int, str]:
    digest = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            size += len(chunk)
            digest.update(chunk)
    return size, digest.hexdigest()


def reject_duplicate_keys(pairs):
    value = {}
    for key, nested in pairs:
        if key in value:
            raise RuntimeError(f"duplicate_json_key:{key}")
        value[key] = nested
    return value


def load_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"), object_pairs_hook=reject_duplicate_keys)


def verify_file(path: Path, size: int, digest: str):
    if path.is_symlink() or not path.is_file() or sha256_file(path) != (size, digest):
        raise RuntimeError(f"file_identity_mismatch:{path.name}")


def write_binary_ply(path: Path, vertices, faces, colors=None):
    vertices = list(vertices)
    faces = list(faces)
    colors = list(colors) if colors is not None else None
    if colors is not None and len(colors) != len(vertices):
        raise RuntimeError("vertex_color_count_mismatch")
    for vertex in vertices:
        if len(vertex) != 3 or not all(math.isfinite(float(value)) for value in vertex):
            raise RuntimeError("invalid_vertex")
    for face in faces:
        if len(face) != 3 or any(int(index) < 0 or int(index) >= len(vertices) for index in face):
            raise RuntimeError("invalid_face")
    color_properties = "property uchar red\nproperty uchar green\nproperty uchar blue\n" if colors is not None else ""
    header = (
        "ply\nformat binary_little_endian 1.0\n"
        f"element vertex {len(vertices)}\nproperty float x\nproperty float y\nproperty float z\n"
        f"{color_properties}element face {len(faces)}\nproperty list uchar uint vertex_indices\nend_header\n"
    ).encode("ascii")
    with path.open("wb") as stream:
        stream.write(header)
        for index, vertex in enumerate(vertices):
            stream.write(struct.pack("<fff", *(float(value) for value in vertex)))
            if colors is not None:
                stream.write(struct.pack("<BBB", *(max(0, min(255, int(round(float(value) * 255)))) for value in colors[index][:3])))
        for face in faces:
            stream.write(struct.pack("<BIII", 3, *(int(index) for index in face)))


def self_test():
    import tempfile
    with tempfile.TemporaryDirectory() as directory:
        output = Path(directory) / "triangle.ply"
        write_binary_ply(output, [(0, 0, 0), (1, 0, 0), (0, 1, 0)], [(0, 1, 2)], [(1, 0, 0)] * 3)
        if not output.read_bytes().startswith(b"ply\nformat binary_little_endian 1.0\n"):
            raise RuntimeError("binary_ply_self_test_failed")
        try:
            write_binary_ply(output, [(0, 0, 0)], [(0, 1, 2)])
        except RuntimeError as error:
            if str(error) != "invalid_face":
                raise
        else:
            raise RuntimeError("invalid_face_self_test_failed")
    print(json.dumps({"status": "generation-probe-self-test-pass"}, sort_keys=True))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--repository", type=Path)
    parser.add_argument("--runtime-site", type=Path)
    parser.add_argument("--dino-source", type=Path)
    parser.add_argument("--model-root", type=Path)
    parser.add_argument("--input", type=Path)
    parser.add_argument("--input-sha256")
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return
    required = (args.repository, args.runtime_site, args.dino_source, args.model_root, args.input, args.input_sha256, args.output_dir)
    if any(value is None for value in required):
        parser.error("all runtime paths and --input-sha256 are required")

    repository = args.repository.resolve(strict=True)
    runtime_site = args.runtime_site.resolve(strict=True)
    dino_source = args.dino_source.resolve(strict=True)
    model_root = args.model_root.resolve(strict=True)
    input_path = args.input.resolve(strict=True)
    output_dir = args.output_dir.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    input_size, input_digest = sha256_file(input_path)
    if input_digest != args.input_sha256:
        raise RuntimeError("input_identity_mismatch")

    dino_lock = load_json(repository / "experiment/warm-modern-meeting-room/dino-derived-runtime-artifact-lock.json")
    dino_source_lock = load_json(repository / "experiment/warm-modern-meeting-room/dino-source-artifact-metadata-lock.json")
    payload_lock = load_json(repository / "experiment/warm-modern-meeting-room/trellis-payload-bytes-lock.json")
    model_lock = load_json(repository / "experiment/warm-modern-meeting-room/trellis-model-artifact-lock.json")
    artifact_lock = load_json(repository / "experiment/warm-modern-meeting-room/artifact-revision-lock.json")
    trellis_root = (repository / artifact_lock["artifact"]["path"]).resolve(strict=True)
    verify_file(model_root / "dinov2_vitl14_reg4_pretrain.safetensors", dino_lock["artifact"]["byteLength"], dino_lock["artifact"]["sha256"])
    for payload in payload_lock["payloadSet"]["payloads"]:
        verify_file(model_root / payload["path"], payload["byteLength"], payload["observedSha256"])

    inherited_paths = [path for path in sys.path if "site-packages" not in path and "dist-packages" not in path]
    sys.path[:] = [str(trellis_root), str(dino_source), str(runtime_site), *inherited_paths]
    if not (dino_source / "dinov2/models/vision_transformer.py").is_file():
        raise RuntimeError("dino_source_entrypoint_missing")
    if importlib.util.find_spec("dinov2") is None:
        raise RuntimeError("dino_source_import_unresolved:" + "|".join(sys.path))
    os.environ["SPCONV_DISABLE_JIT"] = "1"
    os.environ["CUMM_DISABLE_JIT"] = "1"
    os.environ["PYTHONNOUSERSITE"] = "1"

    import torch
    from PIL import Image
    from safetensors.torch import load_file
    from dinov2.models.vision_transformer import vit_large
    from trellis.pipelines.trellis_image_to_3d import TrellisImageTo3DPipeline
    from trellis.representations.mesh import MeshExtractResult

    def mesh_extract_result_init(self, vertices, faces, vertex_attrs=None, res=64):
        if vertices.ndim != 2 or vertices.shape[1] != 3:
            raise ValueError("Mesh vertices must have shape [N, 3]")
        if faces.ndim != 2 or faces.shape[1] != 3:
            raise ValueError("Mesh faces must have shape [M, 3]")
        if not torch.isfinite(vertices).all():
            raise ValueError("Mesh vertices must be finite")
        if vertex_attrs is not None and not torch.isfinite(vertex_attrs).all():
            raise ValueError("Mesh vertex attributes must be finite")
        self.vertices = vertices
        self.faces = faces.long()
        if self.faces.numel() and (self.faces.min().item() < 0 or self.faces.max().item() >= vertices.shape[0]):
            raise ValueError("Mesh face index is outside the vertex array")
        self.vertex_attrs = vertex_attrs
        self.res = res
        self.success = vertices.shape[0] != 0 and faces.shape[0] != 0

    MeshExtractResult.__init__ = mesh_extract_result_init
    if not torch.cuda.is_available():
        raise RuntimeError("cuda_unavailable")
    started = time.monotonic()
    torch.cuda.reset_peak_memory_stats()
    constructor = dino_source_lock["offlineConstructor"]
    dino_model = vit_large(**constructor["arguments"])
    state = load_file(str(model_root / "dinov2_vitl14_reg4_pretrain.safetensors"), device="cpu")
    result = dino_model.load_state_dict(state, strict=True)
    if result.missing_keys or result.unexpected_keys:
        raise RuntimeError("dino_strict_load_failed")
    del state
    pipeline = TrellisImageTo3DPipeline.from_pretrained(str(model_root), image_cond_model=dino_model)
    pipeline.cuda()
    image = Image.open(input_path)
    image.load()
    if image.mode != "RGBA":
        raise RuntimeError("input_must_be_rgba")
    generated = pipeline.run(image, seed=args.seed)
    torch.cuda.synchronize()
    meshes = generated.get("mesh")
    if not isinstance(meshes, list) or len(meshes) != 1 or not meshes[0].success:
        raise RuntimeError("mesh_generation_failed")
    mesh = meshes[0]
    vertices = mesh.vertices.detach().float().cpu().tolist()
    faces = mesh.faces.detach().cpu().tolist()
    colors = mesh.vertex_attrs[:, :3].detach().float().cpu().tolist() if mesh.vertex_attrs is not None else None
    output_path = output_dir / f"probe-seed-{args.seed}.ply"
    write_binary_ply(output_path, vertices, faces, colors)
    output_size, output_digest = sha256_file(output_path)
    prohibited = sorted(name for name in sys.modules if any(name == prefix or name.startswith(prefix + ".") for prefix in PROHIBITED_MODULE_PREFIXES))
    if prohibited:
        raise RuntimeError("prohibited_runtime_module_observed:" + "|".join(prohibited))
    xs, ys, zs = zip(*vertices)
    report = {
        "schemaVersion": 1, "status": "gpu-generation-probe-pass", "seed": args.seed,
        "durationSeconds": round(time.monotonic() - started, 3),
        "input": {"byteLength": input_size, "sha256": input_digest, "mode": image.mode, "size": list(image.size)},
        "output": {"path": output_path.name, "byteLength": output_size, "sha256": output_digest,
                   "vertexCount": len(vertices), "faceCount": len(faces), "hasVertexColors": colors is not None,
                   "bounds": {"min": [min(xs), min(ys), min(zs)], "max": [max(xs), max(ys), max(zs)]}},
        "runtime": {"torchVersion": torch.__version__, "compiledCudaVersion": torch.version.cuda,
                    "gpuName": torch.cuda.get_device_name(0), "gpuCapability": list(torch.cuda.get_device_capability(0)),
                    "peakAllocatedBytes": torch.cuda.max_memory_allocated(), "peakReservedBytes": torch.cuda.max_memory_reserved(),
                    "lockedBaseTrellisTreeSha256": artifact_lock["artifact"]["treeSha256"],
                    "runtimeHotfix": {
                        "strategy": "in-memory-constructor-replacement",
                        "path": "trellis/representations/mesh/cube2mesh.py",
                        "baseSourceSha256": sha256_file(trellis_root / "trellis/representations/mesh/cube2mesh.py")[1],
                        "equivalentPatchedSourceSha256": "5bd144dfe002cca291b5f1625125119eb508c8ac19cc74960f3ec2b5871fece6",
                    },
                    "dinoArtifactSha256": dino_lock["artifact"]["sha256"],
                    "trellisModelCommit": model_lock["source"]["commit"], "prohibitedModulesObserved": []},
    }
    (output_dir / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, sort_keys=True))


if __name__ == "__main__":
    main()
