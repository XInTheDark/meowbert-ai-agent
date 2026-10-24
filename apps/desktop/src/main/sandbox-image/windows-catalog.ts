import fs from "node:fs/promises";
import path from "node:path";
import { createDesktopDocker } from "./manager";

// NTFS cannot preserve every Linux symlink. Only metadata is read by Electron;
// executable assets and native dependencies stay at /app/skills in the image.
export async function prepareWindowsSkillCatalog(image: string, resourcesRoot: string, deviceId: string): Promise<string> {
  const docker = createDesktopDocker();
  const info = await docker.getImage(image).inspect();
  const destination = path.join(resourcesRoot, info.Id.replace(/[^a-zA-Z0-9_-]/g, "_"), "catalog");
  const ready = path.join(destination, ".ready");
  if (await fs.stat(ready).then(() => true, () => false)) return destination;
  const script = [
    "const fs = require('fs'), path = require('path');",
    "const entries = [];",
    "for (const entry of fs.readdirSync('/app/skills', {withFileTypes:true})) {",
    "if (!entry.isDirectory()) continue;",
    "const dir = path.join('/app/skills',entry.name);",
    "if (!fs.existsSync(path.join(dir,'skill.json'))) continue;",
    "entries.push({name:entry.name, manifest:fs.readFileSync(path.join(dir,'skill.json'),'utf8'),",
    "doc:fs.existsSync(path.join(dir,'skill.md')) ? fs.readFileSync(path.join(dir,'skill.md'),'utf8') : null}); }",
    "process.stdout.write(JSON.stringify(entries));"
  ].join(" ");
  const container = await docker.createContainer({ Image: image, Entrypoint: ["node"], Cmd: ["-e", script], Tty: true,
    Labels: { "meowbert.local.device": deviceId }, HostConfig: { NetworkMode: "none", ReadonlyRootfs: true } });
  try {
    await container.start();
    if ((await container.wait()).StatusCode !== 0) throw new Error("Could not read sandbox skill metadata.");
    const output = await container.logs({ stdout: true, stderr: false, follow: false });
    const entries = JSON.parse(output.toString()) as Array<{ name: string; manifest: string; doc: string | null }>;
    for (const entry of entries) {
      if (!/^[a-zA-Z0-9_-][a-zA-Z0-9._-]*$/.test(entry.name)) throw new Error("Invalid sandbox skill directory.");
      const dir = path.join(destination, entry.name);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, "skill.json"), entry.manifest);
      if (entry.doc !== null) await fs.writeFile(path.join(dir, "skill.md"), entry.doc);
    }
    await fs.writeFile(ready, image);
    return destination;
  } finally { await container.remove({ force: true }); }
}
