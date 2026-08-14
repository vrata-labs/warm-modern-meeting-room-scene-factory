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
style bible and `style-sheet.md` remain pending the art-direction gate.

AI generation remains blocked. `ai-rights-verdict.md` rejects the stock TRELLIS
path and records the evidence still required for a pruned mesh-only probe.
`gpu-probe-policy.md` records the proposed disposable machine, exact cost
boundary, zero account GPU quota, and mandatory teardown behavior. The
provider-side reconciler in `scripts/gpu-probe-janitor/` is locally tested but
not deployed or provider-fixture-verified. No experiment GPU resource has been
created.

## Validation

```bash
pnpm install
pnpm validate
pnpm test
```

The boundary check rejects scene binaries and forbidden top-level paths. The
experiment validator checks the brief, readiness record, style bible,
scorecard, fairness protocol, and cross-repository lock structure.
