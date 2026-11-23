import { normalizeScratchPriority, type ScratchPriority } from "@meowbert/shared";
import { query } from "../../lib/db.js";

function projectNotFound(): Error {
  return Object.assign(new Error("Project not found"), { statusCode: 404 });
}

export async function getProjectScratchPriority(projectId: string): Promise<{ scratchPriority: ScratchPriority }> {
  const result = await query<{ scratch_priority: string }>("SELECT scratch_priority FROM environments WHERE id = $1", [projectId]);
  if (!result.rowCount) throw projectNotFound();
  return { scratchPriority: normalizeScratchPriority(result.rows[0].scratch_priority) };
}

export async function updateProjectScratchPriority(projectId: string, priority: ScratchPriority): Promise<{ scratchPriority: ScratchPriority }> {
  const result = await query("UPDATE environments SET scratch_priority = $2 WHERE id = $1", [projectId, priority]);
  if (!result.rowCount) throw projectNotFound();
  return { scratchPriority: priority };
}
