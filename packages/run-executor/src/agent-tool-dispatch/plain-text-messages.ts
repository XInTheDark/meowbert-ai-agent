import type { ResponseOutputItem } from "openai/resources/responses/responses";
import { FINAL_RESPONSE_TOOL_NAME } from "../agent-tools/shared.js";
import type { ToolDispatchContext, ToolDispatchState } from "./types.js";

function collectPlainText(items: ResponseOutputItem[]): string {
  const parts: string[] = [];
  for (const item of items) {
    if (item.type !== "message") continue;
    for (const part of item.content ?? []) {
      if (part.type === "output_text" && part.text.trim()) parts.push(part.text.trim());
    }
  }
  return parts.join("\n\n");
}

function hasFinalResponseCall(items: ResponseOutputItem[]): boolean {
  return items.some((item) => item.type === "function_call" && item.name === FINAL_RESPONSE_TOOL_NAME);
}

// Text the model writes outside a tool call is delivered like a send_message call, before any
// sibling call such as wait can pause the run. A final_response in the same turn carries the answer.
export async function deliverPlainTextAsMessage(
  items: ResponseOutputItem[],
  ctx: ToolDispatchContext,
  state: ToolDispatchState
): Promise<boolean> {
  if (!ctx.deliverPlainText || ctx.notesOnly || hasFinalResponseCall(items)) return false;
  const text = collectPlainText(items);
  if (!text) return false;
  (state.pendingMidRunMessages ??= []).push(text);
  await ctx.publishMidRunMessages?.();
  return true;
}
