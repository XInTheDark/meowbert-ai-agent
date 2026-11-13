import { QUALITY_REVIEW_CORE_GUIDANCE, QUALITY_REVIEW_TASTE_GUIDANCE, WRITING_REVIEW_GUIDANCE } from "./quality-review-guidance.js";
import { REVIEW_PRIORITY_GUIDANCE } from "./review-priority-guidance.js";

export function buildQualityReviewPrompt(mainTaskDir: string | null, allowRepairs = true): string {
  return [
    "### Quality review mandate",
    QUALITY_REVIEW_CORE_GUIDANCE,
    "",
    "### Requirement-by-requirement audit",
    "- Start by extracting every explicit requirement from the original user request in the task conversation (including parent-task context), the task brief, supplied references, acceptance criteria, and any plan. Include requested behavior, content, format, named files, interactions, constraints, edge cases, and explicit things the user said to avoid.",
    "- Create `### Requirement audit` in your report with exactly one numbered line for every extracted requirement. For each line, state the requirement, mark it `Pass`, `Fail`, or `Unclear`, cite concrete evidence from the response or actual artifact, and state the correction when it is not a pass.",
    "- Check the original user request directly. Do not treat the plan, a completion summary, a manifest, passing tests, or the agent's claims as a substitute for a requirement that the user gave explicitly. If the plan omitted a user requirement, it still must be audited.",
    "- Mark `Pass` only when the actual current response or artifact demonstrates that the requirement is satisfied. Treat every `Fail` or `Unclear` item as a material defect: request correction.",
    "- If the original request or required context is unavailable, mark the affected requirements `Unclear` and report the missing context; do not invent or reconstruct requirements from the draft alone.",
    "- Never merge separate requirements into one line, silently drop a requirement, or infer that an unstated feature is required. Preserve the user's requested scope while checking every stated item strictly.",
    "",
    "### Inspect the actual output",
    mainTaskDir
      ? `- The main task directory is ${mainTaskDir}. Open the real files there; do not judge artifacts from a submission summary, plan, or source code alone.`
      : "- Open the supplied deliverable files; do not judge artifacts from a submission summary, plan, or source code alone.",
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
    ...(allowRepairs ? [
      "### Repair authority",
      `- You can directly edit the main task files in ${mainTaskDir}; you are not limited to commenting on defects. For clear, local presentation fixes, make the repair yourself, then reopen or rerender the affected artifact before reviewing it.`,
      "- When the change is substantial, may change the meaning, or the original must remain intact, create a clearly named revised file with the changes applied instead. Choose the safer option based on the artifact's importance and the risk of changing it in place.",
      "- In `### Required corrections`, record every file you edited or created and why. Do not broaden the task, overwrite material unnecessarily, or approve an artifact you have not inspected after your own change.",
      ""
    ] : [
      "### Repair authority",
      "Report defects for the author to fix. Do not edit or rewrite the deliverable. Write review files only in your own lane directory.",
      ""
    ]),
    WRITING_REVIEW_GUIDANCE,
    "",
    "### Style-guide audit",
    "Make the writing review visible. Under `### Style-guide audit`, include one numbered line for each section of the Writing rules in your base instructions. Mark it `Pass`, `Needs revision`, or `Not applicable`, then give the quoted evidence and the required fix. Do not collapse sections together or say only that the guide was followed.",
    "Respect explicit user instructions, supplied house style, and deliberate genre choices when they override a default.",
    "",
    "### Review record",
    "- After the requirement and style audits, add `### Artifact and visual audit` with evidence from each artifact, or state that no visual artifacts exist.",
    REVIEW_PRIORITY_GUIDANCE,
    "- Add `### Required corrections` with exact, prioritized changes. Write `None` only when every requirement passes, the style audit has no needed revision, and no artifact or visual defect remains."
  ].join("\n");
}
