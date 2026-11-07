import { assertFolderInProject, ProjectMapError, type ProjectMapDb } from "./project-map-db.js";
import {
  PROJECT_MAP_CARD_BODY_MAX_CHARS,
  PROJECT_MAP_CARD_STATES,
  PROJECT_MAP_CARD_TITLE_MAX_CHARS,
  type ProjectMapCardState
} from "./project-map.js";

function requireTitle(title: string): string {
  const trimmed = title.trim();
  if (!trimmed) throw new ProjectMapError("Card title cannot be empty.");
  if (trimmed.length > PROJECT_MAP_CARD_TITLE_MAX_CHARS) throw new ProjectMapError(`Card title is longer than ${PROJECT_MAP_CARD_TITLE_MAX_CHARS} characters.`);
  return trimmed;
}

function requireBody(body: string): string {
  if (body.length > PROJECT_MAP_CARD_BODY_MAX_CHARS) throw new ProjectMapError(`Card text is longer than ${PROJECT_MAP_CARD_BODY_MAX_CHARS} characters.`);
  return body;
}

function requireState(state: string): ProjectMapCardState {
  if (!(PROJECT_MAP_CARD_STATES as readonly string[]).includes(state)) throw new ProjectMapError(`Unknown card state: ${state}`);
  return state as ProjectMapCardState;
}

export async function createProjectMapCard(db: ProjectMapDb, input: {
  workspaceId: string;
  environmentId: string;
  folderId: string | null;
  title: string;
  body: string;
  state: string;
}): Promise<string> {
  await assertFolderInProject(db, input.environmentId, input.folderId);
  const result = await db.query<{ id: string }>(
    `INSERT INTO project_map_cards (workspace_id, environment_id, folder_id, title, body, state, sort_order)
     VALUES ($1, $2, $3, $4, $5, $6, (
       SELECT COALESCE(MAX(sort_order), -1) + 1 FROM project_map_cards
        WHERE environment_id = $2 AND folder_id IS NOT DISTINCT FROM $3::uuid
     ))
     RETURNING id`,
    [input.workspaceId, input.environmentId, input.folderId, requireTitle(input.title), requireBody(input.body), requireState(input.state)]
  );
  return result.rows[0].id;
}

// Null fields keep their current value.
export async function updateProjectMapCard(db: ProjectMapDb, environmentId: string, cardId: string, changes: {
  title: string | null;
  body: string | null;
  state: string | null;
}): Promise<void> {
  const result = await db.query(
    `UPDATE project_map_cards
        SET title = COALESCE($3, title), body = COALESCE($4, body), state = COALESCE($5, state), updated_at = now()
      WHERE id = $1 AND environment_id = $2`,
    [
      cardId, environmentId,
      changes.title === null ? null : requireTitle(changes.title),
      changes.body === null ? null : requireBody(changes.body),
      changes.state === null ? null : requireState(changes.state)
    ]
  );
  if (!result.rowCount) throw new ProjectMapError(`Card not found in this project: ${cardId}`, 404);
}

export async function deleteProjectMapCard(db: ProjectMapDb, environmentId: string, cardId: string): Promise<void> {
  const result = await db.query("DELETE FROM project_map_cards WHERE id = $1 AND environment_id = $2", [cardId, environmentId]);
  if (!result.rowCount) throw new ProjectMapError(`Card not found in this project: ${cardId}`, 404);
}
