import { describe, expect, it, vi } from "vitest";
import { finalizeArchiveAfterReply } from "./archive-stream.js";

describe("finalizeArchiveAfterReply", () => {
  it("defers archive finalization until after the caller can send the stream", async () => {
    const archive = {
      finalize: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn()
    };
    const onError = vi.fn();

    finalizeArchiveAfterReply(archive as never, onError);

    expect(archive.finalize).not.toHaveBeenCalled();

    await new Promise((resolve) => setImmediate(resolve));

    expect(archive.finalize).toHaveBeenCalledTimes(1);
    expect(archive.destroy).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });

  it("reports and destroys the archive when finalization fails", async () => {
    const error = new Error("zip failed");
    const archive = {
      finalize: vi.fn().mockRejectedValue(error),
      destroy: vi.fn()
    };
    const onError = vi.fn();

    finalizeArchiveAfterReply(archive as never, onError);
    await new Promise((resolve) => setImmediate(resolve));
    await Promise.resolve();

    expect(onError).toHaveBeenCalledWith(error);
    expect(archive.destroy).toHaveBeenCalledWith(error);
  });
});
