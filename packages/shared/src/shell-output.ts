import { StringDecoder } from "node:string_decoder";

// One output policy for every shell the agent uses. A command's output is captured with its
// beginning and end kept, the model sees a window of that, and anything longer is saved to a file
// the agent can read in pieces. Persistent shells already keep a log file, so they share the window
// and point at the log.

export const SHELL_OUTPUT_HEAD_CHARS = 10_000;
export const SHELL_OUTPUT_TAIL_CHARS = 10_000;
// The most one task keeps on disk as saved command output; the oldest files go first.
export const SHELL_OUTPUT_TASK_BUDGET_BYTES = 16 * 1024 * 1024;
export const SHELL_OUTPUT_DIRNAME = "shell-output";

export interface ShellOutputWindow {
  head: number;
  tail: number;
}

export const DEFAULT_SHELL_OUTPUT_WINDOW: ShellOutputWindow = {
  head: SHELL_OUTPUT_HEAD_CHARS,
  tail: SHELL_OUTPUT_TAIL_CHARS
};

// Keeps the first and last characters of a stream so a long run never grows without bound and the
// end, where errors usually are, survives.
export class BoundedOutputCapture {
  private readonly headLimit: number;
  private readonly tailLimit: number;
  private readonly decoder = new StringDecoder("utf8");
  private head = "";
  private tail = "";
  private total = 0;

  constructor(maxChars: number) {
    this.headLimit = Math.floor(maxChars / 2);
    this.tailLimit = maxChars - this.headLimit;
  }

  push(chunk: Buffer | string): void {
    const text = typeof chunk === "string" ? chunk : this.decoder.write(chunk);
    if (text.length === 0) return;
    this.total += text.length;
    const room = this.headLimit - this.head.length;
    if (room > 0) {
      this.head += text.slice(0, room);
      this.append(text.slice(room));
      return;
    }
    this.append(text);
  }

  get totalLength(): number {
    return this.total;
  }

  get text(): string {
    const omitted = this.total - this.head.length - this.tail.length;
    return omitted > 0 ? `${this.head}\n...[${omitted} characters omitted]...\n${this.tail}` : this.head + this.tail;
  }

  private append(text: string): void {
    if (text.length === 0) return;
    const combined = this.tail + text;
    this.tail = combined.length > this.tailLimit ? combined.slice(combined.length - this.tailLimit) : combined;
  }
}

export function isOutputOverWindow(length: number, window: ShellOutputWindow): boolean {
  return length > window.head + window.tail;
}

// The part of the output the model sees. `savedTo` names where the rest can be read.
export function windowShellOutput(
  output: string,
  fullLength: number,
  window: ShellOutputWindow,
  savedTo: string | null = null
): string {
  if (!isOutputOverWindow(fullLength, window)) return output;
  const marker = `...[truncated; full output length: ${fullLength} characters${savedTo ? `; saved to ${savedTo}` : ""}]`;
  const head = window.head > 0 ? output.slice(0, window.head) : "";
  const tailStart = Math.max(head.length, output.length - window.tail);
  const tail = window.tail > 0 && tailStart < output.length ? output.slice(tailStart) : "";
  return [head, marker, tail].filter((part) => part.length > 0).join("\n");
}
