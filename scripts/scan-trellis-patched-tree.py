#!/usr/bin/env python3
"""Dependency-free static syntax and policy scanner for the patched TRELLIS tree."""

from __future__ import annotations

import ast
import hashlib
import json
import re
import sys
import warnings
from pathlib import Path


ALLOWED_EXTERNAL_ROOTS = {"PIL", "numpy", "safetensors", "spconv", "torch", "xformers"}
DENIED_IMPORT_ROOTS = {
    "aiohttp",
    "boto3",
    "diffoctreerast",
    "diff_gaussian_rasterization",
    "easydict",
    "flash_attn",
    "ftplib",
    "grpc",
    "http",
    "httpx",
    "huggingface_hub",
    "importlib",
    "kaolin",
    "nvdiffrast",
    "open3d",
    "paramiko",
    "plyfile",
    "pkgutil",
    "rembg",
    "requests",
    "runpy",
    "smtplib",
    "socket",
    "subprocess",
    "telnetlib",
    "torchsparse",
    "torchvision",
    "tqdm",
    "urllib",
    "urllib3",
    "vox2seq",
    "websocket",
    "websockets",
    "xmlrpc",
}
EXPECTED_MODEL_CLASSES = {
    "SLatFlowModel": "SLatFlowModel",
    "SLatMeshDecoder": "SLatMeshDecoder",
    "SparseStructureDecoder": "SparseStructureDecoder",
    "SparseStructureFlowModel": "SparseStructureFlowModel",
}
EXPECTED_MODEL_KEYS = {
    "slat_decoder_mesh",
    "slat_flow_model",
    "sparse_structure_decoder",
    "sparse_structure_flow_model",
}
GLIDE_COMMIT = "69b530740eb6cef69442d6180579ef5ba9ef063e"
GLIDE_LICENSE_SHA256 = "86bbb73e855821d7c401912fd4bf82e34313e6e3b6fd6f909f2b6cc9e209a53b"
THIRD_PARTY_NOTICES_SHA256 = "35ad6ac7c9711d9e0c85d85ba6cccd2b8b3f3ddb63d720cecdfb47e0a041df0c"
DISALLOWED_SOURCE_TERMS = re.compile(
    r"\b(?:Elastic|formats|Gaussian|radiance_field|render(?:er|ers|ing)?|RF|serialized)\b|multi[_-]?image",
    re.IGNORECASE,
)


class ScanFailure(Exception):
    def __init__(self, issues: list[str]):
        super().__init__(f"trellis_static_policy_invalid:{','.join(issues)}")
        self.issues = issues


