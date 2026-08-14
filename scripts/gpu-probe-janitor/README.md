# GPU Probe Janitor

This directory contains the provider-side deletion reconciler required before a
disposable GPU probe can launch. It is room-specific pilot infrastructure, not a
general cloud service.

## Safety Model

- Run the function in a dedicated Yandex Cloud folder that contains no
  unrelated Compute or VPC resources. The folder must carry exact `janitor`,
  `purpose`, and random `janitor_guard` labels checked on every invocation.
- Use separate keyless service accounts. The function runtime account receives
  only `compute.editor`, `vpc.publicAdmin`, and `resource-manager.viewer` in the
  dedicated folder. The timer account receives `functions.functionInvoker` on
  the exact function only. Do not grant primitive `editor`/`admin` roles.
- Configure Node.js 22, 128 MB memory, a 30-second timeout, no provisioned
  instances, CommonJS entrypoint `index.handler`, and environment variables
  `TARGET_FOLDER_ID`, `EXPECTED_FOLDER_GUARD`, `PROBE_ID`, and
  `PROBE_EXPIRES_AT`, plus `HARD_MAX_AGE_SECONDS=7200`.
- Invoke `index.handler` from a timer trigger every five minutes with two
  attempts and a 30-second retry interval.
- Every managed probe resource must carry `janitor=yc-gpu-probe-v1`, the exact
  `probe_id`, and `expires_at=<unix-seconds>`. An unknown resource, mismatched
  probe ID, malformed expiry, or expiry different from the run-level
  `PROBE_EXPIRES_AT` aborts the complete sweep before deletion. Valid expiry
  cannot extend creation time plus the hard maximum.
- The reconciler has no Functions, Trigger, IAM, or Resource Manager API client,
  so it cannot delete itself, its trigger, its service account, or the folder.

The folder check, exact resource labels, and folder-scoped IAM form independent
boundaries. Never deploy this function into a shared folder. Internal and
dynamic IP records are ignored; deleting the VM releases them. Only labelled,
unused reserved external addresses are explicitly deleted.

## Reconciliation

Each run validates the folder marker, then lists every page of instances, disks,
filesystems, snapshots, images, and addresses in the exact function folder. The
boundary validates every resource folder and every VM disk/filesystem dependency
before any mutation. It submits expired VM deletions first. Attached disks,
attached filesystems, and used addresses are deferred to the next timer pass;
snapshots are deleted only at their own expiry. Images, detached disks,
detached filesystems, and unused reserved external addresses converge
independently.

Every delete waits for the returned Yandex operation to complete. Successful
list and operation responses are schema-checked; malformed 2xx responses fail
closed. Provider 404 responses are success. Immediate or eventual operation
errors, conflicts, authorization errors, exhausted transient retries, or
insufficient invocation time fail the run so the trigger or next timer pass
retries from fresh inventory.

Delete calls use deterministic idempotency keys derived from timer event ID,
resource type, and resource ID. A repeated delivery of one timer event therefore
reuses the key, while the next scheduled event can retry a dependency that was
not ready earlier.

## Deployment Gate

Deployment is intentionally not automated in this repository yet. Before a GPU
launch, the experiment sponsor must:

1. approve the function/trigger cost and IAM scope;
2. create the marked dedicated folder, two keyless service accounts, function,
   and timer;
3. run a no-GPU fixture using a small CPU VM with an auto-delete boot disk and a
   dynamic address;
4. terminate the operator process and prove that the guest watchdog stops the
   VM and the provider-side janitor removes the VM and disk by the hard expiry;
5. verify zero experiment instances, disks, filesystems, snapshots, images, and
   reserved external addresses after convergence;
6. record billing and delete the fixture resources;
7. after all experiment probes finish, an operator deletes the timer, function,
   service accounts, network, and empty folder and verifies billing. The janitor
   intentionally has no permission or API client for this final control-plane
   cleanup.

No cloud function, trigger, service account, folder, or fixture resource was
created while implementing this code.

## Local Verification

The root repository command runs the pure policy, planner, REST client, handler,
and fake-provider convergence tests:

```bash
pnpm test
```

Official references:

- `https://yandex.cloud/en/docs/functions/concepts/trigger/timer`;
- `https://yandex.cloud/en/docs/functions/lang/nodejs/context`;
- `https://yandex.cloud/en/docs/functions/operations/function-sa`;
- `https://yandex.cloud/en/docs/compute/api-ref/Instance/delete`;
- `https://yandex.cloud/en/docs/compute/api-ref/Filesystem/delete`;
- `https://yandex.cloud/en/docs/compute/operations/vm-control/vm-delete`;
- `https://yandex.cloud/en/docs/vpc/operations/address-delete`;
- `https://yandex.cloud/en/docs/api-design-guide/concepts/idempotency`.
