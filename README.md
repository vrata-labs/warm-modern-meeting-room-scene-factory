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

The Stage 3 contract defines exact scene, asset-ledger, generation-ledger, and
component-construction schemas plus Ajv Draft 2020-12 and semantic validation in
`compiler/`. The checked-in scene specification remains a neutral synthetic
contract fixture. Its fail-closed compiler and reproducibility paths remain
unchanged.

The candidate-owned component construction contract is exposed through
`schemas/component-constructions.schema.json` and
`parseComponentConstructionContract`. It strictly binds project-authored
beveled-box family parts and two instance material overrides to an already valid
scene contract while leaving route and spawn checks on the existing component
envelopes. The checked-in fixture remains contract-test data only.

The F1 Candidate 01 architecture baseline remains pinned separately at commit
`df564befcd65cb51a345fa9d315e40cadef6e563`, with its four Git blobs, canonical
hashes, 19-mesh/3-material GLB evidence, and reopen digest retained in
`candidate-lock.json` and `readiness.json`. The existing
`compileApprovedCandidateArchitecture` and architecture reproducibility APIs are
unchanged. An independent semantic digest also binds the 19 F1 object names,
geometry, transforms, material assignments, and three scalar material records.
F2 compile-plan, reopened-Blend, and decoded-GLB projections must all match that
same pinned F1 digest.

The F2 component slice reads exactly five Git blobs at Candidate 01 commit
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

Compiler source attestation covers every compiler entrypoint, all four Stage 3
schemas, the candidate lock, and the exact package manifest and pnpm lockfile.
Compiler and reproducibility reports retain the complete path-to-SHA-256 map, and
readiness validation independently recomputes it. Candidate lock and readiness
consumers reject duplicate JSON keys and noncanonical text encodings.

Single-run reports keep `componentGlbByteIdentical` false. Only the two-run
reproducibility report sets that component-scoped result true. Exterior, lighting,
media surfaces, final candidate GLB verification, publication readiness, and
repository inclusion of scene binaries remain explicitly false.

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

The same checkout must contain the exact locked component commit. CI checks out
`8fec157a37bf619797f1ff200ccc32f611f94c18` outside this repository with full
history so both the current F2 blobs and historical F1 baseline are available.

The boundary check rejects scene binaries and forbidden top-level paths. The
experiment validator checks the brief, readiness record, style bible,
scorecard, fairness protocol, cross-repository locks, and the Stage 3 scene and
provenance contract fixtures. Component tests additionally cover the five-blob
lock, exact construction expansion, material overrides, applied bevel topology,
binary GLB geometry and inventory, reopen evidence, reproducibility, and focused
negative cases. No production-track mapping is recorded.
