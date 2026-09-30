import { z } from "zod";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM in UTC.");
const daysSchema = z.array(z.number().int().min(0).max(6)).min(1).max(7)
  .refine((days) => new Set(days).size === days.length, "Choose each weekday once.");
const windowSchema = z.object({
  start: timeSchema,
  end: z.union([timeSchema, z.literal("24:00")])
}).strict().refine((window) => window.start !== window.end, "Start and end must differ; use 00:00–24:00 for a full day.");

export const usageActivationRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("at"), days: daysSchema, time: timeSchema }).strict(),
  z.object({
    kind: z.literal("interval"), days: daysSchema,
    everyMinutes: z.number().int().min(1).max(1440),
    windows: z.array(windowSchema).min(1).max(12)
  }).strict()
]);

export const usageActivationInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  providerId: z.string().uuid(),
  model: z.string().trim().min(1).max(240),
  enabled: z.boolean(),
  rules: z.array(usageActivationRuleSchema).min(1).max(20)
}).strict();

export type UsageActivationRule = z.infer<typeof usageActivationRuleSchema>;
export type UsageActivationInput = z.infer<typeof usageActivationInputSchema>;
export type UsageActivationStatus = "running" | "succeeded" | "failed" | "skipped" | "interrupted";
export interface UsageActivationSchedule extends Omit<UsageActivationInput, "providerId"> {
  id: string;
  providerId: string | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastFinishedAt: string | null;
  lastStatus: UsageActivationStatus | null;
  lastError: string | null;
}

const MINUTE_MS = 60_000;
const DAY_MS = 1440 * MINUTE_MS;
function minutes(time: string): number {
  const [hour, minute] = time.split(":").map(Number);
  return hour * 60 + minute;
}

function nextRuleTime(rule: UsageActivationRule, day: number, after: number): number {
  if (rule.kind === "at") {
    const candidate = day + minutes(rule.time) * MINUTE_MS;
    return candidate > after ? candidate : Infinity;
  }
  let next = Infinity;
  for (const window of rule.windows) {
    const startMinute = minutes(window.start);
    let endMinute = minutes(window.end);
    if (endMinute < startMinute) endMinute += 1440;
    const start = day + startMinute * MINUTE_MS;
    const end = day + endMinute * MINUTE_MS;
    const interval = rule.everyMinutes * MINUTE_MS;
    const step = Math.max(0, Math.floor((after - start) / interval) + 1);
    const candidate = start + step * interval;
    if (candidate < end) next = Math.min(next, candidate);
  }
  return next;
}

/** Strictly after the given instant. Overnight windows belong to their starting weekday. */
export function nextUsageActivationAt(rules: UsageActivationRule[], after: Date): Date {
  const timestamp = after.getTime();
  if (!Number.isFinite(timestamp)) throw new Error("Invalid schedule date.");
  const midnight = Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate());
  let next = Infinity;
  for (let offset = -1; offset <= 7; offset++) {
    const day = midnight + offset * DAY_MS;
    const weekday = new Date(day).getUTCDay();
    for (const rule of rules) {
      if (rule.days.includes(weekday)) next = Math.min(next, nextRuleTime(rule, day, timestamp));
    }
  }
  if (!Number.isFinite(next)) throw new Error("Schedule has no upcoming occurrence.");
  return new Date(next);
}
