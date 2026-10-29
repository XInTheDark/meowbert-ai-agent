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
    "Show the user where you are in a longer task. Call it once you see the shape of the work, then again when a step finishes or your plan changes; skip it for quick tasks.",
    "Send it alongside your other tool calls, not on its own. Each call replaces the whole list, so add, drop or reword steps whenever the work changes."
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
