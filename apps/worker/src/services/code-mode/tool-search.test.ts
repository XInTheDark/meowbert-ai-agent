import { describe, expect, it } from "vitest";
import type { FunctionTool } from "openai/resources/responses/responses";
import { searchTools } from "./tool-search.js";

function tool(name: string, description: string, properties: Record<string, unknown> = {}): FunctionTool {
  return {
    type: "function",
    name,
    description,
    strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false }
  };
}

const runShell = tool("run_shell", "Run a command in a fresh task-local shell.");
const upload = tool("google_workspace__upload_file", "Upload a local file to Google Drive.\nLarge files upload in chunks.", {
  path: { type: "string", description: "File to upload." },
  folder_id: { type: ["string", "null"] }
});
const driveSearch = tool("google_workspace__search_files", "Search Drive for files by name.");
const liveSync = tool("list_live_sync_files", "List files synced from the user's computer. Paths are task-relative.");
const tools = [runShell, upload, driveSearch, liveSync];
const none = { group: null, query: null, names: null, full_docs: null };

describe("searchTools", () => {
  it("lists the groups of cold tools when given nothing", () => {
    expect(searchTools(tools, none)).toEqual({
      groups: [{ group: "google_workspace", tools: 2 }, { group: "live_sync", tools: 1 }],
      note: expect.stringContaining("enable_skill")
    });
  });

  it("lists a group by summary, accepting the skill id spelling", () => {
    expect(searchTools(tools, { ...none, group: "google-workspace" })).toEqual({
      tools: [
        { name: "google_workspace__upload_file", summary: "Upload a local file to Google Drive." },
        { name: "google_workspace__search_files", summary: "Search Drive for files by name." }
      ]
    });
  });

  it("documents exact names in full by default and reports unknown ones", () => {
    expect(searchTools(tools, { ...none, names: ["google_workspace__upload_file", "missing_tool"] })).toEqual({
      tools: [{
        name: "google_workspace__upload_file",
        documentation: [
          "// Upload a local file to Google Drive.",
          "// Large files upload in chunks.",
          "tools.google_workspace__upload_file(args: {",
          "  path: string; // File to upload.",
          "  folder_id?: string | null;",
          "}): Promise<any>"
        ].join("\n")
      }],
      not_found: ["missing_tool"]
    });
  });

  it("returns summaries or full docs for a query as asked", () => {
    const summaries = searchTools(tools, { ...none, query: "upload files" });
    const docs = searchTools(tools, { ...none, query: "shell", full_docs: true });

    expect(summaries).toEqual({
      tools: [
        { name: "google_workspace__upload_file", summary: "Upload a local file to Google Drive." },
        { name: "google_workspace__search_files", summary: "Search Drive for files by name." },
        { name: "list_live_sync_files", summary: "List files synced from the user's computer." }
      ]
    });
    expect(docs).toEqual({ tools: [{ name: "run_shell", documentation: expect.stringContaining("tools.run_shell(args:") }] });
  });

  it("returns every match within a group but caps a search across groups", () => {
    const many = Array.from({ length: 30 }, (_, index) => tool(`big_skill__report_${index}`, "Build a report."));

    expect(searchTools(many, { ...none, group: "big_skill", query: "report" })).toMatchObject({ tools: { length: 30 } });
    expect(searchTools(many, { ...none, query: "report" })).toMatchObject({ tools: { length: 20 } });
  });

  it("names the groups when asked for an unknown one", () => {
    expect(searchTools(tools, { ...none, group: "gmail" })).toEqual({ error: "Unknown group: gmail", groups: ["google_workspace", "live_sync"] });
  });
});
