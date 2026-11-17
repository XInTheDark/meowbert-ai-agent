// The provider SDK's timeout only covers the wait for response headers. Once a stream is open, a
// provider that stops sending would hold the run (and its queue lock) forever, so a stream that goes
// this long without an event is abandoned and retried like any other timeout.
export const MODEL_STREAM_IDLE_TIMEOUT_MS = 15 * 60_000;

export class ModelStreamStalledError extends Error {
  constructor(idleMs: number) {
    super(`Request timed out: the model response stream sent nothing for ${Math.round(idleMs / 1000)}s.`);
    this.name = "ModelStreamStalledError";
  }
}

export interface StreamIdleTimeout {
  signal: AbortSignal;
  // Call on every stream event.
  touch(): void;
  // Turns an abort caused by the idle limit into a timeout error; anything else passes through.
  translate(error: unknown): unknown;
  dispose(): void;
}

export function createStreamIdleTimeout(idleMs: number, outer?: AbortSignal): StreamIdleTimeout {
  const idle = new AbortController();
  let timer = setTimeout(() => idle.abort(), idleMs);
  return {
    signal: outer ? AbortSignal.any([outer, idle.signal]) : idle.signal,
    touch() {
      clearTimeout(timer);
      timer = setTimeout(() => idle.abort(), idleMs);
    },
    translate(error) {
      return idle.signal.aborted && !outer?.aborted ? new ModelStreamStalledError(idleMs) : error;
    },
    dispose() {
      clearTimeout(timer);
    }
  };
}
