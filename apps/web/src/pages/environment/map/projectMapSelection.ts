import type { ProjectMap, ProjectMapCard, ProjectMapFolder, ProjectMapTask } from "@meowbert/shared/project-map";
import type { TaskAttachment } from "../../../lib/types";

const STATUS_LABELS: Record<string, string> = {
  queued: "queued", starting: "starting", running: "running", awaiting_input: "needs input",
  succeeded: "done", failed: "failed", cancelled: "cancelled"
};

function taskLine(task: ProjectMapTask, indent = ""): string {
  return `${indent}- Task "${task.title ?? "Untitled task"}" [${task.id}]: ${STATUS_LABELS[task.status] ?? task.status}`;
}

function cardLine(card: ProjectMapCard, indent = ""): string {
  const body = card.body.trim() ? `\n${indent}  ${card.body.trim().replace(/\n/g, `\n${indent}  `)}` : "";
  return `${indent}- Card "${card.title}" [${card.id}]: ${card.state}${body}`;
}

function folderBlock(map: ProjectMap, folder: ProjectMapFolder): string[] {
  const lines = [`Folder "${folder.name}" [${folder.id}]`];
  if (folder.note.trim()) lines.push("Note:", folder.note.trim());
  const subfolders = map.folders.filter((item) => item.parentFolderId === folder.id);
  const cards = map.cards.filter((item) => item.folderId === folder.id);
  const tasks = map.tasks.filter((item) => item.folderId === folder.id);
  if (subfolders.length) lines.push(...subfolders.map((item) => `- Subfolder "${item.name}" [${item.id}]`));
  lines.push(...cards.map((card) => cardLine(card)), ...tasks.map((task) => taskLine(task)));
  return lines;
}

function selectionLabel(map: ProjectMap, ids: string[]): string {
  if (ids.length > 1) return `Map: ${ids.length} items`;
  const id = ids[0];
  const name = map.folders.find((item) => item.id === id)?.name
    ?? map.cards.find((item) => item.id === id)?.title
    ?? map.tasks.find((item) => item.id === id)?.title
    ?? "Untitled task";
  return `Map: ${name}`;
}

// The selected part of the map as a note attachment, so the Master reads it with the message.
export function buildProjectMapAttachment(map: ProjectMap, selectedIds: string[]): TaskAttachment | null {
  const blocks: string[][] = [];
  for (const id of selectedIds) {
    const folder = map.folders.find((item) => item.id === id);
    const card = map.cards.find((item) => item.id === id);
    const task = map.tasks.find((item) => item.id === id);
    if (folder) blocks.push(folderBlock(map, folder));
    else if (card) blocks.push([cardLine(card)]);
    else if (task) blocks.push([taskLine(task)]);
  }
  if (!blocks.length) return null;
  return {
    id: crypto.randomUUID(),
    kind: "note",
    label: selectionLabel(map, selectedIds),
    content: ["Selected on the project map:", ...blocks.map((block) => block.join("\n"))].join("\n\n")
  };
}
