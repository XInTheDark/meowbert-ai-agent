import { NEURAL_ENVIRONMENT_PERSONALITY_ID, loadNeuralPersonalityPrompt } from "@meowbert/shared";
import type { LoadedWorkflowRunContext, WorkflowPromptContext } from "./context.js";
import { asObject, formatSwarmAgentLabel, resolveAgentSwarmReviewRounds } from "./shared.js";
import { hasApprovedSwarmFinalReview, requiresSwarmFinalReview } from "./agent-swarm-reviews.js";
import { hasAgentSwarmBudget, hasDualSwarmRole, hasSwarmLeadership, resolveSwarmTarget } from "./swarm-target.js";
import { loadSwarmGuideDoc } from "./swarm-guide-docs.js";
import {
  SWARM_BUDGET_PROMPT,
  buildDualSwarmRolePrompt,
  buildSwarmChannelsPromptText,
  buildSwarmNodeTypesPrompt,
  buildSwarmPeerPromptText,
  buildSwarmRosterText,
  isQualityReviewSwarmAgent
} from "./swarm-prompt-sections.js";

// The system prompt only names the role. The guide (the role's doc plus facts about this swarm) is
// a separate instruction that stays the same across runs, and the live state goes into the
// conversation at the start of each run so the cached prompt prefix never changes with it.

function buildSwarmSection(role: string): string {
  return [
    `## Agent Swarm — ${role}`,
    "",
    `You are ${role === "Leader" ? "the leader" : "a member"} of an Agent Swarm. Follow the Agent Swarm guide that comes after this system prompt; it explains how the swarm works and what your role involves. The swarm's current state is given at the start of each run.`
  ].join("\n");
}

function buildSharedFacts(context: LoadedWorkflowRunContext): string {
  return [
    "### Workspace",
    `- Main swarm task dir: ${context.workflowTaskDir ?? context.taskDir}.`,
    `- Shared handoff dir, writable by every swarm agent: ${context.swarm?.sharedDir ?? "(unavailable)"}.`,
    context.swarm?.globalChannelId
      ? `- Global channel_id: ${context.swarm.globalChannelId} (the alias \`global\` also works).`
      : "- Global channel_id is unavailable; call `list_channels` if needed.",
    "",
    "### Agents (use these task_id values for channels and waits)",
    buildSwarmPeerPromptText(context),
    "",
    "### Roster",
    buildSwarmRosterText(context)
  ].join("\n");
}

function buildFinalReviewer(context: LoadedWorkflowRunContext): string {
  const hasQualityControlWorker = context.agents.some((agent) =>
    agent.role === "worker" && agent.state_json.agentPresetMode === "quality_control_reviewer"
  );
  return hasQualityControlWorker
    ? "- The final review must come from the Quality Control worker."
    : "- Any worker can give the final review; prefer one that did not write the draft.";
}

function buildLeaderGuide(context: LoadedWorkflowRunContext, qualityReviewOverlay: string | null): string {
  const budgeted = hasAgentSwarmBudget(context);
  return [
    loadSwarmGuideDoc("leader"),
    [
      "## This swarm",
      `- Your identity in swarm chat is ${formatSwarmAgentLabel("leader", 0)}.`,
      `- Configured review rounds: ${resolveAgentSwarmReviewRounds(context)}.`,
      buildFinalReviewer(context),
      budgeted
        ? "- This swarm has a token budget, so you can spawn child nodes as the task develops."
        : "- This swarm has no budget, so it works with the configured roster only."
    ].join("\n"),
    buildDualSwarmRolePrompt(context),
    budgeted ? SWARM_BUDGET_PROMPT : null,
    budgeted ? buildSwarmNodeTypesPrompt(context) : null,
    qualityReviewOverlay,
    buildSharedFacts(context)
  ].filter(Boolean).join("\n\n");
}

function resolveReportChannelId(context: LoadedWorkflowRunContext): string {
  if (hasDualSwarmRole(context)) return resolveSwarmTarget(context, "outer").channelId ?? "global";
  const channelIds = asObject(context.config.swarmChannelIds);
  const parentNodeId = context.currentAgent?.state_json?.swarmParentNodeId;
  return typeof parentNodeId === "string" && typeof channelIds[parentNodeId] === "string"
    ? channelIds[parentNodeId] as string
    : context.swarm?.globalChannelId ?? "global";
}

