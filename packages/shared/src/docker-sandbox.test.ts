import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import { DockerSandboxManager, dockerSandboxTestUtils } from "./docker-sandbox.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("docker sandbox shell wrappers", () => {
  it("waits indefinitely by default for long-lived execs", async () => {
    vi.useFakeTimers();
    let inspectCount = 0;
    const exec = {
      inspect: vi.fn(async () => {
        inspectCount += 1;
        return inspectCount < 61
          ? { Running: true, ExitCode: null }
          : { Running: false, ExitCode: 0 };
      })
    };

    const waitPromise = dockerSandboxTestUtils.waitForExecExit(exec as never);
    await vi.advanceTimersByTimeAsync(6_100);

    await expect(waitPromise).resolves.toBe(0);
    expect(exec.inspect).toHaveBeenCalledTimes(61);
  });

  it("stores sandbox pid files under writable /tmp instead of the process cwd", () => {
    const pidFilePath = dockerSandboxTestUtils.buildSandboxStateFilePath();

    expect(pidFilePath).toMatch(/^\/tmp\/meowbert-sandbox-state\/[0-9a-f-]+\.pid$/);
    expect(pidFilePath).not.toContain(".meowbert/sandbox-state");
  });
  it("builds a valid wrapped command without invalid ampersand separators", () => {
    const command = dockerSandboxTestUtils.buildWrappedCommand({
      command: ["/bin/bash", "-lc", "pwd"],
      pidFilePath: "/tmp/meowbert-test.pid"
    });

    expect(command[0]).toBe("/bin/bash");
    expect(command[1]).toBe("-lc");
    expect(command[2]).not.toContain("&;");

    const syntaxCheck = spawnSync(command[0], ["-n", "-c", command[2]], { encoding: "utf8" });
    expect(syntaxCheck.status).toBe(0);
    expect(syntaxCheck.stderr).toBe("");
  });

  it("runs sandbox processes with a group-writable umask and their arguments intact", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "meowbert-umask-"));
    try {
      const target = path.join(dir, "it's made.txt");
      const [executable, ...args] = dockerSandboxTestUtils.withGroupWritableUmask(["/bin/sh", "-c", 'echo hi > "$1"', "sh", target]);
      const result = spawnSync(executable, args, { encoding: "utf8" });

      expect(result.status).toBe(0);
      expect(fs.statSync(target).mode & 0o777).toBe(0o664);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("builds a valid kill wrapper", () => {
    const command = dockerSandboxTestUtils.buildKillCommand("/tmp/meowbert-test.pid", "TERM");

    expect(command[2]).not.toContain("then;");

    const syntaxCheck = spawnSync(command[0], ["-n", "-c", command[2]], { encoding: "utf8" });
    expect(syntaxCheck.status).toBe(0);
    expect(syntaxCheck.stderr).toBe("");
  });
});

describe("docker sandbox execution identity", () => {
  it("reuses the current non-root uid and gid when available", () => {
    expect(dockerSandboxTestUtils.resolveSandboxContainerIdentity({
      processUid: 501,
      processGid: 20,
      writableMountGids: [0, 20]
    })).toEqual({
      user: "501:20",
      requiresWritableMountNormalization: false
    });
  });

  it("uses a dedicated non-root uid plus writable mount groups when launched from root", () => {
    expect(dockerSandboxTestUtils.resolveSandboxContainerIdentity({
      processUid: 0,
      processGid: 0,
      writableMountGids: [1234, 4321, 1234]
    })).toEqual({
      user: "1000:1234",
      groupAdd: ["4321"],
      requiresWritableMountNormalization: true
    });
  });

  it("can switch a workspace sandbox to root while preserving writable mount groups", () => {
    expect(dockerSandboxTestUtils.resolveSandboxContainerIdentity({
      processUid: 501,
      processGid: 20,
      writableMountGids: [20, 1234, 20],
      runAsRoot: true
    })).toEqual({
      user: "0:20",
      groupAdd: ["1234"],
      requiresWritableMountNormalization: true
    });
  });
});

