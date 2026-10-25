import path from "node:path";
import type { PlatformToolHost } from "@meowbert/run-executor/agent/ports/platform-tools";
import type { RunBootstrap } from "@meowbert/run-executor/agent/ports/run-bootstrap";
import type { ExecutorSettings } from "@meowbert/run-executor/agent/ports/executor-settings";
import { executeHostCommand } from "./host-machine-host";
import type { HostProcesses } from "./host-processes";
import { computerUseService } from "../computer-use/service";
import { getComputerUseStatus } from "../computer";
import type { DesktopLocalExecutorOptions } from "./local-executor";

export function configureLocalRunPlatform(input: {
  platform: PlatformToolHost; options: DesktopLocalExecutorOptions; taskId: string; signal: AbortSignal;
  hostProcesses: HostProcesses; envRoot: string; bootstrap: RunBootstrap; settings: ExecutorSettings;
  liveSyncFiles: RunBootstrap["liveSyncFiles"];
}): void {
  const { platform, options, signal, bootstrap } = input;
  platform.getDesktopComputerPresence = async () => options.computerUseEnabled ? ({ status: await getComputerUseStatus() }) as never : null;
  platform.requestDesktopComputerAction = async (action) => {
    signal.throwIfAborted();
    if (!options.computerUseEnabled) throw new Error("Computer Use is disabled on this device.");
    return computerUseService.performAction({ ...action, taskId: input.taskId });
  };
  if (options.hostConsent && options.hostShellEnabled) {
    platform.hostShell = async ({ command, timeoutMs }) => {
      signal.throwIfAborted();
      return { ...await executeHostCommand(input.hostProcesses, { command, timeoutMs,
        shell: process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/zsh",
        workingDir: path.resolve(input.envRoot, bootstrap.snapshot.task.task_root_path),
        maxOutputKb: input.settings.maxCommandOutputKb, abortSignal: signal }) };
    };
  }
  const originalPath = (value: string) => {
    const local = input.liveSyncFiles.find((file) => file.taskRelativePath === value);
    return bootstrap.liveSyncFiles?.find((file) => file.id === local?.id)?.taskRelativePath ?? value;
  };
  const originalStatus = platform.liveSyncStatus, originalTransfer = platform.liveSyncTransfer;
  platform.liveSyncStatus = (request) => originalStatus({ ...request, taskRelativePath: originalPath(request.taskRelativePath) });
  platform.liveSyncTransfer = (request) => originalTransfer({ ...request, taskRelativePath: originalPath(request.taskRelativePath) });
  const originalSearch = platform.liveSyncFolderSearch;
  platform.liveSyncFolderSearch = async (request) => {
    const local = input.liveSyncFiles.find((file) => file.taskRelativePath === request.taskRelativePath);
    const original = bootstrap.liveSyncFiles?.find((file) => file.id === local?.id);
    const result = await originalSearch({ ...request, taskRelativePath: original?.taskRelativePath ?? request.taskRelativePath });
    if (!original || !local || original.taskRelativePath === local.taskRelativePath) return result;
    const mapPath = (value: string) => local.taskRelativePath + value.slice(original.taskRelativePath.length);
    return { ...result, folder: mapPath(result.folder), items: result.items.map((item) => ({ ...item, path: mapPath(item.path) })) };
  };
}
