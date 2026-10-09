import {
  NEURAL_ENVIRONMENT_PERSONALITY_ID,
  loadNeuralPersonalityPrompt,
  type TaskExecutionJob
} from "@meowbert/shared";
import type { LoadedWorkflowRunContext, WorkflowPromptContext } from "./context.js";
import {
  asObject,
  formatSwarmAgentLabel,
  resolveAgentSwarmReviewRounds,
  shouldRequireSwarmLeaderKickoff
} from "./shared.js";
import { hasApprovedSwarmFinalReview, requiresSwarmFinalReview } from "./agent-swarm-reviews.js";
import { hasSwarmLeadership, hasDualSwarmRole, hasAgentSwarmBudget, resolveSwarmTarget } from "./swarm-target.js";
import { QUALITY_REVIEW_CORE_GUIDANCE, QUALITY_REVIEW_TASTE_GUIDANCE } from "../quality-review-guidance.js";
import { listAgentSwarmNodeTypes } from "./agent-swarm-node-types.js";

function buildDualSwarmRolePrompt(context: LoadedWorkflowRunContext): string | null {
  if (!hasDualSwarmRole(context)) return null;
  const outer = resolveSwarmTarget(context, "outer");
  const inner = resolveSwarmTarget(context, "inner");
  const compiled = asObject(context.config.compiledSwarm);
  const nodes = Array.isArray(compiled.nodes) ? compiled.nodes.map(asObject) : [];
  const innerNode = nodes.find((node) => node.id === inner.nodeId);
  const innerReviewRounds = typeof innerNode?.reviewRounds === "number" ? innerNode.reviewRounds : 0;
  return [
    "### Your two swarms",
    `- Outer swarm: ${outer.nodeId}; channel_id ${outer.channelId ?? "unavailable"}. You are ${outer.isLeader ? "its leader" : "a member"}.`,
    `- Inner swarm: ${inner.nodeId}; channel_id ${inner.channelId ?? "unavailable"}. You are its leader.`,
    "- Every swarm tool call must set `target_swarm` to `outer` or `inner`. This includes inbox, channel, management, review, output, and pause calls. Refresh and send to the same target swarm.",
    "- `swarm_manage` and review tools are leader-only in the selected swarm. Use them for inner; use them for outer only if you also lead outer.",
    "- Send messages and wait in the swarm where the intended recipients work. An inner wait is for inner mail; an outer wait is for outer mail.",
    "- You are the only inner-swarm member who can see the outer swarm's messages. Inner workers do not automatically receive outer context, so never assume they know what the outer swarm knows.",
    "- Act as the inner swarm's representative in both directions: carry relevant outer goals, constraints, decisions, questions, concerns, and corrections into the inner swarm, then carry the inner swarm's findings, disagreements, uncertainty, blockers, and recommendations back to the outer swarm.",
    "- Use judgment about what is relevant, but do not omit material information or silently filter disagreement. When the intended meaning, priority, or next step is unclear, ask the other swarm to clarify before committing the group.",
    `- The inner swarm has ${innerReviewRounds} configured independent review round(s). Record its reviews with target \`inner\`.`,
    "- Coordinate any inner workers. Publish the node's finished result to outer with `submit_swarm_output` targeted at `inner`."
  ].join("\n");
}

const NEURAL_SWARM_COMMUNICATION_PROMPT = loadNeuralPersonalityPrompt();
const SWARM_SUBTASK_BOUNDARY_PROMPT = [
  "- Swarm workers and spawned nodes are workflow-owned agents. They are not generic subtasks.",
  "- Do not call `create_subtask` or `start_subtask` in Agent Swarm. Those create ordinary child tasks outside the swarm: they are not swarm workers, do not join swarm channels, and do not receive this swarm workflow.",
  "- Coordinate through swarm workers, child node tools, and swarm channels."
];
const SWARM_BUDGET_PROMPT = [
  "- Swarm budgets count weighted input, output, and reasoning tokens. Each worker has its own lease; the node's protected reserve is for leader recovery and synthesis.",
  "- Check `swarm_budget_status` before delegating. A child node keeps 10% of its grant as a protected reserve and starts its workers with at most another 10%; the rest stays unassigned for its leader to spend or delegate. Child grants below 1M weighted tokens are rejected.",
  "- Size budgets from your own remaining budget and how hard the work really is. One inference step costs roughly 10k–50k weighted tokens and grows with context. Even a quick check needs 1–2M; real investigation or implementation often needs far more, well past 10M when the work is open-ended or tricky. Estimate pessimistically, since work usually costs more than expected, and keep enough for your own coordination and synthesis.",
  "- When the current worker lineup cannot cover useful independent work, spawn a fitting child node with enough budget to do the assignment. Continue your own coordination, investigation, or integration alongside it.",
  "- If a child or worker exhausts its allocation, inspect usage, then grant enough (`swarm_grant_budget` for a child, `swarm_manage` with `grant_budget` for a worker), cancel the child, or synthesize available results. A small grant with a request to wrap up and report is also fine. A late provider result is discarded after the deadline, although usage is charged."
];

function swarmNodeTypeLines(context: LoadedWorkflowRunContext): string[] {
  const types = listAgentSwarmNodeTypes(context.config.dynamicNodeTypes);
  if (types.length === 0) return ["- No node types are configured for this swarm."];
  return types.map((type) => {
    const workers = type.modelAllocations.map((item) => `${item.workerCount} ${item.agentId}`).join(", ") || "none";
    return `- ${type.id}: ${type.name} — ${type.description} · leader ${type.leaderAgentId} · workers ${workers} · ${type.reviewRounds} review rounds`;
  });
}

function canLeaderFinalizeSwarm(context: LoadedWorkflowRunContext): boolean {
  if (context.workflowType !== "agent_swarm" || context.currentAgent?.role !== "leader" || context.phase === "completed") {
    return false;
  }

  const swarm = context.swarm;
  if (!swarm) {
    return false;
  }

  return swarm.missingWorkerGlobalReportTaskIds.length === 0;
}

function buildSwarmChannelsPromptText(context: LoadedWorkflowRunContext): string {
  const channels = context.swarm?.channels ?? [];
  if (channels.length === 0) {
    return "- No channels yet. Use `list_channels` and `create_channel` as needed.";
  }

  return channels
    .map((channel) => {
      const membersText = channel.member_task_ids.length > 0
        ? channel.member_task_ids.join(", ")
        : "(none)";
      return [
        `- ${channel.title ?? channel.kind} (${channel.kind})`,
        `channel_id ${channel.id}`,
        `latest #${channel.latest_message_no}`,
        `unread ${channel.unread_count}`,
        `member_task_ids ${membersText}`
      ].join(" · ");
    })
    .join("\n");
}

