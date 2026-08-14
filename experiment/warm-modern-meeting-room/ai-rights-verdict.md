# AI Rights Verdict

Verdict date: 2026-08-14.

Current verdict: `BLOCK` for generation. The stock TRELLIS package path is not
approved. A purpose-built image-to-raw-mesh path is only a conditional candidate
and remains blocked until its exact source tree, artifacts, dependency lock,
container digest, SBOM, security report, and provider terms snapshot receive a
human rights signoff.

This is a conservative technical rights record, not legal advice.

## Reviewed Revisions

| Item | Immutable revision | Declared license | Current result |
|---|---|---|---|
| FLUX.1-schnell model | `741f7c3ce8b383c54771c7003378a50191e9efe9` | Apache-2.0 model metadata | Conditional; gated access and exact artifact/dependency lock remain open |
| FLUX source | `802fb4713906133fcbd0d8dc5351620ca4773036` | Apache-2.0 | Conditional |
| TRELLIS source | `442aa1e1afb9014e80681d3bf604e8d728a86ee7` | MIT root license | Stock import path blocked by narrower file-level terms |
| TRELLIS-image-large | `25e0d31ffbebe4b5a97464dd851910efc3002d96` | MIT model-card metadata | Conditional; no standalone license file in the reviewed revision |
| Modified FlexiCubes | `815e075a2a400d06c48d94c347674344ed6ae5c5` | Apache-2.0 | Allowed only inside the pruned mesh path |
| DINOv2 candidate source | `b8931f7bf91576930313be2c6d6af376033b35f0` | Apache-2.0 | Conditional; not yet packaged or runtime-tested |

No model weights or input images were downloaded during this review.

## Hard Failure In The Stock TRELLIS Path

Calling `run(..., preprocess_image=False, formats=["mesh"])` does not isolate the
stock package sufficiently:

- `trellis/__init__.py` eagerly imports pipelines and all representations;
- the representation import reaches
  `trellis/representations/gaussian/general_utils.py`, whose file notice limits
  use to non-commercial research and evaluation;
- the image pipeline imports `rembg` even when preprocessing is disabled;
- the stock loader downloads all six decoder families, including unused
  Gaussian and radiance-field decoders;
- standard `to_glb` imports `nvdiffrast` and appearance-rendering code.

The following code or dependencies are prohibited in this experiment:

- `nvdiffrast`;
- `diffoctreerast`;
- `diff-gaussian-rasterization` and mip-splatting derivatives;
- TRELLIS Gaussian and radiance-field renderers;
- `trellis.utils.render_utils`;
- `trellis.utils.postprocessing_utils` and standard `to_glb`;
- Gaussian/RF checkpoints and `plyfile`;
- stock broad package initializers that import the prohibited paths.

## Conditional Mesh-Only Boundary

A future probe may be reconsidered only if a separately hashed source package:

1. exposes only the image pipeline, sparse structure decoder/flow, SLat flow,
   SLat mesh decoder, mesh extraction, and the modified FlexiCubes source;
2. replaces broad package initializers with narrow explicit imports;
3. removes `rembg`, text, Gaussian, radiance-field, renderer, training, demo,
   and dataset code;
4. loads exactly four local TRELLIS checkpoint families from the reviewed
   model revision;
5. replaces unpinned `torch.hub` with a local, hash-verified DINOv2 load;
6. runs with outbound network disabled and safetensors-only model loading;
7. serializes finite vertices, triangle indices, and optional vertex colors to
   binary little-endian PLY without `to_glb` or a rendering dependency;
8. uses an import denylist at static scan time and runtime, then asserts after
   inference that no prohibited module entered `sys.modules`;
9. records the complete OCI image digest, wheel hashes, native libraries,
   Syft SBOM, vulnerability scan, third-party notices, peak VRAM, and output
   hashes.

The four reviewed TRELLIS weight hashes are:

| Artifact | SHA-256 |
|---|---|
| `ss_dec_conv3d_16l8_fp16.safetensors` | `1c76d4a40519aa2d711cc263a8404105231ac26db31d946bed48b84fee79009a` |
| `ss_flow_img_dit_L_16l8_fp16.safetensors` | `96dc6bfd4136fd950af564dd16b4ae533c9ba6af8f26c670646b2a9f2789b1db` |
| `slat_flow_img_dit_L_64l8p2_fp16.safetensors` | `693fb2a58ad497bd222007301eeec49d14d60f8c12d2f2f00c221fa747b4c66c` |
| `slat_dec_mesh_swin8_B_64l8m256c_fp16.safetensors` | `3e87aba94b5786407eb06d0502c1ed0885a0027a3f2b8537bfe15b0a92c01859` |

These hashes identify artifacts; they do not themselves clear model training
data, output non-infringement, or redistribution.

## Open Security And Reproducibility Failures

- The official `dinov2_vitl14_reg` PyTorch artifact has no publisher-provided
  SHA-256. Its source URL and S3 version metadata must be captured, downloaded
  once in isolation, hashed, converted to safetensors, and stored by digest.
- TRELLIS upstream does not pin DINO source, DINO weights, or most Python
  dependencies.
- The upstream PyTorch 2.4 baseline is affected by CVE-2025-32434. The probe
  must be requalified on a patched PyTorch version, preferably 2.6 or newer;
  accepting the vulnerable baseline is not allowed.
- No final base image, CPython build, NVIDIA driver/runtime set, transitive
  wheel lock, patched-tree hash, or OCI digest exists yet.
- TRELLIS and DINO training-data provenance does not establish warranties for
  output ownership, exclusivity, non-infringement, trademarks, design rights,
  or memorization.

## Provider Terms Result

The candidate provider is raw Yandex Cloud Compute, not a managed AI API.
Reviewed public terms include:

- `https://yandex.ru/legal/cloud_oferta/`;
- `https://yandex.ru/legal/cloud_termsofuse/`;
- `https://yandex.ru/legal/cloud_dpa/ru/`;
- `https://yandex.ru/legal/cloud_terms_compute/`;
- `https://yandex.ru/legal/cloud_terms_storage/`;
- `https://yandex.cloud/ru/docs/overview/concepts/data-deletion`.

The public terms do not provide a blanket promise that every customer payload
or output is never used for training. Platform Terms section 4.6 permits use of
support communications, activity information, metadata, and service-consumption
information for service improvement, debugging, support, security, compliance,
and related model training. The DPA gives stronger purpose limitations for
personal data, but this experiment will not upload personal, private, branded,
or proprietary inputs.

Provider use is therefore conditional on all inputs being internal-original or
separately cleared CC0, non-personal, and non-sensitive. A dated copy of the
applicable account agreement and public terms must be stored in restricted
evidence before launch.

## Required Human Decision

The assigned public role is `experiment-sponsor`; the identity record remains
restricted. That owner must sign one of:

- `allow-pruned-probe`: every condition above is closed for the exact image;
- `deny`: the remaining model/data/provider risk is unacceptable;
- `defer`: evidence is incomplete, which has the same runtime effect as deny.

No signoff exists yet. Until it does, no FLUX or TRELLIS generation may run and
no model input may be uploaded to compute.
