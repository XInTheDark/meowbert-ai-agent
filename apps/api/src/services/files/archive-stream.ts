import archiver from "archiver";

export function finalizeArchiveAfterReply(
  archive: ReturnType<typeof archiver>,
  onError: (error: Error) => void
): void {
  setImmediate(() => {
    void archive.finalize().catch((err) => {
      const error = err instanceof Error ? err : new Error(String(err));
      onError(error);
      archive.destroy(error);
    });
  });
}
