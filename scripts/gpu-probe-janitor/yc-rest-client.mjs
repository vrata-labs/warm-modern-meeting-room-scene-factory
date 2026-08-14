const RESOURCES = Object.freeze({
  instance: {
    collection: "instances",
    listUrl: "https://compute.api.cloud.yandex.net/compute/v1/instances",
    deleteUrl: "https://compute.api.cloud.yandex.net/compute/v1/instances"
  },
  disk: {
    collection: "disks",
    listUrl: "https://compute.api.cloud.yandex.net/compute/v1/disks",
    deleteUrl: "https://compute.api.cloud.yandex.net/compute/v1/disks"
  },
  snapshot: {
    collection: "snapshots",
    listUrl: "https://compute.api.cloud.yandex.net/compute/v1/snapshots",
    deleteUrl: "https://compute.api.cloud.yandex.net/compute/v1/snapshots"
  },
  image: {
    collection: "images",
    listUrl: "https://compute.api.cloud.yandex.net/compute/v1/images",
    deleteUrl: "https://compute.api.cloud.yandex.net/compute/v1/images"
  },
  address: {
    collection: "addresses",
    listUrl: "https://vpc.api.cloud.yandex.net/vpc/v1/addresses",
    deleteUrl: "https://vpc.api.cloud.yandex.net/vpc/v1/addresses"
  }
});

const FOLDER_URL = "https://resource-manager.api.cloud.yandex.net/resource-manager/v1/folders";
const OPERATION_URL = "https://operation.api.cloud.yandex.net/operations";

export class YcApiError extends Error {
  constructor(code, status, detail) {
    super(`${code}:${status}${detail ? `:${detail}` : ""}`);
    this.name = "YcApiError";
    this.code = code;
    this.status = status;
  }
}

async function responseBody(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { message: text.slice(0, 300) };
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function errorDetail(body) {
  return body?.error?.message ?? body?.message ?? body?.code ?? "provider_error";
}

export function createYcRestClient({
  token,
  fetchImpl = fetch,
  sleep = wait,
  clock = () => Date.now(),
  requestTimeoutMs = 5000,
  operationPollMs = 200
}) {
  if (!token) throw new Error("missing_yc_iam_token");

  function remainingMs(deadlineMs) {
    return deadlineMs === undefined ? requestTimeoutMs : deadlineMs - clock();
  }

  async function boundedSleep(milliseconds, deadlineMs) {
    const remaining = remainingMs(deadlineMs);
    if (remaining <= 0) throw new YcApiError("janitor_deadline_exhausted", 408);
    await sleep(Math.min(milliseconds, remaining));
  }

  async function request(input, init = {}, deadlineMs) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remaining = remainingMs(deadlineMs);
      if (remaining <= 0) throw new YcApiError("janitor_deadline_exhausted", 408);
      try {
        const response = await fetchImpl(input, {
          ...init,
          headers: {
            Authorization: `Bearer ${token}`,
            ...(init.headers ?? {})
          },
          signal: AbortSignal.timeout(Math.max(1, Math.min(requestTimeoutMs, remaining)))
        });
        if ((response.status === 429 || response.status >= 500) && attempt < 2) {
          await boundedSleep(100 * (attempt + 1), deadlineMs);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt >= 2) break;
        await boundedSleep(100 * (attempt + 1), deadlineMs);
      }
    }
    throw new YcApiError("yc_request_failed", 0, lastError?.name ?? "network_error");
  }

  async function listAll(type, folderId, deadlineMs) {
    const definition = RESOURCES[type];
    const result = [];
    const seenTokens = new Set();
    let pageToken;

    do {
      const url = new URL(definition.listUrl);
      url.searchParams.set("folderId", folderId);
      url.searchParams.set("pageSize", "1000");
      if (pageToken) url.searchParams.set("pageToken", pageToken);
      const response = await request(url, {}, deadlineMs);
      const body = await responseBody(response);
      if (!response.ok) throw new YcApiError(`list_${type}_failed`, response.status, errorDetail(body));
      result.push(...(body[definition.collection] ?? []));
      pageToken = body.nextPageToken || undefined;
      if (pageToken && seenTokens.has(pageToken)) throw new Error(`repeated_page_token:${type}`);
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);

    return result;
  }

  function completedOperation(body, action) {
    if (body.error) throw new YcApiError(`delete_${action.type}_operation_failed`, 200, errorDetail(body));
    return { status: "deleted", operationId: body.id ?? null };
  }

  async function waitForOperation(body, action, deadlineMs) {
    if (body.done === true) return completedOperation(body, action);
    if (!body.id) throw new YcApiError(`delete_${action.type}_invalid_operation`, 200);

    while (remainingMs(deadlineMs) > 0) {
      await boundedSleep(operationPollMs, deadlineMs);
      const response = await request(`${OPERATION_URL}/${encodeURIComponent(body.id)}`, {}, deadlineMs);
      const current = await responseBody(response);
      if (!response.ok) throw new YcApiError("operation_get_failed", response.status, errorDetail(current));
      if (current.done === true) return completedOperation(current, action);
    }

    throw new YcApiError(`delete_${action.type}_operation_pending`, 408);
  }

  async function remove(action, idempotencyKey, { deadlineMs = clock() + 15000 } = {}) {
    const definition = RESOURCES[action.type];
    if (!definition) throw new Error(`unknown_resource_type:${action.type}`);
    const response = await request(`${definition.deleteUrl}/${encodeURIComponent(action.id)}`, {
      method: "DELETE",
      headers: { "Idempotency-Key": idempotencyKey }
    }, deadlineMs);
    const body = await responseBody(response);
    if (response.status === 404) return { status: "gone", operationId: null };
    if (!response.ok) throw new YcApiError(`delete_${action.type}_failed`, response.status, errorDetail(body));
    return waitForOperation(body, action, deadlineMs);
  }

  return {
    async folder(folderId, { deadlineMs } = {}) {
      const response = await request(`${FOLDER_URL}/${encodeURIComponent(folderId)}`, {}, deadlineMs);
      const body = await responseBody(response);
      if (!response.ok) throw new YcApiError("folder_get_failed", response.status, errorDetail(body));
      return body;
    },
    async inventory(folderId, { deadlineMs } = {}) {
      const [instances, disks, snapshots, images, addresses] = await Promise.all([
        listAll("instance", folderId, deadlineMs),
        listAll("disk", folderId, deadlineMs),
        listAll("snapshot", folderId, deadlineMs),
        listAll("image", folderId, deadlineMs),
        listAll("address", folderId, deadlineMs)
      ]);
      return { instances, disks, snapshots, images, addresses };
    },
    remove
  };
}
