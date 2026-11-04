import { describe, expect, it } from "vitest";
import type { TaskAttachment } from "../../../lib/types";
import { buildMentionOptions, findMentionMatch } from "./composerMentionOptions";
import { findMentionedSkillIds } from "./skillMention";

const attachments: TaskAttachment[] = [
  { id: "a1", kind: "file", label: "hubble-notes.pdf", content: "inputs/hubble-notes.pdf", relativePath: "inputs/hubble-notes.pdf" },
  { id: "a2", kind: "note", label: "A note", content: "plain note" }
];
const skills = [{ id: "pptx-studio", name: "Slides" }, { id: "humanize", name: "Humanize" }];

describe("findMentionMatch", () => {
  it("opens at the start of the input or after whitespace", () => {
    expect(findMentionMatch("@")?.matchingString).toBe("");
    expect(findMentionMatch("please use @hub")).toEqual({ leadOffset: 11, matchingString: "hub", replaceableString: "@hub" });
  });

  it("keeps file names with dots and spaces in the query", () => {
    expect(findMentionMatch("@my notes.pdf")?.matchingString).toBe("my notes.pdf");
  });

  it("does not open inside an email address or across lines", () => {
    expect(findMentionMatch("me@example.com")).toBeNull();
    expect(findMentionMatch("@hub\nnext line")).toBeNull();
  });
});

describe("buildMentionOptions", () => {
  it("labels each item with its type and leaves out notes", () => {
    const options = buildMentionOptions("", attachments, skills);
    expect(options.map((option) => [option.citation.label, option.typeLabel])).toEqual([
      ["hubble-notes.pdf", "Attached file"],
      ["Humanize", "Skill"],
      ["Slides", "Skill"]
    ]);
  });

  it("matches files by name and skills by name or ID", () => {
    expect(buildMentionOptions("HU", attachments, skills).map((option) => option.citation.path)).toEqual([
      "inputs/hubble-notes.pdf",
      "skill:humanize"
    ]);
    expect(buildMentionOptions("pptx", attachments, skills).map((option) => option.citation.path)).toEqual(["skill:pptx-studio"]);
  });
});

describe("findMentionedSkillIds", () => {
  it("finds each skill once and ignores file citations and other links", () => {
    const text = "[Humanize](skill:humanize) and [Humanize](skill:humanize), [a.pdf](inputs/a.pdf), [site](https://example.com)";
    expect(findMentionedSkillIds(text)).toEqual(["humanize"]);
  });
});
