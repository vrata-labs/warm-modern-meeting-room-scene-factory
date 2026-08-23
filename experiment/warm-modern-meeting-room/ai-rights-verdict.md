# AI Rights Verdict

Verdict date: 2026-08-22.

Current verdict: `BLOCK` for generation. The stock TRELLIS package path is not
approved. A deterministic source artifact for the purpose-built
image-to-raw-mesh path is now materialized and passes static policy and syntax
verification. The publisher Git revision, configs, and LFS pointer identities
for TRELLIS-image-large are also locked. The four selected raw TRELLIS payload
byte identities now independently match their publisher LFS pointer OIDs and are
point-in-time attested as restricted-retained. The DINOv2 source Git objects,
candidate runtime source selection, and one publisher HEAD observation are
locked as well. The raw opaque DINO publisher PTH byte identity is independently
verified and restricted-retained. Its state dict was read only inside an
isolated CPU conversion environment with patched PyTorch `2.7.1+cpu`,
`weights_only=True`, no network, and no cloud credentials. The resulting
safetensors artifact is content-addressed, restricted-retained, reproducible
across two conversion runs, and bound to an exact 344-tensor manifest and
byte-level tensor-equivalence record. A revised mesh-only tree defers its dense
mesh grid and FlexiCubes device allocation until mesh extraction. The complete
41-wheel CUDA 11.8 runtime set is content-addressed and offline-installable;
PyTorch `2.7.1+cu118` passed a synthetic weights-only security regression. In a
separate no-network run, all 58 expected DINO/TRELLIS modules imported and the
DINO state plus all four selected TRELLIS states strict-loaded with no missing
or unexpected keys. No model forward, model input, CUDA initialization,
inference, or generation occurred. Generation remains blocked because final
OCI, SBOM/vulnerability, GPU parity/VRAM, provider snapshot, complete notices,
rights, and human-signoff gates remain open.

This is a conservative technical rights record, not legal advice.

## Reviewed Revisions

| Item | Revision / locator | Declared license | Current result |
|---|---|---|---|
| FLUX.1-schnell model | `741f7c3ce8b383c54771c7003378a50191e9efe9` | Apache-2.0 model metadata | Conditional; gated access and exact artifact/dependency lock remain open |
| FLUX source | `802fb4713906133fcbd0d8dc5351620ca4773036` | Apache-2.0 | Conditional |
| TRELLIS source | `442aa1e1afb9014e80681d3bf604e8d728a86ee7` | MIT root license | Stock import path blocked by narrower file-level terms |
| TRELLIS-image-large | `25e0d31ffbebe4b5a97464dd851910efc3002d96` | MIT model-card metadata only | Four selected raw payload identities match the publisher LFS pointers and strict-load against the revised mesh-only source; rights approval and human signoff remain unresolved; no standalone license file |
| Modified FlexiCubes | `815e075a2a400d06c48d94c347674344ed6ae5c5` | Apache-2.0 | Allowed only inside the pruned mesh path |
| DINOv2 source | `b8931f7bf91576930313be2c6d6af376033b35f0` | Apache-2.0 root license with a conflicting repository README caveat | Source Git-object identity and exact 12-file runtime selection locked; offline import and strict-load qualification pass; repository-scope rights caveat remains unresolved |
| DINOv2 ViT-L/14 reg4 weights | raw opaque PTH SHA-256 `36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51`; derived safetensors SHA-256 `30e20dce587ad621a8dfc20e4ed66198d2998974928d44f06a6baf7732503dcc`; publisher URL transitively bound through the historical source lock | Apache-2.0 model-card evidence only | Raw identity, isolated weights-only conversion, derived artifact identity, exact tensor equivalence, and strict source-compatible load locked; redistribution, rights approval, and human signoff remain unresolved |

No model input images were downloaded. The DINO raw publisher payload, its
derived safetensors artifact, and four selected raw TRELLIS payloads were
acquired or created and retained outside public Git under the point-in-time
controls recorded below; all known local model-byte copies were then deleted.

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

