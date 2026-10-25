import fs from "node:fs/promises";
import path from "node:path";
import { createDesktopDocker } from "./manager";
interface DownloadedSandbox { reference: string; resourceDirectory: string }

// Only images this desktop downloaded are eligible; Docker refuses removal while any container uses them.
export async function maintainDownloadedSandboxes(input: {
  resourcesRoot: string; currentImage: string; skillsRoot: string; downloaded: boolean; inUseImages: string[];
}): Promise<void> {
  const file = path.join(input.resourcesRoot, "downloaded-images.json");
  const previousText = await fs.readFile(file, "utf8").catch((error) => { if (error.code === "ENOENT") return "[]"; throw error; });
  const images: DownloadedSandbox[] = JSON.parse(previousText);
  if (input.downloaded && !images.some((image) => image.reference === input.currentImage)) {
    images.push({ reference: input.currentImage, resourceDirectory: path.basename(path.dirname(input.skillsRoot)) });
  }
  const retained: DownloadedSandbox[] = [];
  const docker = createDesktopDocker();
  const currentId = (await docker.getImage(input.currentImage).inspect()).Id;
  for (const image of images) {
    if (image.reference === input.currentImage || input.inUseImages.includes(image.reference)) { retained.push(image); continue; }
    try {
      const previous = docker.getImage(image.reference);
      if ((await previous.inspect()).Id === currentId) { retained.push(image); continue; }
      await previous.remove({ force: false });
      if (/^sha256_[a-f0-9]+$/.test(image.resourceDirectory)) {
        await fs.rm(path.join(input.resourcesRoot, image.resourceDirectory), { recursive: true, force: true });
      }
    } catch { retained.push(image); }
  }
  if (JSON.stringify(retained) !== previousText) await fs.writeFile(file, JSON.stringify(retained), { mode: 0o600 });
}
