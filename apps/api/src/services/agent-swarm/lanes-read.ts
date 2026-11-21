import {
  normalizeAgentSwarmSettings,
  normalizeReviewEffort,
  type AgentSwarmLaneView,
  type AgentSwarmNoteView,
  type AgentSwarmView
} from "@meowbert/shared";
import { query } from "../../lib/db.js";

const MAX_NOTES_PER_PAGE = 200;

interface LaneRow {
  task_id: string;
  parent_task_id: string;
  fork_seed_id: string | null;
  depth: number;
  kind: AgentSwarmLaneView["kind"];
  title: string;
  direction: string | null;
  review_effort: unknown;
  status: AgentSwarmLaneView["status"];
  model: string | null;
  steps: number;
  spent_tokens: string;
  check_findings: number;
  summary: string | null;
  latest_note: string | null;
  user_turns_since_merge: number | null;
  merged_at: string | null;
  created_at: string;
  started_at: string | null;
  ended_at: string | null;
}

// Mirrors the runtime's dormancy rule, which is counted from the conversation rather than stored.
function isResumable(row: LaneRow, dormantLaneTurns: number): boolean {
  return ["done", "failed"].includes(row.status) && row.kind !== "check" && row.merged_at !== null && dormantLaneTurns > 0
    && (row.user_turns_since_merge ?? 0) <= dormantLaneTurns;
}

function toLaneView(row: LaneRow, dormantLaneTurns: number): AgentSwarmLaneView {
  return {
    id: row.task_id,
    parentId: row.parent_task_id,
    groupId: row.fork_seed_id,
    depth: row.depth,
    kind: row.kind,
    title: row.title,
    direction: row.direction,
    reviewEffort: row.kind === "check" ? normalizeReviewEffort(row.review_effort) : null,
    status: row.status,
    model: row.model,
    steps: row.steps,
    spentTokens: Number(row.spent_tokens),
    checkFindings: row.check_findings,
    summary: row.summary,
    latestNote: row.latest_note,
    resumable: isResumable(row, dormantLaneTurns),
    createdAt: row.created_at,
    startedAt: row.started_at,
    endedAt: row.ended_at
  };
}

// The swarm's lane tree with each lane's latest note, or null when the task is not a lane swarm. A lane
// on a picked model shows that model; the rest show the model they were forked on.
export async function loadAgentSwarmView(swarmTaskId: string): Promise<AgentSwarmView | null> {
  const swarm = await query<{ config_json: unknown; token_budget: string | null; spent_tokens: string; deadline_at: string | null }>(
    "SELECT config_json, token_budget, spent_tokens, deadline_at FROM task_swarms WHERE task_id = $1",
    [swarmTaskId]
  );
  const row = swarm.rows[0];
  if (!row) return null;
  const lanes = await query<LaneRow>(
    `SELECT lane.task_id, lane.parent_task_id, lane.fork_seed_id, lane.depth, lane.kind, lane.title, lane.direction, lane.status,
            COALESCE(lane.model_route_json ->> 'modelId', seed.capabilities_json -> 'runtime' ->> 'model') AS model,
            seed.capabilities_json ->> 'checkReviewEffort' AS review_effort,
            lane.steps, lane.spent_tokens::text AS spent_tokens, lane.check_findings,
            lane.result_json ->> 'summary' AS summary,
            (SELECT note.content FROM task_swarm_notes note
              WHERE note.author_task_id = lane.task_id ORDER BY note.seq DESC LIMIT 1) AS latest_note,
            (SELECT COUNT(*)::int FROM task_messages message
              WHERE message.task_id = lane.swarm_task_id AND message.role = 'user' AND message.created_at > lane.merged_at) AS user_turns_since_merge,
            lane.merged_at, lane.created_at, lane.started_at, lane.ended_at
       FROM task_swarm_lanes lane
       LEFT JOIN task_swarm_fork_seeds seed ON seed.id = lane.fork_seed_id
      WHERE lane.swarm_task_id = $1
      ORDER BY lane.depth, lane.created_at, lane.task_id`,
    [swarmTaskId]
  );
  const settings = normalizeAgentSwarmSettings(row.config_json);
  return {
    budgetsEnabled: settings.budgetsEnabled,
    tokenBudget: row.token_budget === null ? null : Number(row.token_budget),
    spentTokens: Number(row.spent_tokens),
    deadlineAt: row.deadline_at,
    dormantLaneTurns: settings.advanced.dormantLaneTurns,
    lanes: lanes.rows.map((lane) => toLaneView(lane, settings.advanced.dormantLaneTurns))
  };
}

