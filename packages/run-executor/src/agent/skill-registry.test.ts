import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { getAvailableSkills, getSkillEntry } from "./skill-registry.js";

const tempDirs: string[] = [];

function createTempSkillsRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-skill-registry-"));
  tempDirs.push(dir);
  return dir;
}

function writeSkill(rootDir: string, folderName: string, manifest: Record<string, unknown>): void {
  const skillDir = path.join(rootDir, folderName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "skill.json"), JSON.stringify(manifest, null, 2));
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("skill-registry", () => {
  it("hides admin-only skills for non-admin actors", () => {
    const rootDir = createTempSkillsRoot();
    writeSkill(rootDir, "docx", {
      id: "docx-studio",
      name: "DOCX Studio",
      description: "Doc tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });
    writeSkill(rootDir, "browser", {
      id: "browser-use",
      name: "Browser Use",
      description: "Browser tools",
      requiresSuperAdmin: true,
      mcp: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp@latest"]
      }
    });

    const nonAdminSkills = getAvailableSkills(rootDir, false);
    expect(nonAdminSkills.map((skill) => skill.id)).toEqual(["docx-studio"]);

    const adminSkills = getAvailableSkills(rootDir, true);
    expect(adminSkills.map((skill) => skill.id).sort()).toEqual(["browser-use", "docx-studio"]);
  });

  it("parses requiresSuperAdmin in manifest entries", () => {
    const rootDir = createTempSkillsRoot();
    writeSkill(rootDir, "browser", {
      id: "browser-use",
      name: "Browser Use",
      description: "Browser tools",
      requiresSuperAdmin: true,
      mcp: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@playwright/mcp@latest"]
      }
    });

    const entry = getSkillEntry(rootDir, "browser-use");
    expect(entry).not.toBeNull();
    expect(entry?.manifest.requiresSuperAdmin).toBe(true);
  });

  it("filters skills with the config visibility predicate", () => {
    const rootDir = createTempSkillsRoot();
    writeSkill(rootDir, "docx", {
      id: "docx-studio",
      name: "DOCX Studio",
      description: "Doc tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });
    writeSkill(rootDir, "browser", {
      id: "browser-use",
      name: "Browser Use",
      description: "Browser tools",
      requiresSuperAdmin: true,
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });

    const visible = getAvailableSkills(rootDir, true, {
      isSkillEnabled: (manifest) => manifest.id !== "browser-use"
    });

    expect(visible.map((skill) => skill.id)).toEqual(["docx-studio"]);
  });

  it("surfaces the catalog group for core skills and defaults other skills to skill", () => {
    const rootDir = createTempSkillsRoot();
    writeSkill(rootDir, "canvas", {
      id: "html-canvas",
      name: "Canvas",
      description: "Canvas tools",
      catalogGroup: "core",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });
    writeSkill(rootDir, "docx", {
      id: "docx-studio",
      name: "DOCX Studio",
      description: "Doc tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });

    const visible = getAvailableSkills(rootDir, true);

    expect(visible).toEqual([
      { id: "html-canvas", name: "Canvas", description: "Canvas tools", catalogGroup: "core" },
      { id: "docx-studio", name: "DOCX Studio", description: "Doc tools", catalogGroup: "custom" }
    ]);
  });

  it("keeps source manifests loadable while hiding them from skill listings", () => {
    const rootDir = createTempSkillsRoot();
    writeSkill(rootDir, "google-drive", {
      id: "google-drive",
      name: "Google Drive",
      description: "Drive source",
      surface: "source",
      source: {
        provider: "google-drive",
        supportsAttachments: true
      },
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });
    writeSkill(rootDir, "docx", {
      id: "docx-studio",
      name: "DOCX Studio",
      description: "Doc tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });

    expect(getAvailableSkills(rootDir, true).map((skill) => skill.id)).toEqual(["docx-studio"]);
    expect(getSkillEntry(rootDir, "google-drive")?.manifest.surface).toBe("source");
  });
});
