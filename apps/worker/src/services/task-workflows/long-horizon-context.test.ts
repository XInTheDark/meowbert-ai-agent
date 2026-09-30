import type { QueryResult } from "pg";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/db.js", () => ({
  query: vi.fn()
}));

import { query } from "../../lib/db.js";
import { loadLongHorizonBudgetTelemetry } from "./long-horizon-context.js";

function buildRowsResult<Row extends object>(rows: Row[]): QueryResult<Row> {
  return {
    command: "SELECT",
    fields: [],
    oid: 0,
    rows,
    rowCount: rows.length
  };
}

describe("loadLongHorizonBudgetTelemetry", () => {
  it("loads current usage and elapsed time on each call", async () => {
    const mockedQuery = vi.mocked(query);
    mockedQuery.mockReset();
    vi.useFakeTimers();

    try {
      vi.setSystemTime(new Date("2026-08-29T00:05:00.000Z"));
      mockedQuery.mockResolvedValueOnce(buildRowsResult([
        { total_tokens: "120", created_at: new Date("2026-08-29T00:00:00.000Z") }
      ]));

      await expect(loadLongHorizonBudgetTelemetry({
        workflowTaskId: "workflow-1",
        timeBudgetMinutes: 10
      })).resolves.toEqual({
        observedTokenUsage: 120,
        elapsedSeconds: 300,
        remainingSeconds: 300,
        isApproachingTimeLimit: false
      });

      vi.setSystemTime(new Date("2026-08-29T00:09:00.000Z"));
      mockedQuery.mockResolvedValueOnce(buildRowsResult([
        { total_tokens: "480", created_at: new Date("2026-08-29T00:00:00.000Z") }
      ]));

      await expect(loadLongHorizonBudgetTelemetry({
        workflowTaskId: "workflow-1",
        timeBudgetMinutes: 10
      })).resolves.toEqual({
        observedTokenUsage: 480,
        elapsedSeconds: 540,
        remainingSeconds: 60,
        isApproachingTimeLimit: true
      });
    } finally {
      vi.useRealTimers();
    }
  });
});
