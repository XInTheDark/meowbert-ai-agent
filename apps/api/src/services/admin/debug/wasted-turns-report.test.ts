import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/db.js", () => ({ query: vi.fn() }));

import { query } from "../../../lib/db.js";
import { buildWastedTurnsReport } from "./wasted-turns-report.js";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const taskId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";

describe("buildWastedTurnsReport", () => {
  const mockedQuery = vi.mocked(query);

  beforeEach(() => {
    vi.clearAllMocks();
    mockedQuery.mockImplementation((async (sql: string) => {
      if (sql.includes("FROM tasks WHERE id = ANY")) return { rows: [{ id: taskId, title: "Audit" }] };
      if (sql.includes("AS diagnostic_count")) {
        return { rows: [{ task_count: "2", turns: "10", weighted_tokens: "1000", diagnostic_count: "4" }] };
      }
      return {
        rows: [
          { task_id: taskId, title: "Audit", payload_json: { stage: "run.turn.no_action", incompleteReason: "max_output_tokens", outputTypes: ["reasoning"] }, weighted_tokens: "100" },
          { task_id: workerId, title: "Worker 1", payload_json: { stage: "run.turn.no_action", outputTypes: ["reasoning"] }, weighted_tokens: "300" },
          { task_id: workerId, title: "Worker 1", payload_json: { stage: "run.turn.plain_text" }, weighted_tokens: null }
        ]
      };
    }) as never);
  });

  it("finds the task in a URL and totals wasted turns by cause and agent", async () => {
    const report = await buildWastedTurnsReport(`https://meowbert.example/w/${workspaceId}/tasks/${taskId}`);

    expect(mockedQuery.mock.calls[0][1]).toEqual([[taskId, workspaceId]]);
    expect(report).toMatchObject({
      taskId,
      hasTurnDiagnostics: true,
      scopeTaskCount: 2,
      allTurns: { turns: 10, weightedTokens: 1000 },
      wasted: { turns: 3, weightedTokens: 400, unmeteredTurns: 1 }
    });
    expect(report.byKind).toEqual(expect.arrayContaining([
      { kind: "output_limit", turns: 1, weightedTokens: 100 },
      { kind: "reasoning_only", turns: 1, weightedTokens: 300 },
      { kind: "plain_text", turns: 1, weightedTokens: 0 }
    ]));
    expect(report.byTask[0]).toEqual({ taskId: workerId, title: "Worker 1", turns: 2, weightedTokens: 300 });
  });

  it("rejects input without a task id", async () => {
    await expect(buildWastedTurnsReport("https://meowbert.example/tasks")).rejects.toThrow("No task id");
  });
});
