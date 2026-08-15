import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
from PIL import Image

from . import samplers
from .base import Pipeline, TRELLIS_MODEL_KEYS
from ..modules import sparse as sp


SAMPLER_CLASSES = {
    "FlowEulerCfgSampler": samplers.FlowEulerCfgSampler,
    "FlowEulerGuidanceIntervalSampler": samplers.FlowEulerGuidanceIntervalSampler,
    "FlowEulerSampler": samplers.FlowEulerSampler,
}


class TrellisImageTo3DPipeline(Pipeline):
    """Inference-only pipeline for one pre-cleared RGBA PIL image."""

    def __init__(
        self,
        models: dict[str, nn.Module] | None = None,
        sparse_structure_sampler: samplers.Sampler | None = None,
        slat_sampler: samplers.Sampler | None = None,
        slat_normalization: dict | None = None,
        image_cond_model: nn.Module | None = None,
    ):
        if models is None:
            return
        if set(models) != TRELLIS_MODEL_KEYS:
            raise ValueError("Exactly four TRELLIS model families are required")
        if not isinstance(image_cond_model, nn.Module):
            raise TypeError("A caller-supplied local image conditioning model is required")
        if sparse_structure_sampler is None or slat_sampler is None:
            raise ValueError("Both samplers are required")
        if not isinstance(slat_normalization, dict):
            raise TypeError("Structured latent normalization must be a dictionary")

        super().__init__(models)
        self.sparse_structure_sampler = sparse_structure_sampler
        self.slat_sampler = slat_sampler
        self.sparse_structure_sampler_params = {}
        self.slat_sampler_params = {}
        self.slat_normalization = slat_normalization
        self.models["image_cond_model"] = image_cond_model.eval()

    @staticmethod
    def _load_sampler(config: dict) -> tuple[samplers.Sampler, dict]:
        if not isinstance(config, dict):
            raise ValueError("Sampler configuration must be an object")
        sampler_class = SAMPLER_CLASSES.get(config.get("name"))
        sampler_args = config.get("args")
        sampler_params = config.get("params")
        if sampler_class is None or not isinstance(sampler_args, dict) or not isinstance(sampler_params, dict):
            raise ValueError("Sampler configuration is not allowlisted")
        return sampler_class(**sampler_args), sampler_params

    @staticmethod
    def from_pretrained(path: str, *, image_cond_model: nn.Module) -> "TrellisImageTo3DPipeline":
        """Load local TRELLIS files and inject a caller-provided local DINO model."""
        pipeline = Pipeline.from_pretrained(path)
        args = pipeline._pretrained_args
        if args.get("image_cond_model") != "dinov2_vitl14_reg":
            raise ValueError("Only the locked local dinov2_vitl14_reg conditioning model is allowed")
        sparse_sampler, sparse_params = TrellisImageTo3DPipeline._load_sampler(
            args.get("sparse_structure_sampler")
        )
        slat_sampler, slat_params = TrellisImageTo3DPipeline._load_sampler(args.get("slat_sampler"))
        new_pipeline = TrellisImageTo3DPipeline(
            models=pipeline.models,
            sparse_structure_sampler=sparse_sampler,
            slat_sampler=slat_sampler,
            slat_normalization=args.get("slat_normalization"),
            image_cond_model=image_cond_model,
        )
        new_pipeline.sparse_structure_sampler_params = sparse_params
        new_pipeline.slat_sampler_params = slat_params
        new_pipeline._pretrained_args = args
        return new_pipeline

    @staticmethod
    def _prepare_image(image: Image.Image) -> torch.Tensor:
        if not isinstance(image, Image.Image) or image.mode != "RGBA":
            raise TypeError("Input must be one pre-cleared RGBA PIL image")
        rgba = np.asarray(image)
        if rgba.ndim != 3 or rgba.shape[2] != 4:
            raise ValueError("Input must contain four RGBA channels")
        alpha = rgba[:, :, 3]
        foreground = np.argwhere(alpha > 0.8 * 255)
        if foreground.size == 0 or np.all(alpha == 255):
            raise ValueError("Input alpha must contain a non-empty pre-cleared foreground")

        top, left = foreground.min(axis=0)
        bottom, right = foreground.max(axis=0)
        center_x = (left + right) / 2
        center_y = (top + bottom) / 2
        size = max(1, int(max(right - left, bottom - top) * 1.2))
        crop_box = (
            center_x - size // 2,
            center_y - size // 2,
            center_x + size // 2,
            center_y + size // 2,
        )
        resized = image.crop(crop_box).resize((518, 518), Image.Resampling.LANCZOS)
        normalized = np.asarray(resized).astype(np.float32) / 255.0
        composited = normalized[:, :, :3] * normalized[:, :, 3:4]
        composited = (composited * 255).astype(np.uint8).astype(np.float32) / 255.0
        tensor = torch.from_numpy(composited).permute(2, 0, 1).unsqueeze(0).float()
        return tensor

    def encode_image(self, image: Image.Image) -> torch.Tensor:
        image_tensor = self._prepare_image(image).to(self.device)
        mean = image_tensor.new_tensor([0.485, 0.456, 0.406])[None, :, None, None]
        std = image_tensor.new_tensor([0.229, 0.224, 0.225])[None, :, None, None]
        image_tensor = (image_tensor - mean) / std
        features = self.models["image_cond_model"](image_tensor, is_training=True)["x_prenorm"]
        return F.layer_norm(features, features.shape[-1:])

    def get_cond(self, image: Image.Image) -> dict:
        cond = self.encode_image(image)
        return {"cond": cond, "neg_cond": torch.zeros_like(cond)}

    def sample_sparse_structure(
        self,
        cond: dict,
        sampler_params: dict | None = None,
    ) -> torch.Tensor:
        flow_model = self.models["sparse_structure_flow_model"]
        resolution = flow_model.resolution
        noise = torch.randn(
            1,
            flow_model.in_channels,
            resolution,
            resolution,
            resolution,
            device=self.device,
        )
        params = {**self.sparse_structure_sampler_params, **(sampler_params or {})}
        samples = self.sparse_structure_sampler.sample(
            flow_model,
            noise,
            **cond,
            **params,
            verbose=False,
        ).samples
        decoder = self.models["sparse_structure_decoder"]
        return torch.argwhere(decoder(samples) > 0)[:, [0, 2, 3, 4]].int()

    def sample_slat(
        self,
        cond: dict,
        coords: torch.Tensor,
        sampler_params: dict | None = None,
    ) -> sp.SparseTensor:
        flow_model = self.models["slat_flow_model"]
        noise = sp.SparseTensor(
            feats=torch.randn(coords.shape[0], flow_model.in_channels, device=self.device),
            coords=coords,
        )
        params = {**self.slat_sampler_params, **(sampler_params or {})}
        slat = self.slat_sampler.sample(
            flow_model,
            noise,
            **cond,
            **params,
            verbose=False,
        ).samples
        std = torch.tensor(self.slat_normalization["std"], device=slat.device)[None]
        mean = torch.tensor(self.slat_normalization["mean"], device=slat.device)[None]
        return slat * std + mean

    @torch.no_grad()
    def run(
        self,
        image: Image.Image,
        seed: int = 42,
        sparse_structure_sampler_params: dict | None = None,
        slat_sampler_params: dict | None = None,
    ) -> dict:
        """Generate mesh representations only from one validated image."""
        cond = self.get_cond(image)
        torch.manual_seed(seed)
        coords = self.sample_sparse_structure(cond, sparse_structure_sampler_params)
        slat = self.sample_slat(cond, coords, slat_sampler_params)
        return {"mesh": self.models["slat_decoder_mesh"](slat)}
