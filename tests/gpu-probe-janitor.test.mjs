import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

import { assertFolderBoundary, assertInventoryBoundary } from "../scripts/gpu-probe-janitor/boundary.mjs";
import {
  deterministicIdempotencyKey,
  resourceExpiryMs,
  validateHardMaxAgeSeconds
} from "../scripts/gpu-probe-janitor/expiry-policy.mjs";
import { createHandler } from "../scripts/gpu-probe-janitor/index.mjs";
import { JanitorSweepError, sweep } from "../scripts/gpu-probe-janitor/janitor.mjs";
import { planSweep } from "../scripts/gpu-probe-janitor/planner.mjs";
import { createYcRestClient } from "../scripts/gpu-probe-janitor/yc-rest-client.mjs";

const createdAt = "2026-08-14T08:00:00Z";
const createdAtMs = Date.parse(createdAt);
const hardMaxAgeSeconds = 7200;
const probeId = "probe-1";
const defaultExpiry = String(Math.floor((createdAtMs + 3600_000) / 1000));

function resource(id, overrides = {}) {
  const actualCreatedAt = overrides.createdAt ?? createdAt;
  const labels = overrides.labels ?? {
    janitor: "yc-gpu-probe-v1",
    probe_id: probeId,
    expires_at: String(Math.floor((Date.parse(actualCreatedAt) + 3600_000) / 1000))
  };
  return { id, ...overrides, createdAt: actualCreatedAt, labels };
}

function inventory(overrides = {}) {
  return { instances: [], disks: [], snapshots: [], images: [], addresses: [], ...overrides };
}

function sweepOptions(client, overrides = {}) {
  const nowMs = createdAtMs + 7300_000;
  return {
    client,
    eventId: "event-1",
    folderId: "folder-1",
    expectedProbeId: probeId,
    expectedExpiresAt: defaultExpiry,
    hardMaxAgeSeconds,
    nowMs,
    deadlineMs: nowMs + 30000,
    clock: () => nowMs,
    ...overrides
  };
}

test("expiry labels shorten, clamp, and preserve past deadlines", () => {
  const shortExpiry = Math.floor((createdAtMs + 3600_000) / 1000);
  const longExpiry = Math.floor((createdAtMs + 20000_000) / 1000);
  const pastExpiry = Math.floor((createdAtMs - 1000) / 1000);
  assert.equal(resourceExpiryMs(resource("short", { labels: { expires_at: String(shortExpiry) } }), hardMaxAgeSeconds), shortExpiry * 1000);
  assert.equal(resourceExpiryMs(resource("long", { labels: { expires_at: String(longExpiry) } }), hardMaxAgeSeconds), createdAtMs + 7200_000);
  assert.equal(resourceExpiryMs(resource("past", { labels: { expires_at: String(pastExpiry) } }), hardMaxAgeSeconds), pastExpiry * 1000);
  assert.equal(resourceExpiryMs(resource("equal", { labels: { expires_at: String(createdAtMs / 1000) } }), hardMaxAgeSeconds), createdAtMs);
  assert.equal(resourceExpiryMs(resource("missing", { labels: {} }), hardMaxAgeSeconds), createdAtMs + 7200_000);
  assert.equal(resourceExpiryMs(resource("malformed", { labels: { expires_at: "later" } }), hardMaxAgeSeconds), createdAtMs + 7200_000);
  assert.throws(() => validateHardMaxAgeSeconds(86401), /invalid_hard_max_age_seconds/);
});

