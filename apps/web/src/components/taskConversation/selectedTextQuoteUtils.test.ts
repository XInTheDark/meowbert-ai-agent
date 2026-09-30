import { describe, expect, it } from "vitest";
import {
  buildSelectedTextMessage,
  formatSelectedTextLocation,
  getSelectedTextQuotePreview,
  splitSelectedTextMessage,
  type SelectedTextQuote
} from "./selectedTextQuoteUtils";

describe("selectedTextQuoteUtils", () => {
  it("formats selected text location correctly", () => {
    expect(formatSelectedTextLocation(null)).toBeNull();
    expect(
      formatSelectedTextLocation({
        startLine: 1,
        startColumn: 5,
        endLine: 3,
        endColumn: 10
      })
    ).toBe("line 1:5 to line 3:10");
  });

  it("builds and splits selected text messages without comments", () => {
    const quotes: SelectedTextQuote[] = [
      { text: "const a = 1;\nconst b = 2;", location: "line 1:1 to line 2:13" }
    ];
    const message = "Please refactor this.";
    const built = buildSelectedTextMessage(quotes, message);

    expect(built).toContain("About this selected snippet (line 1:1 to line 2:13):");
    expect(built).toContain("> const a = 1;\n> const b = 2;");
    expect(built).toContain("Please refactor this.");

    const parsed = splitSelectedTextMessage(built);
    expect(parsed).not.toBeNull();
    expect(parsed?.quotes).toHaveLength(1);
    expect(parsed?.quotes[0].text).toBe("const a = 1;\nconst b = 2;");
    expect(parsed?.quotes[0].location).toBe("line 1:1 to line 2:13");
    expect(parsed?.quotes[0].comment).toBeUndefined();
    expect(parsed?.message).toBe("Please refactor this.");
  });

  it("builds and splits selected text messages with annotation comments", () => {
    const quotes: SelectedTextQuote[] = [
      {
        text: "narrow interception is necessary",
        location: "line 10:1 to line 10:33",
        comment: "yes, so you should do this"
      }
    ];
    const message = "Yes, so";
    const built = buildSelectedTextMessage(quotes, message);

    expect(built).toContain("About this selected snippet (line 10:1 to line 10:33):");
    expect(built).toContain("> narrow interception is necessary");
    expect(built).toContain("Comment: yes, so you should do this");
    expect(built).toContain("Yes, so");

    const parsed = splitSelectedTextMessage(built);
    expect(parsed).not.toBeNull();
    expect(parsed?.quotes).toHaveLength(1);
    expect(parsed?.quotes[0].text).toBe("narrow interception is necessary");
    expect(parsed?.quotes[0].location).toBe("line 10:1 to line 10:33");
    expect(parsed?.quotes[0].comment).toBe("yes, so you should do this");
    expect(parsed?.message).toBe("Yes, so");
  });

  it("handles multiple quotes with mixed comments", () => {
    const quotes: SelectedTextQuote[] = [
      { text: "first line", location: null, comment: "check this" },
      { text: "second line", location: "line 5:1 to line 5:12" }
    ];
    const built = buildSelectedTextMessage(quotes, "Follow up message");
    const parsed = splitSelectedTextMessage(built);

    expect(parsed).not.toBeNull();
    expect(parsed?.quotes).toHaveLength(2);
    expect(parsed?.quotes[0].text).toBe("first line");
    expect(parsed?.quotes[0].comment).toBe("check this");
    expect(parsed?.quotes[1].text).toBe("second line");
    expect(parsed?.quotes[1].comment).toBeUndefined();
    expect(parsed?.message).toBe("Follow up message");
  });

  it("provides preview for long snippets", () => {
    const longText = "line 1\nline 2\nline 3\nline 4\nline 5";
    expect(getSelectedTextQuotePreview(longText)).toBe("...\nline 3\nline 4\nline 5");

    const shortText = "line 1\nline 2";
    expect(getSelectedTextQuotePreview(shortText)).toBe("line 1\nline 2");
  });
});
