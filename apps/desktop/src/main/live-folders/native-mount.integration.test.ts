import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { startNativeLiveFolder, cleanupLiveFolderMounts } from "./native-mount";

// No Google account needed: exercise the real nfsmount, process journal and macOS NFS client.
it.skipIf(process.platform !== "darwin" || process.env.TEST_LIVE_FOLDER_NFS !== "1")("mounts, reads, writes and unmounts through bundled rclone on macOS", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "meowbert-nfs-acceptance-"));
  const source = path.join(root, "source");
  const liveRoot = path.join(root, "Application Support", "live-folders");
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, "input.txt"), "source-to-mount");
  let mount: Awaited<ReturnType<typeof startNativeLiveFolder>> | null = null;
  try {
    mount = await startNativeLiveFolder({ root: liveRoot,
      binary: path.resolve("dist/live-folder-runtime/rclone-" + process.arch), signal: new AbortController().signal,
      folder: { linkId: randomUUID(), connectionId: "a".repeat(64), accountLabel: "local acceptance fixture", localRelativePath: "context/test",
        config: "[google-drive]\ntype = alias\nremote = " + source + "\n" } });
    expect(await fs.readFile(path.join(mount.path, "input.txt"), "utf8")).toBe("source-to-mount");
    await fs.writeFile(path.join(mount.path, "output.txt"), "mount-to-source");
    await expect.poll(() => fs.readFile(path.join(source, "output.txt"), "utf8"), { timeout: 15_000 }).toBe("mount-to-source");
    const config = path.join(liveRoot, "credentials", path.basename(mount.path), "rclone.conf");
    expect((await fs.stat(config)).mode & 0o777).toBe(0o600);
    await mount.stop();
    mount = await startNativeLiveFolder({ root: liveRoot,
      binary: path.resolve("dist/live-folder-runtime/rclone-" + process.arch), signal: new AbortController().signal,
      folder: { linkId: randomUUID(), connectionId: "a".repeat(64), accountLabel: "crash fixture", localRelativePath: "context/test",
        config: "[google-drive]\ntype = alias\nremote = " + source + "\n" } });
    // Startup cleanup must detach an orphaned NFS mount before killing its journaled process.
    await cleanupLiveFolderMounts(liveRoot);
    expect(await mount.isReady!()).toBe(false);
    await expect(fs.readFile(path.join(mount.path, "input.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(liveRoot, "credentials"))).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    await mount?.stop();
    await cleanupLiveFolderMounts(liveRoot);
    await fs.rm(root, { recursive: true, force: true });
  }
}, 60_000);
