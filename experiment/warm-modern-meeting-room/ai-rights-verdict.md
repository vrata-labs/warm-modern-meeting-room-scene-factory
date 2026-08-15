# AI Rights Verdict

Verdict date: 2026-08-15.

Current verdict: `BLOCK` for generation. The stock TRELLIS package path is not
approved. A deterministic source artifact for the purpose-built
image-to-raw-mesh path is now materialized and passes static policy and syntax
verification. The publisher Git revision, configs, and LFS pointer identities
for TRELLIS-image-large are also locked. The DINOv2 source Git objects, candidate
runtime source selection, and one publisher HEAD observation are now locked as
well. It remains
blocked because neither the selected TRELLIS payloads nor the DINO model payload
were downloaded or independently verified, runtime imports were not executed,
and dependency, container, SBOM, GPU, provider, and human-signoff gates are still
open.

This is a conservative technical rights record, not legal advice.

## Reviewed Revisions

| Item | Revision / locator | Declared license | Current result |
|---|---|---|---|
| FLUX.1-schnell model | `741f7c3ce8b383c54771c7003378a50191e9efe9` | Apache-2.0 model metadata | Conditional; gated access and exact artifact/dependency lock remain open |
| FLUX source | `802fb4713906133fcbd0d8dc5351620ca4773036` | Apache-2.0 | Conditional |
| TRELLIS source | `442aa1e1afb9014e80681d3bf604e8d728a86ee7` | MIT root license | Stock import path blocked by narrower file-level terms |
| TRELLIS-image-large | `25e0d31ffbebe4b5a97464dd851910efc3002d96` | MIT model-card metadata only | Publisher Git/LFS pointer identity locked; payload bytes and runtime compatibility unverified; no standalone license file |
| Modified FlexiCubes | `815e075a2a400d06c48d94c347674344ed6ae5c5` | Apache-2.0 | Allowed only inside the pruned mesh path |
| DINOv2 source | `b8931f7bf91576930313be2c6d6af376033b35f0` | Apache-2.0 root license with a conflicting repository README caveat | Source Git-object identity locked; repository-scope caveat and runtime qualification remain unresolved |
| DINOv2 ViT-L/14 reg4 weights | identity not established; publisher URL plus observed version ID `HLmbhvcd2hPq9CNLwMvwswbRlzZRuOeA` | Apache-2.0 model-card evidence only | One HEAD observation recorded; payload identity, redistribution review, derived runtime artifact, and strict-load qualification remain unresolved |

No model-weight payloads or input images were downloaded during this review.

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

## Materialized Mesh-Only Boundary

The separately hashed source artifact now implements these source-level
restrictions:

1. exposes only the image pipeline, sparse structure decoder/flow, SLat flow,
   SLat mesh decoder, mesh extraction, and the modified FlexiCubes source;
2. replaces broad package initializers with narrow explicit imports;
3. removes `rembg`, text, Gaussian, radiance-field, renderer, training, demo,
   and dataset code;
4. selects exactly the four mesh model families from the reviewed official
   six-entry manifest and ignores only its two known appearance decoders;
5. requires one pre-cleared RGBA input and one sample; the manifest must name
   `dinov2_vitl14_reg`, while the caller-injected module is not yet artifact-
   authenticated;
6. loads TRELLIS model state only from adjacent local JSON and safetensors files
   with a strict state dict;
7. rejects non-finite mesh vertices or attributes and out-of-bounds triangle
   indices before returning the mesh representation.

A future probe may be reconsidered only when the exact locked tree is used and
the remaining runtime and artifact controls are added and qualified:

1. use the locked candidate DINO runtime source selection and independently
   ingest and hash
   the still-unverified DINO payload rather than relying only on the injected
   module name or publisher metadata;
2. run with outbound network disabled, execute the runtime import denylist, and
   assert after inference that no prohibited module entered `sys.modules`;
3. validate and serialize finite vertices, triangle indices, and optional
   vertex colors to binary little-endian PLY without `to_glb` or rendering;
4. record the OCI image digest, wheel hashes, native libraries, Syft SBOM,
   vulnerability scan, complete notices, peak VRAM, and output hashes.

## Locked Upstream Source Selection

`trellis-source-selection-lock.json` now pins the reviewed TRELLIS commit, the
modified FlexiCubes submodule commit, and SHA-256 for 53 upstream source,
provenance, and license files selected for patch review. Its canonical selection
digest is
`5860f91b0fddd401f661f5a16ef2f224d3c6f712f73a2fb050fd547abcac8348`.
The complete policy semantics are bound by SHA-256
`9d41db04bbec3977c797751e671377df073b642726d2d1ca554ed5c7c385443c`.

