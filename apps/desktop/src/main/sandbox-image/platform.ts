export function sandboxArchitecture(architecture = process.arch): "amd64" | "arm64" {
  if (architecture !== "x64" && architecture !== "arm64") throw new Error("Unsupported sandbox architecture: " + architecture);
  return architecture === "x64" ? "amd64" : "arm64";
}

export function sharedSandboxDependencies(): string {
  return sandboxArchitecture() === "amd64" ? "shared" : "shared-linux-arm64";
}
