import { describe, expect, it } from "vitest";
import {
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS,
  RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS
} from "../../agent-tools/index.js";
import { limitComputerLocalShellOutput } from "./computer.js";

describe("limitComputerLocalShellOutput", () => {
  it("leaves normal stdout and stderr unchanged", () => {
    const output = { command: "ls", cwd: "/tmp", stdout: "file.txt\n", stderr: "", exitCode: 0, timedOut: false };
    expect(limitComputerLocalShellOutput(output)).toEqual(output);
  });

  it("truncates oversized stdout and stderr with head and tail preserved", () => {
    const limit = RUN_SHELL_DEFAULT_OUTPUT_LIMIT_START_CHARS + RUN_SHELL_DEFAULT_OUTPUT_LIMIT_END_CHARS;
    const huge = `HEAD_${"a".repeat(limit + 5_000)}_TAIL`;

    const bounded = limitComputerLocalShellOutput({
      command: "cat huge.log",
      stdout: huge,
      stderr: "small err",
      exitCode: 0,
      timedOut: false
    });

    expect(bounded.output_truncated).toBe(true);
    expect(bounded.stderr).toBe("small err");
    expect(String(bounded.stdout)).toMatch(/^HEAD_a+/);
    expect(String(bounded.stdout)).toContain(`[truncated; full length: ${huge.length} characters]`);
    expect(String(bounded.stdout)).toMatch(/a+_TAIL$/);
    expect(String(bounded.stdout).length).toBeLessThan(limit + 120);
  });
});
