import { afterEach, expect, it, vi } from "vitest";
const create = vi.hoisted(() => vi.fn());
vi.mock("dockerode", () => ({ default: class { constructor(options: unknown) { create(options); } } }));
import { createDesktopDocker, desktopDockerHost } from "./manager";
const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
afterEach(() => { Object.defineProperty(process, "platform", platform); vi.unstubAllEnvs(); vi.clearAllMocks(); });

it("uses the local Windows Linux-engine named pipe", () => {
  Object.defineProperty(process, "platform", { value: "win32" });
  vi.stubEnv("DOCKER_HOST", "npipe:////./pipe/dockerDesktopLinuxEngine");
  expect(desktopDockerHost()).toBe("npipe:////./pipe/dockerDesktopLinuxEngine");
  createDesktopDocker();
  expect(create).toHaveBeenCalledWith({ socketPath: "//./pipe/dockerDesktopLinuxEngine", timeout: 30_000 });
});

it("refuses a remote Docker daemon", () => {
  vi.stubEnv("DOCKER_HOST", "tcp://remote:2375");
  expect(() => createDesktopDocker()).toThrow(/local Docker Desktop/);
  expect(create).not.toHaveBeenCalled();
});
