import { describe, expect, it } from "vitest";
import { findMountDevice } from "./xfs-quota-device-node.js";

const mountInfo = [
  "2923 2900 8:1 /srv/meowbert/runtime /app/runtime rw,relatime shared:1 - ext4 /dev/sda1 rw,discard",
  "56 2923 7:0 / /app/runtime/task-scratch rw,relatime shared:1784 - xfs /dev/loop0 rw,attr2,inode64,prjquota",
  "57 2923 0:61 / /app/runtime/storage/onedrive-main rw,nosuid shared:9 - fuse.rclone gdrive:meowbert-data rw"
].join("\n");

describe("findMountDevice", () => {
  it("finds the block device behind an exact mount point", () => {
    expect(findMountDevice(mountInfo, "/app/runtime/task-scratch/")).toEqual({
      source: "/dev/loop0",
      major: 7,
      minor: 0
    });
  });

  it("does not match a parent mount for a nested path", () => {
    expect(findMountDevice(mountInfo, "/app/runtime/task-scratch/workspace-1")).toBeNull();
  });
});
