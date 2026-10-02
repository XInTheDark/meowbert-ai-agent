import {
  TASK_CLEANUP_EXPIRATION_DAYS_MAX,
  TASK_CLEANUP_EXPIRATION_DAYS_MIN
} from "@meowbert/shared";
import { z } from "zod";
import { createTaskHistorySearchQuerySchema } from "@meowbert/shared/task-history-search";

export const workspaceParams = z.object({
  wsId: z.string().uuid()
});

export const environmentParams = z.object({
  envId: z.string().uuid()
});

export const workspaceEnvironmentCollectionPaths = [
  "/api/workspaces/:wsId/projects",
  "/api/workspaces/:wsId/environments"
] as const;

export const environmentEntityPaths = [
  "/api/projects/:envId",
  "/api/environments/:envId"
] as const;

export const environmentTaskListQuery = createTaskHistorySearchQuerySchema();

export const environmentTaskCancelBody = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(500).optional()
});

export const environmentTaskCleanupBody = z.object({
  expirationDays: z
    .number()
    .int()
    .min(TASK_CLEANUP_EXPIRATION_DAYS_MIN)
    .max(TASK_CLEANUP_EXPIRATION_DAYS_MAX)
    .nullable()
    .optional(),
  limit: z.number().int().min(1).max(500).optional()
});

export const jsonObjectSchema = z
  .unknown()
  .refine((value) => typeof value === "object" && value !== null && !Array.isArray(value), "Expected a JSON object")
  .transform((value) => value as Record<string, unknown>);

export const environmentCleanupQuery = z.object({
  targetPercent: z.coerce.number().min(1).max(100).default(50),
  modifiedAfter: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  modifiedBefore: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  minSizeBytes: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  maxSizeBytes: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
});