The verifier rejects a nested repository root, remote mismatch, changed commit,
dirty or untracked checkout, changed gitlink/submodule, untracked selected file,
missing file, symlinked path, committed-blob/worktree hash drift, duplicate path,
or inconsistent selection digest. A local operator run passed against clean
checkouts of the reviewed revisions; this external checkout is not reproduced by
normal repository CI:

```bash
node scripts/verify-trellis-source-selection.mjs <trellis-checkout>
```

The source-selection lock remains a historical requirements-at-selection
record, so its `patchedSourceTreeDigest` entry remains in that lock's open-gate
list. Artifact readiness is recorded separately below.

## Materialized Patched Source Artifact

The shipping tree contains 50 regular `100644` files: 46 Python runtime files,
the TRELLIS and FlexiCubes licenses, an authored third-party notice index, and
the exact OpenAI GLIDE MIT license. Every one of the 53 selected inputs has one
`copy`, `patch`, or `omit` disposition in `artifact-lock.json`. The canonical
tree digest is
`e1f2d1caeabc0a9dc795ef9d7c72cffd1ee7ed5501d04a7f70743983ccdcd575`.
The exact selected-source to artifact-path/hash mapping is bound by SHA-256
`8af7c2b7de39b3bc9e256c6cc8cdbc66a89be5a8eb69496582e835726c2de2d4`.
The complete timestamp-free artifact semantics are bound by SHA-256
`816fcf72c8d4d7c57fe5d352824aa51b6ceec771611b3cdc8d2dae80dc419e51`.

The gate arrays inside that content-addressed artifact lock and the per-lock gate
arrays in `readiness.json` are historical snapshots from their respective lock
times. They therefore preserve gates that were open when each lock was made.
Only `readiness.json` `currentGateState` is the unified current state. It is
validated independently from the immutable per-lock snapshots and evaluates the
DINO `allOf` composition from its members. It marks the TRELLIS pointer-identity
gate and DINO source Git-object leaf resolved while keeping both payload
verification gates, the derived runtime artifact gate, and the DINO composite
gate open.

Normal CI can reproduce raw-byte hashes, sizes, modes, dispositions, both lock
digests, the source-to-artifact mapping, Python syntax parsing, internal module
paths and named imported-symbol references, the external import allowlist, and
structural source policy. This static verification does not prove Python or ML
runtime behavior, import TRELLIS, CUDA, spconv, xFormers, or model code, and is
not the offline runtime import test.

The source-level GLIDE issue is resolved for this tree: the attribution pins
commit `69b530740eb6cef69442d6180579ef5ba9ef063e`, and the exact upstream MIT
license has SHA-256
`86bbb73e855821d7c401912fd4bf82e34313e6e3b6fd6f909f2b6cc9e209a53b`.
The complete OCI third-party notice bundle remains open until all dependency
artifacts are locked. FlexiCubes `DCO.txt`, both upstream READMEs,
`.gitmodules`, and serialized attention are omitted from the shipping tree.
No weight payloads, model inputs, generated outputs, containers, or cloud
resources were added or created.

## Publisher Model Git/LFS Identity Lock

`trellis-model-artifact-lock.json` pins the exact publisher repository, commit
`25e0d31ffbebe4b5a97464dd851910efc3002d96`, SHA-1 tree
`867a6b9c2f0ddd5e72f999640bba55421655c2f9`, and all 19 regular `100644`
Git blobs. The inventory contains 11 normal blobs and eight canonical Git LFS
pointers. Its canonical inventory digest is
`e3d5763cedba5e2b9680ad4f57af044928a07d8d82fb93f25b27d5eabf2143f1`.
The complete timestamp-free lock semantics are bound by SHA-256
`d0046a083406c02dd67fd508b917750bc52f8e893527b4e39fa71abda0a6baa9`.

The six-entry pipeline manifest is locked to four selected mesh-path model
families and two ignored appearance decoders. The two encoder config/pointer
pairs are present in the publisher tree but ignored as unreferenced. The
manifest requires `dinov2_vitl14_reg` and eight-element SLat mean and standard
deviation arrays. Raw config and manifest blob hashes bind their complete
contents; this semantic check does not prove that a downloaded state dict has
the expected tensor keys, shapes, dtypes, or strict-load compatibility with the
patched source artifact.

The reviewed README front matter says `license: mit`, normalized here as MIT.
There is no standalone `LICENSE`, `LICENSE.txt`, or equivalent weight-license
file in this revision. This is model-card metadata evidence only, not an
independent conclusion that the weight payloads are licensed or approved for
launch.

