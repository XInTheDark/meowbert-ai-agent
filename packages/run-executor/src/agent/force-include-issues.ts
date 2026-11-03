import { FORCE_INCLUDE_ISSUE_KIND } from "./force-included-attachments.js";
import type { RunControl } from "./ports/run-control.js";

// Shows the user what didn't reach the model. Returns the branch leaf after the message.
export async function reportForceIncludeIssues(
  control: Pick<RunControl, "appendMessage" | "selectBranch">,
  parentMessageId: string | null,
  issues: string[]
): Promise<string | null> {
  if (issues.length === 0) {
    return parentMessageId;
  }

  const messageId = await control.appendMessage({
    role: "system",
    content: { kind: FORCE_INCLUDE_ISSUE_KIND, text: issues.join("\n") },
    parentMessageId
  });
  await control.selectBranch(messageId);
  return messageId;
}
