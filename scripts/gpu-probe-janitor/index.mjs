import { assertFolderBoundary } from "./boundary.mjs";
import { validateHardMaxAgeSeconds } from "./expiry-policy.mjs";
import { sweep } from "./janitor.mjs";
import { createYcRestClient } from "./yc-rest-client.mjs";

function timerEventId(event) {
  const eventId = event?.messages?.[0]?.event_metadata?.event_id;
  if (typeof eventId !== "string" || eventId.length === 0) throw new Error("missing_timer_event_id");
  return eventId;
}

export function createHandler({ clientFactory = createYcRestClient, clock = () => Date.now(), logger = console.log } = {}) {
  return async function gpuProbeJanitorHandler(event, context) {
    const targetFolderId = process.env.TARGET_FOLDER_ID;
    if (!targetFolderId) throw new Error("missing_target_folder_id");
    if (targetFolderId !== context?.functionFolderId) throw new Error("target_folder_mismatch");
    const expectedFolderGuard = process.env.EXPECTED_FOLDER_GUARD;
    if (!expectedFolderGuard) throw new Error("missing_expected_folder_guard");
    const expectedProbeId = process.env.PROBE_ID;
    if (!expectedProbeId) throw new Error("missing_probe_id");
    const expectedExpiresAt = process.env.PROBE_EXPIRES_AT;
    if (!expectedExpiresAt) throw new Error("missing_probe_expiry");

    const token = context?.token?.access_token;
    if (!token) throw new Error("missing_function_service_account_token");
    const hardMaxAgeSeconds = validateHardMaxAgeSeconds(process.env.HARD_MAX_AGE_SECONDS);
    if (typeof context.getRemainingTimeInMillis !== "function") throw new Error("missing_function_deadline");
    const remainingTimeMs = context.getRemainingTimeInMillis();
    if (remainingTimeMs < 10000) throw new Error("insufficient_function_deadline");
    const startedAtMs = clock();
    const deadlineMs = startedAtMs + remainingTimeMs - 5000;
    const client = clientFactory({ token, clock });
    const folder = await client.folder(targetFolderId, { deadlineMs });
    assertFolderBoundary(folder, targetFolderId, expectedFolderGuard);

    return sweep({
      client,
      eventId: timerEventId(event),
      folderId: targetFolderId,
      expectedProbeId,
      expectedExpiresAt,
      hardMaxAgeSeconds,
      nowMs: startedAtMs,
      deadlineMs,
      clock,
      logger
    });
  };
}

export const handler = createHandler();
