import { finishWorkspaceRelinksOnce } from "./device-workspace-relinks.js";
import { publishPendingArtifactsOnce } from "./artifact-publication.js";
import { refreshLocalRunMemoryOnce } from "../memory/local-run-refresh.js";

export function startLocalStorageLoop(): { stop: () => Promise<void> } {
  let stopped = false;
  let pending: Promise<unknown> | null = null;
  let timer: NodeJS.Timeout | null = null;
  const run = () => {
    if (stopped) return;
    pending = Promise.allSettled([publishPendingArtifactsOnce(), refreshLocalRunMemoryOnce(), finishWorkspaceRelinksOnce()])
      .then((results) => { for (const result of results) if (result.status === "rejected") console.error("Local storage retry failed", result.reason); })
      .finally(() => { if (!stopped) { timer = setTimeout(run, 5_000); timer.unref(); } });
  };
  run();
  return { stop: async () => { stopped = true; if (timer) clearTimeout(timer); await pending; } };
}
