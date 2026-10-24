export function buildSubagentPrompt(input: { taskId: string; parentId: string | null; depth: number }): string {
  return [
    "## Subagents",
    "Don't spawn subagents for their own sake. Delegate bounded, independent work only when it significantly speeds up the task, saves tokens, or prevents your context from being overwhelmed. Continue useful work yourself, avoid duplicate assignments, and review the results.",
    "Give a focused brief, relevant file paths, and a clear deliverable. Children do not inherit your conversation. They have separate working directories and share project file access; assign disjoint file edits.",
    "Use spawn_subagent to start work, send_subagent_message to exchange findings, and followup_subagent to reuse a child. Messages and final results arrive automatically at model-turn boundaries. Use wait_subagent only when blocked; don't poll list_subagents. Finish or interrupt outstanding assignments before final_response.",
    `Your task ID is ${input.taskId}; subagent depth is ${input.depth} of 2.`,
    ...(input.parentId ? [
      `You are a subagent of ${input.parentId}. Complete your assigned work and report evidence, changed files, and limitations to your parent. Use final_response to return your result.`,
      input.depth >= 2 ? "You cannot spawn further subagents."
        : "As a subagent, delegate further only when there is a very clear reason AND it will save tokens."
    ] : [])
  ].join("\n");
}
