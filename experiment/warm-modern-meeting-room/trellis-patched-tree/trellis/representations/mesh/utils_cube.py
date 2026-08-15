import torch


cube_corners = torch.tensor(
    [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]],
    dtype=torch.int,
)
cube_neighbor = torch.tensor(
    [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]
)
cube_edges = torch.tensor(
    [0, 1, 1, 5, 4, 5, 0, 4, 2, 3, 3, 7, 6, 7, 2, 6, 2, 0, 3, 1, 7, 5, 6, 4],
    dtype=torch.long,
    requires_grad=False,
)


def _require_positive_resolution(res):
    if not isinstance(res, int) or isinstance(res, bool) or res < 1:
        raise ValueError("Resolution must be a positive integer")


def _require_tensor(name, value, dimensions, columns=None, integer=False):
    if not torch.is_tensor(value):
        raise TypeError(f"{name} must be a local torch.Tensor")
    if value.ndim != dimensions:
        raise ValueError(f"{name} must have {dimensions} dimensions")
    if columns is not None and value.shape[-1] != columns:
        raise ValueError(f"{name} must have {columns} columns")
    if integer and value.dtype not in (torch.int32, torch.int64):
        raise TypeError(f"{name} must use int32 or int64 indices")


def construct_dense_grid(res, device="cuda"):
    _require_positive_resolution(res)
    res_v = res + 1
    vertex_ids = torch.arange(res_v ** 3, device=device)
    coordinate_ids = vertex_ids.reshape(res_v, res_v, res_v)[:res, :res, :res].flatten()
    corner_bias = (cube_corners[:, 0] * res_v + cube_corners[:, 1]) * res_v + cube_corners[:, 2]
    cubes = coordinate_ids.unsqueeze(1) + corner_bias.unsqueeze(0).to(device)
    vertices = torch.stack(
        [vertex_ids // (res_v ** 2), (vertex_ids // res_v) % res_v, vertex_ids % res_v],
        dim=1,
    )
    return vertices, cubes


def construct_voxel_grid(coords):
    _require_tensor("coords", coords, 2, columns=3, integer=True)
    if coords.numel() == 0 or bool(torch.any(coords < 0)):
        raise ValueError("coords must contain non-negative cube coordinates")
    vertices = (cube_corners.unsqueeze(0).to(coords) + coords.unsqueeze(1)).reshape(-1, 3)
    unique_vertices, inverse_indices = torch.unique(vertices, dim=0, return_inverse=True)
    return unique_vertices, inverse_indices.reshape(-1, 8)


def cubes_to_verts(num_verts, cubes, value, reduce="mean"):
    if not isinstance(num_verts, int) or num_verts < 1:
        raise ValueError("num_verts must be positive")
    _require_tensor("cubes", cubes, 2, columns=8, integer=True)
    _require_tensor("value", value, 3)
    if value.shape[:2] != cubes.shape or value.device != cubes.device:
        raise ValueError("value must align with cubes on the same device")
    if bool(torch.any(cubes < 0)) or bool(torch.any(cubes >= num_verts)):
        raise ValueError("cube vertex index is out of bounds")
    channels = value.shape[2]
    reduced = torch.zeros(num_verts, channels, device=cubes.device, dtype=value.dtype)
    return torch.scatter_reduce(
        reduced,
        0,
        cubes.unsqueeze(-1).expand(-1, -1, channels).flatten(0, 1),
        value.flatten(0, 1),
        reduce=reduce,
        include_self=False,
    )


def sparse_cube2verts(coords, feats):
    _require_tensor("coords", coords, 2, columns=3, integer=True)
    _require_tensor("feats", feats, 3)
    if feats.shape[0] != coords.shape[0] or feats.shape[1] != 8 or feats.device != coords.device:
        raise ValueError("feats must be an aligned [N, 8, C] tensor")
    new_coords, cubes = construct_voxel_grid(coords)
    new_feats = cubes_to_verts(new_coords.shape[0], cubes, feats)
    return new_coords, new_feats


def get_dense_attrs(coords: torch.Tensor, feats: torch.Tensor, res: int, sdf_init=True):
    _require_positive_resolution(res)
    _require_tensor("coords", coords, 2, columns=3, integer=True)
    _require_tensor("feats", feats, 2)
    if coords.shape[0] != feats.shape[0] or coords.device != feats.device:
        raise ValueError("coords and feats must align on the same device")
    if coords.numel() == 0 or bool(torch.any(coords < 0)) or bool(torch.any(coords >= res)):
        raise ValueError("dense attribute coordinate is out of bounds")
    channels = feats.shape[-1]
    dense_attrs = torch.zeros([res] * 3 + [channels], device=feats.device, dtype=feats.dtype)
    if sdf_init:
        dense_attrs[..., 0] = 1
    dense_attrs[coords[:, 0], coords[:, 1], coords[:, 2], :] = feats
    return dense_attrs.reshape(-1, channels)


def get_defomed_verts(v_pos: torch.Tensor, deform: torch.Tensor, res):
    _require_positive_resolution(res)
    _require_tensor("v_pos", v_pos, 2, columns=3)
    _require_tensor("deform", deform, 2, columns=3)
    if v_pos.shape != deform.shape or v_pos.device != deform.device:
        raise ValueError("v_pos and deform must have matching shape and device")
    return v_pos / res - 0.5 + (1 - 1e-8) / (res * 2) * torch.tanh(deform)
