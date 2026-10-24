import { expect, it } from "vitest";
import { fromSandboxPath, toSandboxPath, toSandboxText } from "./docker-sandbox-paths.js";

it.each([
  [String.raw`C:\Users\Jerry Brown\project\file.txt`, "/meowbert-host/drives/c/Users/Jerry Brown/project/file.txt"],
  [String.raw`\\server\share\project\file.txt`, "/meowbert-host/unc/server/share/project/file.txt"]
])("round trips Windows mount paths %s", (native, linux) => {
  expect(toSandboxPath(native, "win32")).toBe(linux);
  expect(fromSandboxPath(linux, "win32")).toBe(native);
  expect(toSandboxPath(native, "darwin")).toBe(native);
});

it("maps JSON-encoded paths and retains unrelated shell escapes", () => {
  const encoded = JSON.stringify({ cwd: String.raw`C:\Users\Jerry Brown\project`, command: String.raw`printf 'hello\n'` });
  const decoded = JSON.parse(toSandboxText(encoded, "win32"));
  expect(decoded.cwd).toBe("/meowbert-host/drives/c/Users/Jerry Brown/project");
  expect(decoded.command).toBe(String.raw`printf 'hello\n'`);
});

it("maps JSON-encoded UNC paths without changing regex escapes", () => {
  const encoded = JSON.stringify({ cwd: String.raw`\\server\share\project`, expression: String.raw`/\w+\n/g` });
  const decoded = JSON.parse(toSandboxText(encoded, "win32"));
  expect(decoded.cwd).toBe("/meowbert-host/unc/server/share/project");
  expect(decoded.expression).toBe(String.raw`/\w+\n/g`);
});
