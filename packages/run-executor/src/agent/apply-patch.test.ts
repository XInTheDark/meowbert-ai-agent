import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  applyCodexStyleUpdateDiff,
  applyPatchOperationToWorkspace,
  parseApplyPatchDocument
} from "./apply-patch.js";

describe("applyCodexStyleUpdateDiff", () => {
  it("allows the first chunk to omit an explicit context marker", () => {
    expect(applyCodexStyleUpdateDiff("alpha\nbeta\n", "-alpha\n+gamma\n beta")).toBe("gamma\nbeta\n");
  });

  it("supports end-of-file hunks", () => {
    expect(applyCodexStyleUpdateDiff("alpha\nbeta\n", "@@\n alpha\n-beta\n+delta\n*** End of File")).toBe("alpha\ndelta\n");
  });

  it("matches context with codex-style unicode normalization", () => {
    expect(applyCodexStyleUpdateDiff("smart — quote\n", "-smart - quote\n+plain - quote")).toBe("plain - quote\n");
  });
});

describe("parseApplyPatchDocument", () => {
  it("parses custom tool patch documents with multiple hunks", () => {
    expect(parseApplyPatchDocument([
      "*** Begin Patch",
      "*** Update File: notes.txt",
      "@@",
      "-alpha",
      "+gamma",
      " beta",
      "*** Add File: nested/new.txt",
      "+hello",
      "*** End Patch"
    ].join("\n"))).toEqual([
      {
        type: "update_file",
        path: "notes.txt",
        diff: "@@\n-alpha\n+gamma\n beta"
      },
      {
        type: "create_file",
        path: "nested/new.txt",
        diff: "+hello"
      }
    ]);
  });

  it("parses update hunks with move destinations", () => {
    expect(parseApplyPatchDocument([
      "*** Begin Patch",
      "*** Update File: old.txt",
      "*** Move to: new.txt",
      "*** End Patch"
    ].join("\n"))).toEqual([
      {
        type: "update_file",
        path: "old.txt",
        move_to: "new.txt",
        diff: ""
      }
    ]);
  });
});

describe("applyPatchOperationToWorkspace", () => {
  it("creates parent directories like codex apply_patch", async () => {
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-create-"));

    try {
      const result = await applyPatchOperationToWorkspace({
        operation: {
          type: "create_file",
          path: "nested/dir/file.txt",
          diff: "+hello\n+world"
        },
        baseDir: taskRoot,
        writableRoots: [taskRoot]
      });

      expect(result.output).toBe("Created nested/dir/file.txt");
      expect(fs.readFileSync(path.join(taskRoot, "nested/dir/file.txt"), "utf8")).toBe("hello\nworld\n");
    } finally {
      fs.rmSync(taskRoot, { recursive: true, force: true });
    }
  });

  it("supports move-only update hunks", async () => {
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-move-"));
    fs.writeFileSync(path.join(taskRoot, "old.txt"), "hello\n", "utf8");

    try {
      const result = await applyPatchOperationToWorkspace({
        operation: {
          type: "update_file",
          path: "old.txt",
          move_to: "nested/new.txt",
          diff: ""
        },
        baseDir: taskRoot,
        writableRoots: [taskRoot]
      });

      expect(result.output).toBe("Updated old.txt -> nested/new.txt");
      expect(fs.existsSync(path.join(taskRoot, "old.txt"))).toBe(false);
      expect(fs.readFileSync(path.join(taskRoot, "nested/new.txt"), "utf8")).toBe("hello\n");
    } finally {
      fs.rmSync(taskRoot, { recursive: true, force: true });
    }
  });

  it("denies writes outside the explicitly allowed writable roots", async () => {
    const taskRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-deny-"));
    const sharedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-apply-patch-shared-"));

    try {
      await expect(applyPatchOperationToWorkspace({
        operation: {
          type: "create_file",
          path: "notes.txt",
          diff: "+hello"
        },
        baseDir: taskRoot,
        writableRoots: [sharedRoot]
      })).rejects.toThrow("Write operation denied outside allowed roots");
    } finally {
      fs.rmSync(taskRoot, { recursive: true, force: true });
      fs.rmSync(sharedRoot, { recursive: true, force: true });
    }
  });
});