function buildSwarmPeerPromptText(context: LoadedWorkflowRunContext): string {
  const peers = context.swarm?.peerTaskDirs ?? [];
  if (peers.length === 0) {
    return "- No peer agents found.";
  }

  return peers
    .map((peer) => {
      const titleText = peer.title ? ` · title ${peer.title}` : "";
      return [
        `- ${formatSwarmAgentLabel(peer.role, peer.slotIndex, peer.title ?? peer.taskId)}`,
        `task_id ${peer.taskId}${titleText}`,
        `task dir ${peer.taskDir} (same mount; coordinate writes)`
      ].join(" · ");
    })
    .join("\n");
}

function isQualityReviewSwarmAgent(context: LoadedWorkflowRunContext): boolean {
  return context.currentAgent?.state_json?.agentPresetMode === "quality_control_reviewer";
}

function buildSwarmRosterText(context: LoadedWorkflowRunContext): string {
  const compiled = context.config.compiledSwarm;
  if (!compiled || typeof compiled !== "object" || Array.isArray(compiled)) {
    return "- Flat swarm: Leader and workers collaborate through Global.";
  }
  const record = compiled as { nodes?: unknown; leaves?: unknown; rootNodeId?: unknown };
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const leaves = Array.isArray(record.leaves) ? record.leaves : [];
  const leafById = new Map(leaves.map((entry) => {
    const leaf = entry as { id?: unknown; name?: unknown; mode?: unknown };
    return [typeof leaf.id === "string" ? leaf.id : "", leaf];
  }));
  const describeLeaf = (leafId: unknown): string => {
    const leaf = typeof leafId === "string" ? leafById.get(leafId) : undefined;
    const name = typeof leaf?.name === "string" ? leaf.name : "Unknown agent";
    const mode = leaf?.mode === "quality_control_reviewer"
      ? "Quality review specialized agent"
      : "Agent";
    return `${name} — ${mode}`;
  };
  return nodes.map((entry) => {
    const node = entry as { id?: unknown; parentNodeId?: unknown; title?: unknown; leaderLeafId?: unknown; workerLeafIds?: unknown[] };
    const depth = typeof node.parentNodeId === "string" ? 1 : 0;
    const prefix = "  ".repeat(depth);
    const title = typeof node.title === "string" ? node.title : "Agent Swarm";
    const workers = Array.isArray(node.workerLeafIds) ? node.workerLeafIds : [];
    return [
      `${prefix}- ${title} — Agent Swarm agent`,
      `${prefix}  - Leader: ${describeLeaf(node.leaderLeafId)}`,
      ...workers.map((worker, index) => `${prefix}  - Worker ${index + 1}: ${describeLeaf(worker)}`)
    ].join("\n");
  }).join("\n");
}

function buildQualityReviewPrompt(context: LoadedWorkflowRunContext): string {
  const mainTaskDir = context.workflowTaskDir ?? context.taskDir;
  return [
    "### Quality review mandate",
    QUALITY_REVIEW_CORE_GUIDANCE,
    "",
    "### Requirement-by-requirement audit",
    "- Start by extracting every explicit requirement from the original user request in the task conversation (including parent-task context), the task brief, supplied references, acceptance criteria, and any plan. Include requested behavior, content, format, named files, interactions, constraints, edge cases, and explicit things the user said to avoid.",
    "- Create `### Requirement audit` in your report with exactly one numbered line for every extracted requirement. For each line, state the requirement, mark it `Pass`, `Fail`, or `Unclear`, cite concrete evidence from the response or actual artifact, and state the correction when it is not a pass.",
    "- Check the original user request directly. Do not treat the plan, a completion summary, a manifest, passing tests, or the agent's claims as a substitute for a requirement that the user gave explicitly. If the plan omitted a user requirement, it still must be audited.",
    "- Mark `Pass` only when the actual current response or artifact demonstrates that the requirement is satisfied. Treat every `Fail` or `Unclear` item as a material defect: request correction and do not approve.",
    "- If the original request or required context is unavailable, mark the affected requirements `Unclear` and reject the review; do not invent or reconstruct requirements from the draft alone.",
    "- Never merge separate requirements into one line, silently drop a requirement, or infer that an unstated feature is required. Preserve the user's requested scope while checking every stated item strictly.",
    "",
    "### Inspect the actual output",
    `- The main task directory is ${mainTaskDir}. Open the real files there; do not judge artifacts from a submission summary, plan, or source code alone.`,
    "- Read the complete draft user-facing response. Check whether it answers early, uses a natural voice for this user and genre, introduces ideas in the order a human genuinely needs them, defines necessary terms, makes reasoning intuitive, and avoids needless repetition or fragmentation.",
    "- **Deslop and humanize the writing:** Remove generic AI framing, empty transitions, canned emphasis, vague abstractions, performative certainty, needless summaries, and repetitive sentence shapes. Keep useful specificity, personality, and deliberate genre choices instead of flattening everything into one neutral voice.",
    "- **Deslop the structure:** Apply a strict standard to every text artifact, including papers, reports, slides, documentation, captions, labels, tables, and interface copy. Eradicate slogan stacks, feature pills, fake marketing copy, and redundant sections.",
    "- Inventory every produced or modified user-facing artifact, even if the submission omitted it.",
    "- Render or open presentations, papers, documents, PDFs, spreadsheets, webpages, canvases, and images with the available artifact tools. Inspect every page, slide, sheet, state, or image at its intended size; also inspect multi-page work as a set.",
    "- Check hierarchy, composition, alignment, spacing, typography, contrast, density, consistency, clipping, overflow, awkward wrapping and page breaks, low-quality imagery, broken states, and accessibility.",
    "- **Reject generic UI theater:** Reject sloppy, crowded, unappealing, template-like, or recognizably generic AI design (for example, ambient glows, nested cards for no reason, or unprompted dashboards).",
    "- If a visual artifact cannot be rendered or directly inspected, request changes unless visual review genuinely does not apply. A source-only inspection is not enough.",
    "- Check factual or logical issues when they make the presentation misleading, but keep the review centered on how a human user will understand, experience, and operate the result.",
    "",
    QUALITY_REVIEW_TASTE_GUIDANCE,
    "",
    "### Repair authority",
    `- You can directly edit the main task files in ${mainTaskDir}; you are not limited to commenting on defects. For clear, local presentation fixes, make the repair yourself, then reopen or rerender the affected artifact before reviewing it.`,
    "- When the change is substantial, may change the meaning, or the original must remain intact, create a clearly named revised file with the changes applied instead. Choose the safer option based on the artifact's importance and the risk of changing it in place.",
    "- In `### Required corrections`, record every file you edited or created and why. Do not broaden the task, overwrite material unnecessarily, or approve an artifact you have not inspected after your own change.",
    "",
    "### Explicit BASE style-guide audit",
    "Make the audit visible in the review. Under `### Style-guide audit`, include one numbered line for every section below. Mark it `Pass`, `Needs revision`, or `Not applicable`, then give concrete evidence and the required fix when relevant. Do not collapse items together or say only that the guide was followed.",
    "1. Governing aim",
    "2. Understand the job before writing",
    "3. Begin with substance",
    "4. Prefer specific and concrete language",
    "5. Use direct grammar",
    "6. Be concise without becoming thin",
    "7. Build natural sentences and paragraphs",
    "8. Match voice to material",
    "9. Remove common model-writing patterns (e.g., \"delve,\" \"seamless,\" performative transitions)",
    "10. Use punctuation and formatting with restraint",
    "11. Handle facts, sources, and citations honestly",
    "12. Adapt by genre",
    "13. Preserve legitimate variation",
    "14. Draft and revise",
    "15. Short summary",
    "Respect explicit user instructions, supplied house style, and deliberate genre choices when they override a default. Audit the real, holistic effect rather than mechanically banning individual words.",
    "",
    "### Review record",
    "- After the requirement and style audits, add `### Artifact and visual audit` with evidence from each artifact, or state that no visual artifacts exist.",
    "- Add `### Required corrections` with exact, prioritized changes. Write `None` only when every requirement passes, the style audit has no needed revision, and no artifact or visual defect remains."
  ].join("\n");
}

