import { describe, expect, it } from "vitest";
import {
  buildTaskArtifactDownloadPath,
  buildTaskInputAttachmentPath,
  buildTaskInputsDestinationPath,
  buildThreadTaskRootPath
} from "./taskFileDestinations";

describe("taskFileDestinations", () => {
  it("builds the task inputs destination from the task root", () => {
    expect(buildTaskInputsDestinationPath(".meowbert/task-runs/task-1")).toBe(".meowbert/task-runs/task-1/inputs");
  });

  it("builds a thread task root from the parent root and thread task id", () => {
    expect(buildThreadTaskRootPath(".meowbert/task-runs/task-1", "thread-1")).toBe(
      ".meowbert/task-runs/task-1/threads/thread-1"
    );
  });

  it("builds artifact download paths relative to the task root", () => {
    expect(buildTaskArtifactDownloadPath(".meowbert/task-runs/task-1", "deliverables/report.pdf")).toBe(
      ".meowbert/task-runs/task-1/deliverables/report.pdf"
    );
    expect(buildTaskArtifactDownloadPath(".meowbert/task-runs/task-1/", "\\deliverables\\report.pdf")).toBe(
      ".meowbert/task-runs/task-1/deliverables/report.pdf"
    );
  });

  it("returns null when either side of the artifact path is missing", () => {
    expect(buildTaskArtifactDownloadPath(null, "deliverables/report.pdf")).toBeNull();
    expect(buildTaskArtifactDownloadPath(".meowbert/task-runs/task-1", null)).toBeNull();
  });

  it("maps uploaded task input files back to model-visible inputs paths", () => {
    expect(buildTaskInputAttachmentPath(
      ".meowbert/task-runs/task-1/inputs",
      ".meowbert/task-runs/task-1/inputs/report.pdf",
      "report.pdf"
    )).toBe("inputs/report.pdf");
  });

  it("preserves folder structure for uploaded task input folders", () => {
    expect(buildTaskInputAttachmentPath(
      ".meowbert/task-runs/task-1/inputs",
      ".meowbert/task-runs/task-1/inputs/course/week-1/slides.pdf",
      "slides.pdf"
    )).toBe("inputs/course/week-1/slides.pdf");
  });

  it("falls back to the saved filename when the uploaded path is not under the task input root", () => {
    expect(buildTaskInputAttachmentPath(
      ".meowbert/task-runs/task-1/inputs",
      "context/report.pdf",
      "report (1).pdf"
    )).toBe("inputs/report (1).pdf");
  });
});
