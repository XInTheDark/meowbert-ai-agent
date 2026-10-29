import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import { TASK_PROGRESS_MAX_STEPS } from "@meowbert/shared";

export const UPDATE_PROGRESS_TOOL_NAME = "update_progress";

export const updateProgressArgumentsSchema = z.object({
  goal: z.string().nullable(),
  steps: z.array(z.object({
    title: z.string(),
    status: z.enum(["done", "active", "pending"])
  }).strict()).max(TASK_PROGRESS_MAX_STEPS)
}).strict();

// Called beside other tool calls, so keeping the user informed costs no turn of its own.
export const UPDATE_PROGRESS_TOOL: FunctionTool = {
  type: "function",
  name: UPDATE_PROGRESS_TOOL_NAME,
  description: [
    "Show the user your plan for a task that takes more than a few tool calls: a goal and its steps.",
    "Call it only when the plan changes: once you see the shape of the work, then when a step finishes or you add, drop or reword steps. What each call is doing belongs in that call's summary, not here.",
    "Always send it in parallel with your other tool calls in the same turn. Each call replaces the whole list."
  ].join(" "),
  strict: true,
  parameters: {
    type: "object",
    properties: {
      goal: {
        type: ["string", "null"],
        description: "What you are working on, in a few words, e.g. \"Building the forum-writing handout\". Use null to keep the current one."
      },
      steps: {
        type: "array",
        description: "The steps as you see them now, in order.",
        maxItems: TASK_PROGRESS_MAX_STEPS,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "A short phrase, e.g. \"Read the style guide\"." },
            status: { type: "string", enum: ["done", "active", "pending"] }
          },
          required: ["title", "status"],
          additionalProperties: false
        }
      }
    },
    required: ["goal", "steps"],
    additionalProperties: false
  }
};