describe("docker sandbox path normalization helpers", () => {
  it("dedupes nested writable paths before permission normalization", () => {
    expect(dockerSandboxTestUtils.dedupeNestedPaths([
      "/tmp/workspace",
      "/tmp/workspace/environments/env-1",
      "/tmp/workspace",
      "/tmp/other"
    ])).toEqual([
      "/tmp/other",
      "/tmp/workspace"
    ]);
  });

  it("parses live mount points from /proc/self/mountinfo text", () => {
    expect(dockerSandboxTestUtils.readLiveMountPoints([
      "111 92 0:57 / /app/runtime rw,relatime - ext4 /dev/sda1 rw",
      "222 111 0:91 / /app/runtime/storage/onedrive-main rw,nosuid,nodev - fuse.rclone rclone rw,user_id=0,group_id=0",
      "333 111 0:92 / /app/runtime/xfs-data rw,relatime - xfs /dev/sdb rw"
    ].join("\n"))).toEqual([
      "/app/runtime/storage/onedrive-main",
      "/app/runtime/xfs-data",
      "/app/runtime"
    ]);
  });

  it("plans a nested mount mirror when a live mount is deeper than Docker's static bind", () => {
    expect(dockerSandboxTestUtils.resolveNestedMountMirrorPlan({
      containerPath: "/app/runtime/storage/onedrive-main/workspaces/ws-1/root",
      staticMountDestinations: ["/app/runtime", "/app/config"],
      liveMounts: [
        { mountPoint: "/app/runtime", filesystemType: "ext4" },
        { mountPoint: "/app/runtime/storage/onedrive-main", filesystemType: "fuse.rclone" }
      ]
    })).toEqual({
      liveMountPoint: "/app/runtime/storage/onedrive-main",
      staticMountDestination: "/app/runtime",
      relativePath: "workspaces/ws-1/root"
    });
  });

  it("skips nested mount mirroring when Docker's static bind already matches the live mount", () => {
    expect(dockerSandboxTestUtils.resolveNestedMountMirrorPlan({
      containerPath: "/app/runtime/workspaces/ws-1/root",
      staticMountDestinations: ["/app/runtime", "/app/config"],
      liveMounts: [
        { mountPoint: "/app/runtime", filesystemType: "ext4" }
      ]
    })).toBeNull();
  });

  it("skips nested mount mirroring for host-backed xfs mounts", () => {
    expect(dockerSandboxTestUtils.resolveNestedMountMirrorPlan({
      containerPath: "/app/runtime/xfs-data/workspaces/ws-1/root",
      staticMountDestinations: ["/app/runtime", "/app/config"],
      liveMounts: [
        { mountPoint: "/app/runtime", filesystemType: "ext4" },
        { mountPoint: "/app/runtime/xfs-data", filesystemType: "xfs" }
      ]
    })).toBeNull();
  });

  it("still treats nfs mounts as container-private mirrors", () => {
    expect(dockerSandboxTestUtils.resolveNestedMountMirrorPlan({
      containerPath: "/app/runtime/storage/nfs-main/workspaces/ws-1/root",
      staticMountDestinations: ["/app/runtime", "/app/config"],
      liveMounts: [
        { mountPoint: "/app/runtime", filesystemType: "ext4" },
        { mountPoint: "/app/runtime/storage/nfs-main", filesystemType: "nfs4" }
      ]
    })).toEqual({
      liveMountPoint: "/app/runtime/storage/nfs-main",
      staticMountDestination: "/app/runtime",
      relativePath: "workspaces/ws-1/root"
    });
  });

  it("builds stable nested mount mirror paths under the static Docker bind", () => {
    const first = dockerSandboxTestUtils.buildNestedMountMirrorPath(
      "/app/runtime",
      "/app/runtime/storage/onedrive-main",
      "api-container"
    );
    const second = dockerSandboxTestUtils.buildNestedMountMirrorPath(
      "/app/runtime",
      "/app/runtime/storage/onedrive-main",
      "api-container"
    );

    expect(first).toBe(second);
    expect(first).toMatch(/^\/app\/runtime\/\.meowbert-sandbox-mirrors\/api-container\/[0-9a-f]{24}$/);
  });

  it("prefers direct host-path mappings over nested mirror paths for mounted backends", async () => {
    const manager = new DockerSandboxManager({
      provider: "docker",
      image: "meowbert-sandbox-runtime:local",
      dockerHost: "unix:///var/run/docker.sock",
      startTimeoutMs: 30_000,
      sessionIdleTimeoutMs: 30_000,
      envPassthroughPatterns: [],
      resources: {
        pids: 64,
        memoryMb: 256,
        cpus: 1,
        storageMb: 20
      }
    });

    vi.spyOn(manager as any, "ensureCurrentContainerMounts").mockResolvedValue([
      {
        destination: "/app/runtime",
        source: "/srv/meowbert/runtime"
      }
    ]);
    const mirrorSpy = vi.spyOn(manager as any, "resolveNestedMountMirrorPath");

    await expect((manager as any).resolveMountSource(
      "/app/runtime/storage/onedrive-main/workspaces/ws-1/root",
      false
    )).resolves.toEqual({
      source: "/srv/meowbert/runtime/storage/onedrive-main/workspaces/ws-1/root",
      sourceKind: "direct"
    });

    expect(mirrorSpy).not.toHaveBeenCalled();
  });
});

describe("docker sandbox missing-image errors", () => {
  it("recognizes Docker no-such-image responses", () => {
    expect(dockerSandboxTestUtils.isDockerImageMissingError({
      statusCode: 404,
      reason: "no such container",
      json: {
        message: "No such image: meowbert-sandbox-runtime:local"
      }
    })).toBe(true);
  });

  it("builds an actionable missing-image error message", () => {
    expect(dockerSandboxTestUtils.buildMissingSandboxImageMessage({
      provider: "docker",
      image: "meowbert-sandbox-runtime:local",
      dockerHost: "unix:///var/run/docker.sock",
      startTimeoutMs: 30_000,
      sessionIdleTimeoutMs: 30_000,
      envPassthroughPatterns: [],
      resources: {
        pids: 64,
        memoryMb: 256,
        cpus: 1,
        storageMb: 20
      }
    })).toContain("docker compose build sandbox-runtime");
  });

  it("recognizes Docker unknown-runtime responses", () => {
    expect(dockerSandboxTestUtils.isDockerRuntimeUnavailableError({
      statusCode: 500,
      json: {
        message: "Unknown runtime specified runsc"
      }
    })).toBe(true);
  });

  it("builds an actionable missing-runtime message", () => {
    expect(dockerSandboxTestUtils.buildMissingSandboxRuntimeMessage({
      provider: "docker",
      image: "meowbert-sandbox-runtime:local",
      runtime: "runsc",
      dockerHost: "unix:///var/run/docker.sock",
      startTimeoutMs: 30_000,
      sessionIdleTimeoutMs: 30_000,
      envPassthroughPatterns: [],
      resources: {
        pids: 64,
        memoryMb: 256,
        cpus: 1,
        storageMb: 20
      }
    }, ["runc", "runsc"])).toContain("runsc");
  });

  it("reads runtime names from Docker info payloads", () => {
    expect(dockerSandboxTestUtils.readDockerRuntimeNames({
      Runtimes: {
        runc: {},
        runsc: {}
      }
    })).toEqual(["runc", "runsc"]);
  });
});
