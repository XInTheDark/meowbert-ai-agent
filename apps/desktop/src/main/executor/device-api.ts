export interface DeviceApiOptions { apiBaseUrl: string; token: string; fetch?: typeof fetch }
export class DeviceApiError extends Error {
  readonly route: string;
  constructor(readonly status: number, route: string, readonly method: string, reason?: string) {
    super("Local execution request failed (" + method + " " + route.split("?")[0] + ", HTTP " + status + ")" + (reason ? ": " + reason : "."));
    this.name = "DeviceApiError";
    this.route = route.split("?")[0];
  }
}
async function responseError(response: Response, route: string, method: string): Promise<DeviceApiError> {
  const payload = response.headers.get("content-type")?.includes("json") ? await response.json().catch(() => null) : null;
  const message = typeof payload?.error === "string" ? payload.error : typeof payload?.message === "string" ? payload.message : undefined;
  return new DeviceApiError(response.status, route, method, message?.slice(0, 500));
}
export function createDeviceApi(options: DeviceApiOptions, signal: AbortSignal) {
  const fetchImpl = options.fetch ?? fetch;
  const headers = { authorization: "Bearer " + options.token };
  return {
    async request<T>(route: string, method = "GET", body?: unknown): Promise<T> {
      const response = await fetchImpl(options.apiBaseUrl + route, {
        method, headers: { ...headers, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)])
      });
      if (!response.ok) throw await responseError(response, route, method);
      return await response.json() as T;
    },
    async stream(route: string, onRuns: (runs: unknown[]) => void, onEvent?: (event: string, data: unknown) => void | Promise<void>): Promise<void> {
      const connection = new AbortController();
      const streamSignal = AbortSignal.any([signal, connection.signal]);
      let timer: ReturnType<typeof setTimeout>;
      const touch = () => { clearTimeout(timer); timer = setTimeout(() => connection.abort(new Error("Device connection timed out.")), 35_000); timer.unref(); };
      touch();
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await fetchImpl(options.apiBaseUrl + route, { headers: { ...headers, "x-meowbert-device-presence": "ack-v1" }, signal: streamSignal });
        if (!response.ok) throw await responseError(response, route, "GET");
        if (!response.body) throw new Error("Device run stream is unavailable.");
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (!streamSignal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          touch(); buffer = (buffer + decoder.decode(next.value, { stream: true })).replace(/\r\n/g, "\n");
          const chunks = buffer.split("\n\n"); buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            const event = chunk.match(/^event: (.+)$/m)?.[1];
            const parsed: unknown = JSON.parse(chunk.match(/^data: (.+)$/m)?.[1] ?? "null");
            if (event !== "runs") { if (event) await onEvent?.(event, parsed); continue; }
            if (Array.isArray(parsed)) onRuns(parsed);
          }
        }
      } finally { clearTimeout(timer!); connection.abort(); await reader?.cancel().catch(() => undefined); }
    }
  };
}
export type DeviceApi = ReturnType<typeof createDeviceApi>;
export function waitForDeviceRetry(signal: AbortSignal, ms = 5_000): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { clearTimeout(timer); signal.removeEventListener("abort", done); resolve(); };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}
