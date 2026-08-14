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
  filesystem: {
    collection: "filesystems",
    listUrl: "https://compute.api.cloud.yandex.net/compute/v1/filesystems",
    deleteUrl: "https://compute.api.cloud.yandex.net/compute/v1/filesystems"
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function responseBody(response, invalidResponseCode) {
  const text = await response.text();
  if (!text) {
    if (invalidResponseCode) throw new YcApiError(invalidResponseCode, response.status, "empty_body");
    return {};
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    if (invalidResponseCode) throw new YcApiError(invalidResponseCode, response.status, "malformed_json");
    return { message: text.slice(0, 300) };
  }
  if (invalidResponseCode && !isRecord(body)) {
    throw new YcApiError(invalidResponseCode, response.status, "non_object_body");
  }
  return body;
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
      const body = await responseBody(response, response.ok ? `list_${type}_invalid_response` : undefined);
      if (!response.ok) throw new YcApiError(`list_${type}_failed`, response.status, errorDetail(body));
      const collection = body[definition.collection];
      if (collection !== undefined && !Array.isArray(collection)) {
        throw new YcApiError(`list_${type}_invalid_response`, response.status, "invalid_collection");
      }
      if (collection === undefined && Object.keys(body).length > 0) {
        throw new YcApiError(`list_${type}_invalid_response`, response.status, "missing_collection");
      }
      if (body.nextPageToken !== undefined && typeof body.nextPageToken !== "string") {
        throw new YcApiError(`list_${type}_invalid_response`, response.status, "invalid_page_token");
      }
      result.push(...(collection ?? []));
      pageToken = body.nextPageToken || undefined;
      if (pageToken && seenTokens.has(pageToken)) throw new Error(`repeated_page_token:${type}`);
      if (pageToken) seenTokens.add(pageToken);
    } while (pageToken);

    return result;
  }

  function inspectOperation(body, action, expectedOperationId) {
    const invalidCode = `delete_${action.type}_invalid_operation`;
    if (!isRecord(body) || typeof body.id !== "string" || !body.id) {
      throw new YcApiError(invalidCode, 200, "missing_operation_id");
    }
    if (expectedOperationId && body.id !== expectedOperationId) {
      throw new YcApiError(invalidCode, 200, "operation_id_mismatch");
    }
    if (body.done !== undefined && typeof body.done !== "boolean") {
      throw new YcApiError(invalidCode, 200, "invalid_done_flag");
    }

    const hasError = Object.hasOwn(body, "error");
    const hasResponse = Object.hasOwn(body, "response");
    if (body.done === true) {
      if (hasError === hasResponse) throw new YcApiError(invalidCode, 200, "invalid_operation_result_count");
      if (hasError) throw new YcApiError(`delete_${action.type}_operation_failed`, 200, errorDetail(body));
      if (!isRecord(body.response)) throw new YcApiError(invalidCode, 200, "invalid_operation_result");
      return { status: "deleted", operationId: body.id };
    }
    if (hasResponse) throw new YcApiError(invalidCode, 200, "result_before_completion");
    if (hasError && !isRecord(body.error)) throw new YcApiError(invalidCode, 200, "invalid_pending_error");
    return null;
  }

  async function waitForOperation(body, action, deadlineMs) {
    let failureObserved = Object.hasOwn(body, "error");
    const immediate = inspectOperation(body, action);
    if (immediate) return immediate;
    const operationId = body.id;

    while (remainingMs(deadlineMs) > 0) {
      await boundedSleep(operationPollMs, deadlineMs);
      const response = await request(`${OPERATION_URL}/${encodeURIComponent(operationId)}`, {}, deadlineMs);
      const current = await responseBody(response, response.ok ? `delete_${action.type}_invalid_operation` : undefined);
      if (!response.ok) throw new YcApiError("operation_get_failed", response.status, errorDetail(current));
      const completed = inspectOperation(current, action, operationId);
      if (completed && failureObserved) {
        throw new YcApiError(`delete_${action.type}_invalid_operation`, 200, "success_after_pending_error");
      }
      if (completed) return completed;
      failureObserved ||= Object.hasOwn(current, "error");
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
    if (response.status === 404) return { status: "gone", operationId: null };
    const body = await responseBody(response, response.ok ? `delete_${action.type}_invalid_operation` : undefined);
    if (!response.ok) throw new YcApiError(`delete_${action.type}_failed`, response.status, errorDetail(body));
    return waitForOperation(body, action, deadlineMs);
  }

  return {
    async folder(folderId, { deadlineMs } = {}) {
      const response = await request(`${FOLDER_URL}/${encodeURIComponent(folderId)}`, {}, deadlineMs);
      const body = await responseBody(response, response.ok ? "folder_get_invalid_response" : undefined);
      if (!response.ok) throw new YcApiError("folder_get_failed", response.status, errorDetail(body));
      return body;
    },
    async inventory(folderId, { deadlineMs } = {}) {
      const [instances, disks, filesystems, snapshots, images, addresses] = await Promise.all([
        listAll("instance", folderId, deadlineMs),
        listAll("disk", folderId, deadlineMs),
        listAll("filesystem", folderId, deadlineMs),
        listAll("snapshot", folderId, deadlineMs),
        listAll("image", folderId, deadlineMs),
        listAll("address", folderId, deadlineMs)
      ]);
      return { instances, disks, filesystems, snapshots, images, addresses };
    },
    remove
  };
}
