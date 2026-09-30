import { describe, expect, it } from "vitest";
import {
  buildTaskHistorySearchParams,
  createTaskHistorySearchQuerySchema,
  extractTaskSearchableText,
  finalizeTaskHistoryPage,
  normalizeTaskHistorySearchInput,
  normalizeTaskHistoryStatusList,
  normalizeTaskHistoryTaskTypeList
} from "./task-history-search.js";

describe("normalizeTaskHistoryStatusList", () => {
  it("deduplicates and trims comma-separated status values", () => {
    expect(normalizeTaskHistoryStatusList([" running , failed ", "running", "invalid"]))
      .toEqual(["running", "failed"]);
  });

  it("returns null when no valid statuses are present", () => {
    expect(normalizeTaskHistoryStatusList("unknown, nope")).toBeNull();
  });
});

describe("normalizeTaskHistorySearchInput", () => {
  it("applies shared defaults and supports limit as a pageSize alias", () => {
    expect(normalizeTaskHistorySearchInput({ q: "  flaky test  ", limit: "7", page: "3" }))
      .toEqual({
        query: "flaky test",
        status: null,
        scope: "active",
        taskType: null,
        sortBy: "relevance",
        sortDir: "desc",
        folderMode: "all",
        folderId: null,
        includePreview: true,
        page: 3,
        pageSize: 7
      });
  });
});

describe("normalizeTaskHistoryTaskTypeList", () => {
  it("deduplicates and trims task types while ignoring all", () => {
    expect(normalizeTaskHistoryTaskTypeList([" timed , standard ", "all", "timed"]))
      .toEqual(["timed", "standard"]);
  });

  it("returns null for empty or all-only task types", () => {
    expect(normalizeTaskHistoryTaskTypeList("all")).toBeNull();
  });
});

describe("createTaskHistorySearchQuerySchema", () => {
  it("parses URL-style query params into normalized search input", () => {
    const schema = createTaskHistorySearchQuerySchema({ defaultPageSize: 10 });
    expect(schema.parse({
      q: "deploy",
      status: ["running", "failed"],
      scope: "all",
      taskType: ["long_horizon", "timed"],
      sortBy: "created_at",
      sortDir: "asc",
      folderId: "unfiled",
      page: "2"
    })).toEqual({
      query: "deploy",
      status: ["running", "failed"],
      scope: "all",
      taskType: ["long_horizon", "timed"],
      sortBy: "created_at",
      sortDir: "asc",
      folderMode: "unfiled",
      folderId: null,
      includePreview: true,
      page: 2,
      pageSize: 10
    });
  });
});

describe("buildTaskHistorySearchParams", () => {
  it("serializes repeated status params and omits default filters", () => {
    const params = buildTaskHistorySearchParams({
      query: "history",
      status: ["failed", "cancelled"],
      scope: "active",
      taskType: ["timed", "agent_swarm"],
      sortBy: "relevance",
      sortDir: "desc",
      folderMode: "folder",
      folderId: "11111111-1111-4111-8111-111111111111",
      includePreview: true,
      page: 2,
      pageSize: 25
    });

    expect(params.toString()).toBe(
      "q=history&status=failed&status=cancelled&taskType=timed&taskType=agent_swarm&folderId=11111111-1111-4111-8111-111111111111&page=2&pageSize=25"
    );
  });

  it("serializes explicit column sorting", () => {
    const params = buildTaskHistorySearchParams({
      query: "history",
      status: null,
      scope: "active",
      taskType: null,
      sortBy: "updated_at",
      sortDir: "desc",
      folderMode: "all",
      folderId: null,
      includePreview: true,
      page: 1,
      pageSize: 25
    });

    expect(params.toString()).toBe("q=history&sortBy=updated_at&page=1&pageSize=25");
  });
});

describe("finalizeTaskHistoryPage", () => {
  it("converts page-plus-one rows into pagination metadata", () => {
    const page = finalizeTaskHistoryPage([1, 2, 3], { page: 2, pageSize: 2 });

    expect(page).toEqual({
      items: [1, 2],
      pagination: {
        page: 2,
        pageSize: 2,
        hasPreviousPage: true,
        hasNextPage: true,
        totalItems: null,
        totalPages: null
      }
    });
  });
});

describe("extractTaskSearchableText", () => {
  it("extracts text from response item payloads", () => {
    expect(extractTaskSearchableText({
      response_items: [{
        type: "message",
        content: [
          { type: "output_text", text: "hello" },
          { type: "input_text", text: "ignored" }
        ]
      }, {
        type: "function_call",
        name: "final_response",
        arguments: JSON.stringify({ response: "done" })
      }]
    })).toBe("hello\n\ndone");
  });
});
