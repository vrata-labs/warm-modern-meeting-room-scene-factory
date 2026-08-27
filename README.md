# Warm Modern Meeting Room Scene Factory

Isolated research and pilot tooling for the warm-modern meeting-room A/B
experiment. This repository is intentionally room-specific. It is not a
service, a generic scene platform, or a container for scene binaries.

The normative implementation plan lives in
`vrata-labs/platform/docs/plans/2026-08-12-warm-modern-meeting-room-ab-scene-factory.md`.

## Repository Boundary

This repository owns:

- the shared creative and functional brief;
- the pilot style bible and schemas;
- fairness, scorecard, time, yield, and readiness records;
- pilot compiler and reporting code after the AI feasibility gate;
- full-SHA locks for the two independent scene repositories.

This repository must not contain:

- `.blend`, `.glb`, `.gltf`, texture, preview, or other scene binaries;
- a release directory under `assets/scenes`;
- restricted references, raw model outputs, or credentials;
- work for another room or product project.

Scene artifacts live separately in:

- `vrata-labs/warm-modern-meeting-room-candidate-01`;
- `vrata-labs/warm-modern-meeting-room-candidate-02`.

Candidate numbers are neutral production identifiers. They do not encode the
curated/AI track or the later random `Alpha`/`Beta` review mapping.

## Current Gate

Restricted reference storage is private, bounded, encrypted, and ready.
`reference-ledger.json` contains metadata for 16 reviewed sources, with 12
human-only selections and no retrieved files or approved model inputs. The
style bible and `style-sheet.md` were approved at the art-direction gate on
2026-08-14. The approval covers principles and measurable rules only; it does
not license reference images or approve model inputs.

Internal pruned TRELLIS generation is allowed only for the exact locked boundary
and project-authored inputs. Chair and window/trim component probes passed on
disposable Tesla T4 instances, all probe resources were deleted, and the required
two-of-three AI feasibility threshold is green. This unblocks Stage 3 contract
and compiler work. Production/public publication remains blocked on DINO/model
rights, OCI/SBOM/notices, provider snapshot, billing reconciliation, and separate
publication signoff.

The Stage 3 contract defines exact scene, asset-ledger, generation-ledger,
component-construction, media-surface-construction, exterior-construction, and
lighting-construction schemas plus Ajv Draft
2020-12 and semantic validation in `compiler/`. The checked-in scene
specification remains a neutral synthetic contract fixture. Its fail-closed
compiler and reproducibility paths remain unchanged.

The exterior-construction contract is exposed through
`schemas/exterior-constructions.schema.json` and
`parseExteriorConstructionContract`. It permits only project-authored scalar
materials and deterministic beveled-box volumes, binds the north-side
`main-window`, verifies raw source provenance and accepted-input closure, and
fails closed on support cycles, unsupported footprints, positive-volume
overlap, room intrusion, declared-bounds drift, missing visible vegetation, or
unbounded middle-distance context.

The Candidate-owned lighting construction contract is exposed through
`schemas/lighting-constructions.schema.json` and
`parseLightingConstructionContract`. It binds each scene light in exact order to
an opening, pendant component, or ceiling surface without duplicating scene
position, temperature, luminous intensity, or contribution intent. The fixture
covers directional window daylight, ceiling architectural fill, and a pendant
spot, all with bounded targets and emitters. Directional output is exactly
scene intensityLumens divided by 3600 in watt-per-square-meter; spot output is
exactly intensityLumens divided by 100 in watt. Construction records contain
only these schema-const mappings and cannot supply an independent energy value.

Future Blender projection is fixed without changing the current adapter. Scene
coordinates map as (x, y, z) to Blender (x, z, y), matching the existing F1-F4
geometry projection. Each light aligns local -Z
to the source-to-target vector with local Y as up, then applies rollRadians about
local -Z. SUN angle is angularDiameterDegrees multiplied by pi/180. Spot cone
inputs are half-angles: spot_size is 2 * outer, and spot_blend is
1 - inner/outer. rangeM sets use_custom_distance=true and cutoff_distance;
radiusM sets shadow_soft_size.

Kelvin conversion is fixed as
`tanner-helland-2012-clamped-srgb-to-linear-v1`. Let
T = clamp(temperatureK, 1000, 40000) / 100 and use natural logarithms. For
T <= 66: R = 255, G = 99.4708025861 * ln(T) - 161.1195681661, and B = 0 when
T <= 19, otherwise B = 138.5177312231 * ln(T - 10) - 305.0447927307. For
T > 66: R = 329.698727446 * (T - 60)^-0.1332047592,
G = 288.1221695283 * (T - 60)^-0.0755148492, and B = 255. Clamp each encoded
channel to 0..255, normalize s = channel/255, then convert to linear with
s/12.92 when s <= 0.04045 and ((s + 0.055)/1.055)^2.4 otherwise.

