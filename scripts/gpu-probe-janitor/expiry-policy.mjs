import { createHash } from "node:crypto";

export const EXPIRY_LABEL = "expires_at";

export function validateHardMaxAgeSeconds(value) {
  const seconds = Number(value);
  if (!Number.isInteger(seconds) || seconds < 60 || seconds > 86400) {
    throw new Error("invalid_hard_max_age_seconds");
  }
  return seconds;
}

export function resourceExpiryMs(resource, hardMaxAgeSeconds) {
  const createdAtMs = Date.parse(resource.createdAt);
  if (!Number.isFinite(createdAtMs)) throw new Error(`invalid_resource_created_at:${resource.id}`);

  const hardExpiryMs = createdAtMs + validateHardMaxAgeSeconds(hardMaxAgeSeconds) * 1000;
  const label = resource.labels?.[EXPIRY_LABEL];
  if (!/^\d+$/.test(label ?? "")) return hardExpiryMs;

  const labelledExpiryMs = Number(label) * 1000;
  if (!Number.isSafeInteger(labelledExpiryMs)) return hardExpiryMs;
  return Math.min(labelledExpiryMs, hardExpiryMs);
}

export function isResourceExpired(resource, nowMs, hardMaxAgeSeconds) {
  return nowMs >= resourceExpiryMs(resource, hardMaxAgeSeconds);
}

export function deterministicIdempotencyKey(eventId, action) {
  const bytes = createHash("sha256")
    .update(`${eventId}:${action.type}:${action.id}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