A future probe may be reconsidered only with the exact qualified tree, DINO
module, wheel set, and model payloads. Identity, dependency, offline import, and
strict-load controls are now closed; the remaining probe controls are:

1. assemble and lock the final OCI image, native-library inventory, Syft SBOM,
   vulnerability scan, and complete dependency notice bundle;
2. obtain provider snapshot, rights approval, human signoff, GPU quota, budget,
   launch approval, and an independently verified teardown guard;
3. run with outbound network disabled, inject only the strict-loaded qualified
   DINO module, enforce the runtime audit policy, and assert after inference that
   no prohibited module entered `sys.modules`;
4. validate and serialize finite vertices, triangle indices, and optional
   vertex colors to binary little-endian PLY without `to_glb` or rendering;
5. record GPU parity, peak VRAM, and output hashes under the approved cost cap.

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

That base lock remains immutable. `artifact-revision-lock.json` replaces only
`trellis/representations/mesh/cube2mesh.py`: FlexiCubes and the dense regular
grid are now created on the first mesh extraction call using the input tensor's
device, rather than during model construction. The revised full tree digest is
`8518acfc2e55e789b30305d6703b5e76a082849c8e1860fb37bae0b45e87b2ff`,
the revised source-to-artifact digest is
`eafe70e85740c2df70e7e15e2d52c0f800d3e3df3b94972140f5e26e2cd9d799`,
and the revision-lock semantic digest is
`03a3bc8fdbfd36fc42f46213ef16aad17ff5dd36b75bd245d2a80e96bab7a916`.

The gate arrays inside that content-addressed artifact lock and the per-lock gate
arrays in `readiness.json` are historical snapshots from their respective lock
times. They therefore preserve gates that were open when each lock was made.
Only `readiness.json` `currentGateState` is the unified current state. It is
validated independently from the immutable per-lock snapshots and evaluates the
DINO `allOf` composition from its members. It marks the TRELLIS pointer-identity
and selected-payload byte-identity leaves, DINO source Git-object leaf, DINO raw
payload byte-identity leaf, DINO derived runtime artifact leaf, dependency wheel
lock, patched PyTorch qualification, offline runtime qualification, and the DINO
`allOf` composite resolved. The TRELLIS payload lock resolves no composite gate.

Normal CI can reproduce raw-byte hashes, sizes, modes, dispositions, both lock
digests, the source-to-artifact mapping, Python syntax parsing, internal module
paths and named imported-symbol references, the external import allowlist, and
structural source policy. This static verification does not prove Python or ML
runtime behavior, import TRELLIS, CUDA, spconv, xFormers, or model code. The
separate offline runtime qualification below supplies that evidence without
changing this static verifier's claim.

The source-level GLIDE issue is resolved for this tree: the attribution pins
commit `69b530740eb6cef69442d6180579ef5ba9ef063e`, and the exact upstream MIT
license has SHA-256
`86bbb73e855821d7c401912fd4bf82e34313e6e3b6fd6f909f2b6cc9e209a53b`.
The complete OCI third-party notice bundle remains open until notices are
assembled from the now-locked dependency set. FlexiCubes `DCO.txt`, both upstream READMEs,
`.gitmodules`, and serialized attention are omitted from the shipping tree.
No weight payloads were added to public Git, and no model inputs, generated
outputs, containers, or compute resources were added or created. The raw DINO
payload and four selected raw TRELLIS payloads are retained only under the
point-in-time restricted-storage attestations described below.

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

Their declared total is 2664021360 bytes. In this historical model-artifact lock,
these values came from publisher LFS pointers rather than independently hashing
payload bytes. The historical `trellisModelArtifactLock` gate is resolved only
at publisher commit, raw Git blob, config, and LFS pointer identity level, and
its snapshot correctly leaves `trellisModelPayloadBytesVerification` open. The
separate payload lock below records the later byte-identity result without
mutating this historical lock. Closing that leaf does not clear training-data,
output non-infringement, redistribution, tensor compatibility, runtime, rights,
or human-approval questions.

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

## TRELLIS Selected Payload Byte-Identity Lock

