import { describe, expect, it } from "vitest";
import type { ProjectMap } from "@meowbert/shared";
import { renderProjectMapForMaster } from "./map-view.js";

const details = "First instruction. ".repeat(20) + "\n\n- Preserve this final instruction.";

function makeMap(): ProjectMap {
  return {
    brief: "Project goal", tasks: [], tasksTruncated: false,
    folders: [
      { id: "parent", parentFolderId: null, name: "Parent", note: "Context", sortOrder: 0 },
      { id: "child", parentFolderId: "parent", name: "Child", note: "Details", sortOrder: 0 }
    ],
    cards: [null, "parent", "child"].map((folderId, index) => ({
      id: `card-${index}`, folderId, title: `Work ${index}`, body: `${details} Card ${index}.`, state: "next", sortOrder: index
    }))
  };
}

function bodyLines(output: string): string {
  return output.split("\n").map((line) => line.trimStart()).join("\n");
}

describe("Master map card details", () => {
  it("exposes complete top-level card instructions on the whole-map read", () => {
    const map = makeMap();
    const output = renderProjectMapForMaster(map, null);
    expect(output).toContain('Card "Work 0" [card-0] next');
    expect(bodyLines(output)).toContain(map.cards[0].body);
  });

  it.each(["parent", "child"])("exposes complete card instructions when opening %s", (folderId) => {
    const map = makeMap();
    const output = renderProjectMapForMaster(map, folderId);
    if (folderId === "parent") expect(bodyLines(output)).toContain(map.cards[1].body);
    expect(bodyLines(output)).toContain(map.cards[2].body);
    expect(output).toContain('Card "Work 2" [card-2] next');
    expect(output).not.toContain('Card "Work 0"');
  });
});