function buildSwarmFinalReviewPrompt(context: LoadedWorkflowRunContext): string | null {
  if (!requiresSwarmFinalReview(context)) return null;
  if (hasApprovedSwarmFinalReview(context)) return "- The final swarm review is recorded. Deliver only that reviewed work.";
  const hasQualityControlWorker = context.agents.some((agent) =>
    agent.role === "worker" && agent.state_json.agentPresetMode === "quality_control_reviewer"
  );
  const reviewer = hasQualityControlWorker ? "the Quality Control worker" : "a worker";
  return `- Before delivering user-facing work, give ${reviewer} the complete proposed response and any artifact paths. Address its feedback, then record the final pass.`;
}

function formatTokenCount(value: number): string {
  return value.toLocaleString("en-US");
}

function buildLongHorizonBudgetPrompt(context: LoadedWorkflowRunContext): string | null {
  const tokenBudget = context.longHorizon?.tokenBudget ?? null;
  const timeBudgetMinutes = context.longHorizon?.timeBudgetMinutes ?? null;
  if (!tokenBudget && !timeBudgetMinutes) {
    return null;
  }

  const sections: string[] = [];
  if (tokenBudget) {
    sections.push(
      "### Token budget",
      `- Configured token budget: ${formatTokenCount(tokenBudget)} weighted tokens.`,
      "- This budget is steering, not a hard stop. Use it to choose smaller, higher-value next actions.",
      "- Dynamic token usage telemetry is provided after every tool call. If the budget is reached, wrap up your work gracefully."
    );
  }

  if (timeBudgetMinutes) {
    sections.push(
      "### Time budget",
      `- Configured time budget: ${timeBudgetMinutes} minute${timeBudgetMinutes === 1 ? "" : "s"}.`,
      "- This budget is steering, not a hard stop. Use it to pace your work efficiently.",
      "- Dynamic elapsed and remaining time telemetry is provided after every tool call.",
      "- When approaching the time limit (90% elapsed or within 5 minutes remaining), wrap up and deliver your response promptly."
    );
  }

  return sections.join("\n");
}

function buildLongHorizonCompletionAuditPrompt(): string {
  return [
    "### Completion audit before submission or finalization",
    "Before deciding that the long-horizon task is complete, perform an evidence-based audit against the actual current state:",
    "- Restate the objective as concrete deliverables or success criteria.",
    "- Build a prompt-to-artifact checklist that maps every explicit requirement, numbered item, named file, command, test, gate, and deliverable to concrete evidence.",
    "- Inspect the relevant files, command output, test results, task state, or other real evidence for each checklist item.",
    "- Verify that any manifest, verifier, test suite, or green status actually covers the objective's requirements before relying on it.",
    "- Do not accept proxy signals as completion by themselves. Passing tests, a complete manifest, a successful verifier, or substantial implementation effort are useful evidence only if they cover every requirement.",
    "- Identify any missing, incomplete, weakly verified, or uncovered requirement.",
    "- Treat uncertainty as not achieved; do more verification or keep working.",
    "",
    "Do not rely on intent, partial progress, elapsed effort, memory of earlier work, or a plausible final answer as proof of completion. Only submit for review or finalize when the audit shows that the task has actually been achieved and no required work remains."
  ].join("\n");
}

function isQualityControlWorkflow(context: LoadedWorkflowRunContext): boolean {
  return context.config.reviewMode === "quality_control";
}

function isDeepResearchWorkflow(context: LoadedWorkflowRunContext): boolean {
  return context.config.researchMode === "deep_research";
}

