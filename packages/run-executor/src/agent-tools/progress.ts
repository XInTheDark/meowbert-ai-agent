import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";
import { TASK_PROGRESS_MAX_STEPS } from "@meowbert/shared";

export const UPDATE_PROGRESS_TOOL_NAME = "update_progress";

export const updateProgressArgumentsSchema = z.object({
  goal: z.string().nullable(),
  status: z.string().nullable(),
  steps: z.array(z.object({
    title: z.string(),
    status: z.enum(["done", "active", "pending"]),
    note: z.string().nullable()
  }).strict()).max(TASK_PROGRESS_MAX_STEPS).nullable()
}).strict();

// Called beside other tool calls, so keeping the user informed costs no turn of its own.
export const UPDATE_PROGRESS_TOOL: FunctionTool = {
  type: "function",
  name: UPDATE_PROGRESS_TOOL_NAME,
  description: [
    "Show the user your plan for a task that takes more than a few tool calls: the goal, where things stand overall, and the steps.",
    "The plan stays with the task across turns. Call this when something changes: you see the shape of the work, a step finishes, the plan shifts, or a finding or blocker changes where things stand. Null keeps what the plan already has, so send only what changed.",
    "A new goal starts a new plan; send its status and steps with it.",
    "Call it with every field null to see the current plan, for example when picking up earlier work.",
    "Send it in parallel with your other tool calls in the same turn."
  ].join(" "),
  strict: true,
  parameters: {
    type: "object",
    properties: {
      goal: {
        type: ["string", "null"],
        description: "What you are working on, in a few words, e.g. \"Building the forum-writing handout\". Null keeps the current one."
      },
      status: {
        type: ["string", "null"],
        description: "Where the work stands overall, in one to three short paragraphs: what is done, what you are doing now and why, and anything the user should know. Null keeps the current one."
      },
      steps: {
        type: ["array", "null"],
        description: "The whole step list as you see it now, in order. Null keeps the current list.",
        maxItems: TASK_PROGRESS_MAX_STEPS,
        items: {
          type: "object",
          properties: {
            title: { type: "string", description: "A short phrase, e.g. \"Read the style guide\"." },
            status: { type: "string", enum: ["done", "active", "pending"] },
            note: {
              type: ["string", "null"],
              description: "A few sentences on this step: what you found, did or still need. Null keeps the step's current note."
            }
          },
          required: ["title", "status", "note"],
          additionalProperties: false
        }
      }
    },
    required: ["goal", "status", "steps"],
    additionalProperties: false
  }
};
