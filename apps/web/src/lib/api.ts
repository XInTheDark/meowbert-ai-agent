import { apiBaseUrl } from "./runtime";
import {
  cachedApiGet,
  invalidateApiCache,
  peekApiCache,
  prefetchApiGet,
  primeApiCache,
  type CachedGetOptions,
  type CachedGetSnapshot
} from "./api-cache";

export interface ApiClient {
  get: <T>(path: string) => Promise<T>;
  cachedGet?: <T>(path: string, options?: CachedGetOptions) => CachedGetSnapshot<T>;
  peekGet?: <T>(path: string) => T | null;
  prefetchGet?: <T>(path: string, options?: CachedGetOptions) => Promise<T>;
  primeGet?: <T>(path: string, value: T) => void;
  invalidateGet?: (input?: { path?: string; pathPrefix?: string }) => void;
  post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) => Promise<T>;
  postForm: <T>(path: string, formData: FormData) => Promise<T>;
  patch: <T>(path: string, body?: unknown) => Promise<T>;
  put: <T>(path: string, body?: unknown) => Promise<T>;
  delete: <T>(path: string) => Promise<T>;
}

export interface ApiRequestOptions {
  credentials?: RequestCredentials;
}

export class ApiError extends Error {
  readonly status: number;
  readonly payload: unknown;

  constructor(message: string, status: number, payload: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.payload = payload;
  }
}

function normalizeErrorStatus(payload: unknown, status: number): string {
  if (payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string") {
    return payload.error;
  }

  return `HTTP ${status}`;
}

export function createApiClient(token: string | null): ApiClient {
  async function parseResponsePayload(response: Response): Promise<unknown> {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json().catch(() => ({} as unknown));
    }

    const text = await response.text().catch(() => "");
    return text ? { error: text } : {};
  }

  async function request<T>(method: string, path: string, body?: unknown, options?: ApiRequestOptions): Promise<T> {
    const hasBody = body !== undefined;
    const headers: Record<string, string> = {
      ...(token ? { authorization: `Bearer ${token}` } : {})
    };
    if (hasBody) {
      headers["content-type"] = "application/json";
    }

    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method,
      headers,
      body: hasBody ? JSON.stringify(body) : undefined,
      credentials: options?.credentials
    });

    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      throw new ApiError(normalizeErrorStatus(payload, response.status), response.status, payload);
    }

    return payload as T;
  }

  async function requestForm<T>(path: string, formData: FormData): Promise<T> {
    const response = await fetch(`${apiBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: formData
    });

    const payload = await parseResponsePayload(response);

    if (!response.ok) {
      throw new ApiError(normalizeErrorStatus(payload, response.status), response.status, payload);
    }

    return payload as T;
  }

  return {
    get: <T>(path: string) => request<T>("GET", path),
    cachedGet: <T>(path: string, options?: CachedGetOptions) =>
      cachedApiGet(token, path, () => request<T>("GET", path), options),
    peekGet: <T>(path: string) => peekApiCache<T>(token, path),
    prefetchGet: <T>(path: string, options?: CachedGetOptions) =>
      prefetchApiGet(token, path, () => request<T>("GET", path), options),
    primeGet: <T>(path: string, value: T) => primeApiCache(token, path, value),
    invalidateGet: (input?: { path?: string; pathPrefix?: string }) =>
      invalidateApiCache(input ? { ...input, token } : { token }),
    post: <T>(path: string, body?: unknown, options?: ApiRequestOptions) => request<T>("POST", path, body, options),
    postForm: <T>(path: string, formData: FormData) => requestForm<T>(path, formData),
    patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
    put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body),
    delete: <T>(path: string) => request<T>("DELETE", path)
  };
}


export { apiBaseUrl, taskEventsUrl, desktopComputerStreamUrl } from "./runtime";