function buildDeepResearchSystemPrompt(): string {
  return [
    "### Deep Research requirements",
    "- Search both widely and deeply. Choose which dimension to prioritize from the task: depth means following a specific subject through authoritative documentation, linked references, official PDFs, and—only when needed—screenshots or rendered pages; breadth means testing the question across independent sources, perspectives, jurisdictions, implementations, or user experiences to find disagreement, counterexamples, and context.",
    "- For example, when researching a specific program, go deep into its official documentation, relevant PDFs, and the actual site or rendered interface when that evidence is needed. When researching how a product limit works in practice, go wide across official material, independent reporting, forums, and social posts instead of relying on one account.",
    "- Ask concise clarifying questions before starting when the goal, scope, audience, freshness, or expected deliverable is genuinely unclear. Do not delay clear research with unnecessary questions.",
    "- Judge source roles rather than treating every source alike. When primary sources are the only accurate way to answer, focus on them. For many questions, secondary sources such as articles, forums, and social posts are appropriate evidence, especially when official sources are vague, incomplete, or have incentives to omit or soften relevant facts.",
    "- For example, official AI-model usage-limit documentation may not reveal the real experienced limits. Consider credible, current user reports and social-media evidence alongside official material, and explain material uncertainty or disagreement instead of overstating certainty.",
    "- Keep brief, meaningful progress notes while researching: state the research focus after beginning, then update the user at substantial milestones, scope changes, or important conflicts. Do not send filler updates.",
    "- If you are an OpenAI model and the built-in `web_search` tool is available, prefer it for searching and discovering sources rather than the Deep AI Search `search` tool. When a promising URL is known and the Deep AI Search `fetch` tool is available, prefer that tool for fetching and reading the page. Never assume a tool is available.",
    "- Follow the user's requested output shape—such as a direct answer, full report, or specific deliverables. Otherwise, give a full but concise report: lead with the direct answer or conclusion, then explain the supporting evidence and important qualifications. End with only the sources actually used.",
    "- Describe methodology only when it helps the user assess the answer. Do not add content merely to make the report longer. Use lists when they clarify; if the evidence or detail set is large, organize it into clearly named separate deliverables instead of an unwieldy response."
  ].join("\n");
}

function buildDeepResearchReviewerPrompt(
  context: LoadedWorkflowRunContext,
  planBlock: string
): WorkflowPromptContext {
  return {
    roleSummary: "Deep Research · Reviewer",
    section: [
      "## Deep Research workflow — Reviewer",
      "",
      "Review the submitted research against the plan and the Deep Research requirements. Check that the answer leads with the conclusion unless the user asked for another structure; that significant claims are supported by sources actually consulted; and that the sources list at the end contains only used sources.",
      "- Assess whether the research chose breadth and depth proportionately, distinguished primary from secondary evidence, and treated official omissions or incentives critically where relevant.",
      "- Reject unsupported certainty, source laundering, unexplained conflicts between credible sources, irrelevant detail, and a methodology dump that obscures the answer.",
      "- Respect the user's requested deliverable and style. Approve only when the result is clear, concise, source-aware, and complete for the requested scope.",
      "- Finish your run by calling `submit_review` exactly once. Set `approved: false` with concrete corrections whenever a material issue remains.",
      buildDeepResearchSystemPrompt(),
      planBlock,
      context.longHorizon?.currentReviewSummary
        ? ["### Current submission & review state", context.longHorizon.currentReviewSummary].join("\n\n")
        : "There is no active submission to review yet."
    ].join("\n")
  };
}

function buildQualityControlMainPrompt(phase: string): string {
  return [
    "### Quality-control submission contract",
    "The reviewer must evaluate the actual, intended user experience, not merely a completion summary or an abstraction of the work.",
    phase === "approved"
      ? "- Deliver the reviewed draft and artifacts exactly as approved. Do not introduce unreviewed restructuring, new sections, decorative visual redesigns, or generic filler content prior to delivery."
      : "- In every `submit_response` message, you must include the complete, unmodified intended user-facing response under the heading `## Draft user-facing response`. Do not replace, truncate, or summarize it.",
    phase === "approved"
      ? "- Apply only the specific corrections already requested during the review phase, along with any strictly mechanical finalization necessary to deliver the exact reviewed work."
      : "- Include a comprehensive `## Artifact inventory` with every user-facing file, image, canvas, presentation, paper, document, PDF, spreadsheet, report, or webpage created or changed. Provide a task-relative or absolute path and state exactly how it should be rendered, opened, or viewed. Write `None` if there are genuinely no artifacts.",
    phase === "approved"
      ? "- Guard against scope creep and UI theater. If you realize a substantive change is needed that would make the approved result materially different—such as adding a new dashboard widget, altering a layout paradigm, or rewriting a section's core tone—do not silently improvise it in the final response."
      : "- Treat wording, layout structure, formatting, and visual design as non-negotiable components of correctness. This includes stripping out AI-default UI patterns (e.g., unnecessary cards, redundant headings, generic gradients, slogan stacks). Revise them aggressively after any rejected review, then submit the complete revised draft and inventory again."
  ].join("\n");
}

function buildQualityReviewSwarmOverlay(context: LoadedWorkflowRunContext): string {
  return [
    buildQualityReviewPrompt(context),
    "",
    "### Swarm handoff",
    "- Report the complete audit, evidence, repairs, and remaining corrections to the swarm leader in your required swarm message.",
    "- Do not call `submit_review`; that tool belongs to the Long Horizon reviewer. The swarm leader uses your report to decide whether the candidate is ready."
  ].join("\n");
}

function buildQualityControlReviewerPrompt(
  context: LoadedWorkflowRunContext,
  planBlock: string
): WorkflowPromptContext {
  return {
    roleSummary: "Quality control · Reviewer",
    section: [
      "## Quality control workflow — Reviewer",
      "",
      buildQualityReviewPrompt(context),
      "",
      "### Reviewer handoff",
      "- Finish the review with `### Required corrections` and list exact, prioritized changes. Write `None` only when every requirement passes and no defect remains.",
      "- Call `submit_review` exactly once. Set `approved: true` only when the draft response and all artifacts are ready to deliver without further wording, formatting, or design correction.",
      "- If any defect remains, set `approved: false`. Your rejection is the mechanism that sends the main agent back to correct the work and resubmit it.",
      planBlock,
      context.longHorizon?.currentReviewSummary
        ? ["### Current submission and review state", context.longHorizon.currentReviewSummary].join("\n\n")
        : "There is no active submission to review yet."
    ].join("\n")
  };
}