`trellis-payload-bytes-lock.json` is a separate timestamp-free canonical public
lock. It references the unchanged historical model-artifact lock by public path
and semantic SHA-256, thereby binding publisher repository
`https://huggingface.co/microsoft/TRELLIS-image-large`, exact commit
`25e0d31ffbebe4b5a97464dd851910efc3002d96`, and the selected LFS pointers. Its
complete semantics are bound by SHA-256
`d140f277f756f845aa8ad5d83960fb1bb70d640dcb7aa2c43460901f6ab8839d`.

Each selected payload was acquired by direct GET from its commit-pinned resolve
path with `Accept-Encoding: identity` and no Range request. Each request followed
one 302 redirect to a final 200 response with content type
`application/octet-stream` and `Accept-Ranges: bytes`. Each initial 302 response
reported `x-linked-size` equal to the exact payload byte length and an exact
quoted `x-linked-etag` equal to the publisher LFS SHA-256:

| Artifact | Exact bytes | Publisher LFS / observed SHA-256 | Final ETag |
|---|---:|---|---|
| `slat_dec_mesh_swin8_B_64l8m256c_fp16.safetensors` | 181903412 | `3e87aba94b5786407eb06d0502c1ed0885a0027a3f2b8537bfe15b0a92c01859` | `"90cbb9469e3bb19934ab40a8cec5331b88323c0636b89139383b632d396503cb"` |
| `slat_flow_img_dit_L_64l8p2_fp16.safetensors` | 1203755136 | `693fb2a58ad497bd222007301eeec49d14d60f8c12d2f2f00c221fa747b4c66c` | `"48327f38cd327356fd2fe0a413429b8f9dfc7cc1a9ca4564b2ec9291c73bfb76"` |
| `ss_dec_conv3d_16l8_fp16.safetensors` | 147591972 | `1c76d4a40519aa2d711cc263a8404105231ac26db31d946bed48b84fee79009a` | `"6ac386147a7d3c547af80d0f813e4d4a380e514ac0c1e3a9096ae60c94a497e1"` |
| `ss_flow_img_dit_L_16l8_fp16.safetensors` | 1130770840 | `96dc6bfd4136fd950af564dd16b4ae533c9ba6af8f26c670646b2a9f2789b1db` | `"2235ba5568195f3ac0ef7eb16f46e596a6a93c5cdf409004130a50cc1f032126"` |

The exact total is 2664021360 bytes. `sha256sum` and OpenSSL independently
matched every raw response body to its publisher LFS pointer OID. No
safetensors parsing, deserialization, model input, runtime execution, or
generation occurred.

At the external record time `2026-08-20T12:46:45Z`, operator evidence covered
four content-addressed objects with SSE-KMS AES-256, versioning disabled,
owner-only object ACLs, no bucket ACL grants beyond the owner, static-key
authentication disabled, and anonymous read, list, and configuration access all
disabled. Live unauthenticated checks returned HTTP 403. Full object readback
matched every exact size and SHA-256, and incomplete multipart uploads were zero.
Known local payload deletion was verified at `2026-08-20T12:44:28Z`. These are
point-in-time operator attestations, not continuing public proof of storage
state.

Before the successful explicit put-object path, one canned-ACL attempt was
rejected before transfer and a separate copy path left four incomplete multipart
uploads. All four were detected and aborted. No private bucket, KMS, object-key,
resource, principal, credential, or other restricted locator is published. The
restricted schema-version-3 operator record was fully read back; its raw-record
SHA-256 is
`33f033da362875c9332613183ac8398ef886b7b7c0de768a739f71167e1306ab`.

Only `trellisModelPayloadBytesVerification` is directly resolved. There is no
composite gate effect. At that historical lock time, the snapshot resolved
exactly the DINO payload leaf, DINO source leaf and their composite, patched
source tree, TRELLIS model artifact leaf, and TRELLIS payload leaf. The DINO
derived runtime artifact was still open in that immutable snapshot and was
resolved only by the later lock below.

