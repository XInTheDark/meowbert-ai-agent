import type { TaskMessage, UserProfile } from "../lib/types";

export function canSelectTaskModel(
  user: Pick<UserProfile, "byo_enabled" | "byo_provider" | "byo_forced_model"> | null | undefined
): boolean {
  if (user?.byo_enabled !== true) {
    return true;
  }

  return user.byo_provider === "chatgpt_oauth" && !user.byo_forced_model?.trim();
}

export function getTaskMessageAgentId(message: Pick<TaskMessage, "content_json">): string | null {
  const agent = message.content_json.agent;
  if (!agent || typeof agent !== "object" || Array.isArray(agent) || !("id" in agent) || typeof agent.id !== "string") {
    return null;
  }

  return agent.id.trim().toLowerCase() || null;
}