test("folder and inventory boundaries fail closed", () => {
  const folder = {
    id: "folder-1",
    labels: { janitor: "yc-gpu-probe-v1", purpose: "wmmr-ai-probe", janitor_guard: "guard-1" }
  };
  assert.doesNotThrow(() => assertFolderBoundary(folder, "folder-1", "guard-1"));
  assert.throws(() => assertFolderBoundary(folder, "folder-2", "guard-1"), /folder_id_mismatch/);
  assert.throws(() => assertFolderBoundary({ ...folder, labels: {} }, "folder-1", "guard-1"), /folder_janitor_marker_mismatch/);
  assert.doesNotThrow(() => assertInventoryBoundary(inventory({ instances: [resource("vm-1")] }), probeId, defaultExpiry));
  assert.throws(
    () => assertInventoryBoundary(inventory({ instances: [resource("vm-unknown", { labels: {} })] }), probeId, defaultExpiry),
    /unexpected_unmanaged_resource/
  );
  assert.throws(
    () => assertInventoryBoundary(inventory({ disks: [resource("disk-other", { labels: { janitor: "yc-gpu-probe-v1", probe_id: "other", expires_at: defaultExpiry } })] }), probeId, defaultExpiry),
    /unexpected_probe_resource/
  );
  assert.throws(
    () => assertInventoryBoundary(inventory({ disks: [resource("disk-late", { labels: { janitor: "yc-gpu-probe-v1", probe_id: probeId, expires_at: String(Number(defaultExpiry) + 60) } })] }), probeId, defaultExpiry),
    /unexpected_resource_expiry/
  );
});

test("internal and dynamic address records are outside the destructive boundary", () => {
  const addresses = [
    resource("internal", { labels: {}, reserved: true, internalIpv4Address: { address: "10.0.0.2" } }),
    resource("dynamic", { labels: {}, reserved: false, externalIpv4Address: { address: "198.51.100.10" } })
  ];
  assert.doesNotThrow(() => assertInventoryBoundary(inventory({ addresses }), probeId, defaultExpiry));
  const plan = planSweep(inventory({ addresses }), createdAtMs + 7300_000, hardMaxAgeSeconds);
  assert.deepEqual(plan.actions, []);
});

test("planner orders expired resources and preserves a fresh snapshot", () => {
  const nowMs = createdAtMs + 7300_000;
  const activeCreatedAt = new Date(nowMs - 1000).toISOString();
  const plan = planSweep(inventory({
    instances: [
      resource("vm-expired", {
        bootDisk: { diskId: "disk-attached" },
        secondaryDisks: [{ diskId: "disk-detached" }],
        networkInterfaces: [{ primaryV4Address: { oneToOneNat: { address: "198.51.100.7" } } }]
      }),
      resource("vm-active", { createdAt: activeCreatedAt })
    ],
    disks: [
      resource("disk-attached", { instanceIds: ["vm-expired"] }),
      resource("disk-detached", { instanceIds: [] }),
      resource("disk-active", { createdAt: activeCreatedAt, instanceIds: [] })
    ],
    snapshots: [
      resource("snapshot-fresh", { createdAt: activeCreatedAt, sourceDiskId: "disk-attached" }),
      resource("snapshot-expired", { sourceDiskId: "disk-active" })
    ],
    images: [resource("image-expired")],
    addresses: [
      resource("address-used", { used: true, reserved: true, externalIpv4Address: { address: "198.51.100.7" } }),
      resource("address-unused", { used: false, reserved: true, externalIpv4Address: { address: "198.51.100.8" } })
    ]
  }), nowMs, hardMaxAgeSeconds);

  assert.deepEqual(plan.actions.map(({ type, id }) => `${type}:${id}`), [
    "instance:vm-expired",
    "image:image-expired",
    "snapshot:snapshot-expired",
    "disk:disk-detached",
    "address:address-unused"
  ]);
  assert.ok(!plan.actions.some(({ id }) => id === "snapshot-fresh"));
  assert.deepEqual(plan.deferred, [
    { type: "address", id: "address-used", reason: "still-used" },
    { type: "disk", id: "disk-attached", reason: "still-attached" }
  ]);
});

