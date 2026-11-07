import {
  buildProjectMapRollups,
  projectMapStatusGroup,
  type ProjectMap,
  type ProjectMapFolder,
  type ProjectMapRollup
} from "@meowbert/shared";

const SHORT_NOTE_CHARS = 240;
const UNFILED_TASK_LIMIT = 25;

const STATUS_LABELS: Record<string, string> = {
  queued: "queued", starting: "starting", running: "running", awaiting_input: "needs input",
  succeeded: "done", failed: "failed", cancelled: "cancelled"
};

function shorten(text: string, limit: number): string {
  const flat = text.trim().replace(/\s+/g, " ");
  return flat.length > limit ? `${flat.slice(0, limit)}...` : flat;
}

function formatRollup(rollup: ProjectMapRollup | undefined): string {
  if (!rollup) return "";
  const parts = [
    rollup.active ? `${rollup.active} active` : "",
    rollup.needs_input ? `${rollup.needs_input} need input` : "",
    rollup.failed ? `${rollup.failed} failed` : "",
    rollup.done ? `${rollup.done} done` : ""
  ].filter(Boolean);
  return parts.length ? ` (${parts.join(", ")})` : "";
}

function indentNote(note: string, indent: string, full: boolean): string[] {
  if (!note.trim()) return [];
  if (!full) return [`${indent}  Note: ${shorten(note, SHORT_NOTE_CHARS)}`];
  return [`${indent}  Note:`, ...note.trim().split("\n").map((line) => `${indent}    ${line}`)];
}

function renderFolder(map: ProjectMap, folder: ProjectMapFolder, depth: number, fullNotes: boolean, rollups: Map<string, ProjectMapRollup>): string[] {
  const indent = "  ".repeat(depth);
  const lines = [`${indent}- Folder "${folder.name}" [${folder.id}]${formatRollup(rollups.get(folder.id))}`, ...indentNote(folder.note, indent, fullNotes)];
  for (const card of map.cards.filter((item) => item.folderId === folder.id)) {
    lines.push(`${indent}  - Card "${card.title}" [${card.id}] ${card.state}${card.body.trim() ? `: ${shorten(card.body, SHORT_NOTE_CHARS)}` : ""}`);
  }
  for (const task of map.tasks.filter((item) => item.folderId === folder.id)) {
    lines.push(`${indent}  - Task "${task.title ?? "Untitled task"}" [${task.id}] ${STATUS_LABELS[task.status] ?? task.status}`);
  }
  for (const child of map.folders.filter((item) => item.parentFolderId === folder.id)) {
    lines.push(...renderFolder(map, child, depth + 1, fullNotes, rollups));
  }
  return lines;
}

function renderTopLevel(map: ProjectMap, rollups: Map<string, ProjectMapRollup>): string[] {
  const lines = ["Project brief:", map.brief.trim() || "(empty)", "", "Map:"];
  const topFolders = map.folders.filter((folder) => !folder.parentFolderId);
  const topCards = map.cards.filter((card) => !card.folderId);
  if (!topFolders.length && !topCards.length) lines.push("(no folders or cards yet)");
  for (const folder of topFolders) lines.push(...renderFolder(map, folder, 0, false, rollups));
  for (const card of topCards) lines.push(`- Card "${card.title}" [${card.id}] ${card.state}`);
  const unfiled = map.tasks.filter((task) => !task.folderId);
  if (unfiled.length) {
    const waiting = unfiled.filter((task) => projectMapStatusGroup(task.status) !== "done").length;
    lines.push("", `Unfiled tasks: ${unfiled.length}, ${waiting} not finished. Newest first:`);
    for (const task of unfiled.slice(0, UNFILED_TASK_LIMIT)) {
      lines.push(`- Task "${task.title ?? "Untitled task"}" [${task.id}] ${STATUS_LABELS[task.status] ?? task.status}`);
    }
  }
  if (map.tasksTruncated) lines.push("", "Only the most recently updated tasks are shown; use query_tasks for older ones.");
  return lines;
}

// The map as the Master reads it: one line per item, with IDs it can pass back to update_project_map.
export function renderProjectMapForMaster(map: ProjectMap, folderId: string | null): string {
  const rollups = buildProjectMapRollups(map);
  if (!folderId) return renderTopLevel(map, rollups).join("\n");
  const folder = map.folders.find((item) => item.id === folderId);
  if (!folder) throw new Error(`Folder not found in this project: ${folderId}`);
  return renderFolder(map, folder, 0, true, rollups).join("\n");
}
