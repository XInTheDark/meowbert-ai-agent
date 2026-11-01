import type { TaskHistoryArchiveDocument } from "./task-history-archive.js";

export const ARCHIVE_SECTIONS = {
  messages: ["messages"], events: ["events"], message_revisions: ["message_revisions"],
  context_history: ["context", "history"], context_notes: ["context", "notes"],
  window_prompts: ["context", "windowPrompts"], window_requests: ["context", "windowRequests"],
  subagent_sessions: ["subagents", "sessions"], subagent_mail: ["subagents", "mail"],
  subagent_waits: ["subagents", "waits"], swarm_fork_seeds: ["swarm", "fork_seeds"],
  swarm_notes: ["swarm", "notes"], swarm_lane_results: ["swarm", "lane_results"],
  media: ["media"], conversation_snapshots: ["conversation_snapshots"]
} as const;
export type TaskArchiveSection = keyof typeof ARCHIVE_SECTIONS;
export type ArchivePayload = Record<string, unknown>;
export interface TaskArchiveReference { kind: TaskArchiveSection; payload_id: string; archive_key: string }
export interface TaskArchiveChunk { key: string; ids: string[]; bytes: number }
export interface TaskArchiveManifest {
  version: 2; task: TaskHistoryArchiveDocument["task"]; sections: Partial<Record<TaskArchiveSection, TaskArchiveChunk[]>>;
}

export function archivePayloadId(kind: TaskArchiveSection, item: ArchivePayload): string {
  const id = kind === "media" ? item.sha256 : kind === "swarm_notes" ? item.seq
    : kind === "subagent_sessions" || kind === "subagent_waits" || kind === "swarm_lane_results" ? item.task_id : item.id;
  if (typeof id !== "string" || !id) throw new Error(`Invalid ${kind} archive payload identity.`);
  return id;
}

export function archiveSection(document: TaskHistoryArchiveDocument, kind: TaskArchiveSection): ArchivePayload[] {
  let value: unknown = document;
  for (const key of ARCHIVE_SECTIONS[kind]) value = (value as ArchivePayload | undefined)?.[key];
  return Array.isArray(value) ? value as ArchivePayload[] : [];
}

export function documentFromSections(manifest: TaskArchiveManifest, sections: Partial<Record<TaskArchiveSection, ArchivePayload[]>>): TaskHistoryArchiveDocument {
  const document: ArchivePayload = { version: 2, task: manifest.task, messages: [], events: [], message_revisions: [],
    context: { history: [], notes: [], windowPrompts: [], windowRequests: [] },
    subagents: { sessions: [], mail: [], waits: [] }, swarm: { fork_seeds: [], notes: [], lane_results: [] } };
  for (const [kind, items] of Object.entries(sections)) {
    const keys = ARCHIVE_SECTIONS[kind as TaskArchiveSection];
    if (keys.length === 1) document[keys[0]] = items;
    else {
      const group = (document[keys[0]] ??= {}) as ArchivePayload;
      group[keys[1]] = items;
    }
  }
  return document as unknown as TaskHistoryArchiveDocument;
}
