import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  getSkillCatalogGroup,
  isVisibleSkillManifest,
  loadSkillManifestEntries,
  parseSkillManifest
} from "./skill-manifests.js";

const temporaryRoots: string[] = [];

function writeManifest(root: string, relativeDir: string, id: string): void {
  const skillDir = path.join(root, relativeDir);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify({
    id,
    name: id,
    description: id,
    mcp: { transport: "stdio", command: "node" }
  }));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("parseSkillManifest", () => {
  it("keeps Source access metadata on a normal skill", () => {
    expect(parseSkillManifest({
      id: "google-workspace",
      name: "Google Workspace",
      description: "Edit attached Google files.",
      sourceAccess: { sourceId: "google-drive" },
      mcp: {
        transport: "stdio",
        command: "python3",
        args: ["server.py"]
      }
    })).toMatchObject({
      id: "google-workspace",
      surface: "skill",
      sourceAccess: { sourceId: "google-drive" }
    });
  });

  it("parses hidden and catalogGroup properties", () => {
    const manifest = parseSkillManifest({
      id: "pptx-studio",
      name: "PPTX Studio",
      description: "Slides",
      hidden: true,
      catalogGroup: "documents",
      mcp: { transport: "stdio", command: "node" }
    });
    expect(manifest.hidden).toBe(true);
    expect(manifest.catalogGroup).toBe("documents");
  });
});

describe("loadSkillManifestEntries", () => {
  it("ignores manifests nested below the skills root", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-skills-"));
    temporaryRoots.push(root);
    writeManifest(root, "active", "active");
    writeManifest(root, "archived/retired", "retired");

    expect([...loadSkillManifestEntries(root).keys()]).toEqual(["active"]);
  });
});

describe("isVisibleSkillManifest", () => {
  it("returns false for source manifests", () => {
    const manifest = parseSkillManifest({
      id: "google-drive",
      name: "Google Drive",
      description: "GDrive",
      surface: "source",
      source: { provider: "google-drive" },
      mcp: { transport: "stdio", command: "node" }
    });
    expect(isVisibleSkillManifest(manifest)).toBe(false);
  });

  it("returns false for hidden manifests", () => {
    const manifest = parseSkillManifest({
      id: "pptx-studio",
      name: "PPTX Studio",
      description: "Slides",
      hidden: true,
      mcp: { transport: "stdio", command: "node" }
    });
    expect(isVisibleSkillManifest(manifest)).toBe(false);
  });

  it("returns false for internal manifests", () => {
    const manifest = parseSkillManifest({
      id: "internal-tool",
      name: "Internal Tool",
      description: "Internal",
      surface: "internal",
      mcp: { transport: "stdio", command: "node" }
    });
    expect(isVisibleSkillManifest(manifest)).toBe(false);
  });

  it("returns true for normal active skills", () => {
    const manifest = parseSkillManifest({
      id: "docx-studio",
      name: "DOCX Studio",
      description: "Docs",
      mcp: { transport: "stdio", command: "node" }
    });
    expect(isVisibleSkillManifest(manifest)).toBe(true);
  });
});

describe("getSkillCatalogGroup", () => {
  it("returns configured group", () => {
    const manifest = parseSkillManifest({
      id: "image-generation",
      name: "Image Gen",
      description: "Images",
      catalogGroup: "visuals",
      mcp: { transport: "stdio", command: "node" }
    });
    expect(getSkillCatalogGroup(manifest)).toBe("visuals");
  });

  it("defaults to custom when not specified", () => {
    const manifest = parseSkillManifest({
      id: "my-skill",
      name: "My Skill",
      description: "Skill",
      mcp: { transport: "stdio", command: "node" }
    });
    expect(getSkillCatalogGroup(manifest)).toBe("custom");
  });
});
