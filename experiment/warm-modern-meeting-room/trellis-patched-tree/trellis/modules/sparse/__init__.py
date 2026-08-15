"""Sparse runtime fixed to spconv storage and xFormers attention."""

BACKEND = "spconv"
ATTN = "xformers"
DEBUG = False

from .basic import SparseTensor, sparse_batch_broadcast, sparse_batch_op, sparse_cat, sparse_unbind
from .norm import SparseGroupNorm, SparseLayerNorm, SparseGroupNorm32, SparseLayerNorm32
from .nonlinearity import SparseReLU, SparseSiLU, SparseGELU, SparseActivation
from .linear import SparseLinear
from .attention import (
    SparseMultiHeadAttention,
    sparse_scaled_dot_product_attention,
    sparse_windowed_scaled_dot_product_self_attention,
)
from .conv import SparseConv3d, SparseInverseConv3d
from .spatial import SparseDownsample, SparseUpsample, SparseSubdivide
from . import transformer

__all__ = [
    "ATTN",
    "BACKEND",
    "DEBUG",
    "SparseActivation",
    "SparseConv3d",
    "SparseDownsample",
    "SparseGELU",
    "SparseGroupNorm",
    "SparseGroupNorm32",
    "SparseInverseConv3d",
    "SparseLayerNorm",
    "SparseLayerNorm32",
    "SparseLinear",
    "SparseMultiHeadAttention",
    "SparseReLU",
    "SparseSiLU",
    "SparseSubdivide",
    "SparseTensor",
    "SparseUpsample",
    "sparse_batch_broadcast",
    "sparse_batch_op",
    "sparse_cat",
    "sparse_scaled_dot_product_attention",
    "sparse_unbind",
    "sparse_windowed_scaled_dot_product_self_attention",
    "transformer",
]
