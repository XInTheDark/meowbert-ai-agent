import path from "node:path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";

const execFile = promisify(execFileCallback);
const DEFAULT_XFS_QUOTA_COMMAND = "xfs_quota";

export interface XfsQuotaCommandRunner {
  execFile(command: string, args: string[]): Promise<{ stdout: string; stderr: string }>;
}

export interface XfsProjectQuotaMountStatus {
  ready: boolean;
  message: string;
  stdout: string;
  stderr: string;
}

function defaultCommandRunner(): XfsQuotaCommandRunner {
  return {
    async execFile(command: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
      const result = await execFile(command, args, { encoding: "utf8" });
      return {
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };
}

function normalizeCommandFailure(error: unknown): { message: string; stdout: string; stderr: string } {
  if (!(error instanceof Error)) {
    return {
      message: String(error),
      stdout: "",
      stderr: ""
    };
  }

  const stdoutValue = "stdout" in error ? error.stdout : null;
  const stderrValue = "stderr" in error ? error.stderr : null;

  const stdout =
    typeof stdoutValue === "string"
      ? stdoutValue.trim()
      : Buffer.isBuffer(stdoutValue)
        ? stdoutValue.toString("utf8").trim()
        : "";
  const stderr =
    typeof stderrValue === "string"
      ? stderrValue.trim()
      : Buffer.isBuffer(stderrValue)
        ? stderrValue.toString("utf8").trim()
        : "";

  const details = [error.message, stderr, stdout].map((value) => value.trim()).filter((value) => value.length > 0);
  return {
    message: details[0] ?? "Unknown xfs_quota failure",
    stdout,
    stderr
  };
}

function quoteXfsCommandValue(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function formatQuotaMegabytes(quotaBytes: number): string {
  return `${Math.max(1, Math.ceil(quotaBytes / (1024 * 1024)))}m`;
}

export function resolveWorkspaceStorageUnitRoot(workspaceRoot: string): string {
  return path.resolve(workspaceRoot, "..");
}

export class XfsProjectQuotaManager {
  private readonly commandRunner: XfsQuotaCommandRunner;

  constructor(input: {
    commandRunner?: XfsQuotaCommandRunner;
  } = {}) {
    this.commandRunner = input.commandRunner ?? defaultCommandRunner();
  }

  async inspectMount(input: {
    mountPath: string;
    command?: string;
  }): Promise<XfsProjectQuotaMountStatus> {
    const command = input.command?.trim() || DEFAULT_XFS_QUOTA_COMMAND;

    try {
      const result = await this.commandRunner.execFile(command, [
        "-x",
        "-c",
        "state -p",
        input.mountPath
      ]);

      return {
        ready: true,
        message: result.stdout.trim() || "xfs project quotas are reachable",
        stdout: result.stdout.trim(),
        stderr: result.stderr.trim()
      };
    } catch (error) {
      const failure = normalizeCommandFailure(error);
      return {
        ready: false,
        message: failure.message,
        stdout: failure.stdout,
        stderr: failure.stderr
      };
    }
  }

  async applyProjectQuota(input: {
    mountPath: string;
    storageUnitRoot: string;
    projectId: number;
    quotaBytes: number;
    command?: string;
  }): Promise<void> {
    const command = input.command?.trim() || DEFAULT_XFS_QUOTA_COMMAND;
    const storageUnitRoot = path.resolve(input.storageUnitRoot);
    const quotaMegabytes = formatQuotaMegabytes(input.quotaBytes);

    try {
      await this.commandRunner.execFile(command, [
        "-x",
        "-c",
        `project -s -p ${quoteXfsCommandValue(storageUnitRoot)} ${input.projectId}`,
        "-c",
        `limit -p bsoft=${quotaMegabytes} bhard=${quotaMegabytes} ${input.projectId}`,
        input.mountPath
      ]);
    } catch (error) {
      const failure = normalizeCommandFailure(error);
      throw new Error(
        [
          `Failed to provision xfs project quota for ${storageUnitRoot} (project ${input.projectId}).`,
          failure.message,
          failure.stderr,
          failure.stdout
        ]
          .filter((value) => value && value.trim().length > 0)
          .join("\n")
      );
    }
  }
}
