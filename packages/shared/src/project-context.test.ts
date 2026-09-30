import { describe, expect, it } from "vitest";
import {
  buildProjectContextPath,
  getProjectContextNote,
  getProjectContextNotes,
  isProjectContextPath,
  normalizeProjectContextPath,
  removeProjectContextNotes,
  setProjectContextNote
} from "./project-context.js";

describe("project context helpers", () => {
  it("normalizes context paths and prefixes the context root", () => {
    expect(normalizeProjectContextPath("//context\\docs//guide.md")).toBe("context/docs/guide.md");
    expect(buildProjectContextPath("docs/guide.md")).toBe("context/docs/guide.md");
    expect(buildProjectContextPath("/")).toBe("context");
    expect(isProjectContextPath("context/docs/guide.md")).toBe(true);
    expect(isProjectContextPath("docs/guide.md")).toBe(false);
  });

  it("stores and reads normalized notes", () => {
    const payload = setProjectContextNote({}, "context\\docs//guide.md", "  Read this first.  ");

    expect(getProjectContextNotes(payload)).toEqual({
      "context/docs/guide.md": "Read this first."
    });
    expect(getProjectContextNote(payload, "context/docs/guide.md")).toBe("Read this first.");
  });

  it("removes empty notes and cleans up the payload shape", () => {
    const withNote = setProjectContextNote({}, "context/guide.md", "Important");
    const withoutNote = setProjectContextNote(withNote, "context/guide.md", "   ");

    expect(getProjectContextNotes(withoutNote)).toEqual({});
    expect(withoutNote).toEqual({});
  });

  it("removes multiple notes at once", () => {
    const payload = setProjectContextNote(
      setProjectContextNote({}, "context/a.txt", "A"),
      "context/nested/b.txt",
      "B"
    );

    const next = removeProjectContextNotes(payload, ["context/a.txt", "context/nested/b.txt"]);
    expect(next).toEqual({});
  });

  it("reads legacy notes nested under responses.project_context", () => {
    const payload = {
      responses: {
        store: false,
        project_context: {
          notes: {
            "context/docs/spec.md": "Legacy note"
          }
        }
      }
    };

    expect(getProjectContextNotes(payload)).toEqual({
      "context/docs/spec.md": "Legacy note"
    });
    expect(getProjectContextNote(payload, "context/docs/spec.md")).toBe("Legacy note");
  });

  it("rewrites legacy nested notes to the top level when updated", () => {
    const payload = {
      responses: {
        store: false,
        project_context: {
          notes: {
            "context/docs/spec.md": "Legacy note"
          }
        }
      }
    };

    expect(setProjectContextNote(payload, "context/docs/spec.md", "Updated note")).toEqual({
      responses: {
        store: false
      },
      project_context: {
        notes: {
          "context/docs/spec.md": "Updated note"
        }
      }
    });
  });
});
