import { z } from "zod";
import type { FunctionTool } from "openai/resources/responses/responses";

export const PROJECT_MASTER_TOOL_NAMES = ["create_task", "message_task", "cancel_task", "listen_to_tasks"] as const;

export const createTaskSchema = z.object({
  message: z.string().trim().min(1),
  title: z.string().trim().min(1).max(240).nullable().optional(),
  repeat: z.string().trim().min(1).nullable().optional(),
  timezone: z.string().trim().min(1).nullable().optional(),
  listen: z.boolean().nullable().optional()
});
export const messageTaskSchema = z.object({
  task_id: z.string().uuid(),
  message: z.string().trim().min(1),
  listen: z.boolean().nullable().optional()
});
export const cancelTaskSchema = z.object({ task_id: z.string().uuid() });
export const listenToTasksSchema = z.object({
  task_ids: z.array(z.string().uuid()).min(1).max(50),
  listen: z.boolean()
});

const taskId = { type: "string", description: "Task ID from query_tasks or create_task." } as const;
const listen = {
  type: ["boolean", "null"],
  description: "Whether its next result is reported back to you. Null means true."
} as const;

function tool(name: string, description: string, properties: Record<string, unknown>): FunctionTool {
  return { type: "function", name, description, strict: true,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false } };
}

export const PROJECT_MASTER_FUNCTION_TOOLS: FunctionTool[] = [
  tool("create_task", "Start a new task in this project. It runs on its own, just like a task the user started, and the user can open it from the task list. With repeat set it is a recurring task: it runs once right away, then again on the schedule.", {
    message: { type: "string", description: "Self-contained brief. The task does not see your conversation." },
    title: { type: ["string", "null"], description: "Short task title, or null to generate one." },
    repeat: { type: ["string", "null"], description: "5-field cron expression (minute hour day month weekday) for a recurring task, or null for a one-off task." },
    timezone: { type: ["string", "null"], description: "IANA timezone the cron is read in, or null for this project's default. Only used with repeat." },
    listen
  }),
  tool("message_task", "Send a follow-up message to an existing task in this project. An idle task starts a new run; a running task picks it up at its next step.", {
    task_id: taskId,
    message: { type: "string" },
    listen
  }),
  tool("cancel_task", "Stop a task in this project that is queued or running.", { task_id: taskId }),
  tool("listen_to_tasks", "Turn result reports on or off for existing tasks in this project.", {
    task_ids: { type: "array", items: { type: "string" }, description: "Task IDs to update." },
    listen: { type: "boolean" }
  })
];