function buildNestedLeaderPrompt(context: LoadedWorkflowRunContext): string {
  const budgeted = hasAgentSwarmBudget(context);
  return [
    "### Your own node",
    "- You also lead a node of your own. Assign its workers with `assign_worker`, check their results as a leader would, and publish the node's result with `submit_swarm_output` when it is done. The root leader delivers the final answer.",
    budgeted
      ? "- If your node has no workers, do the assignment yourself only when one agent can comfortably finish it within your budget; otherwise spawn child nodes for the parts that need more hands or an independent check."
      : null,
    budgeted ? SWARM_BUDGET_PROMPT : null,
    budgeted ? buildSwarmNodeTypesPrompt(context) : null
  ].filter(Boolean).join("\n\n");
}

function buildWorkerGuide(context: LoadedWorkflowRunContext, qualityReviewOverlay: string | null): string {
  const budgeted = hasAgentSwarmBudget(context);
  const leadsNode = hasSwarmLeadership(context);
  return [
    loadSwarmGuideDoc("worker"),
    [
      "## This swarm",
      `- Your identity in swarm chat is ${formatSwarmAgentLabel("worker", context.currentAgent?.slot_index ?? null)}.`,
      `- Your report channel is channel_id ${resolveReportChannelId(context)}.`,
      budgeted && !leadsNode
        ? "- Your weighted-token lease is separate from your peers'. Check `swarm_budget_status` for what remains, and tell your leader when you need more."
        : null
    ].filter(Boolean).join("\n"),
    buildDualSwarmRolePrompt(context),
    leadsNode ? buildNestedLeaderPrompt(context) : null,
    [
      "### Internal communication style",
      "Use this style only for swarm messages and handoffs; keep code, artifacts, and user-facing text in their usual style.",
      "",
      loadNeuralPersonalityPrompt()
    ].join("\n"),
    qualityReviewOverlay,
    buildSharedFacts(context)
  ].filter(Boolean).join("\n\n");
}

function buildLeaderLiveState(context: LoadedWorkflowRunContext): string {
  const swarm = context.swarm;
  const missing = swarm?.missingWorkerGlobalReportLabels ?? [];
  const reviewRounds = resolveAgentSwarmReviewRounds(context);
  return [
    "## Agent Swarm state at the start of this run",
    !swarm?.workersStartedAt
      ? "- No workers have been assigned yet. Assign at least one before you deliver."
      : missing.length > 0
        ? `- Still waiting on reports from: ${missing.join(", ")}.`
        : "- Every assigned worker has reported at least once.",
    swarm?.pendingNestedSwarmNodeIds?.length
      ? `- Child nodes that have not published their output: ${swarm.pendingNestedSwarmNodeIds.join(", ")}.`
      : null,
    reviewRounds > 0 ? `- Review rounds recorded: ${swarm?.completedReviewRounds ?? 0} of ${reviewRounds}.` : null,
    !requiresSwarmFinalReview(context)
      ? null
      : hasApprovedSwarmFinalReview(context)
        ? "- The final review is recorded. Deliver only the reviewed work."
        : "- The final review is not recorded yet.",
    "",
    "### Channels",
    buildSwarmChannelsPromptText(context)
  ].filter((line) => line !== null).join("\n");
}

function buildWorkerLiveState(context: LoadedWorkflowRunContext): string {
  return [
    "## Agent Swarm state at the start of this run",
    "### Channels",
    buildSwarmChannelsPromptText(context)
  ].join("\n");
}

function workerRoleSummary(context: LoadedWorkflowRunContext): string {
  const label = formatSwarmAgentLabel("worker", context.currentAgent?.slot_index ?? null);
  if (hasSwarmLeadership(context)) return `Agent Swarm · Nested leader ${label}`;
  if (isQualityReviewSwarmAgent(context)) return `Agent Swarm · Quality review ${label}`;
  return `Agent Swarm · ${label}`;
}

export function buildSwarmPromptContext(
  context: LoadedWorkflowRunContext,
  role: "leader" | "worker",
  qualityReviewOverlay: string | null
): WorkflowPromptContext {
  if (role === "leader") {
    return {
      roleSummary: isQualityReviewSwarmAgent(context) ? "Agent Swarm · Quality review leader" : "Agent Swarm · Leader",
      section: buildSwarmSection("Leader"),
      guide: buildLeaderGuide(context, qualityReviewOverlay),
      liveState: buildLeaderLiveState(context)
    };
  }
  return {
    roleSummary: workerRoleSummary(context),
    embeddedPersonalityIds: [NEURAL_ENVIRONMENT_PERSONALITY_ID],
    section: buildSwarmSection(hasDualSwarmRole(context) ? "Inner leader" : "Worker"),
    guide: buildWorkerGuide(context, qualityReviewOverlay),
    liveState: buildWorkerLiveState(context)
  };
}
