const JANITOR_ID = "yc-gpu-probe-v1";

export function assertFolderBoundary(folder, expectedFolderId, expectedGuard) {
  if (!folder || !expectedFolderId || !expectedGuard) throw new Error("invalid_folder_boundary_input");
  if (folder.id !== expectedFolderId) throw new Error("folder_id_mismatch");
  if (folder.labels?.janitor !== JANITOR_ID) throw new Error("folder_janitor_marker_mismatch");
  if (folder.labels?.purpose !== "wmmr-ai-probe") throw new Error("folder_purpose_marker_mismatch");
  if (folder.labels?.janitor_guard !== expectedGuard) throw new Error("folder_guard_marker_mismatch");
}

function managedResources(inventory) {
  return [
    ...(inventory.instances ?? []).map((resource) => ["instance", resource]),
    ...(inventory.disks ?? []).map((resource) => ["disk", resource]),
    ...(inventory.snapshots ?? []).map((resource) => ["snapshot", resource]),
    ...(inventory.images ?? []).map((resource) => ["image", resource]),
    ...(inventory.addresses ?? [])
      .filter((resource) => resource.externalIpv4Address && resource.reserved)
      .map((resource) => ["address", resource])
  ];
}

export function assertInventoryBoundary(inventory, expectedProbeId, expectedExpiresAt) {
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(expectedProbeId ?? "")) throw new Error("invalid_expected_probe_id");
  if (!/^\d+$/.test(expectedExpiresAt ?? "")) throw new Error("invalid_expected_probe_expiry");
  for (const [type, resource] of managedResources(inventory)) {
    if (resource.labels?.janitor !== JANITOR_ID) throw new Error(`unexpected_unmanaged_resource:${type}:${resource.id}`);
    if (resource.labels?.probe_id !== expectedProbeId) throw new Error(`unexpected_probe_resource:${type}:${resource.id}`);
    if (!/^\d+$/.test(resource.labels?.expires_at ?? "")) throw new Error(`invalid_resource_expiry_label:${type}:${resource.id}`);
    if (resource.labels.expires_at !== expectedExpiresAt) throw new Error(`unexpected_resource_expiry:${type}:${resource.id}`);
  }
}

export { JANITOR_ID };
