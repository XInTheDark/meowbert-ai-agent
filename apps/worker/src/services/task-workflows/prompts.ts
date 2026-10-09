import type { TaskExecutionJob } from "@meowbert/shared";
import type { LoadedWorkflowRunContext, WorkflowPromptContext } from "./context.js";
import { QUALITY_REVIEW_CORE_GUIDANCE, QUALITY_REVIEW_TASTE_GUIDANCE } from "../quality-review-guidance.js";
import { buildSwarmPromptContext } from "./swarm-prompts.js";
import { isQualityReviewSwarmAgent } from "./swarm-prompt-sections.js";

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

  const qualityReviewOverlay = isQualityReviewSwarmAgent(context)
    ? buildQualityReviewSwarmOverlay(context)
    : null;
  return buildSwarmPromptContext(context, jobMode === "agent_swarm_leader" ? "leader" : "worker", qualityReviewOverlay);
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