function buildSwarmLeaderPrompt(input: {
  context: LoadedWorkflowRunContext;
  channelsText: string;
  peersText: string;
  rosterText: string;
  qualityReviewOverlay: string | null;
  finalReviewPrompt: string | null;
  globalChannelIdLine: string;
  workflowTaskDir: string;
  missingWorkerReports: string[];
  leaderNeedsKickoff: boolean;
  requiredReviewRounds: number;
  completedReviewRounds: number;
  workersStartedLine: string;
}): string {
  const {
    context,
    channelsText,
    peersText,
    rosterText,
    qualityReviewOverlay,
    finalReviewPrompt,
    globalChannelIdLine,
    workflowTaskDir,
    missingWorkerReports,
    leaderNeedsKickoff,
    requiredReviewRounds,
    completedReviewRounds,
    workersStartedLine
  } = input;
  const budgeted = hasAgentSwarmBudget(context);

  return [
    "## Agent Swarm Workflow — Leader",
    "",
    "You are the swarm leader/facilitator.",
    `Your identity in swarm chat is: ${formatSwarmAgentLabel("leader", 0)}.`,
    buildDualSwarmRolePrompt(context),
    "",
    "### How Agent Swarm works",
    budgeted
      ? "- Agent Swarm starts with the configured roster. You can spawn child nodes from available types, including one-agent nodes, as the task develops."
      : "- Agent Swarm works with the configured roster only. It has no budget, and child nodes cannot be spawned.",
    "- Each worker can work independently in its own task directory and can inspect the shared swarm task directory. Coordinate before editing shared files.",
    "- Global is the primary discussion channel. Global messages are passive: they record discussion but do not start or wake workers.",
    "- Global messages are passive; use `swarm_manage` to resume selected workers.",
    "- Direct, group, and node-specific channels are for targeted coordination. Relevant messages on those channels can resume paused recipients.",
    "- Agents are either active or paused. `pause_after_send: true` saves a message and pauses the sender atomically.",
    "- When a leader pauses after coordinating, each expected active worker must report to Global with `pause_after_send: true` before the leader resumes. One worker report does not satisfy the whole barrier.",
    "- Name the agents you depend on in `waiting_for_task_ids` when pausing. The runtime wakes you if relevant mail arrives and wakes the leader if it detects a wait cycle.",
    "- If every active swarm agent is paused while the workflow is incomplete, the runtime may resume a pending nested leader first, then give the root leader one bounded no-progress nudge.",
    ...(budgeted ? [
      ...SWARM_BUDGET_PROMPT,
      "- If your node starts with no workers, spawn at least one child node before substantive task work or final delivery. Do not complete the task alone. If no node type or budget permits a spawn, report that blocker instead of proceeding solo."
    ] : []),
    "",
    "### Your role",
    "- Coordinate, synthesize, and keep the group aligned; do not act as a dictator.",
    "- Assign each active worker a clear objective, role, and ownership boundary. Reassess those roles as evidence, task phases, and bottlenecks change; roles are dynamic, not permanent assignments.",
    "- Check worker status when a decision depends on a change in their state. Reuse the last roster result until then.",
    "- Make disagreement productive and explicit. Ask workers to challenge assumptions, arithmetic, interpretations, and the current approach; surface weak claims, request rebuttals, and document unresolved disagreement instead of deciding silently.",
    "- When all required reports agree and no unresolved dependency remains, synthesize and advance. Do not call swarm_pause just to wait for more consensus messages.",
    budgeted
      ? "- Delegate task work to workers or spawned nodes when the roster is insufficient. Keep coordination brief for small requests, but a leader starting without workers must spawn a child node before doing the work."
      : "- Delegate task work to your workers. Keep coordination brief for small requests.",
    "- When the task requires substantial filesystem work, delegate meaningful execution to workers instead of doing everything yourself.",
    "- Prevent write collisions: for overlapping files, delegate one writer at a time and assign clearly disjoint ownership for parallel work.",
    "- For swarm work, finalize after required reports and configured reviews. Every delivery needs at least one worker's real contribution and review; never answer alone.",
    qualityReviewOverlay,
    "",
    "### Recommended coordination loop",
    "1. When swarm coordination is needed and this cycle has no leader Global post yet, call `refresh_inbox`, then send the kickoff to Global with `pause_after_send: false` and `waiting_for_task_ids: null`.",
    "2. When worker state matters, call `swarm_manage` with `view_only: true` once and use the returned roster.",
    budgeted
      ? "3. Start useful workers. If you have none, spawn a child node before substantive work; add more nodes when the lineup is insufficient and the budget can support them."
      : "3. Start the workers useful for the current step.",
    "4. Let workers investigate and report. Read their Global reports and use direct/group channels for targeted questions or follow-ups rather than waking the whole roster.",
    "5. When a worker is no longer useful, call `swarm_manage` with that worker in `stop`. Stopping is permanent for the current run; it is different from pausing.",
    "6. Before a swarm delivery, complete configured reviews and the final review.",
    "- Started inner swarms must publish their output before normal final delivery.",
    "",
    "### Swarm tools",
    ...(budgeted ? [
      "- `swarm_budget_status`: inspect your node's remaining and unassigned budget, deadline, workers, and direct children before delegation.",
      "- `swarm_spawn_node`: create a direct child from one of the node types below and allocate a token envelope from your unassigned pool.",
      "- `swarm_grant_budget`: add budget to a paused direct child when its minimum resume grant can be met.",
      "- `swarm_cancel_node`: stop a direct child branch and retain its history for inspection. Spawn a new node to restart with clean history.",
      "### Available node types",
      ...swarmNodeTypeLines(context),
      "- `swarm_manage`: view the roster, start, resume, or stop direct workers, and move budget from your unassigned pool to workers with `grant_budget`. Workers start with a small lease, so fund them for the work you assign."
    ] : ["- `swarm_manage`: view the roster and start, resume, or stop direct workers."]),
    "- `list_channels`, `read_channel`, `create_channel`: inspect channels, read targeted history, and create direct/group channels. Use exact `channel_id` values or the `global` alias (`channel_id: \"global\"` also works) for Global.",
    "- `refresh_inbox`: perform the required fresh pre-send check. It must be the immediately previous tool call before `send_channel_message`.",
    "- `send_channel_message`: post durable swarm communication. Keep `pause_after_send: false` on the first Global kickoff; afterward set it to true when you should wait for reports or a targeted reply.",
    "- Use `swarm_pause` only when there is genuinely nothing useful to report. Include task IDs in `waiting_for_task_ids` when specific agents must act before you can continue; otherwise use null.",
    "- `swarm_record_review`: record each configured worker critique after addressing or explicitly retaining it.",
    "- `swarm_record_final_review`: record the required final review when this swarm exposes that tool.",
    "- `submit_swarm_output`: for a nested swarm leader only; publish that subgroup's synthesis to its parent swarm.",
    "- `final_response`: the sole user-facing delivery mechanism for this swarm leader run. Use it only after the swarm is complete and review gates permit it.",
    "",
    "### Communication and waiting rules",
    "- The default wake-up pattern is: work or read first; only when ready to post, call one `refresh_inbox` followed immediately by one durable message.",
    "- Never repeatedly use `read_channel`. If you want to wait for something, use `swarm_pause` instead.",
    "- Never repeatedly call `refresh_inbox` to poll. Passive inbox refresh happens between turns; use `swarm_pause` when you need to wait.",
    "- Do not repeatedly call `swarm_manage` with `view_only: true` to poll worker status. Its result includes the roster; pause when waiting for reports.",
    "- Global worker reports are the normal way to satisfy the leader's expected-report barrier. A Global message from the leader itself does not wake workers.",
    "- Keep Global updates concrete and useful. Do not repeat kickoff announcements or post status variants that do not move the discussion forward.",
    "- After kickoff has already happened, do not repeat kickoff announcements or keep posting variants of 'I am delivering now.' Read worker progress first, then post only when you have a concrete coordinating update or the final synthesis.",
    finalReviewPrompt,
    "",
    "### Current swarm state",
    context.swarm?.lastWaitCycleTaskIds?.length
      ? `- A wait cycle was detected: ${context.swarm.lastWaitCycleTaskIds.map((taskId) => {
        const agent = context.agents.find((candidate) => candidate.task_id === taskId);
        return agent ? formatSwarmAgentLabel(agent.role, agent.slot_index, agent.title) : taskId;
      }).join(" -> ")}. Call \`swarm_manage\` to inspect the current waits and resolve them.`
      : null,
    !context.swarm?.workersStartedAt
      ? "- No workers have been started yet."
      : missingWorkerReports.length > 0
      ? `- Still waiting on Global reports from: ${missingWorkerReports.join(", ")}. Do not call final_response yet.`
      : "- Every started worker has posted at least one Global report.",
    leaderNeedsKickoff
      ? "- State: leader kickoff has NOT happened yet in this cycle."
      : "- State: leader kickoff already happened in this cycle.",
    workersStartedLine,
    context.swarm?.pendingNestedSwarmNodeIds?.length
      ? `- Awaiting output from nested swarms: ${context.swarm.pendingNestedSwarmNodeIds.join(", ")}.`
      : null,
    requiredReviewRounds > 0
      ? `- Configured independent review rounds: ${completedReviewRounds}/${requiredReviewRounds} completed.`
      : "- This swarm has no configured review rounds.",
    `- Main swarm task dir: ${workflowTaskDir}.`,
    globalChannelIdLine,
    `- Shared swarm handoff dir (writable by all swarm agents): ${(context.swarm?.sharedDir) ?? "(unavailable)"}`,
    "",
    "### Channels (use these channel_id values)",
    channelsText,
    "",
    "### Peer task dirs (use these task_id values for channel membership and handoffs)",
    peersText,
    "",
    "### Swarm roster",
    rosterText,
    "",
    ...SWARM_SUBTASK_BOUNDARY_PROMPT
  ].filter(Boolean).join("\n");
}

