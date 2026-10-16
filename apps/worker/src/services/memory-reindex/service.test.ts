import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/redis.js", () => ({ redis: {} }));
vi.mock("../workspaces/workspace-storage.js", () => ({
  resolveTaskWorkspaceRoot: vi.fn(async ({ workspaceId }: { workspaceId: string }) => `/workspaces/${workspaceId}`)
}));
vi.mock("../memory/index.js", () => ({ syncWorkspaceMemoryOnce: vi.fn() }));
vi.mock("./job-store.js", () => ({
  claimReindexJob: vi.fn(),
  finishReindexJob: vi.fn(),
  listMemoryEnabledWorkspaces: vi.fn(),
  markWorkspaceFinished: vi.fn(),
  markWorkspaceStarted: vi.fn(),
  setReindexTotal: vi.fn(),
  touchReindexJob: vi.fn()
}));

import { syncWorkspaceMemoryOnce } from "../memory/index.js";
import {
  finishReindexJob,
  listMemoryEnabledWorkspaces,
  markWorkspaceFinished,
  markWorkspaceStarted
} from "./job-store.js";
import { runReindexJob } from "./service.js";

const workspaces = Array.from({ length: 6 }, (_, index) => ({
  id: `00000000-0000-0000-0000-00000000000${index}`,
  name: `ws${index}`,
  root_path: null,
  storage_backend_id: null
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listMemoryEnabledWorkspaces).mockResolvedValue(workspaces);
  vi.mocked(markWorkspaceStarted).mockResolvedValue(true);
});

describe("runReindexJob", () => {
  it("never syncs more workspaces at once than the job's concurrency", async () => {
    let inFlight = 0;
    let peak = 0;
    vi.mocked(syncWorkspaceMemoryOnce).mockImplementation(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return null;
    });

    await runReindexJob({ id: "job", concurrency: 2 }, () => false);

    expect(peak).toBe(2);
    expect(syncWorkspaceMemoryOnce).toHaveBeenCalledTimes(6);
    expect(finishReindexJob).toHaveBeenCalledWith("job");
  });

  it("records a failed workspace and keeps going", async () => {
    vi.mocked(syncWorkspaceMemoryOnce)
      .mockResolvedValueOnce({ state: "error", error: "embedding failed" } as never)
      .mockResolvedValue(null);

    await runReindexJob({ id: "job", concurrency: 1 }, () => false);

    expect(markWorkspaceFinished).toHaveBeenCalledWith("job", expect.stringContaining("ws0"), "embedding failed");
    expect(markWorkspaceFinished).toHaveBeenCalledTimes(6);
  });

  it("stops picking up workspaces once the job is cancelled", async () => {
    vi.mocked(syncWorkspaceMemoryOnce).mockResolvedValue(null);
    vi.mocked(markWorkspaceStarted).mockResolvedValueOnce(true).mockResolvedValue(false);

    await runReindexJob({ id: "job", concurrency: 1 }, () => false);

    expect(syncWorkspaceMemoryOnce).toHaveBeenCalledTimes(1);
  });

  it("leaves the job running for another worker when shutting down", async () => {
    await runReindexJob({ id: "job", concurrency: 2 }, () => true);

    expect(syncWorkspaceMemoryOnce).not.toHaveBeenCalled();
    expect(finishReindexJob).not.toHaveBeenCalled();
  });
});
