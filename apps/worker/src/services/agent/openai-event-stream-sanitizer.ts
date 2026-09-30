const EMPTY_LINE_BOUNDARY = /\r\n\r\n|\n\n|\r\r/;
const DATA_LINE_PREFIX = "data:";
const EVENT_LINE_PREFIX = "event:";

interface FrameBoundaryMatch {
  index: number;
  length: number;
}

function findFrameBoundary(buffer: string): FrameBoundaryMatch | null {
  const match = EMPTY_LINE_BOUNDARY.exec(buffer);
  if (!match || match.index < 0) {
    return null;
  }

  return {
    index: match.index,
    length: match[0].length
  };
}

function splitFrameLines(frame: string): string[] {
  return frame.split(/\r\n|\n|\r/);
}

function isMalformedEventOnlyFrame(frame: string): boolean {
  const lines = splitFrameLines(frame).filter((line) => line.length > 0);
  if (lines.length === 0) {
    return false;
  }

  const hasEventLine = lines.some((line) => line.startsWith(EVENT_LINE_PREFIX));
  if (!hasEventLine) {
    return false;
  }

  const dataLines = lines.filter((line) => line.startsWith(DATA_LINE_PREFIX));
  if (dataLines.length === 0) {
    return true;
  }

  return dataLines.every((line) => line.slice(DATA_LINE_PREFIX.length).trim().length === 0);
}

function createSanitizedEventStreamBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      reader = body.getReader();
      let buffer = "";

      const flushFrames = (flushRemainder: boolean): void => {
        while (true) {
          const boundary = findFrameBoundary(buffer);
          if (!boundary) {
            break;
          }

          const frame = buffer.slice(0, boundary.index);
          buffer = buffer.slice(boundary.index + boundary.length);
          if (!isMalformedEventOnlyFrame(frame)) {
            controller.enqueue(encoder.encode(`${frame}\n\n`));
          }
        }

        if (!flushRemainder || buffer.length === 0) {
          return;
        }

        if (!isMalformedEventOnlyFrame(buffer)) {
          controller.enqueue(encoder.encode(buffer));
        }
        buffer = "";
      };

      try {
        while (reader) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          flushFrames(false);
        }

        buffer += decoder.decode();
        flushFrames(true);
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader?.releaseLock();
      }
    },
    async cancel(reason) {
      await reader?.cancel(reason);
    }
  });
}

export function sanitizeOpenAiEventStreamResponse(response: Response): Response {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("text/event-stream") || !response.body) {
    return response;
  }

  const sanitized = new Response(createSanitizedEventStreamBody(response.body), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  });

  try {
    Object.defineProperties(sanitized, {
      url: { value: response.url },
      redirected: { value: response.redirected },
      type: { value: response.type }
    });
  } catch {
    // Best-effort only; response metadata is not required for correctness.
  }

  return sanitized;
}
