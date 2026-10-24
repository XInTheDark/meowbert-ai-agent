import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { createDesktopDocker } from "./manager";
import { prepareWindowsSkillCatalog } from "./windows-catalog";

// The image owns the skill builds, including native Linux dependencies.
export async function prepareSandboxSkills(image: string, resourcesRoot: string, deviceId: string): Promise<string> {
  if (process.platform === "win32") return prepareWindowsSkillCatalog(image, resourcesRoot, deviceId);
  const docker = createDesktopDocker();
  const info = await docker.getImage(image).inspect();
  const destination = path.join(resourcesRoot, info.Id.replace(/[^a-zA-Z0-9_-]/g, "_"));
  const ready = path.join(destination, ".ready");
  if (await fs.stat(ready).then(() => true, () => false)) return path.join(destination, "skills");
  await fs.mkdir(destination, { recursive: true });
  const container = await docker.createContainer({ Image: image, Labels: { "meowbert.local.device": deviceId }, Cmd: ["true"] });
  try {
    const archive = await container.getArchive({ path: "/app/skills" });
    const tar = spawn("/usr/bin/tar", ["-xf", "-", "-C", destination], { stdio: ["pipe", "ignore", "pipe"] });
    const completion = new Promise<void>((resolve, reject) => {
      tar.on("error", reject);
      tar.on("exit", (code) => code === 0 ? resolve() : reject(new Error("Could not unpack sandbox skills.")));
    });
    await Promise.all([pipeline(archive, tar.stdin), completion]);
    await fs.writeFile(ready, image);
    return path.join(destination, "skills");
  } finally { await container.remove({ force: true }); }
}

export async function stopDesktopContainers(deviceId: string): Promise<void> {
  const docker = createDesktopDocker();
  const containers = await docker.listContainers({ all: true, filters: { label: ["meowbert.local.device=" + deviceId] } });
  await Promise.all(containers.map(async ({ Id }) => {
    await docker.getContainer(Id).remove({ force: true }).catch((error: { statusCode?: number }) => {
      if (error.statusCode !== 404) throw error;
    });
  }));
}
