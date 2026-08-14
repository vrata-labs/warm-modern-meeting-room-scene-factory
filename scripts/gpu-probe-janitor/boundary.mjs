const JANITOR_ID = "yc-gpu-probe-v1";
const INVENTORY_COLLECTIONS = ["instances", "disks", "filesystems", "snapshots", "images", "addresses"];

function values(value) {
  return Array.isArray(value) ? value : [];
}

function assertInventoryShape(inventory) {
  if (!inventory || typeof inventory !== "object" || Array.isArray(inventory)) {
    throw new Error("invalid_inventory");
  }
  for (const collection of INVENTORY_COLLECTIONS) {
    if (!Array.isArray(inventory[collection])) throw new Error(`invalid_inventory_collection:${collection}`);
  }
}

function optionalResourceArray(resource, field, type) {
  const value = resource[field];
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error(`invalid_resource_array:${type}:${resource.id}:${field}`);
  return value;
}

export function assertFolderBoundary(folder, expectedFolderId, expectedGuard) {
  if (!folder || !expectedFolderId || !expectedGuard) throw new Error("invalid_folder_boundary_input");
  if (folder.id !== expectedFolderId) throw new Error("folder_id_mismatch");
  if (folder.labels?.janitor !== JANITOR_ID) throw new Error("folder_janitor_marker_mismatch");
  if (folder.labels?.purpose !== "wmmr-ai-probe") throw new Error("folder_purpose_marker_mismatch");
  if (folder.labels?.janitor_guard !== expectedGuard) throw new Error("folder_guard_marker_mismatch");
}

function allResources(inventory) {
  return [
    ...values(inventory.instances).map((resource) => ["instance", resource]),
    ...values(inventory.disks).map((resource) => ["disk", resource]),
    ...values(inventory.filesystems).map((resource) => ["filesystem", resource]),
    ...values(inventory.snapshots).map((resource) => ["snapshot", resource]),
    ...values(inventory.images).map((resource) => ["image", resource]),
    ...values(inventory.addresses).map((resource) => ["address", resource])
  ];
}

function managedResources(inventory) {
  return allResources(inventory)
    .filter(([type, resource]) => type !== "address" || (
      resource.externalIpv4Address && resource.reserved
    ));
}

function assertInstanceDependencies(inventory) {
  const instanceIds = new Set(values(inventory.instances).map(({ id }) => id));
  const disksById = new Map(values(inventory.disks).map((disk) => [disk.id, disk]));
  const filesystemIds = new Set(values(inventory.filesystems).map(({ id }) => id));
  const instanceDiskIds = new Map();
  const diskInstanceIds = new Map();

  for (const instance of values(inventory.instances)) {
    if (!instance.bootDisk?.diskId) throw new Error(`missing_instance_boot_disk:${instance.id}`);
    const attachedDiskIds = [
      instance.bootDisk.diskId,
      ...optionalResourceArray(instance, "secondaryDisks", "instance").map(({ diskId }) => diskId)
    ];
    for (const diskId of attachedDiskIds) {
      if (!diskId || !disksById.has(diskId)) throw new Error(`untracked_instance_disk:${instance.id}:${diskId ?? "missing"}`);
    }
    instanceDiskIds.set(instance.id, new Set(attachedDiskIds));

    for (const { filesystemId } of optionalResourceArray(instance, "filesystems", "instance")) {
      if (!filesystemId || !filesystemIds.has(filesystemId)) {
        throw new Error(`untracked_instance_filesystem:${instance.id}:${filesystemId ?? "missing"}`);
      }
    }
  }

  for (const disk of values(inventory.disks)) {
    const attachedInstanceIds = optionalResourceArray(disk, "instanceIds", "disk");
    diskInstanceIds.set(disk.id, new Set(attachedInstanceIds));
    for (const instanceId of attachedInstanceIds) {
      if (!instanceId) throw new Error(`invalid_disk_instance_reference:${disk.id}`);
      if (!instanceIds.has(instanceId)) throw new Error(`untracked_disk_instance:${disk.id}:${instanceId}`);
      if (!instanceDiskIds.get(instanceId).has(disk.id)) {
        throw new Error(`disk_instance_reference_mismatch:${disk.id}:${instanceId}`);
      }
    }
  }

  for (const [instanceId, attachedDiskIds] of instanceDiskIds) {
    for (const diskId of attachedDiskIds) {
      if (!diskInstanceIds.get(diskId).has(instanceId)) {
        throw new Error(`instance_disk_reference_mismatch:${instanceId}:${diskId}`);
      }
    }
  }
}

export function assertInventoryBoundary(inventory, expectedFolderId, expectedProbeId, expectedExpiresAt) {
  assertInventoryShape(inventory);
  if (!expectedFolderId) throw new Error("invalid_expected_folder_id");
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(expectedProbeId ?? "")) throw new Error("invalid_expected_probe_id");
  if (!/^\d+$/.test(expectedExpiresAt ?? "")) throw new Error("invalid_expected_probe_expiry");

  const seen = new Set();
  for (const [type, resource] of allResources(inventory)) {
    if (!resource?.id) throw new Error(`invalid_resource_id:${type}`);
    if (resource.folderId !== expectedFolderId) throw new Error(`resource_folder_mismatch:${type}:${resource.id}`);
    const key = `${type}:${resource.id}`;
    if (seen.has(key)) throw new Error(`duplicate_inventory_resource:${key}`);
    seen.add(key);
  }

  for (const [type, resource] of managedResources(inventory)) {
    if (resource.labels?.janitor !== JANITOR_ID) throw new Error(`unexpected_unmanaged_resource:${type}:${resource.id}`);
    if (resource.labels?.probe_id !== expectedProbeId) throw new Error(`unexpected_probe_resource:${type}:${resource.id}`);
    if (!/^\d+$/.test(resource.labels?.expires_at ?? "")) throw new Error(`invalid_resource_expiry_label:${type}:${resource.id}`);
    if (resource.labels.expires_at !== expectedExpiresAt) throw new Error(`unexpected_resource_expiry:${type}:${resource.id}`);
  }

  assertInstanceDependencies(inventory);
}

export { JANITOR_ID };