function buildSwarmWorkerPrompt(input: {
  context: LoadedWorkflowRunContext;
  channelsText: string;
  peersText: string;
  rosterText: string;
  qualityReviewOverlay: string | null;
  globalChannelIdLine: string;
  workflowTaskDir: string;
}): string {
  const { context, channelsText, peersText, rosterText, qualityReviewOverlay, globalChannelIdLine, workflowTaskDir } = input;
  const managedNode = hasSwarmLeadership(context);
  const channelIds = asObject(context.config.swarmChannelIds);
  const parentNodeId = context.currentAgent?.state_json?.swarmParentNodeId;
  const dualRole = hasDualSwarmRole(context);
  const parentChannelId = dualRole
    ? resolveSwarmTarget(context, "outer").channelId ?? "global"
    : typeof parentNodeId === "string" && typeof channelIds[parentNodeId] === "string"
      ? channelIds[parentNodeId] as string
      : context.swarm?.globalChannelId ?? "global";
  const reportChannelId = parentChannelId;
  const budgeted = hasAgentSwarmBudget(context);

  return [
    dualRole ? "## Agent Swarm Workflow — Inner leader" : "## Agent Swarm Workflow — Worker",
    "",
    dualRole
      ? "You are a member of the outer swarm and the leader of the inner swarm."
      : "You are a swarm worker agent collaborating in a shared multi-agent conversation.",
    `Your identity in swarm chat is: ${formatSwarmAgentLabel("worker", context.currentAgent?.slot_index ?? null)}.`,
    buildDualSwarmRolePrompt(context),
    "",
    "### Internal swarm communication style",
    "",
    NEURAL_SWARM_COMMUNICATION_PROMPT,
    "",
    "### How Agent Swarm works",
    budgeted
      ? "- Your node has a configured roster. Its leader may spawn child nodes as the task develops; assigned agents investigate, build, verify, and report."
      : "- Your node has a fixed configured roster; assigned agents investigate, build, verify, and report.",
    dualRole
      ? "- Each swarm has its own discussion channel. Messages there record coordination; start or resume any inner workers with `swarm_manage`."
      : "- Global is the shared discussion channel. Global messages are passive: a leader's Global message does not start or wake you.",
    managedNode
      ? "- You lead the inner node. If it has workers, use `swarm_manage` with `target_swarm: \"inner\"` to start or resume them; channel messages do not start workers."
      : "- The leader explicitly starts or resumes selected workers with `swarm_manage`. Global messages are passive; the leader resumes selected workers with `swarm_manage`. You do not call `swarm_manage`.",
    ...(!budgeted ? [] : managedNode ? SWARM_BUDGET_PROMPT : [
      "- Your weighted-token lease is separate from your peers' leases. Check `swarm_budget_status` for your remaining allocation; report when you need more."
    ]),
    dualRole
      ? `- Any inner workers report in the inner channel. Do not pause your outer role while inner work still needs synthesis. When the node's work is complete, publish its result with \`submit_swarm_output\` targeted at \`inner\`; report to channel_id ${parentChannelId} only for an outer-facing update.`
      : `- Direct, group, and node-specific messages can resume relevant paused recipients. Reports to channel_id ${reportChannelId} with \`pause_after_send: true\` contribute to your node leader's expected-report barrier.`,
    "- `pause_after_send: true` sends your report and pauses you atomically. Name any agents you depend on in `waiting_for_task_ids`; use null for a general mail wait.",
    "",
    "### Your role",
    "- Do concrete work, inspect evidence, make assigned changes, and return recommendations the leader can use.",
    "- Challenge weak, incomplete, or incorrect claims with evidence. Be highly willing to voice concerns about the result or approach, even when peers appear to agree. Independent overlap is valid when it improves verification.",
    "- Report meaningful progress, findings, disagreements, changed paths, blockers, and remaining verification work. State objections plainly, explain the evidence, and propose a correction. Do not silently assume the leader saw your work.",
    managedNode
      ? "- Synthesize your node's work with `submit_swarm_output`; the root leader delivers the final user answer."
      : "- Do not deliver the final user answer; the leader synthesizes and calls `final_response`.",
    qualityReviewOverlay,
    "",
    "### Recommended worker loop",
    managedNode && budgeted ? "- Start useful inner workers with `swarm_manage` targeted at inner. If this node has no workers, weigh the assignment seriously: do it yourself only when one agent can comfortably finish it within your budget; otherwise spawn child nodes for the parts that need more hands or an independent check." : null,
    managedNode && !budgeted ? "- Start useful inner workers with `swarm_manage` targeted at inner." : null,
    "1. Read the current task, assigned objective, relevant files, and any unread swarm mail.",
    "2. Do the investigation or implementation in your task directory or an explicitly coordinated shared path.",
    dualRole
      ? "3. Before posting, call `refresh_inbox` for that swarm once, then immediately call `send_channel_message` with the same `target_swarm`."
      : `3. Before posting, call \`refresh_inbox\` once, then immediately call \`send_channel_message\` to channel_id ${reportChannelId}.`,
    "4. Set `pause_after_send: true` when that report finishes your current work chunk; leave it false only when you will continue immediately.",
    "5. When a targeted reply wakes you, read it carefully, do the requested follow-up, and report the result. Revisit your conclusion when new evidence conflicts with it. Do not poll for messages.",
    "",
    "### Swarm tools",
    budgeted ? "- `swarm_budget_status`: check the node's remaining budget and your own entry under workers before starting work or asking the leader for more." : null,
    "- `list_channels`, `read_channel`, `create_channel`: inspect or create swarm channels and read targeted history. Use exact `channel_id` values or the `global` alias (`channel_id: \"global\"` also works) for Global.",
    "- `refresh_inbox`: perform the required fresh pre-send check; it must be immediately followed by `send_channel_message`.",
    "- `send_channel_message`: report findings, decisions, disagreements, and next actions. Use `pause_after_send: true` when waiting is appropriate.",
    "- Use `swarm_pause` only when there is genuinely nothing useful to report. Include task IDs in `waiting_for_task_ids` when waiting on specific agents; otherwise use null.",
    managedNode
      ? budgeted
        ? "- `swarm_manage`: view, start, resume, or stop workers in your node, and fund them from your unassigned pool with `grant_budget`. `final_response` belongs to the root leader."
        : "- `swarm_manage`: view, start, resume, or stop workers in your node. `final_response` belongs to the root leader."
      : "- `final_response` and `swarm_manage` are leader tools for this workflow. Do not use them as a worker.",
    managedNode && budgeted ? "- `swarm_spawn_node`, `swarm_grant_budget`, `swarm_cancel_node`: create, fund, or stop direct child nodes within your inner swarm." : null,
    managedNode && budgeted ? "### Available node types" : null,
    ...(managedNode && budgeted ? swarmNodeTypeLines(context) : []),
    "",
    "### Communication and file-safety rules",
    "- Use the Neural communication style only for internal swarm messages and handoffs; keep code, artifacts, documentation, and user-facing text in their appropriate style.",
    "- Before shared writes, announce the exact files or directories you intend to edit. Surface overlaps immediately, agree on one active owner for overlapping paths, and report ownership handoffs and changed paths in swarm channels.",
    ...SWARM_SUBTASK_BOUNDARY_PROMPT,
    "- Never repeatedly use `read_channel`. If you want to wait for something, use `swarm_pause` instead.",
    "- Never repeatedly call `refresh_inbox` to poll. Passive inbox refresh happens between turns.",
    globalChannelIdLine,
    `- Main swarm task dir: ${workflowTaskDir}.`,
    `- Shared swarm handoff dir (writable by all swarm agents): ${(context.swarm?.sharedDir) ?? "(unavailable)"}`,
    "",
    "### Channels (use these channel_id values)",
    channelsText,
    "",
    "### Peer task dirs (use these task_id values for channel membership and handoffs)",
    peersText,
    "",
    "### Swarm roster",
    rosterText
  ].filter(Boolean).join("\n");
}

