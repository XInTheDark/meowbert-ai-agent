import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import { CHOSEN_MODEL_ROUTE_EFFORTS, type PlatformModelRouter } from "@meowbert/shared";

// Every forked swarm agent, leader and lanes alike, is offered the same swarm tools so a fork's tools
// array matches its parent's; who may call what is checked when the call is dispatched. Check lanes
// are fresh, not forks, and only get submit.
export const SPLIT_TOOL_NAME = "split";
export const DIVERGE_TOOL_NAME = "diverge";
export const CHECK_TOOL_NAME = "check";
export const STEER_TOOL_NAME = "steer";
export const STOP_LANE_TOOL_NAME = "stop";
export const RESUME_TOOL_NAME = "resume";
export const SHARE_TOOL_NAME = "share";
export const SUBMIT_TOOL_NAME = "submit";
export const SWARM_TOOL_NAMES = [
  SPLIT_TOOL_NAME,
  DIVERGE_TOOL_NAME,
  CHECK_TOOL_NAME,
  STEER_TOOL_NAME,
  STOP_LANE_TOOL_NAME,
  RESUME_TOOL_NAME,
  SHARE_TOOL_NAME,
  SUBMIT_TOOL_NAME
] as const;

// Which swarm tools a run is offered: forked agents get all of them, Check lanes only submit.
export type SwarmToolSet = "all" | "check";

export function isSwarmToolName(name: string): boolean {
  return (SWARM_TOOL_NAMES as readonly string[]).includes(name);
}

const laneTitle = z.string().trim().min(1).max(200);
const laneId = z.string().uuid();
// Present only when the swarm has a model router; null keeps the parent's model.
const laneModel = {
  model: z.string().trim().min(1).nullable().optional(),
  effort: z.enum(CHOSEN_MODEL_ROUTE_EFFORTS).nullable().optional()
};

export const splitArgumentsSchema = z.object({
  lanes: z.array(z.object({
    title: laneTitle,
    direction: z.string().trim().min(1).max(4_000).nullable(),
    weight: z.number().positive().nullable(),
    ...laneModel
  })).min(1),
  spine_path: z.string().trim().min(1).nullable()
});

export const divergeArgumentsSchema = z.object({
  question: z.string().trim().min(1).max(8_000),
  lanes: z.array(z.object({
    title: laneTitle,
    direction: z.string().trim().min(1).max(4_000).nullable(),
    ...laneModel
  })).min(1)
});

export const checkArgumentsSchema = z.object({
  draft: z.string().trim().min(1),
  files: z.array(z.string().trim().min(1)),
  focus: z.string().trim().min(1).max(4_000).nullable(),
  ...laneModel
});

export const steerArgumentsSchema = z.object({
  lane_id: laneId,
  message: z.string().trim().min(1).max(8_000)
});

export const stopLaneArgumentsSchema = z.object({
  lane_id: laneId,
  discard: z.boolean()
});

