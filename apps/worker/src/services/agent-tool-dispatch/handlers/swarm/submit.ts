import fs from "node:fs/promises";
import path from "node:path";
import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
import { SUBMIT_TOOL_NAME, submitArgumentsSchema } from "@meowbert/run-executor/agent-tools/swarm";
import type { SwarmLaneFile } from "../../../agent-swarm/lane-store.js";
import { toolErrorResult, type ToolCallResult } from "@meowbert/run-executor/agent-tool-dispatch/tool-call-result";
import type { ToolDispatchContext, ToolDispatchState } from "@meowbert/run-executor/agent-tool-dispatch/types";
import { checkSwarmToolRole } from "./role-gate.js";

// About four characters per token; the summary goes into the parent's context, so it stays short.
const CHARS_PER_TOKEN = 4;

export function truncateLaneSummary(summary: string, maxTokens: number): string {
  const maxChars = maxTokens * CHARS_PER_TOKEN;
  return summary.length <= maxChars ? summary : `${summary.slice(0, maxChars - 15).trimEnd()}\n[truncated]`;
}

// Sizes come from the files the lane names, one stat each, for the merge's assembly hint; no walk.
async function describeFiles(paths: string[], taskDir: string): Promise<SwarmLaneFile[]> {
  return Promise.all([...new Set(paths)].map(async (filePath) => {
    const absolutePath = path.resolve(taskDir, filePath);
    const stats = await fs.stat(absolutePath).catch(() => null);
    return { path: absolutePath, bytes: stats?.isFile() ? stats.size : null };
  }));
}

export async function handleSubmit(call: ResponseFunctionToolCall, ctx: ToolDispatchContext, state: ToolDispatchState): Promise<ToolCallResult> {
  const roleError = checkSwarmToolRole(SUBMIT_TOOL_NAME, ctx.swarm?.run);
  if (roleError) return toolErrorResult(roleError);
  if (ctx.codeModeParentCallId) return toolErrorResult("Call submit directly, not from exec.");
  const parsed = submitArgumentsSchema.safeParse(JSON.parse(call.arguments));
  if (!parsed.success) return toolErrorResult(`Invalid submit arguments: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  state.swarmSubmit = {
    summary: truncateLaneSummary(parsed.data.summary, ctx.swarm!.run.settings.advanced.laneSummaryMaxTokens),
    decisions: parsed.data.decisions,
    findings: parsed.data.findings,
    files: await describeFiles(parsed.data.files, ctx.taskDir)
  };
  return { output: { submitted: true } };
}
