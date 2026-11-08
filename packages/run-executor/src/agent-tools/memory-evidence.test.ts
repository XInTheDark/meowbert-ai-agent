import { describe, expect, it } from "vitest";
import { buildResponseTools } from "./availability.js";
import { READ_TASK_EVIDENCE_TOOL_NAME } from "./memory-evidence.js";

describe("Memory evidence tool availability", () => {
  it.each([
    { memory: true, history: true, offered: true },
    { memory: false, history: true, offered: false },
    { memory: true, history: false, offered: false }
  ])("respects Memory and cross-task history availability: %j", ({ memory, history, offered }) => {
    const names = buildResponseTools({ webSearch: false }, [], {
      allowFileIndexTools: memory, allowTaskHistoryTools: history
    }).map((tool) => "name" in tool ? tool.name : tool.type);
    expect(names.includes(READ_TASK_EVIDENCE_TOOL_NAME)).toBe(offered);
  });
});
