# Disposable GPU Probe Policy

Status: first internal probe passed on 2026-08-23. Three disposable VM attempts
were created; the third completed generation. All probe VMs, auto-delete disks,
temporary access bindings, and the temporary service account were deleted.

## Primary Probe Shape

| Field | Value |
|---|---|
| Provider | Yandex Cloud Compute |
| Region / zone | Russia / `ru-central1-a` |
| Platform | `standard-v3-t4` |
| Accelerator | 1 Tesla T4, 15655829504 reported bytes |
| CPU / memory | 4 vCPU / 16 GB RAM |
| Scheduling | Preemptible |
| Boot disk | 100 GB network SSD, auto-delete |
| Public address | Dynamic IPv4 only; never reserve it |
| Base image | `fd8qb5sstf8h1lk8pmb8`, `ubuntu-2204-lts-cuda-12-2-v20260813` |
| In-guest watchdog | 45 minutes |
| Approved campaign ceiling | 120 minutes / 65.72384 RUB |

The originally planned T4i quota was unavailable. Yandex granted one T4 quota,
so the approved run used the T4 shape. The measured probe passed; this is exact
evidence for the recorded software boundary, not a general compatibility claim.

## Cost Boundary

The pre-run T4i estimate was:

| Component | RUB/hour |
|---|---:|
| Preemptible T4i VM: GPU, 4 vCPU, 16 GB RAM | 30.60840 |
| 100 GB network SSD | 1.99000 |
| Active dynamic public IPv4 | 0.26352 |
| Primary all-in floor | 32.86192 |

The 120-minute campaign ceiling was 65.72384 RUB before paid traffic or unusual
request volume. Three T4 VM attempts were needed because the first metadata
configuration was invalid and the second expired before workload completion.
Actual provider metering is pending and must be reconciled before another paid
run. The 1,000 RUB Stage 2 hard cap is not a spending target.

An A100 fallback in `ru-central1-b` requires a separate explicit approval. Its
preemptible 28 vCPU / 119 GB / one A100 shape with the same disk and IP costs
190.93242 RUB per hour, or 381.86484 RUB for two hours.

Official references:

- `https://yandex.cloud/en/docs/compute/concepts/gpus`;
- `https://yandex.cloud/en/docs/compute/concepts/preemptible-vm`;
- `https://yandex.cloud/ru/docs/compute/pricing`;
- `https://yandex.cloud/ru/docs/vpc/pricing`.

## Capacity Result

The initial 2026-08-14 check returned zero GPU quota. Support ticket `FS946793`
subsequently resulted in `compute.instanceT4Gpus.count=1`; T4i remained zero.
Zone `ru-central1-a` had T4 capacity for the successful run.

## Recorded Probe Boundary

The completed probe used:

1. one deterministic project-authored RGBA input;
2. exact content-addressed DINO, TRELLIS, and 41-wheel payloads;
3. a non-root, read-only-root workload with no network, no added capabilities,
   and no new privileges;
4. an in-guest 45-minute shutdown watchdog plus an independent local deletion
   timer armed before each VM;
5. immediate output upload, exact full readback, VM deletion, disk deletion, and
   access-binding teardown;
6. public-safe result evidence in `gpu-generation-probe-lock.json` without
   restricted storage locators or generated binaries.

This narrower internal run did not have the originally proposed provider-side
function janitor or a final OCI/SBOM bundle. The sponsor accepted those explicit
deviations for one disposable probe only. They remain required before a broader
campaign or production publication.

## Teardown Contract

- Use one dedicated experiment folder containing no unrelated Compute or VPC
  resources. The folder has an immutable random guard marker checked by the
  janitor. Every managed resource has exact janitor ID, probe ID, and immutable
  expiry labels; an unknown or mismatched resource aborts before mutation.
- Use one preemptible VM, one auto-delete boot disk, and one dynamic address.
  Do not create secondary disks, filesystems, static addresses, snapshots,
  custom images, reservations, instance groups, or long-lived service-account
  keys.
- Before VM creation, arm a provider-side timer outside both the VM and the
  operator process. Its janitor deletes only boundary-validated probe resources
  at expiry and waits for each provider delete operation to finish. Failure to
  arm or verify this timer blocks VM creation.
- Start an in-guest shutdown watchdog before dependency or model work. It must
  stop the VM no later than 110 minutes after boot.
- Run the workload from an external wrapper with a shorter command timeout and
  a best-effort unconditional cleanup block. Normal completion and handled
  failures delete immediately; an unhandled operator crash falls back to the
  in-guest stop and independent provider-side janitor.
- Stopping is only an emergency billing brake. The external owner must delete
  the VM and verify deletion of its auto-delete boot disk and release of its
  dynamic address.
- Upload accepted outputs, logs, SBOM, cost evidence, and hashes before delete.
  A failed upload marks the run failed but does not extend VM lifetime.
- Postflight lists all experiment-labeled instances, disks, filesystems,
  snapshots, images, and addresses. Any remainder is a teardown failure and
  blocks another run.
- Recheck billing after provider metering catches up and attach the result to
  the run record.
- After the complete experiment, an operator deletes the timer, function,
  service accounts, network, and empty folder. The janitor intentionally has no
  control-plane permission to delete itself or the folder.

Preemptible instances have no SLA and can stop at any time. Their provider
maximum lifetime of 24 hours is not a substitute for the 45-minute watchdog or
the independent deletion guard. The guard is implemented and locally tested but
was not deployed or provider-fixture-verified for this probe. No further paid
run should start until billing reconciliation is complete, the exposed operator
credential is rotated, and the next run's deletion guard is explicitly armed.
