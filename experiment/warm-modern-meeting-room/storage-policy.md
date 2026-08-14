# Restricted Storage Policy

Status: ready for classified reference handling as of 2026-08-14.

The experiment sponsor approved the private storage boundary for Stage 1 on
2026-08-13. This approval covers metadata collection and storage of classified
human-only references. It does not approve model inputs or AI generation.

## Public Record Boundary

The storage provider, controls, quota, retention rules, and owner roles are
public evidence. The bucket name, resource IDs, encryption key ID, IAM
principals, and object URLs remain in the restricted operator record and must
not be committed to public Git.

## Controls

- provider: Yandex Cloud Object Storage in the Russia region;
- hard bucket quota: 10 GiB;
- anonymous read, list, and configuration access: disabled;
- static access keys, temporary static credentials, and presigned URLs: disabled;
- access path: short-lived IAM tokens held by the experiment sponsor;
- encryption: server-side envelope encryption with a dedicated AES-256 Yandex
  KMS key;
- KMS key deletion protection: enabled;
- bucket versioning: disabled to avoid retained hidden copies;
- verified object count at activation: zero.

The active KMS key version costs 0.00439 RUB per hour, or 3.16080 RUB for a
720-hour billing month, before cryptographic operations. This recurring cost is
part of the experiment budget until the encrypted source record is retired.

## Prefix And Retention Contract

| Prefix | Allowed content | Retention |
|---|---|---|
| `human-only/` | Classified references that may be viewed by authors but never sent to a model | Manual deletion no later than 90 days after the terminal experiment outcome |
| `model-inputs/` | Internal-original or separately cleared inputs named in the AI rights verdict | Manual deletion no later than 90 days after the terminal experiment outcome, or immediately after rights withdrawal |
| `accepted/<sha256>/` | Content-addressed accepted raw AI outputs and required source evidence | No automatic expiry; retain through every dependent public release and for 90 days after its formal retirement |
| `evidence/` | Rights snapshots, hashes, SBOMs, teardown records, and cost reports | Retain with the experiment record |
| `temporary/` | Retryable transfer and processing intermediates | Automatic deletion after 30 days |
| `rejected/` | Rejected raw attempts when retention is needed for the yield report | Automatic deletion after 30 days; ledger metadata may remain |

Incomplete multipart uploads under the lifecycle-managed prefixes are aborted
after one day. No raw reference or output may be placed at the bucket root.

## Access Procedure

1. Classify the source in `reference-ledger.json` before retrieval.
2. Confirm the destination prefix and retention class.
3. Use a short-lived IAM token; do not create a static access key.
4. Record source URL or public-safe ID, SHA-256, size, classification, uploader
   role, and upload time in the restricted operator record.
5. For model inputs, require a signed `allow` AI rights verdict that names the
   exact input ID. A `human-only` record is never promoted implicitly.
6. For accepted AI outputs, use the output SHA-256 as the object directory and
   verify the uploaded bytes before deleting any disposable compute resource.

## Deletion Procedure

1. Freeze the public-safe ledger and record the terminal outcome.
2. Delete objects due under the retention table, including incomplete uploads.
3. List the affected prefixes and verify that no due object remains.
4. Preserve only content-addressed accepted sources still required by a public
   release and the minimum evidence needed for its provenance chain.
5. When no encrypted object remains, remove the bucket encryption binding,
   delete the empty bucket, disable KMS deletion protection, and schedule the
   dedicated key for destruction.
6. Recheck Object Storage and KMS billing after the provider deletion window
   and attach the result to the teardown record.

Deleting the KMS key before encrypted objects are cleared is destructive and is
forbidden. The experiment sponsor owns access, retention review, deletion, and
billing verification.
