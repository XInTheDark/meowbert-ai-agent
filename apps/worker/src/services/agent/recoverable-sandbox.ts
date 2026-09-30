import {
  formatSandboxCrashReport,
  type DockerSandboxHandle,
  type SandboxCrashReport
} from "@meowbert/shared/docker-sandbox";

type PersistentSandbox = DockerSandboxHandle;

export interface SandboxController {
  sandbox: PersistentSandbox;
  initializeSandbox: () => Promise<{ alreadyInitialized: boolean }>;
}

interface SandboxRecovery {
  message: string;
}

function describeRecovery(report: SandboxCrashReport, restartError: unknown): string {
  const outcome = restartError === null
    ? "The sandbox container stopped unexpectedly and a new one was started. Files in mounted directories are preserved; /tmp contents and running processes were lost."
    : `The sandbox container stopped unexpectedly and restarting it failed: ${restartError instanceof Error ? restartError.message : String(restartError)}`;
  return `${outcome}\n${formatSandboxCrashReport(report)}`;
}

/**
 * Owns the run's sandbox container: creates it (eagerly or on first use) and
 * replaces it with a fresh container when Docker reports it is no longer running.
 */
export function createRecoverableSandboxController(input: {
  create: () => Promise<PersistentSandbox>;
  initial?: PersistentSandbox | null;
  onRecovered?: (recovery: SandboxRecovery) => Promise<void> | void;
}): SandboxController {
  let current: PersistentSandbox | null = input.initial ?? null;
  let createPromise: Promise<PersistentSandbox> | null = null;
  let stopped = false;
  const recoveries = new WeakMap<PersistentSandbox, Promise<SandboxRecovery | null>>();

  const ensureSandbox = async (): Promise<{ sandbox: PersistentSandbox; alreadyInitialized: boolean }> => {
    if (current) {
      return { sandbox: current, alreadyInitialized: true };
    }
    if (stopped) {
      throw new Error("Sandbox has already been stopped.");
    }
    if (!createPromise) {
      createPromise = input.create().then((created) => {
        current = created;
        return created;
      }).finally(() => {
        createPromise = null;
      });
    }
    return { sandbox: await createPromise, alreadyInitialized: false };
  };

  const recover = async (crashed: PersistentSandbox): Promise<SandboxRecovery | null> => {
    const report = await crashed.readCrashReport().catch(() => null);
    if (!report) {
      return null;
    }
    await crashed.stop();
    if (current === crashed) {
      current = null;
    }
    let restartError: unknown = null;
    if (!stopped) {
      await ensureSandbox().catch((error: unknown) => {
        restartError = error;
      });
    }
    const recovery = { message: describeRecovery(report, restartError) };
    await Promise.resolve(input.onRecovered?.(recovery)).catch(() => {});
    return recovery;
  };

  const recoverOnce = (crashed: PersistentSandbox): Promise<SandboxRecovery | null> => {
    let pending = recoveries.get(crashed);
    if (!pending) {
      pending = recover(crashed);
      recoveries.set(crashed, pending);
    }
    return pending;
  };

  const withCrashContext = async (crashed: PersistentSandbox, error: unknown): Promise<never> => {
    const recovery = await recoverOnce(crashed);
    if (!recovery) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${message}\n\n${recovery.message}`);
  };

  const sandbox = {
    get id() {
      return current?.id ?? "sandbox-uninitialized";
    },
    executeShellCommand: async (...args: Parameters<PersistentSandbox["executeShellCommand"]>) => {
      const { sandbox: target } = await ensureSandbox();
      const result = await target.executeShellCommand(...args).catch((error: unknown) => withCrashContext(target, error));
      if (result.exitCode === 0 || result.aborted) {
        return result;
      }
      const recovery = await recoverOnce(target);
      return recovery ? { ...result, sandboxCrash: recovery.message } : result;
    },
    startAttachedProcess: async (...args: Parameters<PersistentSandbox["startAttachedProcess"]>) => {
      const { sandbox: target } = await ensureSandbox();
      return target.startAttachedProcess(...args).catch((error: unknown) => withCrashContext(target, error));
    },
    getMappedHostPort: async (...args: Parameters<PersistentSandbox["getMappedHostPort"]>) => {
      const { sandbox: target } = await ensureSandbox();
      return target.getMappedHostPort(...args);
    },
    readCrashReport: async () => current?.readCrashReport() ?? null,
    stop: async () => {
      stopped = true;
      const pending = createPromise;
      await current?.stop();
      if (pending) {
        await pending.then((created) => created.stop(), () => {});
      }
    }
  } as unknown as PersistentSandbox;

  return {
    sandbox,
    initializeSandbox: async () => {
      const { alreadyInitialized } = await ensureSandbox();
      return { alreadyInitialized };
    }
  };
}
