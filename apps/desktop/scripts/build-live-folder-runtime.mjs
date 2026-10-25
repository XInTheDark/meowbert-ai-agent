import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist/live-folder-runtime");
await fs.mkdir(output, { recursive: true });
// Download only while building the app. Never install or download tools at runtime.
if (process.platform !== "darwin") process.exit(0);
const version = "1.75.2";
const checksums = {
  x64: "574e1f31cf1c464e5fb0325cb66fcbdeaf1efa1802bd9b17f13c256fd74b6561",
  arm64: "610ab7d48615135dfc60b763858b11a426a0d3d1160c1bb76fb0ae6011b02edd"
};
const cache = path.join(os.homedir(), ".cache/meowbert-build/rclone", version);
await fs.mkdir(cache, { recursive: true });
for (const [architecture, checksum] of Object.entries(checksums)) {
  const name = "rclone-v" + version + "-osx-" + (architecture === "x64" ? "amd64" : architecture);
  const archive = path.join(cache, name + ".zip");
  let bytes = await fs.readFile(archive).catch(() => null);
  if (!bytes || createHash("sha256").update(bytes).digest("hex") !== checksum) {
    const response = await fetch("https://downloads.rclone.org/v" + version + "/" + name + ".zip", { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error("Could not fetch the pinned rclone build: HTTP " + response.status);
    bytes = Buffer.from(await response.arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== checksum) throw new Error("rclone archive checksum mismatch.");
    await fs.writeFile(archive, bytes);
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-rclone-build-"));
  try {
    await execFile("/usr/bin/unzip", ["-q", archive, name + "/rclone", name + "/README.txt", "-d", temporary]);
    const binary = path.join(output, "rclone-" + architecture);
    await fs.copyFile(path.join(temporary, name, "rclone"), binary);
    await fs.chmod(binary, 0o755);
    await fs.copyFile(path.join(temporary, name, "README.txt"), path.join(output, "rclone-README.txt"));
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}
await fs.writeFile(path.join(output, "LICENSE-rclone.txt"), "rclone v" + version + "\nCopyright (C) 2012 by Nick Craig-Wood https://rclone.org\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:\n\nThe above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.\n\nTHE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.\n");
