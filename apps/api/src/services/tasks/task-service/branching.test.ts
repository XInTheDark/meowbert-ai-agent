import { describe, expect, it, vi } from "vitest";
import { resolveActiveLeafMessageIdInTx } from "./branching.js";

function rows<T>(items: T[]) {
  return { rows: items, rowCount: items.length };
}

describe("resolveActiveLeafMessageIdInTx", () => {
  it("shows the branch containing the latest persisted tool completion while the task is running", async () => {
    const client = {
      query: vi.fn()
        .mockResolvedValueOnce(rows([{ id: "recovery-tool-message" }]))
        .mockResolvedValueOnce(rows([{ id: "recovery-tool-leaf" }]))
    };

    await expect(resolveActiveLeafMessageIdInTx(client as never, "task-1", "user-1"))
      .resolves.toBe("recovery-tool-leaf");

    expect(client.query.mock.calls[0]?.[0]).toContain("te.type = 'command_end'");
    expect(client.query.mock.calls[0]?.[0]).toContain("t.status IN ('queued', 'starting', 'running')");
    expect(client.query.mock.calls[0]?.[1]).toEqual(["task-1", "user-1"]);
    expect(client.query.mock.calls[1]?.[1]).toEqual(["task-1", "recovery-tool-message"]);
  });
});
