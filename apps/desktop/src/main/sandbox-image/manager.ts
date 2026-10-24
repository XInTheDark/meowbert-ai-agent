import Docker from "dockerode";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { sandboxArchitecture } from "./platform";

export interface SandboxImageReference { reference: string; digest: string | null }
export interface SandboxImageClient {
  inspect(reference: string): Promise<{ repoDigests?: string[]; id?: string; architecture?: string; os?: string }>;
  pull(reference: string, onProgress?: (message: string) => void): Promise<void>;
}
export function desktopDockerHost(): string {
  if (process.platform === "win32") return process.env.DOCKER_HOST ?? "npipe:////./pipe/dockerDesktopLinuxEngine";
  const socket = path.join(os.homedir(), ".docker/run/docker.sock");
  return process.env.DOCKER_HOST ?? "unix://" + (fs.existsSync(socket) ? socket : "/var/run/docker.sock");
}
export function createDesktopDocker(): Docker {
  const host = desktopDockerHost();
  if (host.startsWith("npipe:////./pipe/") && process.platform === "win32") {
    return new Docker({ socketPath: host.slice(8), timeout: 30_000 });
  }
  if (!host.startsWith("unix://")) throw new Error("Local execution requires the local Docker Desktop socket or Windows named pipe.");
  return new Docker({ socketPath: host.slice(7), timeout: 30_000 });
}
export function imageRepository(reference: string): string {
  const withoutDigest = reference.split("@")[0];
  const colon = withoutDigest.lastIndexOf(":");
  return colon > withoutDigest.lastIndexOf("/") ? withoutDigest.slice(0, colon) : withoutDigest;
}
export function pinnedImage(image: SandboxImageReference): string {
  return image.digest ? imageRepository(image.reference) + "@" + image.digest : image.reference;
}
export function imageHasDigest(reference: string, digest: string, repoDigests: string[] | undefined): boolean {
  return (repoDigests ?? []).includes(imageRepository(reference) + "@" + digest);
}
export function createDockerImageClient(docker = createDesktopDocker()): SandboxImageClient {
  return {
    async inspect(reference) {
      const info = await docker.getImage(reference).inspect();
      return { repoDigests: info.RepoDigests, id: info.Id, architecture: info.Architecture, os: info.Os };
    },
    async pull(reference, onProgress) {
      const stream = await docker.pull(reference, { platform: "linux/" + sandboxArchitecture() });
      await new Promise<void>((resolve, reject) => {
        docker.modem.followProgress(stream, (error) => error ? reject(error) : resolve(), (event) => {
          onProgress?.([event.status, event.progress].filter(Boolean).join(" "));
        });
      });
    }
  };
}
export async function sandboxImagePresent(client: SandboxImageClient, image: SandboxImageReference): Promise<boolean> {
  try {
    const info = await client.inspect(pinnedImage(image));
    if ((info.architecture && info.architecture !== sandboxArchitecture()) || (info.os && info.os !== "linux")) return false;
    return !image.digest || imageHasDigest(image.reference, image.digest, info.repoDigests);
  } catch { return false; }
}
export async function ensureSandboxImage(input: {
  client: SandboxImageClient; image: SandboxImageReference; onProgress?: (message: string) => void;
}): Promise<{ downloaded: boolean; digest: string | null }> {
  if (await sandboxImagePresent(input.client, input.image)) return { downloaded: false, digest: input.image.digest };
  if (!input.image.digest) throw new Error("This server uses a local sandbox image. Load its linux/" + sandboxArchitecture() + " build into Docker Desktop first.");
  await input.client.pull(pinnedImage(input.image), input.onProgress);
  if (!await sandboxImagePresent(input.client, input.image)) throw new Error("The downloaded sandbox does not match the server digest.");
  return { downloaded: true, digest: input.image.digest };
}