export const resumeArgumentsSchema = z.object({
  lane_id: laneId,
  message: z.string().trim().min(1).max(8_000),
  extra_tokens: z.number().int().positive().nullable()
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

const laneIdProperty = { type: "string", description: "The lane_id from split, diverge, check or your lane results." };

// With a router, each lane entry can pick its model from the router's targets, and its reasoning
// effort when the router allows that. The leader and its forks build the same tools from the same
// router, so their tools arrays still match.
function modelChoiceProperties(router: PlatformModelRouter | null): Record<string, unknown> {
  if (!router) return {};
  const options = router.models.map((target) => `- ${target.id}: ${target.description}`).join("\n");
  return {
    model: {
      type: ["string", "null"],
      enum: [...router.models.map((target) => target.id), null],
      description: `Model this lane runs on; null for your own model, which shares your cache and is usually best. A different model widens a diverge or makes a more independent Check:\n${options}`
    },
    ...(router.allowReasoningEffort ? {
      effort: {
        type: ["string", "null"],
        enum: [...CHOSEN_MODEL_ROUTE_EFFORTS, null],
        description: "Reasoning effort for a lane on a picked model; null for a balanced default."
      }
    } : {})
  };
}

function buildSplitTool(router: PlatformModelRouter | null): FunctionTool {
  return tool(SPLIT_TOOL_NAME, "Fork copies of yourself (lanes) that each take a different, concrete part of the work. Lanes start with everything you know. Must be your last tool call; your turn ends and you resume with their summaries once all have submitted.", {
    lanes: {
      type: "array",
      minItems: 1,
      items: strictObject({
        title: { type: "string", description: "The part this lane owns, in a few words." },
        direction: { type: ["string", "null"], description: "What the lane should do and deliver, beyond what the title says." },
        weight: { type: ["number", "null"], description: "Relative share of the budget when budgets are on; null for an equal share." },
        ...modelChoiceProperties(router)
      })
    },
    spine_path: { type: ["string", "null"], description: "Path of the spine file you wrote for a split deliverable; null when there is none." }
  });
}

function buildDivergeTool(router: PlatformModelRouter | null): FunctionTool {
  return tool(DIVERGE_TOOL_NAME, "Fork lanes that each answer the same question independently and cannot see each other, then compare their answers. For judgment calls worth about three times the cost; at least one lane is always undirected. Must be your last tool call.", {
    question: { type: "string", description: "The question every lane answers, with what a full answer contains." },
    lanes: {
      type: "array",
      minItems: 1,
      items: strictObject({
        title: { type: "string", description: "A short name for this answer." },
        direction: { type: ["string", "null"], description: "An angle to take, or null to answer with no steer." },
        ...modelChoiceProperties(router)
      })
    }
  });
}

function buildCheckTool(router: PlatformModelRouter | null): FunctionTool {
  return tool(CHECK_TOOL_NAME, "Hand a deliverable to a fresh reviewer that sees the user's messages, the draft and its files, but none of your reasoning. Your turn ends; you resume with its findings.", {
    draft: { type: "string", description: "The reply or deliverable as you would send it." },
    files: { type: "array", items: { type: "string" }, description: "Paths of the deliverable's files." },
    focus: { type: ["string", "null"], description: "Anything the reviewer should look at first; null for none." },
    ...modelChoiceProperties(router)
  });
}

const STEER_TOOL = tool(STEER_TOOL_NAME, "Send a message to one of your running lanes. It arrives at the lane's next step.", {
  lane_id: laneIdProperty,
  message: { type: "string" }
});

const STOP_LANE_TOOL = tool(STOP_LANE_TOOL_NAME, "Stop one of your lanes and its sub-lanes. With discard false it submits what it has now; with discard true it is cancelled and its result dropped.", {
  lane_id: laneIdProperty,
  discard: { type: "boolean" }
});

const RESUME_TOOL = tool(RESUME_TOOL_NAME, "Continue one of your dormant lanes with its full context, for a follow-up on its part. Your turn ends; you resume with its new result.", {
  lane_id: laneIdProperty,
  message: { type: "string", description: "What the lane should do next." },
  extra_tokens: { type: ["integer", "null"], description: "Budget to add to the lane's share when budgets are on; otherwise null." }
});

const SHARE_TOOL = tool(SHARE_TOOL_NAME, "Lanes only. Share a short note with your sibling lanes: a finding, decision or warning that would change how they act. They see it at their next step.", {
  text: { type: "string", description: "One or two lines." }
});

const SUBMIT_TOOL = tool(SUBMIT_TOOL_NAME, "Lanes only. Finish your part and report to your parent. The parent reads the summary, not your reasoning.", {
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
});

export function buildSwarmFunctionTools(toolSet: SwarmToolSet, router: PlatformModelRouter | null = null): FunctionTool[] {
  if (toolSet === "check") return [SUBMIT_TOOL];
  return [buildSplitTool(router), buildDivergeTool(router), buildCheckTool(router), STEER_TOOL, STOP_LANE_TOOL, RESUME_TOOL, SHARE_TOOL, SUBMIT_TOOL];
}
