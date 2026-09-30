import { isSkillEnabledByConfig } from "@meowbert/shared";
import { config } from "../../../lib/config.js";

export interface TaskMessageToolOptions {
  webSearch?: boolean;
  memorySearch?: boolean;
  scheduleTask?: boolean;
  subtasks?: boolean;
  computerUse?: boolean;
  enabledSkills?: string[];
  enabledSources?: string[];
}

export interface TaskMessageAgentSelection {
  id?: string;
}

export interface TaskMessageAttachment {
  id?: string;
  kind: "note" | "file" | "directory" | "canvas";
  label: string;
  content: string;
  relativePath?: string;
  sizeBytes?: number | null;
  forceInclude?: boolean;
}

export interface TaskPrefaceMessage {
  role: "system";
  content: Record<string, unknown>;
}

export function normalizeTaskMessageToolOptions(
  input: TaskMessageToolOptions | null | undefined
): TaskMessageToolOptions | undefined {
  if (!input) {
    return undefined;
  }

  const normalized: TaskMessageToolOptions = {};

  if (input.webSearch === true) {
    normalized.webSearch = true;
  }

  if (input.memorySearch === true) {
    normalized.memorySearch = true;
  }

  if (input.scheduleTask === true) {
    normalized.scheduleTask = true;
  }

  if (input.subtasks === true) {
    normalized.subtasks = true;
  }

  if (input.computerUse === true) {
    normalized.computerUse = true;
  }

  if (Array.isArray(input.enabledSkills)) {
    const enabledSkills = input.enabledSkills
      .filter((skill): skill is string => typeof skill === "string")
      .map((skill) => skill.trim())
      .filter((skill) => skill.length > 0)
      .filter((skill) => isSkillEnabledByConfig(config, skill));
    if (enabledSkills.length > 0) {
      normalized.enabledSkills = Array.from(new Set(enabledSkills));
    }
  }

  if (Array.isArray(input.enabledSources)) {
    const enabledSources = input.enabledSources
      .filter((source): source is string => typeof source === "string")
      .map((source) => source.trim())
      .filter((source) => source.length > 0);
    if (enabledSources.length > 0) {
      normalized.enabledSources = Array.from(new Set(enabledSources));
    }
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export function normalizeTaskMessageAgentSelection(
  input: TaskMessageAgentSelection | null | undefined
): { id: string } | undefined {
  const rawId = input?.id;
  if (typeof rawId !== "string") {
    return undefined;
  }

  const id = rawId.trim().toLowerCase();
  if (!id) {
    return undefined;
  }

  return { id };
}

export function normalizeTaskMessageAttachments(
  input: TaskMessageAttachment[] | null | undefined
): TaskMessageAttachment[] | undefined {
  if (!Array.isArray(input)) {
    return undefined;
  }

  const normalized: TaskMessageAttachment[] = [];

  for (const attachment of input) {
    if (
      !attachment
      || (attachment.kind !== "note" && attachment.kind !== "file" && attachment.kind !== "directory" && attachment.kind !== "canvas")
      || typeof attachment.label !== "string"
      || attachment.label.trim().length === 0
      || typeof attachment.content !== "string"
      || attachment.content.trim().length === 0
    ) {
      continue;
    }

    const next: TaskMessageAttachment = {
      kind: attachment.kind,
      label: attachment.label.trim(),
      content: attachment.content
    };

    if (typeof attachment.id === "string" && attachment.id.trim().length > 0) {
      next.id = attachment.id.trim();
    }
    if (typeof attachment.relativePath === "string" && attachment.relativePath.trim().length > 0) {
      next.relativePath = attachment.relativePath.trim();
    }
    if (typeof attachment.sizeBytes === "number" && Number.isFinite(attachment.sizeBytes)) {
      next.sizeBytes = attachment.sizeBytes;
    } else if (attachment.sizeBytes === null) {
      next.sizeBytes = null;
    }
    if (attachment.forceInclude === true) {
      next.forceInclude = true;
    }

    normalized.push(next);
  }

  return normalized.length > 0 ? normalized : undefined;
}

// Messages written by a Project Master on the user's behalf carry this sender.
export type TaskMessageSender = "project_master";

export function buildUserMessageContent(input: {
  message: string;
  sender?: TaskMessageSender;
  tools?: TaskMessageToolOptions | null;
  agent?: TaskMessageAgentSelection | null;
  attachments?: TaskMessageAttachment[] | null;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    text: input.message
  };

  if (input.sender) {
    payload.sender = input.sender;
  }

  const normalizedTools = normalizeTaskMessageToolOptions(input.tools);
  if (normalizedTools) {
    payload.tools = normalizedTools;
  }

  const normalizedAgent = normalizeTaskMessageAgentSelection(input.agent);
  if (normalizedAgent) {
    payload.agent = normalizedAgent;
  }

  const normalizedAttachments = normalizeTaskMessageAttachments(input.attachments);
  if (normalizedAttachments) {
    payload.attachments = normalizedAttachments;
  }

  return payload;
}