The shared entry-view capture and metric are fixed by this contract; only the
average-minimum and dark-ratio criteria come from the bound style bible. The
display-sRGB8 metric consumes encoded integer R, G, and B bytes directly with no
linearization. For each pixel N = 2126*R + 7152*G + 722*B and divisor 10000.
Average passes exactly when sum(N) >= averageMinimum*10000*pixelCount. A pixel
is dark exactly when N < darkPixelThreshold*10000. The 0.7 ratio passes exactly
when darkCount*10 <= pixelCount*7. The threshold remains 40.

First-view rights closure covers every unique source used by material recipes,
components, exterior, and lighting construction, and requires screenshots=true
for each. Source provenance and accepted-input closure are also validated, but
the contract remains fixture-only until an exact Candidate source record exists.
No light has been compiled or rendered and no first-view criterion has been
measured.

The F4 exterior compiler is exposed through
`loadApprovedCandidateExteriorSource`, `compileApprovedCandidateExterior`, and
`verifyApprovedCandidateExteriorReproducibility`. Its hardened loader reads
exactly seven Git blobs from Candidate 01 commit
`380098d4b7cbc1d57498b059466f095ae3568929` and tree
`671af158f4b0f213d010191f21c3cd7d4779b5e9`, then verifies the schema-v4 source
lock hashes and counts through the component, media-surface, and exterior
semantic validators. Exact Blender produces 19 architecture meshes, 38
component meshes, and four root-level `exterior.<objectId>` beveled-box meshes.
Support relationships are custom metadata, never object parenting. The GLB has
exactly eight scalar PBR materials; each of the five interior/component
materials retains `asset-layout-project` provenance and each of the three
exterior materials retains `asset-exterior-constructions-project` provenance.
Media planes remain external runtime manifest data and are not exported into
the GLB.

Two F4 runs produce byte-identical 614784-byte GLB bytes with SHA-256
`eb74ca5e90b7dd09ad137c2127a53988491a557eb1d634093dd2b5eee6456b92`
and identical reopen digest
`d54209a0bb1c473910e701625f253d62fae5f70b3794dc04a8afeb3bd00f9f89`.
The decoded binary contains 16656 vertices, 24540 indices, 8180 triangles, and
16656 finite unit normals. Khronos validation reports zero errors and zero
warnings. Blend files are measured at 1421892 bytes but are not byte-identical,
so only the exterior-scoped GLB identity claim is true. Lighting, final-candidate
GLB, release, repository-artifact, publication, and global final byte-identity
claims remain false.

The candidate-owned component construction contract is exposed through
`schemas/component-constructions.schema.json` and
`parseComponentConstructionContract`. It strictly binds project-authored
beveled-box family parts and two instance material overrides to an already valid
scene contract while leaving route and spawn checks on the existing component
envelopes. The checked-in fixture remains contract-test data only.

The historical F3 media-surface baseline and deterministic projection are exposed through
`schemas/media-surface-constructions.schema.json` and
`parseMediaSurfaceConstructionContract`, `loadApprovedCandidateMediaSurfaceSource`,
`compileApprovedCandidateMediaSurfaces`, and
`verifyApprovedCandidateMediaSurfacesReproducibility`. The hardened loader reads
exactly six Git blobs at Candidate 01 commit
`26d3af6e2720576113431c22b9443533b919f390`, verifies the locked commit, tree,
blob identities, raw and canonical hashes, counts, provenance, accepted inputs,
and both component and media-surface semantic reports without a worktree or
network fallback. The compiler emits only an external canonical pretty-JSON
runtime manifest. Manifest and report targets are rejected anywhere under either
the Scene Factory root or the resolved trusted Candidate root. Each output is
written to a randomized same-parent exclusive temp file, read back and validated,
then published with an atomic no-clobber hard link; failures remove partial temps
and only the final inodes created by that invocation. Physical position, yaw,
width, and height come solely from the
scene specification; representation, pixels, front face, and input semantics
come solely from media-surface constructions. Purpose stays logical and is not
projected. Two runs must produce byte-identical 1022-byte manifest bytes with
SHA-256 `352b31af533049d7fe84f1ecb55643db85e7258ceff1e2d87be8f8785e38a4fb`.
That exact 1022-byte, two-surface, `platform-runtime-plane`, byte-identical
evidence is pinned separately under `mediaSurfaceBaseline` in the active
Candidate lock. The F3 API still reads its historical six-blob commit rather
than the current F4 commit.

