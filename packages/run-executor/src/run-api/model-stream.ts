import type { RunApiModelStreamEvent } from "@meowbert/shared";

export async function readModelStream(response: Response): Promise<{ status: number; body: unknown }> {
  if (!response.body) throw new Error("The Run API model response stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const next = await reader.read();
      buffer += decoder.decode(next.value, { stream: !next.done });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      if (next.done && buffer.trim()) lines.push(buffer);
      for (const line of lines) {
        if (!line.trim()) continue;
        const event = JSON.parse(line) as RunApiModelStreamEvent;
        if (event.type === "heartbeat") continue;
        if (event.type !== "result" || !Number.isInteger(event.status) || !("body" in event)) {
          throw new Error("The Run API sent an invalid model response.");
        }
        return { status: event.status, body: event.body };
      }
      if (next.done) throw new Error("The Run API model response stream ended before a result arrived.");
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
