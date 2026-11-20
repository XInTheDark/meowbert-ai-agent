import { expect, it } from "vitest";
import { parseXmlToolCalls } from "./xml-tool-call-parser.js";

it("pairs closing function and parameter tags and preserves scalar arguments", () => {
  expect(parseXmlToolCalls(`<tool_call><function=run_shell><parameter=command>pwd</parameter=command><parameter=timeout_seconds>10</parameter=timeout_seconds><parameter=enabled>false</parameter=enabled></function=run_shell></tool_call>`))
    .toEqual([{ name: "run_shell", arguments: { command: "pwd", timeout_seconds: 10, enabled: false } }]);
});
