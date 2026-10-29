import { describe, expect, it } from "vitest";
import { selectTaskMessageMetadataContent } from "./task-message-metadata-content.js";

describe("selectTaskMessageMetadataContent", () => {
  it("keeps inline artifact metadata for tool messages", () => {
    expect(
      selectTaskMessageMetadataContent("tool", {
        tool: "html_canvas_inline_artifact",
        callId: "call_canvas_1",
        durationMs: 180,
        response_function_output: {
          output: JSON.stringify({
            ok: true,
            inline_artifact: {
              type: "html",
              relative_path: "reports/summary.html",
              title: "Summary",
              width: 820,
              height: 540
            }
          })
        },
        stdout: "hidden"
      })
    ).toEqual({
      tool: "html_canvas_inline_artifact",
      callId: "call_canvas_1",
      durationMs: 180,
      inline_artifact: {
        type: "html",
        relative_path: "reports/summary.html",
        title: "Summary",
        width: 820,
        height: 540
      }
    });
  });

  it("keeps the step summary, progress, and marked artifact paths the activity card shows", () => {
    expect(selectTaskMessageMetadataContent("tool", {
      tool: "update_progress",
      summary: "Checking the style guide",
      progress: { goal: "Build the handout", steps: [{ title: "Read guides", status: "done" }, { title: "", status: "pending" }] },
      artifact_paths: ["handout.pdf"],
      removed_artifact_paths: ["draft.pdf"],
      stdout: "hidden"
    })).toEqual({
      tool: "update_progress",
      summary: "Checking the style guide",
      progress: { goal: "Build the handout", steps: [{ title: "Read guides", status: "done" }] },
      artifact_paths: ["handout.pdf"],
      removed_artifact_paths: ["draft.pdf"]
    });
  });

  it("strips metadata content for non-tool messages", () => {
    expect(
      selectTaskMessageMetadataContent("assistant", {
        text: "hello",
        inline_artifact: {
          type: "html",
          relative_path: "reports/summary.html"
        }
      })
    ).toEqual({});
  });
});