interface NoteRow {
  seq: string;
  author_task_id: string;
  title: string | null;
  kind: "shared" | "auto";
  content: string;
  created_at: string;
  notify_siblings: boolean;
  notify_parent: "none" | "inbox" | "wake";
}

export interface LoadAgentSwarmNotesOptions {
  afterSeq?: string | null;
  beforeSeq?: string | null;
  kind?: "shared" | "auto" | null;
  laneId?: string | null;
  countLaneId?: string | null;
}

export interface AgentSwarmNotesPage {
  notes: AgentSwarmNoteView[];
  hasOlder: boolean;
  totalCount: number;
  laneCount?: number;
}

function toNoteView(note: NoteRow): AgentSwarmNoteView {
  return {
    seq: note.seq,
    laneId: note.author_task_id,
    laneTitle: note.title ?? "Leader",
    kind: note.kind,
    content: note.content,
    createdAt: note.created_at,
    notifySiblings: note.notify_siblings,
    notifyParent: note.notify_parent
  };
}

// Defaults to the most recent page in chronological order; `beforeSeq` walks backward and `afterSeq` catches up forward.
export async function loadAgentSwarmNotes(
  swarmTaskId: string,
  options: LoadAgentSwarmNotesOptions = {}
): Promise<AgentSwarmNotesPage> {
  const kind = options.kind ?? null;
  const laneId = options.laneId ?? null;
  const countLaneId = options.countLaneId ?? laneId;
  const isForward = Boolean(options.afterSeq);

  const [rowsRes, countsRes] = await Promise.all([
    isForward
      ? query<NoteRow>(
          `SELECT note.seq::text AS seq, note.author_task_id, lane.title, note.kind, note.content, note.created_at,
                  note.notify_siblings, note.notify_parent
             FROM task_swarm_notes note
             LEFT JOIN task_swarm_lanes lane ON lane.task_id = note.author_task_id
            WHERE note.swarm_task_id = $1
              AND note.seq > $2::bigint
              AND ($3::text IS NULL OR note.kind = $3)
              AND ($4::uuid IS NULL OR note.author_task_id = $4)
            ORDER BY note.seq ASC
            LIMIT $5`,
          [swarmTaskId, options.afterSeq, kind, laneId, MAX_NOTES_PER_PAGE]
        )
      : query<NoteRow>(
          `SELECT note.seq::text AS seq, note.author_task_id, lane.title, note.kind, note.content, note.created_at,
                  note.notify_siblings, note.notify_parent
             FROM task_swarm_notes note
             LEFT JOIN task_swarm_lanes lane ON lane.task_id = note.author_task_id
            WHERE note.swarm_task_id = $1
              AND ($2::bigint IS NULL OR note.seq < $2::bigint)
              AND ($3::text IS NULL OR note.kind = $3)
              AND ($4::uuid IS NULL OR note.author_task_id = $4)
            ORDER BY note.seq DESC
            LIMIT $5`,
          [swarmTaskId, options.beforeSeq ?? null, kind, laneId, MAX_NOTES_PER_PAGE + 1]
        ),
    query<{ total_count: number; lane_count: number }>(
      `SELECT COUNT(*)::int AS total_count,
              COUNT(*) FILTER (WHERE $3::uuid IS NOT NULL AND author_task_id = $3::uuid)::int AS lane_count
         FROM task_swarm_notes
        WHERE swarm_task_id = $1
          AND ($2::text IS NULL OR kind = $2)`,
      [swarmTaskId, kind, countLaneId]
    )
  ]);

  const hasOlder = !isForward && rowsRes.rows.length > MAX_NOTES_PER_PAGE;
  const orderedRows = isForward
    ? rowsRes.rows
    : rowsRes.rows.slice(0, MAX_NOTES_PER_PAGE).reverse();
  const counts = countsRes.rows[0];
  return {
    notes: orderedRows.map(toNoteView),
    hasOlder,
    totalCount: counts?.total_count ?? orderedRows.length,
    ...(countLaneId ? { laneCount: counts?.lane_count ?? 0 } : {})
  };
}
