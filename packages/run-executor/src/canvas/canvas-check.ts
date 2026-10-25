import path from "node:path";
import type { MachineHandle as DockerSandboxHandle } from "@meowbert/shared/docker-sandbox";
import type { InlineArtifactDisplay } from "@meowbert/shared/inline-artifacts";

const CHECK_TIMEOUT_MS = 60_000;
const DEFAULT_SKILLS_ROOT = "/app/skills";

export interface CanvasCheckResult {
  ok: boolean;
  loaded: boolean;
  blank: boolean;
  title: string | null;
  content_height: number | null;
  errors: Array<{ kind: string; message: string; source: string | null; line: number | null }>;
  failed_requests: Array<{ url: string; status: number | null; reason: string | null }>;
  hints: string[];
  screenshot_path: string | null;
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function buildCanvasCheckCommand(input: {
  skillsRootDir: string | null;
  entryPath: string;
  rootDir: string;
  display: InlineArtifactDisplay;
  screenshotPath: string;
}): string {
  const cliPath = path.join(input.skillsRootDir ?? DEFAULT_SKILLS_ROOT, "html-canvas", "scripts", "html-canvas-cli.mjs");
  return [
    "node", quote(cliPath), "check",
    "--input", quote(input.entryPath),
    "--root", quote(input.rootDir),
    "--display", input.display,
    "--screenshot", quote(input.screenshotPath)
  ].join(" ");
}

export function parseCanvasCheckOutput(stdout: string): CanvasCheckResult | null {
  const start = stdout.indexOf("{");
  if (start < 0) return null;
  try {
    const parsed = JSON.parse(stdout.slice(start)) as Partial<CanvasCheckResult>;
    if (typeof parsed.ok !== "boolean") return null;
    return {
      ok: parsed.ok,
      loaded: parsed.loaded === true,
      blank: parsed.blank === true,
      title: typeof parsed.title === "string" ? parsed.title : null,
      content_height: typeof parsed.content_height === "number" ? parsed.content_height : null,
      errors: Array.isArray(parsed.errors) ? parsed.errors.slice(0, 20) : [],
      failed_requests: Array.isArray(parsed.failed_requests) ? parsed.failed_requests.slice(0, 20) : [],
      hints: Array.isArray(parsed.hints) ? parsed.hints : [],
      screenshot_path: typeof parsed.screenshot_path === "string" ? parsed.screenshot_path : null
    };
  } catch {
    return null;
  }
}

/** Loads the page in the sandbox's Chromium under the same frame conditions the app uses. */
export async function runCanvasCheck(input: {
  sandbox: Pick<DockerSandboxHandle, "executeShellCommand">;
  skillsRootDir: string | null;
  workingDir: string;
  entryPath: string;
  rootDir: string;
  display: InlineArtifactDisplay;
  screenshotPath: string;
  abortSignal?: AbortSignal;
}): Promise<CanvasCheckResult | { error: string }> {
  const result = await input.sandbox.executeShellCommand({
    shell: "/bin/bash",
    command: buildCanvasCheckCommand(input),
    workingDir: input.workingDir,
    env: { PLAYWRIGHT_BROWSERS_PATH: "/ms-playwright" },
    timeoutMs: CHECK_TIMEOUT_MS,
    maxOutputKb: 64,
    abortSignal: input.abortSignal
  });
  if (result.timedOut) {
    return { error: "The page check timed out." };
  }
  const parsed = parseCanvasCheckOutput(result.stdout);
  if (parsed) {
    return parsed;
  }
  return { error: (result.stderr || result.stdout).trim().slice(0, 2000) || `The page check exited with code ${result.exitCode}.` };
}
