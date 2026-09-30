import { describe, expect, it } from "vitest";
import {
  matchesToolsMenuQuery,
  partitionToolsMenuSkills,
  type SkillSummary
} from "./ToolOptionsDropdown";

describe("partitionToolsMenuSkills", () => {
  it("routes skills into categorized sections by catalogGroup", () => {
    const skills: SkillSummary[] = [
      {
        id: "core-tool",
        name: "Core Tool",
        description: "Core tool",
        catalogGroup: "core"
      },
      {
        id: "html-canvas",
        name: "Canvas",
        description: "Visual HTML documents",
        catalogGroup: "visuals"
      },
      {
        id: "docx-studio",
        name: "DOCX Studio",
        description: "Word document tools",
        catalogGroup: "documents"
      },
      {
        id: "deep-ai-search",
        name: "Deep AI Search",
        description: "Web search tool",
        catalogGroup: "web"
      },
      {
        id: "custom-mcp",
        name: "Custom MCP",
        description: "Custom extension"
      }
    ];

    const partitioned = partitionToolsMenuSkills(skills);
    expect(partitioned.coreSkills).toEqual([skills[0]]);
    expect(partitioned.visualSkills).toEqual([skills[1]]);
    expect(partitioned.documentSkills).toEqual([skills[2]]);
    expect(partitioned.webSkills).toEqual([skills[3]]);
    expect(partitioned.customSkills).toEqual([skills[4]]);
  });

  it("treats skills without a group as custom skills", () => {
    const skills: SkillSummary[] = [
      {
        id: "my-custom-skill",
        name: "My custom skill",
        description: "Custom workflow"
      }
    ];

    expect(partitionToolsMenuSkills(skills)).toEqual({
      coreSkills: [],
      visualSkills: [],
      documentSkills: [],
      webSkills: [],
      customSkills: skills
    });
  });
});

describe("matchesToolsMenuQuery", () => {
  it("matches query against any candidate value", () => {
    expect(matchesToolsMenuQuery("doc", "DOCX Studio", "Word templates", "docx-studio")).toBe(true);
    expect(matchesToolsMenuQuery("pdf", "DOCX Studio", "Word templates", "docx-studio")).toBe(false);
  });
});