The normal-CI invocation of this verifier validates only the canonical public
lock, its self-digest, and its relationship to the historical public model lock.
This verifier invocation does not access real payloads or the restricted
operator record, initiate payload or network requests, allow network fallback,
or reproduce the real payload hashes. This does not claim that the complete
normal CI workflow is network-free. CI exercises optional streaming verification
only with small synthetic fixtures. On Linux, the explicit `--payload-dir` mode
uses bounded descriptor-anchored directory enumeration and child access, streams
the four expected regular files as logical bytes, and rejects missing or extra
selection, size or hash drift, nonregular input, symlink components, and
path/inode changes. It fails closed where descriptor-relative access is
unavailable. It does not parse safetensors and makes no claim about runner
network isolation or physical sparse allocation.

This identity lock does not establish tensor keys, shapes, dtypes, strict-load
compatibility, runtime safety, license or redistribution approval, model-input
approval, output rights, human signoff, or permission to generate.

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

The complete timestamp-free historical DINO source lock semantics are bound by SHA-256
`d20a7721c8618b557f7b93ae0d88914a46eee25d4db0af071b2e6651c030faf9`.
Its historical gate snapshot remains unchanged: only `dinoSourceGitObjectLock`
was resolved, while `dinoArtifactPayloadBytesVerification` and the
`dinoSourceAndArtifactLock` `allOf` composite were open. The separate raw payload
lock below records their later resolved state. Neither historical lock qualifies
a converted runtime artifact or strict loading. The separate derived-artifact
lock below now records the safetensors identity and tensor equivalence. Offline
runtime qualification remains open.

The direct source run and explicit HEAD-only run passed at
`2026-08-15T09:59:50Z`. They are external local evidence and are not reproducible
in normal CI. Normal CI validates only canonical lock semantics, relationships,
digests, boundaries, and gate composition; it does not clone external source or
perform the publisher HEAD. Neither external check makes a payload, license,
runtime, generation, or human-approval claim. Runner egress is not itself a
sandbox boundary; accidental-network prevention remains part of the open offline
runtime qualification.

## DINO Raw Payload Byte-Identity Lock

`dino-payload-bytes-lock.json` is a separate immutable public lock. It references
the historical source lock by public path and SHA-256 rather than mutating it or
duplicating the publisher URL. The complete timestamp-free payload-lock semantics
are bound by SHA-256
`72da7b8d42e33ba0f7632018cf9766e93ac5e62892b51023b755ce25db56f55b`.
The external verification completed at `2026-08-20T09:04:22Z`; the restricted
payload upload completed at `2026-08-20T08:46:24Z`. Those operational timestamps
are readiness evidence and are intentionally outside the content-addressed lock.

Immediately before acquisition, a zero-redirect HEAD exactly matched the
historical source lock. One direct GET returned status 200 with zero redirects,
no Range request, `Accept-Encoding: identity`, and one response block. Its exact
bound headers were:

| Header | Exact value |
|---|---|
| `accept-ranges` | `bytes` |
| `content-length` | `1217607321` |
| `content-type` | `binary/octet-stream` |
| `etag` | `"b6cbe2bf3ce2f370d5a67bcd465144b0-146"` |
| `last-modified` | `Fri, 27 Oct 2023 10:37:32 GMT` |
| `x-amz-server-side-encryption` | `AES256` |
| `x-amz-version-id` | `HLmbhvcd2hPq9CNLwMvwswbRlzZRuOeA` |

`content-encoding`, `content-range`, `location`, and `transfer-encoding` were
absent. The response body was retained as an opaque raw PTH with exact length
1217607321 and independently observed SHA-256
`36e4deffbaef061a2576705b0c36f93621e2ae20bf6274694821b0b492551b51`.
Both `sha256sum` and OpenSSL independently produced that digest. The publisher
did not supply SHA-256, so `publisherSha256` remains null; this is not a
publisher-hash-verified claim.

