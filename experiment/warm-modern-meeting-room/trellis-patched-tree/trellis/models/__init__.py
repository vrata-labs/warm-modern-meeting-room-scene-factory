import json
from pathlib import Path
from types import MappingProxyType

from safetensors.torch import load_file

from .sparse_structure_flow import SparseStructureFlowModel
from .sparse_structure_vae import SparseStructureDecoder
from .structured_latent_flow import SLatFlowModel
from .structured_latent_vae import SLatMeshDecoder

MODEL_CLASSES = MappingProxyType({
    "SLatFlowModel": SLatFlowModel,
    "SLatMeshDecoder": SLatMeshDecoder,
    "SparseStructureDecoder": SparseStructureDecoder,
    "SparseStructureFlowModel": SparseStructureFlowModel,
})

__all__ = [*MODEL_CLASSES, "from_pretrained"]


def from_pretrained(path: str, **kwargs):
    """Load one allowlisted model from adjacent local JSON and safetensors files."""
    model_prefix = Path(path).resolve()
    config_file = model_prefix.with_suffix(".json")
    model_file = model_prefix.with_suffix(".safetensors")
    if (not config_file.is_file() or config_file.is_symlink()
            or not model_file.is_file() or model_file.is_symlink()):
        raise FileNotFoundError(f"Missing local model pair for {model_prefix}")

    with config_file.open("r", encoding="utf-8") as f:
        config = json.load(f)
    if set(config) != {"args", "name"}:
        raise ValueError("Model config must contain only name and args")
    name = config.get("name")
    args = config.get("args")
    if name not in MODEL_CLASSES or not isinstance(args, dict):
        raise ValueError("Model config is not an allowlisted TRELLIS model")
    model = MODEL_CLASSES[name](**args, **kwargs)
    model.load_state_dict(load_file(str(model_file), device="cpu"), strict=True)

    return model
