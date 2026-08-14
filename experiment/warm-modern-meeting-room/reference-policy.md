# Reference And Storage Policy

## Current Gate

The restricted storage boundary is ready as of 2026-08-14 and is recorded in
`readiness.json` and `storage-policy.md`. Metadata-only reference collection may
proceed. Human-only files may be retrieved only into the approved restricted
prefix after classification; no such file has been retrieved yet.

Model-input preparation remains blocked. The current reference ledger contains
zero approved model inputs, and the AI rights verdict remains `BLOCK`.

## Classification Before Retrieval

Every candidate reference is classified before its file is downloaded or
copied:

- `metadata-only`: public URL and descriptive metadata may be committed;
- `human-only`: may be viewed by authors and reduced to abstract principles, but only stored in approved restricted storage and never copied as a composition;
- `model-input`: allowed only when internal-original or CC0 terms explicitly permit ML processing and derivative redistribution;
- `rejected`: branded-product likeness, signature composition that cannot be safely abstracted, private material, unclear provenance, or incompatible rights; do not retrieve for the experiment.

Classification is not promoted implicitly. In particular, a CC0 photograph is
still `human-only` when property, architectural-design, trademark, privacy, or
other third-party rights needed for model conditioning are unresolved.

## Public Git

Public Git may contain URLs, metadata, checksums, licenses, and small evidence
whose redistribution has been cleared. It must not contain raw human-only
references, private benchmarks, provider credentials, raw rejected attempts,
or an unpublished blind-review mapping.

## Private Benchmark

SenseTower and other private scenes are not design references or model inputs.
They may be used only after both A/B candidates freeze, and only for a broad
quality-gap assessment that cannot change the frozen comparison.

## Model Inputs

No model input is prepared or uploaded until the human rights owner approves
the exact code, weights, dependencies, provider terms, retention/training,
territories, output use, and redistribution chain. An unresolved field blocks
generation.

The 2026-08-14 ledger intentionally approves no model input. A future entry
requires a separate review and explicit `modelInputAllowed: true`; editing the
classification alone is insufficient.
