# Reference And Storage Policy

## Current Gate

Reference collection and model-input preparation are blocked until a restricted
storage owner, quota, access policy, retention period, and deletion procedure
are recorded in `readiness.json`.

## Classification Before Retrieval

Every candidate reference is classified before its file is downloaded or
copied:

- `metadata-only`: public URL and descriptive metadata may be committed;
- `human-only`: may be viewed by authors but only stored in approved restricted storage;
- `model-input`: allowed only when internal-original or CC0 terms explicitly permit ML processing and derivative redistribution;
- `rejected`: branded, distinctive, private, unclear, or incompatible rights; do not retrieve for the experiment.

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
