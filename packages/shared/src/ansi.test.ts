import { describe, expect, it } from "vitest";
import { stripAnsi, stripAnsiChunk, type AnsiStripState } from "./ansi.js";

describe("stripAnsi", () => {
  it("strips ripgrep color escape sequences and preserves identifiers", () => {
    const raw =
      "\x1b[0m\x1b[35m/app/skills/pptx-studio/scripts/build_deck.py\x1b[0m\n"
      + "\x1b[0m\x1b[32m21\x1b[0m:    warn_about_\x1b[0m\x1b[1m\x1b[31moverlap\x1b[0ms,\n"
      + "\x1b[0m\x1b[32m40\x1b[0m:    _add_\x1b[0m\x1b[1m\x1b[31moverlap\x1b[0m_detection_slide(presentation)\n"
      + "\x1b[0m\x1b[32m471\x1b[0m:    # Use names to disambiguate shapes in prompts and simplify tests/inspection for \x1b[0m\x1b[1m\x1b[31moverlap\x1b[0ms.\n"
      + "\x1b[0m\x1b[32m1035\x1b[0m:def _add_\x1b[0m\x1b[1m\x1b[31moverlap\x1b[0m_detection_slide(presentation: Presentation) -> None:";

    const cleaned = stripAnsi(raw);

    expect(cleaned).toBe(
      "/app/skills/pptx-studio/scripts/build_deck.py\n"
      + "21:    warn_about_overlaps,\n"
      + "40:    _add_overlap_detection_slide(presentation)\n"
      + "471:    # Use names to disambiguate shapes in prompts and simplify tests/inspection for overlaps.\n"
      + "1035:def _add_overlap_detection_slide(presentation: Presentation) -> None:"
    );
  });

  it("strips standard grep color escape sequences", () => {
    const raw = "21:    warn_about_\x1b[01;31m\x1b[Koverlap\x1b[m\x1b[Ks,";
    expect(stripAnsi(raw)).toBe("21:    warn_about_overlaps,");
  });

  it("strips bracketed-paste prompt toggles and trailing prompt characters", () => {
    const raw = "\u001b[?2004h\u001b[?2004l\r\r\n/tmp/task\n";
    expect(stripAnsi(raw)).toBe("/tmp/task\n");

    const withPrompt = "\u001b[?2004h> \u001b[?2004l\necho test\n";
    expect(stripAnsi(withPrompt)).toBe("echo test\n");
  });

  it("strips OSC sequences such as terminal titles and hyperlinks", () => {
    const raw = "\u001b]0;my-window-title\u0007Hello \u001b]8;;https://example.com\u001b\\link\u001b]8;;\u001b\\ world";
    expect(stripAnsi(raw)).toBe("Hello link world");
  });

  it("strips 256-color and 24-bit truecolor escape sequences", () => {
    const raw = "\u001b[38;5;196mRed\u001b[0m \u001b[48;2;0;255;0mGreen BG\u001b[0m";
    expect(stripAnsi(raw)).toBe("Red Green BG");
  });

  it("strips cursor controls and line erase sequences", () => {
    const raw = "Loading...\u001b[2K\u001b[1GDone\u001b[?25h";
    expect(stripAnsi(raw)).toBe("Loading...Done");
  });

  it("strips control sequences split across stream chunks", () => {
    const state: AnsiStripState = { pending: "" };
    const cleaned = [
      stripAnsiChunk("\u001b[", state),
      stripAnsiChunk("2KLoading", state),
      stripAnsiChunk("\u001b]0;title", state),
      stripAnsiChunk("\u0007Done", state)
    ].join("");

    expect(cleaned).toBe("LoadingDone");
    expect(state.pending).toBe("");
  });

  it("cleans orphaned SGR sequences", () => {
    const raw = "[0m[35m/path/to/file[0m: [32m10[0m: test";
    expect(stripAnsi(raw)).toBe("/path/to/file: 10: test");
  });

  it("does not mutate normal brackets or array indexing", () => {
    expect(stripAnsi("const item = array[0];")).toBe("const item = array[0];");
    expect(stripAnsi("items[0m]")).toBe("items[0m]");
    expect(stripAnsi("matrix[1][2]")).toBe("matrix[1][2]");
  });

  it("handles empty or non-string inputs safely", () => {
    expect(stripAnsi("")).toBe("");
    expect(stripAnsi(null as unknown as string)).toBe("");
    expect(stripAnsi(undefined as unknown as string)).toBe("");
  });
});