test("idempotency keys are stable per timer event and resource", () => {
  const action = { type: "instance", id: "vm-1" };
  const first = deterministicIdempotencyKey("event-1", action);
  assert.equal(first, deterministicIdempotencyKey("event-1", action));
  assert.notEqual(first, deterministicIdempotencyKey("event-2", action));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test("REST client consumes every inventory page", async () => {
  const requests = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    requests.push(url.toString());
    const collection = url.pathname.split("/").at(-1);
    if (collection === "instances" && !url.searchParams.has("pageToken")) {
      return new Response(JSON.stringify({ instances: [resource("vm-1")], nextPageToken: "next" }));
    }
    if (collection === "instances") return new Response(JSON.stringify({ instances: [resource("vm-2")] }));
    return new Response(JSON.stringify({ [collection]: [] }));
  };
  const client = createYcRestClient({ token: "test-token", fetchImpl });
  const result = await client.inventory("folder-1");
  assert.deepEqual(result.instances.map(({ id }) => id), ["vm-1", "vm-2"]);
  assert.equal(requests.filter((url) => url.includes("/instances")).length, 2);
  assert.ok(requests.every((url) => url.includes("folderId=folder-1")));
});

test("REST delete waits for successful operation completion", async () => {
  let attempts = 0;
  const responses = [
    new Response(JSON.stringify({ message: "retry" }), { status: 500 }),
    new Response(JSON.stringify({ id: "operation-1", done: false }), { status: 200 }),
    new Response(JSON.stringify({ id: "operation-1", done: true, response: {} }), { status: 200 }),
    new Response("", { status: 404 })
  ];
  const client = createYcRestClient({
    token: "test-token",
    fetchImpl: async () => {
      attempts += 1;
      return responses.shift();
    },
    sleep: async () => {}
  });
  assert.deepEqual(await client.remove({ type: "instance", id: "vm-1" }, "key-1"), { status: "deleted", operationId: "operation-1" });
  assert.deepEqual(await client.remove({ type: "disk", id: "disk-1" }, "key-2"), { status: "gone", operationId: null });
  assert.equal(attempts, 4);
});

test("REST delete rejects immediate, eventual, and conflict errors", async () => {
  const immediate = createYcRestClient({
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ id: "operation-1", done: true, error: { message: "denied" } }))
  });
  await assert.rejects(immediate.remove({ type: "instance", id: "vm-1" }, "key-1"), /operation_failed/);

  const pendingResponses = [
    new Response(JSON.stringify({ id: "operation-2", done: false })),
    new Response(JSON.stringify({ id: "operation-2", done: true, error: { message: "failed later" } }))
  ];
  const eventual = createYcRestClient({
    token: "test-token",
    fetchImpl: async () => pendingResponses.shift(),
    sleep: async () => {}
  });
  await assert.rejects(eventual.remove({ type: "disk", id: "disk-1" }, "key-2"), /operation_failed/);

  const conflict = createYcRestClient({
    token: "test-token",
    fetchImpl: async () => new Response(JSON.stringify({ message: "still attached" }), { status: 409 })
  });
  await assert.rejects(conflict.remove({ type: "address", id: "address-1" }, "key-3"), /delete_address_failed:409/);
});

test("sweep validates complete inventory before any delete", async () => {
  let removeCalled = false;
  const client = {
    inventory: async () => inventory({ instances: [resource("unknown", { labels: {} })] }),
    remove: async () => {
      removeCalled = true;
    }
  };
  await assert.rejects(sweep(sweepOptions(client)), /unexpected_unmanaged_resource/);
  assert.equal(removeCalled, false);
});

test("sweep continues independent deletes and reports authorization failure", async () => {
  const removed = [];
  const client = {
    inventory: async () => inventory({ instances: [resource("vm-1"), resource("vm-2")] }),
    remove: async ({ id }) => {
      removed.push(id);
      if (id === "vm-1") throw Object.assign(new Error("forbidden"), { code: "delete_instance_failed", status: 403 });
      return { status: "deleted", operationId: "operation-2" };
    }
  };
  await assert.rejects(
    sweep(sweepOptions(client)),
    (error) => error instanceof JanitorSweepError && error.summary.errors[0].status === 403
  );
  assert.deepEqual(removed, ["vm-1", "vm-2"]);
});

test("deadline exhaustion leaves an error for trigger retry", async () => {
  const client = {
    inventory: async () => inventory({ instances: [resource("vm-1")] }),
    remove: async () => assert.fail("delete must not start without its retry budget")
  };
  const nowMs = createdAtMs + 7300_000;
  await assert.rejects(
    sweep(sweepOptions(client, { nowMs, deadlineMs: nowMs + 1000, clock: () => nowMs })),
    (error) => error instanceof JanitorSweepError && error.summary.errors[0].code === "janitor_deadline_exhausted"
  );
});

