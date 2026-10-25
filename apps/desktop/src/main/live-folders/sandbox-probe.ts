import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { MachineHandle } from "@meowbert/shared/docker-sandbox";
import { StorageNotReadyError } from "../storage/inputs";
import { isNativeLiveFolderMounted } from "./native-mount";

// Check named files in both directions, never walk a remote folder.
export async function verifySandboxLiveFolders(input: {
  sandbox: Pick<MachineHandle, "executeShellCommand">; paths: string[]; taskDir: string; readOnly: boolean;
}): Promise<void> {
  for (const root of [...new Set(input.paths)]) {
    const token = randomUUID();
    const probe = path.join(root, ".meowbert-probe-" + token);
    const reply = probe + "-reply";
    try {
      if (!await isNativeLiveFolderMounted(root)) throw new Error("The native mount is unavailable.");
      await fs.writeFile(probe, token, { flag: "wx", mode: 0o644 });
      const script = "const fs = require('node:fs');"
        + "if (fs.readFileSync(" + JSON.stringify(probe) + ", 'utf8') !== " + JSON.stringify(token) + ") process.exit(1);"
        + (input.readOnly ? "" : "fs.writeFileSync(" + JSON.stringify(reply) + ", " + JSON.stringify(token) + ", {flag: 'wx', mode: 0o644});");
      const result = await input.sandbox.executeShellCommand({
        command: "node -e '" + script.replaceAll("'", "'\"'\"'") + "'", shell: "/bin/sh",
        workingDir: input.taskDir, timeoutMs: 10_000, maxOutputKb: 1
      });
      if (result.exitCode !== 0 || result.timedOut || result.aborted) throw new Error("The sandbox cannot access the mount.");
      if (!input.readOnly && await fs.readFile(reply, "utf8") !== token) throw new Error("The mount is not writable from the sandbox.");
      if (!await isNativeLiveFolderMounted(root)) throw new Error("The native mount disappeared.");
    } catch {
      throw new StorageNotReadyError("Waiting for storage: Docker Desktop cannot access a live Google Drive folder. Check Docker Desktop file sharing and retry Local Execution.");
    } finally {
      await Promise.all([probe, reply].map((file) => fs.unlink(file).catch(() => undefined)));
    }
  }
}
