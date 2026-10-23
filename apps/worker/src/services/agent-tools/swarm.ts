import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";

// Every swarm agent, leader and lanes alike, is offered the same swarm tools so a fork's tools array
// matches its parent's; who may call what is checked when the call is dispatched.
export const SPLIT_TOOL_NAME = "split";
export const SHARE_TOOL_NAME = "share";
export const SUBMIT_TOOL_NAME = "submit";
export const SWARM_TOOL_NAMES = [SPLIT_TOOL_NAME, SHARE_TOOL_NAME, SUBMIT_TOOL_NAME] as const;

export function isSwarmToolName(name: string): boolean {
  return (SWARM_TOOL_NAMES as readonly string[]).includes(name);
}

export const splitArgumentsSchema = z.object({
  lanes: z.array(z.object({
    title: z.string().trim().min(1).max(200),
    direction: z.string().trim().min(1).max(4_000).nullable(),
    weight: z.number().positive().nullable()
  })).min(1),
  spine_path: z.string().trim().min(1).nullable()
});

export const shareArgumentsSchema = z.object({
  text: z.string().trim().min(1).max(2_000)
});

export const submitArgumentsSchema = z.object({
  summary: z.string().trim().min(1),
  decisions: z.array(z.object({
    choice: z.string().trim().min(1),
    reason: z.string().trim().min(1),
    would_change_if: z.string().trim().min(1)
  })).nullable(),
  findings: z.array(z.object({
    severity: z.enum(["must_fix", "should_fix"]),
    location: z.string().trim().min(1),
    issue: z.string().trim().min(1)
  })).nullable(),
  files: z.array(z.string().trim().min(1))
});

function tool(name: string, description: string, properties: Record<string, unknown>): FunctionTool {
  return { type: "function", name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
}

function strictObject(properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "object", properties, required: Object.keys(properties), additionalProperties: false };
}

export const SWARM_FUNCTION_TOOLS: FunctionTool[] = [
  tool(SPLIT_TOOL_NAME, "Fork copies of yourself (lanes) that each take a different, concrete part of the work. Lanes start with everything you know. Must be your last tool call; your turn ends and you resume with their summaries once all have submitted.", {
    lanes: {
      type: "array",
      minItems: 1,
      items: strictObject({
        title: { type: "string", description: "The part this lane owns, in a few words." },
        direction: { type: ["string", "null"], description: "What the lane should do and deliver, beyond what the title says." },
        weight: { type: ["number", "null"], description: "Relative share of the budget when budgets are on; null for an equal share." }
      })
    },
    spine_path: { type: ["string", "null"], description: "Path of the spine file you wrote for a split deliverable; null when there is none." }
  }),
  tool(SHARE_TOOL_NAME, "Lanes only. Share a short note with your sibling lanes: a finding, decision or warning that would change how they act. They see it at their next step.", {
    text: { type: "string", description: "One or two lines." }
  }),
  tool(SUBMIT_TOOL_NAME, "Lanes only. Finish your part and report to your parent. The parent reads the summary, not your reasoning.", {
    summary: { type: "string", description: "What you found or produced and anything the parent must know." },
    decisions: {
      type: ["array", "null"],
      description: "Your key choices, when you were asked to answer a question independently; otherwise null.",
      items: strictObject({
        choice: { type: "string" },
        reason: { type: "string" },
        would_change_if: { type: "string", description: "What would make you choose differently." }
      })
    },
    findings: {
      type: ["array", "null"],
      description: "Problems found, when you were asked to check a deliverable; otherwise null.",
      items: strictObject({
        severity: { type: "string", enum: ["must_fix", "should_fix"] },
        location: { type: "string" },
        issue: { type: "string" }
      })
    },
    files: { type: "array", items: { type: "string" }, description: "Paths of the files you produced, in your lane directory." }
  })
];