The four selected publisher LFS pointer identities are:

| Artifact | Publisher LFS OID SHA-256 | Declared payload bytes |
|---|---|---:|
| `slat_dec_mesh_swin8_B_64l8m256c_fp16.safetensors` | `3e87aba94b5786407eb06d0502c1ed0885a0027a3f2b8537bfe15b0a92c01859` | 181903412 |
| `slat_flow_img_dit_L_64l8p2_fp16.safetensors` | `693fb2a58ad497bd222007301eeec49d14d60f8c12d2f2f00c221fa747b4c66c` | 1203755136 |
| `ss_dec_conv3d_16l8_fp16.safetensors` | `1c76d4a40519aa2d711cc263a8404105231ac26db31d946bed48b84fee79009a` | 147591972 |
| `ss_flow_img_dit_L_16l8_fp16.safetensors` | `96dc6bfd4136fd950af564dd16b4ae533c9ba6af8f26c670646b2a9f2789b1db` | 1130770840 |

Their declared total is 2664021360 bytes. These values came from publisher LFS
pointers, not from independently hashing payload bytes. The
`trellisModelArtifactLock` gate is resolved only at publisher commit, raw Git
blob, config, and LFS pointer identity level. The new
`trellisModelPayloadBytesVerification` gate remains open: the four selected
payloads must be ingested directly into restricted storage, independently
SHA-256 hashed and size-checked against these pointers, and retained by digest
before launch. Even closing that gate would not clear training-data, output
non-infringement, redistribution, tensor compatibility, runtime, or human
approval questions.

The no-checkout verifier reads only local Git objects with lazy fetch and Git
LFS smudge disabled. It removes inherited Git environment overrides, disables
global and system Git config, reads the literal local origin URL, verifies the
locked commit object and complete recursive tree/blob snapshot, and independently
recalculates SHA-1 object identities and raw SHA-256 content hashes. Parent
commit OIDs are syntax-checked but history is not traversed. Its local pass is
external evidence and is not reproduced by normal repository CI; CI validates
the canonical lock and its semantic relationships without cloning the publisher
repository. The verifier does not invoke Git LFS, read LFS payload bytes, execute
model runtime code, or permit network fallback.

## DINO Source And Publisher Metadata Lock

`dino-source-artifact-metadata-lock.json` records the DINOv2 repository locator
and pins commit
`b8931f7bf91576930313be2c6d6af376033b35f0`, SHA-1 tree
`39a04d481b50b484f72b1c43251efc0b2bcb5dd7`, and SHA-1 object format. Its
complete recursive snapshot has 174 files and 57 directories. The verifier
independently read and hashed one commit object, 58 tree objects, and all 174
blob objects. There are 173 regular `100644` files and one `100755` file,
`scripts/lint.sh`. The canonical complete-source content digest is
`8615fa3237c4123e4fe7fbb24511fa89ffc1bab74277f78134b6c27ee2971d57`.
The local origin URL is locator evidence, not signed publisher provenance; the
object identities and independently calculated raw content hashes provide the
content-integrity evidence.
The complete path, mode, and Git blob OID graph is also independently bound by
SHA-256
`e753c5e96b58032fa597d6d8b4e28163c376a244240fa793b2047a280b919848`.

The candidate verbatim runtime source selection contains exactly 12 files and
43510 bytes. It is not yet a proven import closure.
Its path-and-raw-SHA-256 selection digest is
`5d9fe22b05aad04a77e33b20faecf72a176fb0de5d977128127415196f87fd4d`.
It includes only `dinov2/__init__.py`, the narrow model initializers and vision
transformer, and the required `dinov2/layers` modules. It explicitly excludes
`hubconf.py` and `dinov2/hub/**`, which retain broad eager imports and the
publisher network loader.

The future project-owned offline constructor is locked to
`dinov2.models.vision_transformer.vit_large` for model ID
`dinov2_vitl14_reg`, with `img_size=518`, `patch_size=14`,
`init_values=1.0`, `ffn_layer=mlp`, `block_chunks=0`, four register tokens,
interpolation antialiasing enabled, and interpolation offset `0.0`. State must
come from a project-owned local file and load strictly. This record does not
execute Python or import PyTorch, `torch.hub`, DINO, or TRELLIS, and it does not
establish runtime compatibility.