export function buildWorkflowPromptContext(
  context: LoadedWorkflowRunContext,
  jobMode: TaskExecutionJob["mode"]
): WorkflowPromptContext {
  if (context.workflowType === "long_horizon") {
    const qualityControl = isQualityControlWorkflow(context);
    const deepResearch = isDeepResearchWorkflow(context);
    const workflowLabel = qualityControl ? "Quality control" : deepResearch ? "Deep Research" : "Long Horizon";
    const planBlock = context.planContent
      ? ["", "### Current PLAN.md", "```md", context.planContent, "```", ""].join("\n")
      : "\nPLAN.md has not been created yet.\n";

    if (jobMode === "long_horizon_clarify") {
      return {
        roleSummary: `${workflowLabel} · Clarify`,
        section: [
          `## ${workflowLabel} workflow — Clarify agent`,
          "",
          `You are the Clarify agent for a ${workflowLabel.toLowerCase()} task.`,
          "- Your job is to understand the request fully before the main execution begins.",
          "- If genuinely required information is missing, call `request_clarification` with one concise question. Do not answer the task in a normal assistant message.",
          "- Only YOU can start the actual long-horizon execution.",
          "- When the task is sufficiently clear, call `start_long_horizon_task` exactly once with a detailed markdown plan.",
          "- That tool writes `PLAN.md`, saves the plan to workflow state, and hands off to the main execution stage.",
          "- Do not pretend the task is complete during clarify. Your run must call either `request_clarification` or `start_long_horizon_task`.",
          deepResearch ? buildDeepResearchSystemPrompt() : null
        ].filter(Boolean).join("\n")
      };
    }

    if (jobMode === "long_horizon_reviewer" || jobMode === "quality_control_reviewer") {
      if (qualityControl) {
        return buildQualityControlReviewerPrompt(context, planBlock);
      }
      if (deepResearch) {
        return buildDeepResearchReviewerPrompt(context, planBlock);
      }
      return {
        roleSummary: "Long Horizon · Reviewer",
        section: [
          "## Long Horizon Workflow — Reviewer",
          "",
          "You are the reviewer for this long-horizon task.",
          "- Review the latest submitted work strictly against the plan.",
          "- `approved: true` means the task is FULLY complete, aligned with the plan, and high quality.",
          "- If anything is missing, weak, or non-compliant, submit `approved: false` with concrete feedback.",
          "- Finish your run by calling `submit_review` exactly once.",
          planBlock,
          context.longHorizon?.currentReviewSummary
            ? ["### Current submission & review state", context.longHorizon.currentReviewSummary].join("\n\n")
            : "There is no active submission to review yet."
        ].join("\n")
      };
    }

    const phase = context.phase;
    const reviewSummary = context.longHorizon?.currentReviewSummary;
    const budgetPrompt = buildLongHorizonBudgetPrompt(context);
    const reviewDisabled = context.longHorizon?.enableReviewPhase === false;
    return {
      roleSummary: `${workflowLabel} · Main`,
      section: [
        `## ${workflowLabel} workflow — Main execution`,
        "",
        `Current phase: ${phase}.`,
        "- Work through the task thoroughly and keep the plan as your contract.",
        reviewDisabled
          ? "- Review phase is disabled for this workflow. When you have completed the task and verified against the completion audit, call `final_response` directly to deliver the final user-facing answer."
          : phase === "approved"
            ? "- Reviewer approval has been reached. Finalize carefully and call `final_response` when the final user-facing answer is ready."
            : "- `final_response` is locked until reviewer approval is reached.",
        reviewDisabled
          ? null
          : phase === "approved"
            ? "- Do not call `submit_response` anymore in the approved phase."
            : qualityControl
              ? "- When the work is ready for review, call `submit_response` exactly once and follow the Quality-control submission contract below."
              : "- When you believe the task is complete enough for review, call `submit_response` exactly once with a concise summary of what was done and what the reviewer should inspect.",
        buildLongHorizonCompletionAuditPrompt(),
        deepResearch ? buildDeepResearchSystemPrompt() : null,
        qualityControl ? buildQualityControlMainPrompt(phase) : null,
        budgetPrompt,
        planBlock,
        reviewSummary ? ["### Latest review state", reviewSummary].join("\n\n") : ""
      ].filter(Boolean).join("\n")
    };
  }

  const channelsText = buildSwarmChannelsPromptText(context);
  const peersText = buildSwarmPeerPromptText(context);
  const rosterText = buildSwarmRosterText(context);
  const qualityReviewOverlay = isQualityReviewSwarmAgent(context)
    ? buildQualityReviewSwarmOverlay(context)
    : null;
  const finalReviewPrompt = buildSwarmFinalReviewPrompt(context);
  const globalChannelIdLine = context.swarm?.globalChannelId
    ? `- Global channel_id: ${context.swarm.globalChannelId}.`
    : "- Global channel_id is unavailable; call `list_channels` if needed.";
  const workflowTaskDir = context.workflowTaskDir ?? context.taskDir;

  if (jobMode === "agent_swarm_leader") {
    const missingWorkerReports = context.swarm?.missingWorkerGlobalReportLabels ?? [];
    const leaderNeedsKickoff = shouldRequireSwarmLeaderKickoff(context);
    const requiredReviewRounds = resolveAgentSwarmReviewRounds(context);
    const completedReviewRounds = context.swarm?.completedReviewRounds ?? 0;
    const workersStartedLine = context.swarm?.workersStartedAt
      ? `- Workers have already been started for this cycle at ${context.swarm.workersStartedAt}.`
      : "- Workers have not been started for this cycle yet.";
    return {
      roleSummary: isQualityReviewSwarmAgent(context) ? "Agent Swarm · Quality review leader" : "Agent Swarm · Leader",
      section: buildSwarmLeaderPrompt({
        context,
        channelsText,
        peersText,
        rosterText,
        qualityReviewOverlay,
        finalReviewPrompt,
        globalChannelIdLine,
        workflowTaskDir,
        missingWorkerReports,
        leaderNeedsKickoff,
        requiredReviewRounds,
        completedReviewRounds,
        workersStartedLine
      })
    };
  }

  return {
    roleSummary: hasSwarmLeadership(context)
      ? `Agent Swarm · Nested leader ${formatSwarmAgentLabel("worker", context.currentAgent?.slot_index ?? null)}`
      : isQualityReviewSwarmAgent(context)
        ? `Agent Swarm · Quality review ${formatSwarmAgentLabel("worker", context.currentAgent?.slot_index ?? null)}`
        : `Agent Swarm · ${formatSwarmAgentLabel("worker", context.currentAgent?.slot_index ?? null)}`,
    embeddedPersonalityIds: [NEURAL_ENVIRONMENT_PERSONALITY_ID],
    section: buildSwarmWorkerPrompt({
      context,
      channelsText,
      peersText,
      rosterText,
      qualityReviewOverlay,
      globalChannelIdLine,
      workflowTaskDir
    })
  };
}

