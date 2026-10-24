import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { readPersistentShellOutput, requestPersistentShellRuntime, type PersistentShellRuntimeState } from "@meowbert/shared";
import type { MachineHost, MachineSpec } from "@meowbert/run-executor/agent/ports/machine-host";
import type { PersistentShellRequest, PlatformToolHost } from "@meowbert/run-executor/agent/ports/platform-tools";

type Session = {
  id: string;
  state: PersistentShellRuntimeState;
  logPath: string;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  stoppedAt: string | null;
  stopReason: string | null;
  lifetimeSeconds: number;
  expiresAt: string;
};
type ShellHost = Pick<PlatformToolHost, "persistentShell" | "readShellSessionWaitState">;
type Options = { machine: MachineHost; spec: MachineSpec; signal: AbortSignal };

// Sessions are owned by this run and disappear with its sandbox, including on lease loss.
export function createLocalPersistentShells(options: Options): ShellHost {
  const sessions = new Map<string, Session>();
  let pending: Promise<unknown> = Promise.resolve();
  const serialize = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = pending.then(() => { options.signal.throwIfAborted(); return operation(); });
    pending = result.catch(() => undefined);
    return result;
  };
  const runtime = async (session: Session, request: Record<string, unknown>, action: "launch" | "request" = "request") => {
    options.signal.throwIfAborted();
    return requestPersistentShellRuntime({ attachPersistentSandbox: async () => options.machine.sandbox }, {
      id: session.id, container_id: options.machine.sandbox.id, working_dir: options.spec.envRoot
    }, request, action);
  };
  const requireSession = (id: string) => {
    const session = sessions.get(id);
    if (!session) throw new Error("Persistent shell session does not belong to this run.");
    return session;
  };
  const refresh = async (session: Session) => {
    if (session.stoppedAt) return session;
    if (Date.now() >= Date.parse(session.expiresAt)) {
      session.stoppedAt = new Date().toISOString();
      session.stopReason = "Persistent shell session lifetime expired.";
      return session;
    }
    session.state = await runtime(session, { action: "status" });
    session.updatedAt = new Date().toISOString();
    if (session.state.status === "completed") session.completedAt ??= session.updatedAt;
    return session;
  };
  const status = async (session: Session, request: { tailLines?: number | null; saveOutputPath?: string | null } = {}) => {
    await refresh(session);
    const output = await readPersistentShellOutput({ ...request, logPath: session.logPath, taskDir: options.spec.taskDir });
    return { ...describeSession(session), ...output, output_file: output.outputFile,
      completed_at: session.completedAt, stopped_at: session.stoppedAt, stop_reason: session.stopReason };
  };
  const start = async (request: Extract<PersistentShellRequest, { action: "start" }>) => {
    const id = randomUUID();
    const lifetimeSeconds = Math.min(1_209_600, Math.max(1, Math.round(request.lifetimeSeconds ?? 43_200)));
    const startedAt = new Date().toISOString();
    const session: Session = { id, logPath: path.join(options.spec.taskDir, ".shell-sessions", id + ".log"),
      state: { status: "idle", mode: request.mode ?? "terminal", commandId: null, command: "", exitCode: null,
        cwd: options.spec.envRoot, outputTruncated: false }, startedAt, updatedAt: startedAt,
      completedAt: null, stoppedAt: null, stopReason: null, lifetimeSeconds,
      expiresAt: new Date(Date.now() + lifetimeSeconds * 1_000).toISOString() };
    await fs.mkdir(path.dirname(session.logPath), { recursive: true });
    session.state = await runtime(session, { mode: session.state.mode, cwd: options.spec.envRoot,
      logPath: session.logPath, expiresAt: Date.parse(session.expiresAt) / 1_000,
      env: { ...options.spec.env, ...request.envOverrides } }, "launch");
    sessions.set(id, session);
    if (request.command) session.state = await runtime(session, { action: "submit", command: request.command });
    return { session_id: id, status: session.state.status, lifetime_seconds: lifetimeSeconds,
      expires_at: session.expiresAt, sandbox_limits: { memory_mb: options.spec.resources.memoryMb,
        cpus: options.spec.resources.cpus, pids: options.spec.resources.pids } };
  };
  const submit = async (session: Session, request: Extract<PersistentShellRequest, { action: "run" }>) => {
    await refresh(session);
    if (session.state.status === "running" && request.force && !session.stoppedAt) {
      await runtime(session, { action: "interrupt", commandId: session.state.commandId });
      const deadline = Date.now() + 5_000;
      while (session.state.status === "running" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
        await refresh(session);
      }
    }
    if (session.stoppedAt || session.state.status !== "idle") throw new Error("Session is not idle. Inspect it or start another shell_session.");
    session.state = await runtime(session, { action: "submit", command: request.command });
    return { session_id: session.id, status: session.state.status, command: request.command,
      background: true, command_id: session.state.commandId };
  };
  const handle = async (request: PersistentShellRequest): Promise<Record<string, unknown>> => {
    if (request.action === "start") return start(request);
    if (request.action === "list") {
      return { sessions: await Promise.all([...sessions.values()].map(async (session) => describeSession(await refresh(session)))) };
    }
    const session = requireSession(request.sessionId);
    if (request.action === "status") return status(session, request);
    if (request.action === "run") return submit(session, request);
    await refresh(session);
    if (request.action === "stop") {
      if (!session.stoppedAt) await runtime(session, { action: "stop" });
      session.stoppedAt ??= new Date().toISOString();
      session.stopReason ??= "Stopped by shell_session.";
      return { status: "stopped" };
    }
    if (session.stoppedAt) throw new Error("This session has ended. Start a new shell_session.");
    const result = await runtime(session, { action: request.control, commandId: session.state.commandId,
      data: request.data, cols: request.cols, rows: request.rows });
    return { ...result, session_id: session.id, command_id: result.commandId, exit_code: result.exitCode,
      output_truncated: result.outputTruncated };
  };
  return {
    persistentShell: (request) => serialize(() => handle(request)),
    readShellSessionWaitState: ({ sessionId }) => serialize(async () => {
      const session = requireSession(sessionId);
      const result = await status(session);
      return { sessionId, status: String(result.status), commandId: session.state.commandId,
        exitCode: session.state.exitCode, output: result.output, outputTruncated: session.state.outputTruncated,
        outputVersion: result.outputVersion, stopReason: session.stopReason };
    })
  };
}

function describeSession(session: Session) {
  return { session_id: session.id, status: session.stoppedAt ? "stopped" : session.state.status,
    command: session.state.command, cwd: session.state.cwd, mode: session.state.mode,
    started_at: session.startedAt, updated_at: session.updatedAt, command_id: session.state.commandId,
    exit_code: session.state.exitCode, output_truncated: session.state.outputTruncated,
    lifetime_seconds: session.lifetimeSeconds, expires_at: session.expiresAt };
}