Eight evidence records bind raw Git OID, byte size, and SHA-256 for the root
license, model card, README, broad Hub entry point, publisher backbone loader,
publisher base URL helper, vision transformer, and ChannelAdaptive-DINO
documentation. The root `LICENSE` and `MODEL_CARD.md` state Apache-2.0 evidence,
and the root license SHA-256 is
`600cc67cc4cb2f5ea317dcfc687ad1c74dc4bec8782bbe9db0afd83513b935b7`.
However, the pinned tree contains one ChannelAdaptive-DINO README but no
referenced `LICENSE_CELL_DINO`, ChannelAdaptive-DINO code, or associated model
weights. That README broadly says repository contents, including code and model
weights, are intended for research use only. It first says code is coming soon,
later says CellDINO code "is released" under "CC by NC" despite the absent
referenced license, and says model weights "will be released" under the FAIR
Non-Commercial Research License. These conflicting and incomplete statements sit
outside the candidate runtime source selection, but their broad wording creates
an unresolved repository-scope question for human review. They are not
normalized here into a confirmed license identifier or treated as a license or
launch approval.

The publisher artifact URL is
`https://dl.fbaipublicfiles.com/dinov2/dinov2_vitl14/dinov2_vitl14_reg4_pretrain.pth`.
A single zero-redirect HEAD observation recorded status 200, content type
`binary/octet-stream`, content length 1217607321, Last-Modified
`Fri, 27 Oct 2023 10:37:32 GMT`, version ID
`HLmbhvcd2hPq9CNLwMvwswbRlzZRuOeA`, multipart ETag
`"b6cbe2bf3ce2f370d5a67bcd465144b0-146"`, byte ranges, and AES256 server-side
encryption. The ETag is not SHA-256 and the version ID is opaque publisher
metadata. Both publisher and observed payload SHA-256 remain null. No GET, range
fallback, or redirect was permitted. The verifier destroyed the response after
headers without entering body-flow mode; no response-body bytes were delivered
to verifier code, while a wire-level zero-byte claim is intentionally not made.

The complete timestamp-free DINO lock semantics are bound by SHA-256
`d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9`.
Only `dinoSourceGitObjectLock` is resolved. The
`dinoArtifactPayloadBytesVerification` leaf remains open, and
`dinoSourceAndArtifactLock` remains an open `allOf` identity composition of those
two leaves. Closing the payload leaf requires a repeated zero-redirect metadata
check, restricted ingestion of the raw PTH, independent byte-length and SHA-256
verification, and digest retention. It does not qualify a converted runtime
artifact or strict loading. Any safetensors derivative requires a separate
content-addressed artifact record under the open
`dinoDerivedRuntimeArtifactLock`, tensor-equivalence evidence, and the still-open
offline runtime qualification before use.

The direct source run and explicit HEAD-only run passed at
`2026-08-15T09:59:50Z`. They are external local evidence and are not reproducible
in normal CI. Normal CI validates only canonical lock semantics, relationships,
digests, boundaries, and gate composition; it does not clone external source or
perform the publisher HEAD. Neither external check makes a payload, license,
runtime, generation, or human-approval claim. Runner egress is not itself a
sandbox boundary; accidental-network prevention remains part of the open offline
runtime qualification.

## Open Security And Reproducibility Failures

- The selected TRELLIS LFS payload bytes have not been downloaded, independently
  hashed, or tested for strict state-dict and tensor compatibility. The
  `trellisModelPayloadBytesVerification` gate remains mandatory before launch.
- No publisher SHA-256 was found in the reviewed pinned evidence or the recorded
  HEAD observation for the official `dinov2_vitl14_reg` PyTorch artifact. Its URL
  and observed HEAD metadata are locked, but the 1217607321 payload bytes must
  still be ingested once in isolation, independently hashed, and stored by
  digest. A later safetensors conversion must receive its own digest and
  tensor-equivalence record before `dinoDerivedRuntimeArtifactLock` can close.
- TRELLIS upstream does not pin DINO source, DINO weights, or most Python
  dependencies. The project lock now compensates for source identity only; the
  weight and dependency gates remain open.
- The single ChannelAdaptive-DINO README in the complete DINO source snapshot
  contains broad research-only wording, contradictory present/future code
  statements, an absent referenced "CC by NC" license, and a future FAIR
  Non-Commercial weight statement, creating an unresolved scope question outside
  the candidate source selection.
- The upstream PyTorch 2.4 baseline is affected by CVE-2025-32434. The probe
  must be requalified on a patched PyTorch version, preferably 2.6 or newer;
  accepting the vulnerable baseline is not allowed.
- No final base image, CPython build, NVIDIA driver/runtime set, transitive
  wheel lock, or OCI digest exists yet. No dependency installation or real
  runtime import qualification has been performed for the materialized tree.
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
