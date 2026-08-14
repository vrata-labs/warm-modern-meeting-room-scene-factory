import { assertInventoryBoundary } from "./boundary.mjs";
import { deterministicIdempotencyKey } from "./expiry-policy.mjs";
import { planSweep } from "./planner.mjs";

const MIN_ACTION_BUDGET_MS = 16000;

export class JanitorSweepError extends Error {
  constructor(summary) {
    super("janitor_sweep_failed");
    this.name = "JanitorSweepError";
    this.summary = summary;
  }
}

export async function sweep({
  client,
  eventId,
  folderId,
  expectedProbeId,
  expectedExpiresAt,
  hardMaxAgeSeconds,
  nowMs,
  deadlineMs = nowMs + 30000,
  clock = () => Date.now(),
  logger = () => {}
}) {
  const inventory = await client.inventory(folderId, { deadlineMs });
  assertInventoryBoundary(inventory, folderId, expectedProbeId, expectedExpiresAt);
  const plan = planSweep(inventory, nowMs, hardMaxAgeSeconds);
  const deleted = [];
  const gone = [];
  const deferred = [...plan.deferred];
  const errors = [];
  const unattempted = [];

  for (let index = 0; index < plan.actions.length; index += 1) {
    const current = plan.actions[index];
    if (deadlineMs - clock() < MIN_ACTION_BUDGET_MS) {
      unattempted.push(...plan.actions.slice(index).map(({ type, id }) => ({ type, id })));
      break;
    }

    try {
      const result = await client.remove(current, deterministicIdempotencyKey(eventId, current), { deadlineMs });
      const record = { type: current.type, id: current.id, operationId: result.operationId ?? null };
      if (result.status === "deleted") deleted.push(record);
      else if (result.status === "gone") gone.push(record);
      else throw new Error(`unexpected_delete_status:${result.status}`);
    } catch (error) {
      errors.push({
        type: current.type,
        id: current.id,
        code: error.code ?? error.name ?? "error",
        status: error.status ?? null
      });
    }
  }

  errors.push(...unattempted.map(({ type, id }) => ({
    type,
    id,
    code: "janitor_deadline_exhausted",
    status: 408
  })));

  const summary = {
    eventId,
    folderId,
    inventoryCounts: plan.inventoryCounts,
    plannedCount: plan.actions.length,
    deleted,
    gone,
    deferred,
    unattempted,
    errors
  };
  logger(JSON.stringify({
    event: "gpu_probe_janitor_sweep",
    eventId,
    folderId,
    inventoryCounts: summary.inventoryCounts,
    plannedCount: summary.plannedCount,
    deletedCount: deleted.length,
    goneCount: gone.length,
    deferredCount: deferred.length,
    unattemptedCount: unattempted.length,
    errorCount: errors.length
  }));

  if (errors.length > 0) throw new JanitorSweepError(summary);
  return summary;
}
