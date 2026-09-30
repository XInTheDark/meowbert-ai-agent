import { describe, expect, it, vi } from "vitest";
import { requestPersistentShellRuntime } from "./persistent-shell-runtime.js";

const target = { id: "test", container_id: "container", working_dir: "/workspace" };

describe("persistent shell transport failures", () => {
  it("reports missing runtime startup diagnostics", async () => {
    const manager = { attachPersistentSandbox: vi.fn().mockResolvedValue({
      executeShellCommand: vi.fn().mockResolvedValue({
        exitCode: 2, timedOut: false, stdout: "",
        stderr: "python3: can't open file '/opt/meowbert/persistent-shell/main.py': No such file or directory"
      })
    }) };
    await expect(requestPersistentShellRuntime(manager, target, {}, "launch"))
      .rejects.toThrow("Persistent shell startup failed. Check the sandbox runtime image and startup diagnostics. Exit code: 2.\npython3: can't open file");
  });

  it("keeps uncertain delivery guidance for input timeouts", async () => {
    const manager = { attachPersistentSandbox: vi.fn().mockResolvedValue({
      executeShellCommand: vi.fn().mockResolvedValue({ exitCode: null, timedOut: true, stdout: "", stderr: "" })
    }) };
    await expect(requestPersistentShellRuntime(manager, target, { action: "input", data: "yes\n" }))
      .rejects.toThrow("delivery may be uncertain. Inspect status before retrying input. Request timed out.");
  });
});