The F1 Candidate 01 architecture baseline remains pinned separately at commit
`df564befcd65cb51a345fa9d315e40cadef6e563`, with its four Git blobs, canonical
hashes, 19-mesh/3-material GLB evidence, and reopen digest retained in
`candidate-lock.json` and `readiness.json`. The existing
`compileApprovedCandidateArchitecture` and architecture reproducibility APIs are
unchanged. An independent semantic digest also binds the 19 F1 object names,
geometry, transforms, material assignments, and three scalar material records.
F2 compile-plan, reopened-Blend, and decoded-GLB projections must all match that
same pinned F1 digest.

The F2 component baseline remains isolated under `componentBaseline` and reads
exactly five Git blobs at Candidate 01 commit
`8fec157a37bf619797f1ff200ccc32f611f94c18`: scene, asset ledger, generation
ledger, concept selection, and component constructions. The hardened loader has
no network fallback and verifies every blob identity/raw hash/size, all canonical
hashes and counts, provenance, and both accepted inputs. Exact Blender compiles
the 19 architecture meshes plus 38 individually named component meshes: 3 table
parts, 32 chair parts, 1 conference AV part, and 2 pendant parts. Every component
starts as an exact-dimension cube and has its locked bevel modifier applied before
save and export. The resulting inventory is exactly 57 meshes and 5 scalar PBR
materials, with no parents, helper objects, collision meshes, lights, cameras,
images, textures, extensions, animations, or skins. Two independent exports are
required to produce a byte-identical GLB and identical reopen inspection digest.
Reopen reports contain actual material custom properties, Principled PBR values,
and object material-slot evidence. Decoded normals must be finite and unit length,
declared accessor bounds must match decoded values, and the pinned Khronos
`gltf-validator` gate must report zero errors and zero warnings.

Compiler source attestation covers every compiler entrypoint, all seven Stage 3
schemas, the candidate lock, the approved style bible, and the exact package
manifest and pnpm lockfile.
Compiler and reproducibility reports retain the complete path-to-SHA-256 map, and
readiness validation independently recomputes it. Candidate lock and readiness
consumers reject duplicate JSON keys and noncanonical text encodings.

Single-run F2 reports keep `componentGlbByteIdentical` false. Only the two-run F2
reproducibility report sets that component-scoped result true. Single-run F3
reports set `mediaSurfacesCompiled` true and `byteIdentical` false; only two-run
F3 reproducibility sets `byteIdentical` true. Single-run F4 reports keep
`exteriorGlbByteIdentical` false; only two-run F4 reproducibility sets that
exterior-scoped result true. Lighting, final candidate GLB verification, release
creation, publication readiness, repository inclusion of artifact bytes, and
the global `byteIdenticalExportsVerified` claim remain explicitly false.

The neutral low-fidelity concept gate selected the functional correction of
Concept 03 and assigned its exact validated specification to Candidate 01 without
disclosing a production-track mapping. Preview binaries remain private. The gate
does not claim cleared release assets, a scene binary, or publication readiness.

## Validation

```bash
pnpm install
pnpm validate
pnpm test
```

The Candidate 01 architecture tests require a separate local checkout through
`CANDIDATE_01_DIR` (or the default sibling repository name). Set `BLENDER_BIN`
to the exact locked Blender 4.5.12 binary to run the compile, reopen, and
two-run byte-identity gates instead of skipping them.

The same checkout must contain the exact locked F4 commit. CI checks out
`380098d4b7cbc1d57498b059466f095ae3568929` outside this repository with full
history so the current F4 source and historical F3, F2, and F1 baselines are all
available.

The boundary check rejects scene binaries and forbidden top-level paths. The
experiment validator checks the brief, readiness record, style bible,
scorecard, fairness protocol, cross-repository locks, and the Stage 3 scene and
provenance contract fixtures. Component tests additionally cover the five-blob
lock, exact construction expansion, material overrides, applied bevel topology,
binary GLB geometry and inventory, reopen evidence, reproducibility, and focused
negative cases. Media-surface tests cover the six-blob lock, source ownership,
canonical projection bytes, reproducibility, hostile Git/worktree drift,
malformed projections, and fail-closed output handling. No production-track
mapping is recorded.

Exterior contract tests additionally cover canonical source bytes, exact scene
and source-ledger closure, material-role compatibility, north-window visibility,
support topology, declared bounds, deterministic naming, and stable negative
diagnostics. Approved exterior tests additionally cover the seven-blob source
lock, exact transforms and dimensions, applied bevel topology, support metadata
without parenting, material provenance, decoded normals and accessor bounds,
forbidden-content absence, reopen inspection, Khronos validation, output-root
safety, and two-run GLB byte identity.

Lighting contract tests cover exact scene-light order and role closure, opening,
pendant, table-top, and ceiling bindings, deterministic intensity conversion,
Blender projection conventions, bounded emitter geometry, encoded-byte metric
arithmetic, the frozen first-view policy, style-bible criteria, canonical and raw
fixture hashes, project-authored provenance, complete screenshot-rights closure,
and six stable checked-in mutation fixtures.
