import { describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/config.js", () => ({
  config: {
    skills: {
      manifests: {}
    }
  }
}));

import { buildUserMessageContent, normalizeTaskMessageAttachments } from "./shared.js";

describe("task-service shared attachment normalization", () => {
  it("preserves canvas attachments in stored user message content", () => {
    const attachments = normalizeTaskMessageAttachments([
      {
        kind: "canvas",
        label: " Quadratics Lab ",
        content: "Canvas: Quadratics Lab",
        relativePath: " canvases/quadratics-lab "
      }
    ]);

    expect(attachments).toEqual([
      {
        kind: "canvas",
        label: "Quadratics Lab",
        content: "Canvas: Quadratics Lab",
        relativePath: "canvases/quadratics-lab"
      }
    ]);
    expect(buildUserMessageContent({
      message: "Update it",
      attachments
    })).toMatchObject({
      text: "Update it",
      attachments
    });
  });
});
