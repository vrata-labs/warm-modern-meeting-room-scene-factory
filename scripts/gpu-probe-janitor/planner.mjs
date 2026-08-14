import { isResourceExpired } from "./expiry-policy.mjs";

function values(value) {
  return Array.isArray(value) ? value : [];
}

function action(phase, type, resource, reason) {
  return { phase, type, id: resource.id, reason };
}

function externalAddressValues(instance) {
  return values(instance.networkInterfaces)
    .map((networkInterface) => networkInterface.primaryV4Address?.oneToOneNat?.address)
    .filter(Boolean);
}

export function planSweep(inventory, nowMs, hardMaxAgeSeconds) {
  const instances = values(inventory.instances);
  const disks = values(inventory.disks);
  const snapshots = values(inventory.snapshots);
  const images = values(inventory.images);
  const addresses = values(inventory.addresses);

  const expiredInstances = instances.filter((resource) => isResourceExpired(resource, nowMs, hardMaxAgeSeconds));
  const dependentDiskIds = new Set(expiredInstances.flatMap((instance) => [
    instance.bootDisk?.diskId,
    ...values(instance.secondaryDisks).map(({ diskId }) => diskId)
  ].filter(Boolean)));
  const dependentAddressValues = new Set(expiredInstances.flatMap(externalAddressValues));

  const expiredDiskIds = new Set(disks
    .filter((resource) => dependentDiskIds.has(resource.id) || isResourceExpired(resource, nowMs, hardMaxAgeSeconds))
    .map(({ id }) => id));

  const actions = expiredInstances.map((resource) => action(0, "instance", resource, "expired"));
  const deferred = [];

  for (const resource of snapshots) {
    if (isResourceExpired(resource, nowMs, hardMaxAgeSeconds)) actions.push(action(1, "snapshot", resource, "expired"));
  }

  for (const resource of images) {
    if (isResourceExpired(resource, nowMs, hardMaxAgeSeconds)) actions.push(action(1, "image", resource, "expired"));
  }

  for (const resource of disks) {
    if (!expiredDiskIds.has(resource.id)) continue;
    if (values(resource.instanceIds).length > 0) {
      deferred.push({ type: "disk", id: resource.id, reason: "still-attached" });
    } else {
      actions.push(action(2, "disk", resource, dependentDiskIds.has(resource.id) ? "expired-instance-disk" : "expired"));
    }
  }

  for (const resource of addresses) {
    if (!resource.externalIpv4Address || !resource.reserved) continue;
    const addressValue = resource.externalIpv4Address?.address;
    const expired = dependentAddressValues.has(addressValue) || isResourceExpired(resource, nowMs, hardMaxAgeSeconds);
    if (!expired) continue;
    if (resource.used) {
      deferred.push({ type: "address", id: resource.id, reason: "still-used" });
    } else if (resource.reserved) {
      actions.push(action(3, "address", resource, dependentAddressValues.has(addressValue) ? "expired-instance-address" : "expired"));
    }
  }

  actions.sort((left, right) => left.phase - right.phase || left.type.localeCompare(right.type) || left.id.localeCompare(right.id));
  deferred.sort((left, right) => left.type.localeCompare(right.type) || left.id.localeCompare(right.id));

  return {
    actions,
    deferred,
    inventoryCounts: {
      instances: instances.length,
      disks: disks.length,
      snapshots: snapshots.length,
      images: images.length,
      addresses: addresses.length
    }
  };
}