At the recorded verification time, operator evidence showed that the
content-addressed object was retained under approved restricted policy with
SSE-KMS AES-256, versioning disabled, owner-only object ACL, no bucket ACL
entries, static-key authentication disabled, and anonymous read, list, and
configuration access disabled. Unauthenticated read, list, and configuration
checks each returned HTTP 403. Full retained-object readback reproduced the
exact length and SHA-256. There were zero incomplete multipart uploads, and all
known local payload copies were deleted. No bucket, object key or URL, KMS
identifier, IAM principal, or credential is public. These are point-in-time
operator attestations, not public proof of continuing storage state.

The restricted operator record is schema version 2 and was fully read back under
evidence retention. Its raw-record SHA-256 is
`55d6dcbe1321068ac82a4c2e2f07f2faabd803e86693ec809044724b5d6a91da`.
The public lock binds this digest and restricted visibility, not the record
locator.

At this historical payload-lock step, the
`dinoArtifactPayloadBytesVerification` leaf was directly resolved. Because
`dinoSourceGitObjectLock` was already resolved, the mechanically evaluated
`dinoSourceAndArtifactLock` `allOf` composite is now resolved as well. The
identity result did not resolve `dinoDerivedRuntimeArtifactLock` or any other
non-identity gate. That historical snapshot remains unchanged.

Normal CI scope is
`canonical-public-lock-only/no-payload-or-restricted-record-access`: it validates
canonical JSON, the self-digest, source-lock relationship, gates, and boundaries
without payload or restricted-record access and without initiating network
requests. An optional explicit local-file verifier streams logical bytes,
length, and SHA-256 only. It rejects paths containing symlink components,
non-regular files, path or inode drift, size drift, and hash mismatch without
deserializing the PTH. It makes no claim about external runner egress controls or
the local file's physical allocation.

No PTH inspection, deserialization, source-weight compatibility test, derived
artifact creation, tensor-equivalence test, runtime execution, model-input use,
generation, rights approval, or human signoff occurred while creating that raw
payload lock. Pickle-backed PTH content can be unsafe to deserialize. The later
isolated conversion below does not retroactively change this historical claim.
The raw payload is not called approved, licensed, runtime-ready, or
publisher-hash-verified.

## DINO Derived Runtime Artifact Lock

`dino-derived-runtime-artifact-lock.json` is a new immutable public lock that
references the raw payload lock by path and SHA-256. Its complete timestamp-free
semantics are bound by SHA-256
`947b7b7adb9bcde2d6c63948e789d6b8236045f05d3c8688a2062e20e60b8bb6`.
The separate public tensor manifest is bound by SHA-256
`1b3d3e1878c99c5f271931e257961091a049af65b4b4ff5c7602bc72b6087a83`.
Neither public record contains a storage locator, credential, KMS identifier,
local path, model payload, or derived artifact bytes.

The exact converter source is bound by SHA-256
`1b8d57d01b421a5a3448d87be05ab16c4cd8d2f1078cff8ef2d36986a1a4397b`.
It ran as a non-root user in a read-only Linux amd64 container bound by digest
`sha256:d1fca38316e82fb61c19eefa6587900f12c5b675c723ce6472568f84af59c7c2`.
The container had no network, no cloud credentials, no capabilities, and
`no-new-privileges`; only one read-only input file and a separate output
directory were mounted. The converter used Python `3.12.11`, patched PyTorch
`2.7.1+cpu`, safetensors `0.5.3`, CPU map location, and
`weights_only=True`. It copied and hashed the input once into a sealed memfd, then
deserialized only those immutable bytes. The private output directory mode was
`0700`; container limits were 12 GiB memory, 4 CPUs, and 128 PIDs under Docker's
default seccomp profile. All twelve conversion-only wheels are individually
bound by filename, length, and SHA-256. This conversion environment does not
close the production `dependencyWheelHashLock`, `patchedPytorchQualification`,
or `ociImageDigest` gates.

The raw 1217607321-byte PTH matched its existing locked SHA-256 before both
conversion runs. Both runs produced one metadata-free 1217523408-byte
safetensors file with SHA-256
`30e20dce587ad621a8dfc20e4ed66198d2998974928d44f06a6baf7732503dcc`.
The artifact has a 32456-byte header with SHA-256
`5769bfb92118023630e6c2eccc5f7099a2ddb9b0514e5f4a3cf32db955e1466a`
and 1217490944 tensor-data bytes. The two artifacts were byte-identical.