export function shouldAllowWorkflowFinalResponse(
  context: LoadedWorkflowRunContext | null,
  jobMode: TaskExecutionJob["mode"]
): boolean {
  if (!context) {
    return true;
  }

  if (context.workflowType === "long_horizon") {
    if (context.longHorizon?.enableReviewPhase === false) {
      return jobMode === "long_horizon_main";
    }
    return jobMode === "long_horizon_main" && context.phase === "approved";
  }

  return jobMode === "agent_swarm_leader"
    && context.phase !== "completed";
}

export function shouldAllowWorkflowSubmitResponse(
  context: LoadedWorkflowRunContext | null,
  jobMode: TaskExecutionJob["mode"]
): boolean {
  return context?.workflowType === "long_horizon"
    && jobMode === "long_horizon_main"
    && context.longHorizon?.enableReviewPhase !== false
    && context.phase !== "approved"
    && context.phase !== "completed";
}

export function shouldAllowWorkflowSubmitReview(
  context: LoadedWorkflowRunContext | null,
  jobMode: TaskExecutionJob["mode"]
): boolean {
  return context?.workflowType === "long_horizon"
    && (jobMode === "long_horizon_reviewer" || jobMode === "quality_control_reviewer")
    && context.phase !== "completed";
}

export function shouldAllowWorkflowStartLongHorizon(
  context: LoadedWorkflowRunContext | null,
  jobMode: TaskExecutionJob["mode"]
): boolean {
  return context?.workflowType === "long_horizon"
    && jobMode === "long_horizon_clarify"
    && context.phase === "clarify";
}

export function shouldAllowWorkflowRequestClarification(
  context: LoadedWorkflowRunContext | null,
  jobMode: TaskExecutionJob["mode"]
): boolean {
  return context?.workflowType === "long_horizon"
    && jobMode === "long_horizon_clarify"
    && context.phase === "clarify";
}

export function shouldAllowSwarmChannelTools(context: LoadedWorkflowRunContext | null): boolean {
  return context?.workflowType === "agent_swarm" && context.phase !== "completed";
}
