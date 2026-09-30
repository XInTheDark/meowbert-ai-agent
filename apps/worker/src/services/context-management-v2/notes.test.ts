import { beforeEach, expect, it, vi } from "vitest";
vi.mock("../../lib/db.js", () => ({withTransaction: vi.fn()}));
import { withTransaction } from "../../lib/db.js";
import { writeContextNote } from "./notes.js";
import type { ContextManagementV2State } from "./types.js";

beforeEach(() => { vi.resetAllMocks(); });

it("retains one revision per node while preserving the inherited branch snapshot", async () => {
  const notes = [{node: "parent", path: "progress.md", revision: 4, content: "Original"}];
  const client = {query: vi.fn(async (sql: string, params: any[]) => {
    if (sql.includes("SELECT note.content")) {
      const own = notes.find((note) => note.node === params[2] && note.path === params[1]);
      return {rows: [own ?? notes[0]]};
    }
    if (sql.includes("MAX(revision)")) {
      return {rows:[{revision: Math.max(0, ...notes.filter((note) => note.node === params[1]).map((note) => note.revision)) + 1}]};
    }
    if (sql.includes("INSERT INTO task_context_notes")) notes.push({node:params[1], path:params[2], revision:params[3], content:params[4]});
    if (sql.includes("DELETE FROM task_context_notes")) {
      for (let i = notes.length - 1; i >= 0; i--) {
        if (notes[i].node === params[1] && notes[i].path === params[2] && notes[i].revision < params[3]) notes.splice(i,1);
      }
    }
    return {rows:[]};
  })};
  vi.mocked(withTransaction).mockImplementation(async (fn) => fn(client as never));
  const state = {taskId:"task", contextNodeId:"child"} as ContextManagementV2State;
  for (let i = 0; i < 100; i++) await writeContextNote({state, path:"progress.md", text:"x", append:true});
  expect(notes).toEqual([
    {node:"parent", path:"progress.md", revision:4, content:"Original"},
    {node:"child", path:"progress.md", revision:100, content:"Original" + "x".repeat(100)}
  ]);
  expect(client.query.mock.calls[0][0]).toContain("FOR UPDATE");
});
