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

The first Stage 3 slice defines exact scene, asset-ledger, and generation-ledger
schemas plus Ajv Draft 2020-12 and semantic validation in `compiler/`. The checked-in
scene specification is a neutral synthetic contract fixture, not an approved
candidate design. The next slice adds an exact-Blender room shell compiler for
the synthetic fixture. It creates closed floor, ceiling, and wall assemblies
only outside the repository and keeps openings, materials, approved candidate
compilation, and byte-identical export qualification as separate follow-up
slices.

## Validation

```bash
pnpm install
pnpm validate
pnpm test
```

The boundary check rejects scene binaries and forbidden top-level paths. The
experiment validator checks the brief, readiness record, style bible,
scorecard, fairness protocol, cross-repository locks, and the Stage 3 scene and
provenance contract fixtures.
