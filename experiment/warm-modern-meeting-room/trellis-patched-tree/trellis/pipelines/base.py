import json
from pathlib import Path

import torch
import torch.nn as nn

from .. import models

TRELLIS_MODEL_KEYS = frozenset({
    "slat_decoder_mesh",
    "slat_flow_model",
    "sparse_structure_decoder",
    "sparse_structure_flow_model",
})
TRELLIS_IGNORED_MODEL_KEYS = frozenset({
    "slat_decoder_gs",
    "slat_decoder_rf",
})


class Pipeline:
    """
    A base class for pipelines.
    """
    def __init__(
        self,
        models: dict[str, nn.Module] = None,
    ):
        if models is None:
            return
        self.models = models
        for model in self.models.values():
            model.eval()

    @staticmethod
    def from_pretrained(path: str) -> "Pipeline":
        """Load the four TRELLIS model families from one local directory."""
        root = Path(path).resolve(strict=True)
        if not root.is_dir():
            raise ValueError("Pipeline path must be a local directory")
        config_file = root / "pipeline.json"
        if not config_file.is_file():
            raise FileNotFoundError(config_file)

        with config_file.open("r", encoding="utf-8") as file:
            config = json.load(file)
        if set(config) != {"args", "name"}:
            raise ValueError("pipeline.json must contain only name and args")
        if config.get("name") != "TrellisImageTo3DPipeline":
            raise ValueError("Only TrellisImageTo3DPipeline is allowed")
        args = config.get("args")
        if not isinstance(args, dict) or not isinstance(args.get("models"), dict):
            raise ValueError("pipeline.json must define an args.models object")
        configured_model_keys = set(args["models"])
        if not TRELLIS_MODEL_KEYS.issubset(configured_model_keys):
            raise ValueError("pipeline.json is missing a required TRELLIS mesh model family")
        if configured_model_keys - TRELLIS_MODEL_KEYS != TRELLIS_IGNORED_MODEL_KEYS:
            raise ValueError("pipeline.json contains an unknown TRELLIS model family")

        loaded_models = {}
        selected_model_paths = {}
        for key in sorted(TRELLIS_MODEL_KEYS):
            relative_model_path = args["models"][key]
            if not isinstance(relative_model_path, str) or not relative_model_path:
                raise ValueError(f"Invalid local model path for {key}")
            if "\\" in relative_model_path or "\0" in relative_model_path:
                raise ValueError(f"Invalid local model path for {key}")
            relative_path = Path(relative_model_path)
            if relative_path.is_absolute() or ".." in relative_path.parts:
                raise ValueError(f"Model path escapes pipeline directory: {key}")
            unresolved_model_path = (root / relative_path).absolute()
            model_path = unresolved_model_path.resolve()
            if root not in model_path.parents or model_path != unresolved_model_path:
                raise ValueError(f"Model path escapes pipeline directory: {key}")
            loaded_models[key] = models.from_pretrained(str(model_path))
            selected_model_paths[key] = relative_model_path

        new_pipeline = Pipeline(loaded_models)
        new_pipeline._pretrained_args = {**args, "models": selected_model_paths}
        return new_pipeline

    @property
    def device(self) -> torch.device:
        for model in self.models.values():
            if hasattr(model, 'device'):
                return model.device
        for model in self.models.values():
            if hasattr(model, 'parameters'):
                return next(model.parameters()).device
        raise RuntimeError("No device found.")

    def to(self, device: torch.device) -> None:
        for model in self.models.values():
            model.to(device)

    def cuda(self) -> None:
        self.to(torch.device("cuda"))

    def cpu(self) -> None:
        self.to(torch.device("cpu"))
