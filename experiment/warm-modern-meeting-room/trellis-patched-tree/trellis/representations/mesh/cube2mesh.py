from types import SimpleNamespace

import torch

from ...modules.sparse import SparseTensor
from .flexicubes.flexicubes import FlexiCubes
from .utils_cube import construct_dense_grid, get_defomed_verts, get_dense_attrs, sparse_cube2verts


class MeshExtractResult:
    def __init__(self, vertices, faces, vertex_attrs=None, res=64):
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
        if self.faces.num() and (
            self.faces.min().item() < 0 or self.faces.max().item() >= vertices.shape[0]
        ):
            raise ValueError("Mesh face index is outside the vertex array")
        self.vertex_attrs = vertex_attrs
        self.res = res
        self.success = vertices.shape[0] != 0 and faces.shape[0] != 0


class SparseFeatures2Mesh:
    def __init__(self, device="cuda", res=64, use_color=True):
        self.device = device
        self.res = res
        self.mesh_extractor = FlexiCubes(device=device)
        self.sdf_bias = -1.0 / res
        verts, cubes = construct_dense_grid(self.res, self.device)
        self.reg_c = cubes.to(self.device)
        self.reg_v = verts.to(self.device)
        self.use_color = use_color
        self._calc_layout()

    def _calc_layout(self):
        self.layouts = SimpleNamespace(
            sdf={"shape": (8, 1), "size": 8},
            deform={"shape": (8, 3), "size": 8 * 3},
            weights={"shape": (21,), "size": 21},
        )
        if self.use_color:
            self.layouts.color = {"shape": (8, 6), "size": 8 * 6}
        start = 0
        for layout in vars(self.layouts).values():
            layout["range"] = (start, start + layout["size"])
            start += layout["size"]
        self.feats_channels = start

    def get_layout(self, feats: torch.Tensor, name: str):
        layout = getattr(self.layouts, name, None)
        if layout is None:
            return None
        start, end = layout["range"]
        return feats[:, start:end].reshape(-1, *layout["shape"])

    def __call__(self, cubefeats: SparseTensor):
        coords = cubefeats.coords[:, 1:]
        feats = cubefeats.feats
        sdf = self.get_layout(feats, "sdf")
        deform = self.get_layout(feats, "deform")
        color = self.get_layout(feats, "color")
        weights = self.get_layout(feats, "weights")
        sdf += self.sdf_bias
        vertex_attrs = [sdf, deform, color] if self.use_color else [sdf, deform]
        vertex_positions, vertex_attrs = sparse_cube2verts(coords, torch.cat(vertex_attrs, dim=-1))
        dense_vertex_attrs = get_dense_attrs(
            vertex_positions,
            vertex_attrs,
            res=self.res + 1,
            sdf_init=True,
        )
        dense_weights = get_dense_attrs(coords, weights, res=self.res, sdf_init=False)
        if self.use_color:
            dense_sdf = dense_vertex_attrs[..., 0]
            dense_deform = dense_vertex_attrs[..., 1:4]
            dense_colors = dense_vertex_attrs[..., 4:]
        else:
            dense_sdf = dense_vertex_attrs[..., 0]
            dense_deform = dense_vertex_attrs[..., 1:4]
            dense_colors = None

        deformed_vertices = get_defomed_verts(self.reg_v, dense_deform, self.res)
        vertices, faces, colors = self.mesh_extractor(
            voxelgrid_vertices=deformed_vertices,
            scalar_field=dense_sdf,
            cube_idx=self.reg_c,
            resolution=self.res,
            beta=dense_weights[:, :12],
            alpha=dense_weights[:, 12:20],
            gamma_f=dense_weights[:, 20],
            voxelgrid_colors=dense_colors,
        )
        return MeshExtractResult(vertices=vertices, faces=faces, vertex_attrs=colors, res=self.res)