The public manifest contains 344 ASCII-sorted tensor records with exact names,
dtypes, shapes, element counts, byte lengths, data offsets, and per-tensor
SHA-256 values. Its tensor-identity digest is
`6423b9afd5bcdb42dc69123dcddf203d6534cab0b26d1c09a5d184d18efb3d63`;
its exact safetensors-layout digest is
`ba5e1d272ac2691f269385976e9f33b84159d598de9233987aca302a5dcd33aa`.
The source and derived key sets, dtypes, shapes, and canonical contiguous tensor
bytes matched exactly, with zero missing, extra, non-tensor, or mismatched
entries. This is exact equivalence, not a tolerance-based numerical comparison.

The derived artifact and both conversion reports were retained outside public
Git under SSE-KMS AES-256, disabled versioning and static-key authentication,
an empty object ACL grant list, and disabled anonymous read, list, and
configuration access. Unauthenticated checks returned HTTP 403. Full artifact
readback matched length and SHA-256, both report readbacks matched their exact
bytes, and multipart-upload listing was empty. All known local raw and derived
model-byte copies were deleted. The schema-version-2 restricted operator record
was also fully read back; its raw SHA-256 is
`f1485bb09f93a7fa1bf13f04710d74b2c5d142b76305c482b9154ffcee0f28c4`.
These are point-in-time operator attestations, not continuing public proof.

The lock directly resolves only `dinoDerivedRuntimeArtifactLock`. It does not
execute the DINO constructor, strict `load_state_dict`, TRELLIS imports, model
inference, a model input, GPU code, or generation. It does not resolve any
composite or unrelated gate. Normal CI validates only the public lock, manifest,
converter source hash, historical relationships, and gate boundaries without
model bytes, restricted records, converter execution, or network access.

## Production Runtime Wheel Lock

`dependency-wheel-hash-lock.json` binds one complete 41-wheel CPython 3.12.11,
Linux x86-64, CUDA 11.8 set totaling 3036864277 bytes. The complete inventory
digest is
`7ef3a07c4d9e0d62b4dfca3eff1bcb639d4747a6048f91422320add47d32bc9c`,
and the lock semantic digest is
`2e46abb1fa9804656de205e7db3d54e2671906d16fb056e3c9f2b6edc3662198`.
Every wheel record binds filename, normalized distribution, version, byte
length, SHA-256, METADATA and WHEEL hashes, tags, Python requirement, and exact
Requires-Dist strings. Target-specific tags, direct requirements, transitive
requirements, markers, and extras are validated independently. A clean
`--network=none --no-index --only-binary --no-compile` install was
operator-attested; its local-wheelhouse pip report was verified with no missing
dependencies, conflicts, unsupported wheels, sdists, or source builds. The
attestor matched 16309 hashed wheel RECORD entries to 16397 installed files and
1152 directories, rejecting symlinks, special files, unowned files, and extra
directories.

The first resolver attempt selected an ABI-compatible xformers wheel from PyPI
that was actually built for CUDA 12.6. Offline import rejected it on
`libcudart.so.12`; that unaccepted restricted-storage prefix was deleted. The
accepted set instead binds the PyTorch CUDA 11.8 index wheel with SHA-256
`c938925b2fed8641efc62ac8fec98e56cb3f78f40c25d2e768654b99fdb05d0c`.
The accepted wheel set and reports were fully read back from restricted SSE-KMS
storage. No wheel bytes or private locators are in public Git.
The schema-version-3 dependency operator record was fully read back with raw
SHA-256
`f149291f1b60aa3ebf56adc4be2985700636f7811b42bdb12f82478ab2b2c6a3`.

## Patched PyTorch Qualification

