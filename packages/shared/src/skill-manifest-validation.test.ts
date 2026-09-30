import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertEnabledBundledSkillManifestsPresent,
  getMissingEnabledBundledSkillManifestIds
} from "./skill-manifest-validation.js";

const tempDirs: string[] = [];

function createTempSkillsRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-skill-manifest-validation-"));
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

describe("skill-manifest-validation", () => {
  it("reports html-canvas when explicitly enabled but missing from the skills root", () => {
    const rootDir = createTempSkillsRoot();
    const config = {
      skills: {
        rootDir,
        htmlCanvas: {
          enabled: true
        }
      }
    };

    expect(getMissingEnabledBundledSkillManifestIds(config)).toEqual(["html-canvas"]);
    expect(() => assertEnabledBundledSkillManifestsPresent(config)).toThrow(
      /missing.*html-canvas/i
    );
  });

  it("does not require html-canvas when the toggle is disabled", () => {
    const rootDir = createTempSkillsRoot();
    const config = {
      skills: {
        rootDir,
        htmlCanvas: {
          enabled: false
        }
      }
    };

    expect(getMissingEnabledBundledSkillManifestIds(config)).toEqual([]);
    expect(() => assertEnabledBundledSkillManifestsPresent(config)).not.toThrow();
  });

  it("accepts explicitly enabled bundled skills when their manifests are present", () => {
    const rootDir = createTempSkillsRoot();
    writeSkill(rootDir, "html-canvas", {
      id: "html-canvas",
      name: "HTML Canvas",
      description: "Canvas tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });
    writeSkill(rootDir, "browser-use", {
      id: "browser-use",
      name: "Browser Use",
      description: "Browser tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });
    writeSkill(rootDir, "docx-studio", {
      id: "docx-studio",
      name: "DOCX Studio",
      description: "Document tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });
    writeSkill(rootDir, "pptx-studio", {
      id: "pptx-studio",
      name: "PPTX Studio",
      description: "Presentation tools",
      mcp: {
        transport: "stdio",
        command: "node",
        args: ["server.mjs"]
      }
    });

    const config = {
      skills: {
        rootDir,
        browserUse: {
          enabled: true
        },
        htmlCanvas: {
          enabled: true
        },
        office: {
          enabled: true
        }
      }
    };

    expect(getMissingEnabledBundledSkillManifestIds(config)).toEqual([]);
    expect(() => assertEnabledBundledSkillManifestsPresent(config)).not.toThrow();
  });
});
