export interface DeviceApiOptions { apiBaseUrl: string; token: string; fetch?: typeof fetch }
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
      if (!response.ok) throw new Error("Local execution request failed with HTTP " + response.status);
      return await response.json() as T;
    },
    async stream(route: string, onRuns: (runs: unknown[]) => void): Promise<void> {
      const response = await fetchImpl(options.apiBaseUrl + route, { headers, signal });
      if (!response.ok || !response.body) throw new Error("Device run stream is unavailable.");
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      try {
        while (!signal.aborted) {
          const next = await reader.read();
          if (next.done) break;
          buffer += decoder.decode(next.value, { stream: true });
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";
          for (const chunk of chunks) {
            if (!/^event: runs$/m.test(chunk)) continue;
            const parsed: unknown = JSON.parse(chunk.match(/^data: (.+)$/m)?.[1] ?? "null");
            if (Array.isArray(parsed)) onRuns(parsed);
          }
        }
      } finally { await reader.cancel().catch(() => undefined); }
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
