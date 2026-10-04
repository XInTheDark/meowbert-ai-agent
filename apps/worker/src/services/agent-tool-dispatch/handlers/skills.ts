import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";
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
  finishBuiltinToolFailure,
  finishBuiltinToolSuccess,
  startBuiltinToolExecution
} from "../events.js";
import { toolErrorResult, type ToolCallResult } from "../tool-call-result.js";
import type { ToolDispatchContext, ToolDispatchState } from "../types.js";
import { rethrowIfTaskCancelled, summarizeToolEventValue } from "../utils.js";
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
): Promise<ToolCallResult> {
  const execution = await startBuiltinToolExecution(ctx, state, outputItem, {
    inputLabel: "Action",
    inputText: "List available skills"
  });
  const catalog = ctx.skillsRootDir
    ? getAvailableSkills(ctx.skillsRootDir, ctx.isSkillAdmin, {
        isSkillEnabled: (manifest) => isSkillEnabledByConfig(config, manifest.id)
      })
    : [];
  const onDemand = (ctx.onDemandSkills ?? []).filter((skill) => !catalog.some((entry) => entry.id === skill.id));
  const skills = [...catalog, ...onDemand];
  const output = {
    skills,
    enabled: Array.from(ctx.activeMcpConnections.keys())
  };
  return finishBuiltinToolSuccess(ctx, execution, output, {
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
): Promise<ToolCallResult> {
  await ctx.assertNotCancelled();
  const parsed = parseToolArguments(ENABLE_SKILL_TOOL_NAME, outputItem.arguments, enableSkillArgumentsSchema);
  if (!parsed.ok) {
    return toolErrorResult(parsed.error);
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

    return await finishBuiltinToolSuccess(ctx, execution, skillOutput, {
      eventPayload: {
        skill: parsed.value.skill,
        toolCount: result.toolNames.length
      }
    });
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Failed to enable skill: ${message}`);
  }
}

export async function handleSkillToolCall(
  outputItem: ResponseFunctionToolCall,
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<ToolCallResult | null> {
  await ctx.assertNotCancelled();
  const parsedSkillTool = parseSkillToolName(outputItem.name);
  if (!parsedSkillTool) {
    return null;
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
    return finishBuiltinToolFailure(
      ctx,
      execution,
      `Skill "${parsedSkillTool.skillId}" is not enabled. Call enable_skill first.`
    );
  }

  try {
    const result = await callMcpTool(resolvedConnection.connection, parsedSkillTool.toolName, normalizedArgs);
    await ctx.assertNotCancelled();

    let parsedResult: unknown = result;
    try {
      parsedResult = JSON.parse(result);
    } catch {
      // keep raw string output
    }
    return await finishBuiltinToolSuccess(ctx, execution, parsedResult);
  } catch (err) {
    rethrowIfTaskCancelled(err);
    const message = err instanceof Error ? err.message : String(err);
    return finishBuiltinToolFailure(ctx, execution, `Skill tool error: ${message}`);
  }
}
