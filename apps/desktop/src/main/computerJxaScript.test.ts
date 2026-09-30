import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const computerSourcePath = path.join(currentDir, "computer.ts");

describe("macOS computer JXA script", () => {
  it("does not use the reserved JXA run handler", () => {
    const source = fs.readFileSync(computerSourcePath, "utf8");
    const macScriptStart = source.indexOf("const MAC_COMPUTER_SCRIPT = `");
    expect(macScriptStart).toBeGreaterThanOrEqual(0);

    const macScript = source.slice(macScriptStart);
    expect(macScript).toContain("function main()");
    expect(macScript).toContain("console.log(main());");
    expect(macScript).not.toContain("function run()");
    expect(macScript).not.toContain("console.log(run());");
  });
});