test("handler fails before auth or mutation on function-folder mismatch", async () => {
  let clientCreated = false;
  const previous = { ...process.env };
  process.env.TARGET_FOLDER_ID = "folder-expected";
  process.env.EXPECTED_FOLDER_GUARD = "guard-1";
  process.env.PROBE_ID = probeId;
  process.env.PROBE_EXPIRES_AT = defaultExpiry;
  process.env.HARD_MAX_AGE_SECONDS = "7200";
  try {
    const handler = createHandler({ clientFactory: () => {
      clientCreated = true;
      return {};
    } });
    await assert.rejects(handler({}, { functionFolderId: "folder-other" }), /target_folder_mismatch/);
    assert.equal(clientCreated, false);
  } finally {
    for (const key of ["TARGET_FOLDER_ID", "EXPECTED_FOLDER_GUARD", "PROBE_ID", "PROBE_EXPIRES_AT", "HARD_MAX_AGE_SECONDS"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("official timer shape and marked folder reach an empty sweep", async () => {
  const previous = { ...process.env };
  process.env.TARGET_FOLDER_ID = "folder-1";
  process.env.EXPECTED_FOLDER_GUARD = "guard-1";
  process.env.PROBE_ID = probeId;
  process.env.PROBE_EXPIRES_AT = defaultExpiry;
  process.env.HARD_MAX_AGE_SECONDS = "7200";
  try {
    const client = {
      folder: async () => ({
        id: "folder-1",
        labels: { janitor: "yc-gpu-probe-v1", purpose: "wmmr-ai-probe", janitor_guard: "guard-1" }
      }),
      inventory: async () => inventory(),
      remove: async () => assert.fail("empty inventory must not mutate")
    };
    const handler = createHandler({ clientFactory: () => client, clock: () => createdAtMs, logger: () => {} });
    const result = await handler({
      messages: [{ event_metadata: { event_id: "timer-event-1" }, details: {} }]
    }, {
      functionFolderId: "folder-1",
      token: { access_token: "short-lived-token" },
      getRemainingTimeInMillis: () => 30000
    });
    assert.equal(result.plannedCount, 0);
  } finally {
    for (const key of ["TARGET_FOLDER_ID", "EXPECTED_FOLDER_GUARD", "PROBE_ID", "PROBE_EXPIRES_AT", "HARD_MAX_AGE_SECONDS"]) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
});

test("CommonJS cloud entrypoint loads the ESM handler", () => {
  const require = createRequire(import.meta.url);
  const entrypoint = require("../scripts/gpu-probe-janitor/index.js");
  assert.equal(typeof entrypoint.handler, "function");
});

test("no-GPU fixture converges a younger disk sharing the run expiry", async () => {
  const sharedLabels = {
    janitor: "yc-gpu-probe-v1",
    probe_id: probeId,
    expires_at: defaultExpiry
  };
  let currentInventory = inventory({
    instances: [resource("cpu-fixture", { labels: sharedLabels, bootDisk: { diskId: "fixture-disk" } })],
    disks: [resource("fixture-disk", {
      createdAt: new Date(createdAtMs + 3500_000).toISOString(),
      labels: sharedLabels,
      instanceIds: ["cpu-fixture"]
    })]
  });
  const removed = [];
  const client = {
    inventory: async () => currentInventory,
    remove: async ({ type, id }) => {
      removed.push(`${type}:${id}`);
      if (type === "instance") {
        currentInventory = inventory({ disks: [{ ...currentInventory.disks[0], instanceIds: [] }] });
      } else if (type === "disk") {
        currentInventory = inventory();
      }
      return { status: "deleted", operationId: `operation-${id}` };
    }
  };

  await sweep(sweepOptions(client));
  await sweep(sweepOptions(client, { eventId: "event-2", nowMs: createdAtMs + 7600_000, deadlineMs: createdAtMs + 7630_000, clock: () => createdAtMs + 7600_000 }));
  assert.deepEqual(removed, ["instance:cpu-fixture", "disk:fixture-disk"]);
  assert.deepEqual(await client.inventory(), inventory());
});
