import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";
import { readSandboxCrashReport, tailSandboxEventLog } from "./docker-sandbox-crash-report.js";

function eventLine(action: string, seconds: number, attributes: Record<string, string> = {}): string {
  return JSON.stringify({ Action: action, timeNano: seconds * 1_000_000_000, Actor: { Attributes: attributes } });
}

function fakeDocker(input: { inspect: () => Promise<unknown>; events: string[] }) {
  return {
    getContainer: () => ({ inspect: input.inspect }),
    getEvents: async () => Readable.from([input.events.join("\n")])
  };
}

describe("readSandboxCrashReport", () => {
  it("returns null while the container is running", async () => {
    const docker = fakeDocker({ inspect: async () => ({ State: { Running: true } }), events: [] });

    await expect(readSandboxCrashReport(docker as never, "abc")).resolves.toBeNull();
  });

  it("reports Docker state, limits, and lifecycle events for a dead container", async () => {
    const docker = fakeDocker({
      inspect: async () => ({
        Created: "2026-09-29T00:00:00Z",
        State: { Running: false, Status: "exited", ExitCode: 137, OOMKilled: true, Error: "" },
        HostConfig: { Memory: 640 * 1024 * 1024, NanoCpus: 1_000_000_000, PidsLimit: 400 }
      }),
      events: [
        eventLine("exec_die", 1, { execID: "x" }),
        eventLine("oom", 2, { "com.meowbert.task_id": "t1", image: "sandbox" }),
        eventLine("die", 3, { exitCode: "137" })
      ]
    });

    const report = await readSandboxCrashReport(docker as never, "abc");

    expect(report?.state).toMatchObject({ status: "exited", exitCode: 137, oomKilled: true, error: null });
    expect(report?.limits).toEqual({ memoryMb: 640, cpus: 1, pids: 400 });
    expect(report?.recentEvents.split("\n")).toEqual([
      "1970-01-01T00:00:02.000Z oom image=sandbox",
      "1970-01-01T00:00:03.000Z die exitCode=137"
    ]);
  });

  it("still reports events after the container was removed", async () => {
    const docker = fakeDocker({
      inspect: async () => {
        throw Object.assign(new Error("no such container"), { statusCode: 404 });
      },
      events: [eventLine("die", 3, { exitCode: "128" })]
    });

    const report = await readSandboxCrashReport(docker as never, "abc");

    expect(report).toMatchObject({ state: null, limits: null });
    expect(report?.recentEvents).toContain("die exitCode=128");
  });
});

describe("tailSandboxEventLog", () => {
  it("keeps only the most recent ~4KB of events", () => {
    const events = Array.from({ length: 500 }, (_, index) => eventLine("kill", index, { signal: "15" })).join("\n");

    const tail = tailSandboxEventLog(events);

    expect(tail.length).toBeLessThanOrEqual(4096);
    expect(tail.endsWith("kill signal=15")).toBe(true);
    expect(tail).toContain(new Date(499_000).toISOString());
  });
});
