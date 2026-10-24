import { describe, expect, it } from "vitest";
import { sanitizeOpenAiEventStreamResponse } from "./openai-event-stream-sanitizer.js";

function createReadableStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
}

describe("sanitizeOpenAiEventStreamResponse", () => {
  it("drops event-only keepalive frames that would otherwise break the SDK parser", async () => {
    const response = new Response(createReadableStream([
      "event: response.created\n",
      "data: {\"type\":\"response.created\",\"response\":{\"output\":[]}}\n\n",
      "event: response.reasoning_summary_text.delta\n",
      ": keep-alive\n\n",
      "event: response.completed\n",
      "data: {\"type\":\"response.completed\",\"response\":{\"output\":[]}}\n\n"
    ]), {
      status: 200,
      headers: {
        "content-type": "text/event-stream"
      }
    });

    const sanitized = sanitizeOpenAiEventStreamResponse(response);
    const text = await sanitized.text();

    expect(text).toContain("event: response.created");
    expect(text).toContain("event: response.completed");
    expect(text).not.toContain("event: response.reasoning_summary_text.delta");
    expect(text).not.toContain(": keep-alive");
  });

  it("preserves non-stream responses unchanged", async () => {
    const response = new Response("ok", {
      status: 200,
      headers: {
        "content-type": "application/json"
      }
    });

    const sanitized = sanitizeOpenAiEventStreamResponse(response);
    expect(await sanitized.text()).toBe("ok");
  });

  it("does not drop valid event frames when event and data arrive in separate chunks", async () => {
    const response = new Response(createReadableStream([
      "event: response.output_text.delta\n",
      "data: {\"type\":\"response.output_text.delta\",\"delta\":\"hi\"}\n",
      "\n"
    ]), {
      status: 200,
      headers: {
        "content-type": "text/event-stream"
      }
    });

    const sanitized = sanitizeOpenAiEventStreamResponse(response);
    const text = await sanitized.text();

    expect(text).toContain("event: response.output_text.delta");
    expect(text).toContain("\"delta\":\"hi\"");
  });
});
