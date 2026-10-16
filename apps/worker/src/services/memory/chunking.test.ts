import { describe, expect, it, vi } from "vitest";
vi.mock("../../lib/config.js", () => ({ config: {} }));
import { buildChunkContext, chunkMemoryFile } from "./chunking.js";

describe("chunkMemoryFile", () => {
  it("merges small sibling sections and keeps their shared heading as the breadcrumb", () => {
    const text = ["# Auth", "", "## Tokens", "Expire after 15 minutes.", "", "## Sessions", "Stored in Redis."].join("\n");
    const { chunks } = chunkMemoryFile(".memory/auth.md", text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual(["Auth"]);
    expect(chunks[0].text).toContain("15 minutes");
    expect(chunks[0].text).toContain("Redis");
  });

  it("does not merge a section into an unrelated branch of the outline", () => {
    const text = ["# A", "## A1", "x".repeat(50), "### A1a", "y".repeat(50), "# B", "## B1", "z".repeat(50)].join("\n");
    const { chunks } = chunkMemoryFile(".memory/notes.md", text, 120, 20);

    expect(chunks.every((chunk) => !(chunk.text.includes("y") && chunk.text.includes("z")))).toBe(true);
    expect(chunks.find((chunk) => chunk.text.includes("z"))?.headingPath).toEqual(["B", "B1"]);
  });

  it("splits long sections between bullets, never inside one", () => {
    const bullets = Array.from({ length: 12 }, (_, index) => `- item ${index} ${"word ".repeat(15)}\n  - detail ${index}`);
    const text = ["## Decisions", ...bullets].join("\n");
    const { chunks } = chunkMemoryFile(".memory/decisions.md", text, 400, 50);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.text.length).toBeLessThanOrEqual(400);
      expect(chunk.headingPath).toEqual(["Decisions"]);
      for (const match of chunk.text.matchAll(/- item (\d+)/g)) {
        expect(chunk.text).toContain(`- detail ${match[1]}`);
      }
    }
  });

  it("ignores heading-like lines inside fenced code", () => {
    const text = ["## Commands", "```bash", "# not a heading", "npm run migrate", "```"].join("\n");
    const { chunks } = chunkMemoryFile(".memory/commands.md", text);

    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toEqual(["Commands"]);
  });

  it("reads the description from frontmatter or the first prose line and keeps frontmatter out of chunks", () => {
    const withFrontmatter = chunkMemoryFile(".memory/a.md", "---\ndescription: Deploy notes\n---\n# Deploy\nUse Coolify.");
    expect(withFrontmatter.description).toBe("Deploy notes");
    expect(withFrontmatter.chunks[0].text).not.toContain("description:");

    expect(chunkMemoryFile(".memory/b.md", "# Deploy\nHow we ship the app.\n\n- Use Coolify").description).toBe("How we ship the app.");
    expect(chunkMemoryFile(".memory/c.md", "# Deploy\n- Use Coolify").description).toBeNull();
  });

  it("falls back to size-based splitting for non-markdown files", () => {
    const { chunks } = chunkMemoryFile(".memory/actions.json", JSON.stringify({ value: "a".repeat(3_000) }), 1_000, 100);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.every((chunk) => chunk.headingPath.length === 0)).toBe(true);
  });
});

describe("buildChunkContext", () => {
  it("joins the path, heading breadcrumb, and description", () => {
    expect(buildChunkContext({ relativePath: ".memory/auth.md", headingPath: ["Auth", "Tokens"], description: "Auth notes" }))
      .toBe(".memory/auth.md › Auth › Tokens\nAuth notes");
  });
});
