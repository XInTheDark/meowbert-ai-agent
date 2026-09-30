import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DECISION_CONTEXT_PROMPT_CHAR_LIMIT,
  buildTaskDecisionContext
} from "./task-decision-context.js";
import type { TaskMessageRow } from "./types.js";

const PNG_BYTES = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/lG9q4wAAAABJRU5ErkJggg==",
  "base64"
);

function createUserMessage(content: Record<string, unknown>): TaskMessageRow {
  return {
    id: "msg-1",
    role: "user",
    content_json: content,
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: "2026-05-05T00:00:00.000Z"
  };
}

describe("buildTaskDecisionContext", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function makeTempDir(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-decision-context-"));
    tempDirs.push(dir);
    return dir;
  }

  it("includes bounded message, memory, and text attachment excerpts", async () => {
    const taskInputDir = makeTempDir();
    fs.writeFileSync(path.join(taskInputDir, "brief.txt"), `${"alpha ".repeat(2000)}omega`, "utf8");
    fs.writeFileSync(path.join(taskInputDir, "large.pdf"), "%PDF fake", "utf8");

    const context = await buildTaskDecisionContext({
      mode: "first_user",
      taskInputDir,
      memoryMainFile: {
        path: "/workspace/.memory/MEMORY.md",
        content: "Workspace prefers concise implementation plans.",
        truncated: false
      },
      projectMemoryMainFile: {
        path: "/workspace/.memory/projects/project/MEMORY.md",
        content: "Project uses routed models for task execution.",
        truncated: false
      },
      messages: [
        createUserMessage({
          text: "Please classify this request and name it well.",
          attachments: [
            {
              kind: "file",
              label: "brief.txt",
              content: "brief.txt",
              relativePath: "brief.txt",
              sizeBytes: 12_000
            },
            {
              kind: "file",
              label: "large.pdf",
              content: "large.pdf",
              relativePath: "large.pdf",
              sizeBytes: 9
            }
          ]
        })
      ]
    });

    expect(context.text.length).toBeLessThanOrEqual(DECISION_CONTEXT_PROMPT_CHAR_LIMIT);
    expect(context.text).toContain("Please classify this request");
    expect(context.text).toContain("Workspace prefers concise implementation plans.");
    expect(context.text).toContain("Project uses routed models for task execution.");
    expect(context.text).toContain("File attachment excerpt: brief.txt");
    expect(context.text).toContain("alpha alpha");
    expect(context.text).toContain("Skipped preview for document/binary format.");
    expect(context.imageItems).toEqual([]);
  });

  it("attaches at most five small images for decision context", async () => {
    const taskInputDir = makeTempDir();
    const attachments = [];
    for (let index = 0; index < 6; index += 1) {
      const filename = `image-${index}.png`;
      fs.writeFileSync(path.join(taskInputDir, filename), PNG_BYTES);
      attachments.push({
        kind: "file",
        label: filename,
        content: filename,
        relativePath: filename,
        sizeBytes: PNG_BYTES.length
      });
    }

    const context = await buildTaskDecisionContext({
      mode: "first_user",
      taskInputDir,
      imageDetail: "high",
      messages: [
        createUserMessage({
          text: "Title the image task.",
          attachments
        })
      ]
    });

    expect(context.imageItems).toHaveLength(5);
    expect(context.text).toContain("Image attachment: image-5.png");
  });
});