def sha256(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def module_name(path: Path) -> tuple[str, bool]:
    parts = list(path.with_suffix("").parts)
    is_package = parts[-1] == "__init__"
    if is_package:
        parts.pop()
    return ".".join(parts), is_package


def dotted_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = dotted_name(node.value)
        return f"{parent}.{node.attr}" if parent else None
    return None


def resolved_dotted_name(node: ast.AST, aliases: dict[str, str]) -> str | None:
    name = dotted_name(node)
    if name is None:
        return None
    root, separator, suffix = name.partition(".")
    resolved_root = aliases.get(root, root)
    return f"{resolved_root}.{suffix}" if separator else resolved_root


def relative_import(module: str, is_package: bool, node: ast.ImportFrom) -> str | None:
    if node.level == 0:
        return node.module
    package = module.split(".") if is_package else module.split(".")[:-1]
    remove = node.level - 1
    if remove > len(package):
        return None
    base = package[: len(package) - remove] if remove else package
    if node.module:
        base.extend(node.module.split("."))
    return ".".join(base)


def assigned_name(target: ast.AST) -> str | None:
    return target.id if isinstance(target, ast.Name) else None


def assignment_values(tree: ast.Module, name: str) -> list[ast.AST]:
    values: list[ast.AST] = []
    for node in tree.body:
        if isinstance(node, ast.Assign) and any(assigned_name(target) == name for target in node.targets):
            values.append(node.value)
        elif isinstance(node, ast.AnnAssign) and assigned_name(node.target) == name and node.value is not None:
            values.append(node.value)
    return values


def all_assignment_values(tree: ast.Module, name: str) -> list[ast.AST]:
    values: list[ast.AST] = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and any(assigned_name(target) == name for target in node.targets):
            values.append(node.value)
        elif isinstance(node, ast.AnnAssign) and assigned_name(node.target) == name and node.value is not None:
            values.append(node.value)
        elif isinstance(node, ast.NamedExpr) and assigned_name(node.target) == name:
            values.append(node.value)
    return values


def assignment_value(tree: ast.Module, name: str):
    values = assignment_values(tree, name)
    return values[0] if len(values) == 1 else None


def string_collection(node: ast.AST | None) -> set[str] | None:
    if isinstance(node, (ast.List, ast.Set, ast.Tuple)):
        values = []
        for element in node.elts:
            if not isinstance(element, ast.Constant) or not isinstance(element.value, str):
                return None
            values.append(element.value)
        return set(values)
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id == "frozenset" and len(node.args) == 1:
        return string_collection(node.args[0])
    return None


def string_mapping(node: ast.AST | None) -> dict[str, str] | None:
    if isinstance(node, ast.Call) and dotted_name(node.func) == "MappingProxyType" and len(node.args) == 1:
        node = node.args[0]
    if not isinstance(node, ast.Dict):
        return None
    values: dict[str, str] = {}
    for key, value in zip(node.keys, node.values):
        if not isinstance(key, ast.Constant) or not isinstance(key.value, str) or not isinstance(value, ast.Name):
            return None
        values[key.value] = value.id
    return values


def constant_assignment(tree: ast.AST, name: str):
    value = assignment_value(tree, name)
    return value.value if isinstance(value, ast.Constant) else None


def import_aliases(tree: ast.Module, module: str, is_package: bool) -> dict[str, str]:
    aliases: dict[str, str] = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                bound = alias.asname or alias.name.split(".")[0]
                aliases[bound] = alias.name if alias.asname else alias.name.split(".")[0]
        elif isinstance(node, ast.ImportFrom):
            resolved = relative_import(module, is_package, node)
            if resolved is None:
                continue
            for alias in node.names:
                if alias.name == "*":
                    continue
                aliases[alias.asname or alias.name] = f"{resolved}.{alias.name}" if resolved else alias.name
    return aliases


def direct_namespace(tree: ast.Module) -> set[str]:
    names: set[str] = set()
    for node in tree.body:
        if isinstance(node, (ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            names.add(node.name)
        elif isinstance(node, ast.Assign):
            names.update(name for target in node.targets if (name := assigned_name(target)) is not None)
        elif isinstance(node, ast.AnnAssign):
            if (name := assigned_name(node.target)) is not None:
                names.add(name)
        elif isinstance(node, ast.Import):
            names.update(alias.asname or alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            names.update(alias.asname or alias.name for alias in node.names if alias.name != "*")
    return names


def internal_namespaces(
    parsed: dict[str, ast.Module],
    module_records: dict[str, tuple[str, bool]],
) -> dict[str, set[str]]:
    namespaces = {
        module_records[relative][0]: direct_namespace(tree)
        for relative, tree in parsed.items()
    }
    for _ in range(len(parsed)):
        changed = False
        for relative, tree in parsed.items():
            module, is_package = module_records[relative]
            for node in tree.body:
                if not isinstance(node, ast.ImportFrom) or not any(alias.name == "*" for alias in node.names):
                    continue
                resolved = relative_import(module, is_package, node)
                if resolved in namespaces:
                    previous = len(namespaces[module])
                    namespaces[module].update(namespaces[resolved])
                    changed = changed or len(namespaces[module]) != previous
        if not changed:
            break
    return namespaces


def protected_binding_issues(tree: ast.Module, relative: str, name: str) -> list[str]:
    issues: list[str] = []
    if len(all_assignment_values(tree, name)) != 1:
        issues.append(f"protected_binding_assignment_count:{relative}:{name}")
    for node in ast.walk(tree):
        targets: list[ast.AST] = []
        if isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign, ast.NamedExpr)):
            targets = list(node.targets) if isinstance(node, ast.Assign) else [node.target]
        elif isinstance(node, ast.Delete):
            targets = list(node.targets)
        for target in targets:
            root = target
            while isinstance(root, (ast.Attribute, ast.Subscript)):
                root = root.value
            if isinstance(root, ast.Name) and root.id == name and not isinstance(target, ast.Name):
                issues.append(f"protected_binding_mutation:{relative}:{getattr(node, 'lineno', 0)}:{name}")
        if isinstance(node, ast.Call):
            call = dotted_name(node.func)
            mutating_methods = {
                "__delitem__",
                "__setitem__",
                "add",
                "clear",
                "difference_update",
                "discard",
                "intersection_update",
                "pop",
                "popitem",
                "remove",
                "setdefault",
                "symmetric_difference_update",
                "update",
            }
            if call and call.startswith(f"{name}.") and call.rsplit(".", 1)[-1] in mutating_methods:
                issues.append(f"protected_binding_method_call:{relative}:{node.lineno}:{call}")
    return issues


def read_required_exclusions(policy_path: Path) -> set[str]:
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    exclusions = policy.get("requiredExclusions")
    if not isinstance(exclusions, list) or not all(isinstance(value, str) for value in exclusions):
        raise ScanFailure(["source_policy_required_exclusions_invalid"])
    return set(exclusions)


def scan(tree_root: Path, policy_path: Path) -> dict:
    issues: list[str] = []
    tree_root = tree_root.resolve(strict=True)
    policy_path = policy_path.resolve(strict=True)
    python_files = sorted(tree_root.rglob("*.py"), key=lambda path: path.relative_to(tree_root).as_posix())
    if len(python_files) != 46:
        issues.append(f"python_file_count:{len(python_files)}")

    forbidden_names = {".gitmodules", "DCO.txt", "README.md", "serialized_attn.py"}
    for path in tree_root.rglob("*"):
        if path.name in forbidden_names:
            issues.append(f"forbidden_artifact_path:{path.relative_to(tree_root).as_posix()}")

    parsed: dict[str, ast.Module] = {}
    source_text: dict[str, str] = {}
    module_records: dict[str, tuple[str, bool]] = {}
    module_names: set[str] = set()
    for path in python_files:
        relative = path.relative_to(tree_root).as_posix()
        try:
            bytes_value = path.read_bytes()
            text = bytes_value.decode("utf-8")
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", SyntaxWarning)
                tree = ast.parse(text, filename=relative)
        except (OSError, UnicodeDecodeError, SyntaxError) as error:
            issues.append(f"python_syntax:{relative}:{getattr(error, 'lineno', 0) or 0}")
            continue
        parsed[relative] = tree
        source_text[relative] = text
        name, is_package = module_name(Path(relative))
        module_records[relative] = (name, is_package)
        parts = name.split(".")
        module_names.update(".".join(parts[:index]) for index in range(1, len(parts) + 1))

    required_exclusions = read_required_exclusions(policy_path)
    module_to_relative = {module: relative for relative, (module, _) in module_records.items()}
    namespaces = internal_namespaces(parsed, module_records)
    external_roots: set[str] = set()
    internal_imports: set[str] = set()
    for relative, tree in parsed.items():
        module, is_package = module_records[relative]
        source = source_text[relative]
        aliases = import_aliases(tree, module, is_package)
        if DISALLOWED_SOURCE_TERMS.search(source):
            issues.append(f"disallowed_source_term:{relative}")

        for node in ast.walk(tree):
            imported_modules: list[str] = []
            if isinstance(node, ast.Import):
                imported_modules.extend(alias.name for alias in node.names)
            elif isinstance(node, ast.ImportFrom):
                resolved = relative_import(module, is_package, node)
                if resolved is None:
                    issues.append(f"invalid_relative_import:{relative}:{node.lineno}")
                    continue
                if resolved:
                    imported_modules.append(resolved)
                    for alias in node.names:
                        if alias.name == "*":
                            continue
                        candidate = f"{resolved}.{alias.name}"
                        if candidate in module_names:
                            imported_modules.append(candidate)
                        elif resolved.split(".")[0] == "trellis":
                            if resolved not in module_to_relative or alias.name not in namespaces.get(resolved, set()):
                                issues.append(
                                    f"missing_internal_symbol:{relative}:{node.lineno}:{candidate}"
                                )
                        if candidate == "torch.hub" or candidate.startswith("torch.hub."):
                            issues.append(f"denied_import:{relative}:{node.lineno}:{candidate}")

            for imported in imported_modules:
                root = imported.split(".")[0]
                if imported == "torch.hub" or root in DENIED_IMPORT_ROOTS:
                    issues.append(f"denied_import:{relative}:{node.lineno}:{imported}")
                    continue
                if root == "trellis":
                    if any(imported == excluded or imported.startswith(f"{excluded}.") for excluded in required_exclusions):
                        issues.append(f"excluded_internal_import:{relative}:{node.lineno}:{imported}")
                    if "serialized_attn" in imported.split("."):
                        issues.append(f"serialized_internal_import:{relative}:{node.lineno}")
                    if imported not in module_names:
                        issues.append(f"missing_internal_import:{relative}:{node.lineno}:{imported}")
                    internal_imports.add(imported)
                elif root not in sys.stdlib_module_names:
                    external_roots.add(root)
                    if root not in ALLOWED_EXTERNAL_ROOTS:
                        issues.append(f"unapproved_external_import:{relative}:{node.lineno}:{imported}")

            if isinstance(node, ast.Call):
                call = resolved_dotted_name(node.func, aliases)
                if call in {
                    "__import__",
                    "builtins.__import__",
                    "builtins.compile",
                    "builtins.eval",
                    "builtins.exec",
                    "compile",
                    "eval",
                    "exec",
                    "importlib.import_module",
                }:
                    issues.append(f"dynamic_execution:{relative}:{node.lineno}:{call}")
                if call == "torch.load" or (call and call.startswith("torch.hub.")):
                    issues.append(f"prohibited_torch_call:{relative}:{node.lineno}:{call}")
                if call == "getattr" and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
                    owner = resolved_dotted_name(node.args[0], aliases)
                    if owner and isinstance(node.args[1].value, str):
                        dynamic_target = f"{owner}.{node.args[1].value}"
                        if dynamic_target == "torch.load" or dynamic_target.startswith("torch.hub"):
                            issues.append(
                                f"prohibited_dynamic_access:{relative}:{node.lineno}:{dynamic_target}"
                            )
                        if dynamic_target in {
                            "builtins.__import__",
                            "builtins.compile",
                            "builtins.eval",
                            "builtins.exec",
                        }:
                            issues.append(
                                f"dynamic_execution_access:{relative}:{node.lineno}:{dynamic_target}"
                            )

            if isinstance(node, (ast.Assign, ast.AnnAssign, ast.NamedExpr)):
                value = node.value
                resolved_value = resolved_dotted_name(value, aliases) if value is not None else None
                if resolved_value == "torch.load" or (resolved_value and resolved_value.startswith("torch.hub")):
                    issues.append(f"prohibited_callable_alias:{relative}:{node.lineno}:{resolved_value}")
                if resolved_value in {
                    "__import__",
                    "builtins.__import__",
                    "builtins.compile",
                    "builtins.eval",
                    "builtins.exec",
                    "compile",
                    "eval",
                    "exec",
                    "importlib.import_module",
                }:
                    issues.append(f"dynamic_execution_alias:{relative}:{node.lineno}:{resolved_value}")
                if resolved_value in {"torch", "torch.hub"}:
                    issues.append(f"prohibited_module_alias:{relative}:{node.lineno}:{resolved_value}")

    if external_roots != ALLOWED_EXTERNAL_ROOTS:
        missing = sorted(ALLOWED_EXTERNAL_ROOTS - external_roots)
        extra = sorted(external_roots - ALLOWED_EXTERNAL_ROOTS)
        if missing:
            issues.append(f"required_external_imports_missing:{'|'.join(missing)}")
        if extra:
            issues.append(f"unexpected_external_imports:{'|'.join(extra)}")

    root_initializer = parsed.get("trellis/__init__.py")
    if root_initializer is None:
        issues.append("root_initializer_missing")
    else:
        executable_nodes = [
            node for node in root_initializer.body
            if not (
                isinstance(node, ast.Expr)
                and isinstance(node.value, ast.Constant)
                and isinstance(node.value.value, str)
            )
        ]
        if executable_nodes:
            issues.append("root_initializer_not_inert")

    models_path = "trellis/models/__init__.py"
    models_tree = parsed.get(models_path)
    if models_tree is None:
        issues.append("models_initializer_missing")
    else:
        issues.extend(protected_binding_issues(models_tree, models_path, "MODEL_CLASSES"))
        classes = string_mapping(assignment_value(models_tree, "MODEL_CLASSES"))
        if classes != EXPECTED_MODEL_CLASSES:
            issues.append("model_class_allowlist_invalid")
        load_calls = [
            node for node in ast.walk(models_tree)
            if isinstance(node, ast.Call) and dotted_name(node.func) and dotted_name(node.func).endswith("load_state_dict")
        ]
        if len(load_calls) != 1 or not any(
            keyword.arg == "strict" and isinstance(keyword.value, ast.Constant) and keyword.value.value is True
            for keyword in (load_calls[0].keywords if load_calls else [])
        ):
            issues.append("strict_state_dict_load_missing")
        models_source = source_text.get(models_path, "")
        if 'with_suffix(".json")' not in models_source or 'with_suffix(".safetensors")' not in models_source:
            issues.append("local_json_safetensors_loader_missing")

    pipeline_base_path = "trellis/pipelines/base.py"
    pipeline_base_tree = parsed.get(pipeline_base_path)
    model_keys = string_collection(assignment_value(pipeline_base_tree, "TRELLIS_MODEL_KEYS")) if pipeline_base_tree else None
    if model_keys != EXPECTED_MODEL_KEYS:
        issues.append("pipeline_model_keys_invalid")
    ignored_model_keys = (
        string_collection(assignment_value(pipeline_base_tree, "TRELLIS_IGNORED_MODEL_KEYS"))
        if pipeline_base_tree else None
    )
    if ignored_model_keys != {"slat_decoder_gs", "slat_decoder_rf"}:
        issues.append("pipeline_ignored_model_keys_invalid")
    if pipeline_base_tree:
        issues.extend(protected_binding_issues(pipeline_base_tree, pipeline_base_path, "TRELLIS_MODEL_KEYS"))
        issues.extend(protected_binding_issues(pipeline_base_tree, pipeline_base_path, "TRELLIS_IGNORED_MODEL_KEYS"))

    pipeline_init_path = "trellis/pipelines/__init__.py"
    pipeline_init_tree = parsed.get(pipeline_init_path)
    if pipeline_init_tree is None:
        issues.append("pipeline_initializer_missing")
    else:
        exports = string_collection(assignment_value(pipeline_init_tree, "__all__"))
        imported_pipeline_names = [
            alias.name
            for node in pipeline_init_tree.body
            if isinstance(node, ast.ImportFrom)
            for alias in node.names
        ]
        if exports != {"TrellisImageTo3DPipeline"} or imported_pipeline_names != ["TrellisImageTo3DPipeline"]:
            issues.append("single_pipeline_export_invalid")

    pipeline_path = "trellis/pipelines/trellis_image_to_3d.py"
    pipeline_tree = parsed.get(pipeline_path)
    pipeline_source = source_text.get(pipeline_path, "")
    if pipeline_tree is None:
        issues.append("image_pipeline_missing")
    else:
        from_pretrained = next(
            (node for node in ast.walk(pipeline_tree) if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == "from_pretrained"),
            None,
        )
        keyword_only = {argument.arg for argument in from_pretrained.args.kwonlyargs} if from_pretrained else set()
        if "image_cond_model" not in keyword_only:
            issues.append("injected_image_model_contract_missing")
        run = next((node for node in ast.walk(pipeline_tree) if isinstance(node, ast.FunctionDef) and node.name == "run"), None)
        run_returns = [node for node in ast.walk(run) if isinstance(node, ast.Return)] if run else []
        mesh_only = any(
            isinstance(node.value, ast.Dict)
            and len(node.value.keys) == 1
            and isinstance(node.value.keys[0], ast.Constant)
            and node.value.keys[0].value == "mesh"
            for node in run_returns
        )
        if not mesh_only:
            issues.append("mesh_only_pipeline_result_missing")
        if 'image.mode != "RGBA"' not in pipeline_source or "pre-cleared RGBA PIL image" not in pipeline_source:
            issues.append("precleared_rgba_contract_missing")
        if "dinov2_vitl14_reg" not in pipeline_source:
            issues.append("locked_dino_model_name_missing")
        run_arguments = {argument.arg for argument in run.args.args} if run else set()
        if "num_samples" in run_arguments:
            issues.append("multi_sample_pipeline_contract_present")

    for relative in (
        "trellis/pipelines/samplers/flow_euler.py",
        "trellis/representations/mesh/cube2mesh.py",
    ):
        if "SimpleNamespace" not in source_text.get(relative, ""):
            issues.append(f"simple_namespace_missing:{relative}")

    for relative in (
        "trellis/representations/mesh/cube2mesh.py",
        "trellis/representations/mesh/flexicubes/flexicubes.py",
    ):
        if re.search(r"\btraining\b", source_text.get(relative, ""), re.IGNORECASE):
            issues.append(f"mesh_inference_boundary_invalid:{relative}")

    fixed_constants = [
        ("trellis/modules/attention/__init__.py", "BACKEND", "xformers"),
        ("trellis/modules/sparse/__init__.py", "ATTN", "xformers"),
        ("trellis/modules/sparse/__init__.py", "BACKEND", "spconv"),
    ]
    for relative, name, expected in fixed_constants:
        tree = parsed.get(relative)
        if tree is None or constant_assignment(tree, name) != expected:
            issues.append(f"fixed_backend_invalid:{relative}:{name}")
        elif tree is not None:
            issues.extend(protected_binding_issues(tree, relative, name))
    for relative in (
        "trellis/modules/attention/full_attn.py",
        "trellis/modules/sparse/attention/full_attn.py",
        "trellis/modules/sparse/attention/windowed_attn.py",
    ):
        if "xops.memory_efficient_attention" not in source_text.get(relative, ""):
            issues.append(f"xformers_attention_missing:{relative}")
    if "SparseConvTensor" not in source_text.get("trellis/modules/sparse/basic.py", ""):
        issues.append("spconv_sparse_tensor_missing")

    flex_path = "trellis/representations/mesh/flexicubes/flexicubes.py"
    flex_source = source_text.get(flex_path, "")
    for marker in ("MODIFICATION NOTICE", "inference-only", "_require_tensor"):
        if marker not in flex_source:
            issues.append(f"flexicubes_modification_marker_missing:{marker}")

    glide_path = "trellis/models/sparse_structure_flow.py"
    if GLIDE_COMMIT not in source_text.get(glide_path, ""):
        issues.append("glide_immutable_attribution_missing")
    glide_license = tree_root / "third_party/openai-glide/LICENSE.txt"
    if not glide_license.is_file() or sha256(glide_license.read_bytes()) != GLIDE_LICENSE_SHA256:
        issues.append("glide_license_not_exact")
    notices = tree_root / "THIRD_PARTY_NOTICES.txt"
    notice_text = notices.read_text(encoding="utf-8") if notices.is_file() else ""
    if not notices.is_file() or sha256(notices.read_bytes()) != THIRD_PARTY_NOTICES_SHA256:
        issues.append("third_party_notice_not_exact")
    if GLIDE_COMMIT not in notice_text:
        issues.append("third_party_notice_incomplete")
    for marker in (
        "FlexiCubes",
        "815e075a2a400d06c48d94c347674344ed6ae5c5",
        "trellis/representations/mesh/flexicubes/LICENSE.txt",
        "prominent modification notice",
    ):
        if marker not in notice_text:
            issues.append(f"flexicubes_notice_incomplete:{marker}")

    mesh_source = source_text.get("trellis/representations/mesh/cube2mesh.py", "")
    for marker in ("torch.isfinite(vertices)", "torch.isfinite(vertex_attrs)", "Mesh face index is outside"):
        if marker not in mesh_source:
            issues.append(f"mesh_output_validation_missing:{marker}")

    if issues:
        raise ScanFailure(sorted(set(issues)))
    return {
        "schemaVersion": 1,
        "status": "static-policy-and-syntax-verified-runtime-not-executed",
        "verificationKind": "static-policy-and-syntax",
        "pythonFileCount": len(python_files),
        "externalImportRoots": sorted(external_roots),
        "internalImportCount": len(internal_imports),
        "runtimeImportsExecuted": False,
        "generationAllowed": False,
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: scan-trellis-patched-tree.py <tree-directory> <source-policy-path>")
    result = scan(Path(sys.argv[1]), Path(sys.argv[2]))
    sys.stdout.write(json.dumps(result, sort_keys=True, separators=(",", ":")) + "\n")


if __name__ == "__main__":
    try:
        main()
    except ScanFailure as error:
        sys.stderr.write(str(error) + "\n")
        raise SystemExit(1) from None
