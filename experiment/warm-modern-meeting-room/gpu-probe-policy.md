# Disposable GPU Probe Policy

Status: proposed and blocked. No experiment GPU VM, disk, snapshot, image,
reservation, or IP has been created.

## Primary Probe Shape

| Field | Value |
|---|---|
| Provider | Yandex Cloud Compute |
| Region / zone | Russia / `ru-central1-d` |
| Platform | `standard-v3-t4i` |
| Accelerator | 1 T4i, 24 GB VRAM |
| CPU / memory | 4 vCPU / 16 GB RAM |
| Scheduling | Preemptible |
| Boot disk | 100 GB network SSD, auto-delete |
| Public address | Dynamic IPv4 only; never reserve it |
| Base image | `fd8qb5sstf8h1lk8pmb8`, `ubuntu-2204-lts-cuda-12-2-v20260813` |
| Maximum first-run wall time | 120 minutes |

The T4i is a cost-first candidate with useful margin above TRELLIS's stated
16 GB minimum. It is not named among upstream's verified A100/A6000 devices, so
technical compatibility remains a measured probe result rather than an
assumption.

## Cost Boundary

Current RU/RUB prices include VAT:

| Component | RUB/hour |
|---|---:|
| Preemptible T4i VM: GPU, 4 vCPU, 16 GB RAM | 30.60840 |
| 100 GB network SSD | 1.99000 |
| Active dynamic public IPv4 | 0.26352 |
| Primary all-in floor | 32.86192 |

The 120-minute first-run maximum is 65.72384 RUB before paid traffic or unusual
request volume. The proposed Stage 2 compute hard cap is 1,000 RUB. This cap is
not a spending target and is not approved merely by committing this policy.

An A100 fallback in `ru-central1-b` requires a separate explicit approval. Its
preemptible 28 vCPU / 119 GB / one A100 shape with the same disk and IP costs
190.93242 RUB per hour, or 381.86484 RUB for two hours.

Official references:

- `https://yandex.cloud/en/docs/compute/concepts/gpus`;
- `https://yandex.cloud/en/docs/compute/concepts/preemptible-vm`;
- `https://yandex.cloud/ru/docs/compute/pricing`;
- `https://yandex.cloud/ru/docs/vpc/pricing`.

## Current Capacity Blocker

The 2026-08-14 read-only quota check returned zero for every exposed GPU quota,
including T4, T4i, V100, A100, and Gen2. Yandex exposes no read-only API for
instantaneous host inventory. No launch can succeed until the account receives
an explicit GPU quota and the selected zone has capacity.

An API request for one T4i quota was attempted without creating a resource. It
was rejected before request creation because the cloud does not have the
`QUOTA_MANAGER_USE_QUOTA_REQUEST_SERVICE_VIA_API` alpha flag. The remaining
request path is Yandex Console or provider support; browser automation reached
the provider CAPTCHA and did not bypass it.

## Launch Preconditions

All conditions are mandatory:

1. Approved style bible and cleared probe input IDs exist.
2. The AI rights verdict is `allow-pruned-probe` for an exact OCI digest.
3. The chosen GPU quota is nonzero.
4. The experiment sponsor explicitly approves the quoted machine, maximum wall
   time, and 1,000 RUB campaign cap.
5. A preflight records all experiment-labeled instances, disks, snapshots,
   images, addresses, and KMS resources; the expected set is empty.
6. The input and required model artifacts are already in restricted storage and
   verified by SHA-256. The VM does not receive unrelated cloud credentials.
7. An isolated, short-lived run folder and a provider-side scheduled janitor are
   active before VM creation. The janitor identity has cleanup rights only in
   that run folder and deletes its resources after the recorded expiry even if
   the operator machine disappears.
8. The local wrapper, in-guest watchdog, and provider-side janitor have passed a
   no-GPU fixture test that verifies instance, disk, address, and folder cleanup.

## Teardown Contract

- Create every run in a dedicated folder. Assign labels `managed-by=opencode`,
  `purpose=wmmr-ai-probe`, the unique run ID, and an immutable expiry time to
  every created resource.
- Use one preemptible VM, one auto-delete boot disk, and one dynamic address.
  Do not create secondary disks, static addresses, snapshots, custom images,
  reservations, instance groups, or long-lived service-account keys.
- Before VM creation, arm a provider-side timer outside both the VM and the
  operator process. Its janitor deletes all compute/network resources in the
  dedicated run folder at expiry and then deletes the run folder. Failure to
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
- Postflight lists all experiment-labeled instances, disks, snapshots, images,
  and addresses. Any remainder is a teardown failure and blocks another run.
- Recheck billing after provider metering catches up and attach the result to
  the run record.

Preemptible instances have no SLA and can stop at any time. Their provider
maximum lifetime of 24 hours is not a substitute for the 110-minute watchdog or
the independent deletion guard. That guard is not implemented yet, so launch
remains blocked even if GPU quota becomes available.
