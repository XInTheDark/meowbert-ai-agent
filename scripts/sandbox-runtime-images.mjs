import path from "node:path";
import { pathToFileURL } from "node:url";

export function sandboxRuntimeImages(repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? "")) {
    throw new Error("A GitHub owner/repository is required for runtime publication.");
  }
  const normalized = repository.toLowerCase();
  const owner = normalized.split("/")[0];
  return {
    name: `ghcr.io/${owner}/meowbert-sandbox-runtime`,
    aliasName: `ghcr.io/${normalized}/sandbox-runtime`,
    platforms: ["linux/amd64", "linux/arm64"]
  };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const image = sandboxRuntimeImages(process.env.GITHUB_REPOSITORY);
  console.log(`name=${image.name}\nalias_name=${image.aliasName}\nplatforms=${image.platforms.join(",")}`);
}
