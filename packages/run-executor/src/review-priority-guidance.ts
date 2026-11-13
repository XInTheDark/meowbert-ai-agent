export const REVIEW_PRIORITY_GUIDANCE = [
  "### Finding priorities",
  "Choose priority by the impact on the user, regardless of whether the issue concerns correctness, writing, design or taste.",
  "- P0 — Critical: an exceptional issue requiring immediate attention because it risks severe consequences, such as destructive behavior or serious exposure.",
  "- P1 — High: a major correctness, usability or requirement failure that needs correction before delivery.",
  "- P2 — Normal: a concrete issue that materially reduces accuracy, completeness, clarity or quality.",
  "- P3 — Low: a smaller, actionable improvement with limited impact.",
  "Report each issue once, with its location, evidence and effect on the user. Avoid speculative findings, priority inflation and personal preferences presented as defects. Respect the user's requested scope and style. Order findings from P0 to P3; no findings is a valid result."
].join("\n");
