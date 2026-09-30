import type { ResponseFunctionToolCall, ResponseInputItem } from "openai/resources/responses/responses";
import { isSkillEnabledByConfig } from "@meowbert/shared";
import { callMcpTool, parseSkillToolName, providerSafeSkillToolId, type McpConnection } from "../../agent/mcp-client.js";
import { getAvailableSkills } from "../../agent/skill-registry.js";
import {
  ENABLE_SKILL_TOOL_NAME,
  LIST_SKILLS_TOOL_NAME,
  enableSkillArgumentsSchema
} from "../../agent-tools/index.js";
import { parseToolArguments } from "../../agent/utils.js";
import {
  appendBuiltinToolMessage,
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution
} from "../events.js";
import { pushParseError, serializeToolOutput } from "../state.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";
import { emitTaskEvent } from "../../runtime/events.js";
import { config } from "../../../lib/config.js";
import { buildSkillEnabledPromptDelta } from "../../agent/skill-prompt.js";
import { normalizeSkillToolArguments } from "../../agent/skill-tool-paths.js";

function getActiveMcpConnection(
  connections: Map<string, McpConnection>,
  requestedSkillId: string
): { skillId: string; connection: McpConnection } | null {
  const exactConnection = connections.get(requestedSkillId);
  if (exactConnection) {
    return { skillId: requestedSkillId, connection: exactConnection };
  }

  for (const [skillId, connection] of connections) {
    if (providerSafeSkillToolId(skillId) === requestedSkillId) {
      return { skillId, connection };
    }
  }

  return null;
}

export async function handleListSkills(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Action",
    inputText: "List available skills"
  });
  const skills = ctx.skillsRootDir
    ? getAvailableSkills(ctx.skillsRootDir, ctx.isSkillAdmin, {
        isSkillEnabled: (manifest) => isSkillEnabledByConfig(config, manifest.id)
      })
    : [];
  const output = {
    skills,
    enabled: Array.from(ctx.activeMcpConnections.keys())
  };
  await finishBuiltinToolSuccess(ctx, state, execution, output, {
    eventPayload: {
      skillCount: skills.length,
      enabledSkillCount: output.enabled.length
    }
  });
}

export async function handleEnableSkill(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<void> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(ENABLE_SKILL_TOOL_NAME, outputItem.arguments, enableSkillArgumentsSchema);
  if (!parsed.ok) {
    pushParseError(state, outputItem.call_id, parsed.error);
    return;
  }

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Skill",
    inputText: parsed.value.skill
  });

  try {
    const result = await ctx.enableSkillById(parsed.value.skill);
    const skillOutput = {
      enabled: true,
      skill: parsed.value.skill,
      tools: result.toolNames,
      documentation: result.doc ?? "No documentation available for this skill."
    };

    if (ctx.appendPromptDelta) {
      ctx.appendPromptDelta({
        reason: "skill_enabled",
        role: "system",
        content: buildSkillEnabledPromptDelta({
          skillId: parsed.value.skill,
          doc: result.doc,
          toolNames: result.toolNames
        })
      });
    }

    await finishBuiltinToolSuccess(ctx, state, execution, skillOutput, {
      eventPayload: {
        skill: parsed.value.skill,
        toolCount: result.toolNames.length
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Failed to enable skill: ${message}`);
  }
}

export async function handleSkillToolCall(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<boolean> {
  await ctx.assertNotCancelled();
  const parsedSkillTool = parseSkillToolName(outputItem.name);
  if (!parsedSkillTool) {
    return false;
  }

  let args: Record<string, unknown> = {};
  try {
    const parsedArgs = JSON.parse(outputItem.arguments);
    if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
      args = parsedArgs as Record<string, unknown>;
    }
  } catch {
    // empty args
  }

  const normalizedArgs = normalizeSkillToolArguments(args, ctx.taskDir);

  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Arguments",
    inputText: summarizeToolEventValue(args)
  });

  const resolvedConnection = getActiveMcpConnection(ctx.activeMcpConnections, parsedSkillTool.skillId);
  if (!resolvedConnection) {
    await finishBuiltinToolFailure(
      ctx,
      state,
      execution,
      `Skill "${parsedSkillTool.skillId}" is not enabled. Call enable_skill first.`
    );
    return true;
  }

  try {
    const result = await callMcpTool(resolvedConnection.connection, parsedSkillTool.toolName, normalizedArgs);
    await ctx.assertNotCancelled();
    const durationMs = Date.now() - execution.startedAtMs;

    let parsedResult: unknown = result;
    try {
      parsedResult = JSON.parse(result);
    } catch {
      // keep raw string output
    }

    const item: ResponseInputItem = {
      type: "function_call_output",
      call_id: outputItem.call_id,
      output: serializeToolOutput(parsedResult, state)
    };
    state.conversationItems.push(item);
    state.runPersistedItems.push(item);

    await appendBuiltinToolMessage(ctx, execution, parsedResult, { durationMs });
    await emitTaskEvent(ctx.taskId, "command_end", {
      step: execution.step,
      callId: execution.callId,
      tool: execution.toolName,
      durationMs
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    await finishBuiltinToolFailure(ctx, state, execution, `Skill tool error: ${message}`);
  }

  return true;
}
