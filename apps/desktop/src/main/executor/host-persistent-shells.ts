import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { readPersistentShellOutput } from "@meowbert/shared";
import type { SandboxAttachedProcess } from "@meowbert/shared/docker-sandbox";
import type { MachineHost, MachineSpec } from "@meowbert/run-executor/agent/ports/machine-host";
import type { PersistentShellRequest, PlatformToolHost } from "@meowbert/run-executor/agent/ports/platform-tools";

type Session = { id: string; process: SandboxAttachedProcess; logPath: string; command: string; commandId: string | null;
  status: string; exitCode: number | null; startedAt: string; expiresAt: string; timer: ReturnType<typeof setTimeout> };
type Options = { machine: MachineHost; spec: MachineSpec; signal: AbortSignal };

function describe(session: Session) {
  return { session_id: session.id, status: session.status, command: session.command, command_id: session.commandId,
    exit_code: session.exitCode, started_at: session.startedAt, expires_at: session.expiresAt };
}

async function startSession(options: Options, request: Extract<PersistentShellRequest, { action: "start" }>): Promise<Session> {
  const id = randomUUID();
  const logPath = path.join(options.spec.taskDir, ".shell-sessions", id + ".log");
  await fs.mkdir(path.dirname(logPath), { recursive: true });
  await fs.writeFile(logPath, "");
  const command = process.platform === "win32" ? ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", "-"]
    : [process.env.SHELL || "/bin/zsh", "-s"];
  const attached = await options.machine.sandbox.startAttachedProcess({ command, workingDir: options.spec.envRoot,
    env: { ...options.spec.env, ...request.envOverrides }, tty: false, stdin: true });
  const lifetime = Math.min(1_209_600, Math.max(1, request.lifetimeSeconds ?? 43_200)) * 1000;
  const session: Session = { id, process: attached, logPath, command: "", commandId: null, status: "idle", exitCode: null,
    startedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + lifetime).toISOString(),
    timer: setTimeout(() => { session.status = "stopped"; void attached.close(); }, lifetime) };
  let pending: Promise<unknown> = Promise.resolve();
  let tail = "";
  const append = (chunk: Buffer) => {
    pending = pending.then(() => fs.appendFile(logPath, chunk));
    tail = (tail + String(chunk)).slice(-8_192);
    const marker = session.commandId && new RegExp("MEOWBERT_" + session.commandId + "_(-?[0-9]+)");
    const match = marker && tail.match(marker);
    if (match) { session.exitCode = Number(match[1]); session.status = "idle"; tail = ""; }
  };
  attached.stdout.on("data", append);
  attached.stderr?.on("data", append);
  void attached.waitForExit().then(async (code) => {
    await pending; session.status = "completed"; session.exitCode = code; clearTimeout(session.timer);
  }).catch(() => { session.status = "stopped"; clearTimeout(session.timer); });
  return session;
}

async function submit(session: Session, command: string) {
  if (session.status !== "idle") throw new Error("Session is not idle. Inspect it or start another shell_session.");
  session.commandId = randomUUID().replaceAll("-", ""); session.command = command; session.status = "running"; session.exitCode = null;
  const marker = "MEOWBERT_" + session.commandId + "_";
  const suffix = process.platform === "win32" ? '\nWrite-Output ("' + marker + '" + $(if ($?) { 0 } else { 1 }))\n'
    : '\nprintf "\n' + marker + '%d\n" $?\n';
  await new Promise<void>((resolve, reject) => session.process.stdin!.write(command + suffix, (error) => error ? reject(error) : resolve()));
  return { ...describe(session), background: true };
}

export function createHostPersistentShells(options: Options): Pick<PlatformToolHost, "persistentShell" | "readShellSessionWaitState"> {
  const sessions = new Map<string, Session>();
  const requireSession = (id: string) => { const session = sessions.get(id); if (!session) throw new Error("Session does not belong to this run."); return session; };
  const status = async (session: Session, request: { tailLines?: number | null; saveOutputPath?: string | null } = {}) => ({
    ...describe(session), ...await readPersistentShellOutput({ ...request, logPath: session.logPath, taskDir: options.spec.taskDir })
  });
  options.signal.addEventListener("abort", () => { for (const session of sessions.values()) clearTimeout(session.timer); }, { once: true });
  return {
    async persistentShell(request) {
      options.signal.throwIfAborted();
      if (request.action === "start") {
        const session = await startSession(options, request);
        sessions.set(session.id, session);
        if (request.command) await submit(session, request.command);
        return describe(session);
      }
      if (request.action === "list") return { sessions: [...sessions.values()].map(describe) };
      const session = requireSession(request.sessionId);
      if (request.action === "status") return status(session, request);
      if (request.action === "run") return submit(session, request.command);
      if (request.action === "stop" || request.control === "interrupt") {
        clearTimeout(session.timer); await session.process.close(); session.status = "stopped"; return describe(session);
      }
      if (request.control !== "input") throw new Error("Native shell sessions support input and interrupt; terminal resizing requires sandbox mode.");
      await new Promise<void>((resolve, reject) => session.process.stdin!.write(request.data ?? "", (error) => error ? reject(error) : resolve()));
      return describe(session);
    },
    async readShellSessionWaitState({ sessionId }) {
      options.signal.throwIfAborted();
      const session = requireSession(sessionId); const output = await status(session);
      return { sessionId, status: session.status, commandId: session.commandId, exitCode: session.exitCode,
        output: output.output, outputTruncated: false, outputVersion: output.outputVersion, stopReason: null };
    }
  };
}