`patched-pytorch-qualification-lock.json` binds the exact
`torch-2.7.1+cu118` wheel SHA-256
`91454dcfdb81f181fdf216d6d6d9912fbd8795578b90384b3b8b8132737072bb`
and has semantic digest
`5e1ab0cae4a4161da26f541638e8b763e2fdd8dc81ca901f02540fae5f604d69`.
The qualification is tied to CVE-2025-32434 / GHSA-53q9-r3pm-6pq6, first fixed
in 2.6.0 by commit
`8d4b8a920a2172523deb95bf20e8e52d50649c04`. In a no-network, non-root,
read-only-root environment, a safe synthetic state dict round-tripped with
`weights_only=True`; a malicious legacy tar was rejected before unpickling and
its side-effect sentinel was absent. No application runtime or model artifact
was read by this security harness. Before importing torch, the harness rehashed
the entire attested runtime site and matched 11011 installed torch files to the
exact locked wheel. The schema-version-3 PyTorch operator record was fully read
back with raw SHA-256
`0b6fa69f5be1c18a539344e72d83b6933ae9df0cc1d2a19ac164af485cbc4a9b`.

## Offline Import And Strict-Load Qualification

`offline-runtime-qualification-lock.json` has semantic digest
`ba9ef8896650ad1704100671f33ae52045fdcdd980e053e401e1fe8e0843ef79`.
It binds the revised TRELLIS tree, exact 12-file DINO selection, dependency and
PyTorch locks, five model metadata blobs, four TRELLIS payloads, and the DINO
derived safetensors artifact. All 58 expected project modules imported. No
prohibited mesh-path module or torch Hub call was observed. All TRELLIS and DINO
module origins matched their locked source trees, and the complete installed
runtime site was rehashed again before imports. Python audit events recorded no
successful audited process launch or socket operation; the run also observed a
loopback-only network namespace, seccomp filter, zero effective capabilities,
read-only inputs, and no cloud credentials. Locked cumm 0.7.11 attempted one import-time
`nvcc --version` probe; the audit hook blocked `subprocess.Popen` before launch,
and only that exact caught attempt is accepted.

The DINO 344-tensor state and all four selected TRELLIS model families loaded
strictly with zero missing or unexpected keys. Peak process RSS was 3861208
KiB. Dense mesh-grid allocation remained deferred. The run used no model input,
did not call any top-level model forward, did not initialize CUDA, and performed
no inference, output creation, or generation. Temporary local model payload
copies were deleted after qualification. This result does not establish GPU
parity, final OCI composition, SBOM status, rights, or launch approval.
The schema-version-3 offline-runtime operator record was fully read back with
raw SHA-256
`f9696cfd60fdb6577c707e24f523e80513236a3aa9a47e1922bd25e4a9a573d9`.

## Open Security And Reproducibility Failures

- The four selected TRELLIS raw payload byte identities now match their publisher
  LFS pointer SHA-256 values and strict-load against the revised source, but this
  does not establish model-card scope, redistribution rights, model-input or
  output rights, generation approval, or human signoff.
- No publisher SHA-256 was found in the reviewed pinned evidence, HEAD, or GET
  metadata for the official `dinov2_vitl14_reg` PyTorch artifact. The raw
  1217607321-byte payload has only the independently observed SHA-256 and
  restricted full-readback evidence. The derived safetensors identity and tensor
  equivalence are now locked, but publisher-hash verification remains absent.
- TRELLIS upstream does not pin DINO source, DINO weights, or most Python
  dependencies. The project locks now compensate for source, raw weight, and
  derived artifact identity, dependency closure, and strict-load compatibility;
  source-versus-weight rights remain open.
- The single ChannelAdaptive-DINO README in the complete DINO source snapshot
  contains broad research-only wording, contradictory present/future code
  statements, an absent referenced "CC by NC" license, and a future FAIR
  Non-Commercial weight statement, creating an unresolved scope question outside
  the candidate source selection.
- PyTorch `2.7.1+cu118` and the full transitive wheel set are qualified for the
  recorded import and strict-load scope, but no final OCI image digest, NVIDIA
  driver qualification, Syft SBOM, or complete vulnerability result exists yet.
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
