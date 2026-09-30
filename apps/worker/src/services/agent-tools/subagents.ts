import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";

export const SUBAGENT_TOOL_NAMES = [
  "spawn_subagent", "send_subagent_message", "followup_subagent", "wait_subagent", "list_subagents", "interrupt_subagent"
] as const;

export const spawnSubagentSchema = z.object({
  message: z.string().trim().min(1), title: z.string().trim().min(1).max(240).nullable().optional(),
  model: z.enum(["default", "fast"]).nullable().optional()
});
export const subagentMessageSchema = z.object({ target: z.string().uuid(), message: z.string().trim().min(1) });
export const subagentTargetSchema = z.object({ target: z.string().uuid() });
export const subagentWaitSchema = z.object({ timeout_seconds: z.number().int().min(1).max(3600).nullable().optional() });

const target = { type: "string", description: "Subagent ID returned by spawn_subagent or list_subagents." } as const;
function tool(name: string, description: string, properties: Record<string, unknown>): FunctionTool {
  return { type: "function", name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
}

export const SUBAGENT_FUNCTION_TOOLS: FunctionTool[] = [
  tool("spawn_subagent", "Start a subagent and return immediately. Give a focused brief, useful file paths, and a clear deliverable. Delegate only when it significantly speeds up work, saves tokens, or keeps context manageable; keep doing independent work yourself.", {
    message: { type: "string", description: "Self-contained assignment. The child does not inherit your conversation." },
    title: { type: ["string", "null"], description: "Short assignment label." },
    model: { type: ["string", "null"], enum: ["default", "fast", null], description: "Default inherits your model and reasoning settings; Fast uses the configured lightweight subagent preset." }
  }),
  tool("send_subagent_message", "Send a message within this task tree. It is delivered at the next model turn; it does not start an idle subagent.", {
    target, message: { type: "string" }
  }),
  tool("followup_subagent", "Give an existing subagent another assignment, retaining its history and model. Starts an idle subagent; a running subagent receives it at its next model turn.", {
    target, message: { type: "string" }
  }),
  tool("wait_subagent", "Yield only when you have no useful work left. Wake on a message, result, user input, or timeout. Timeout does not cancel subagents.", {
    timeout_seconds: { type: ["integer", "null"], minimum: 1, maximum: 3600, description: "Maximum wait; null uses 60 seconds." }
  }),
  tool("list_subagents", "List subagents and their current status in this task tree. Results arrive automatically; do not repeatedly poll.", {}),
  tool("interrupt_subagent", "Interrupt a subagent's assignment and descendants. Its history remains available for a later followup_subagent.", { target })
];
