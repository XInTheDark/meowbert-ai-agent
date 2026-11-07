import {
  createProjectFolder,
  createProjectMapCard,
  deleteProjectFolder,
  deleteProjectMapCard,
  moveProjectMapItems,
  ProjectMapError,
  renameProjectFolder,
  setProjectBrief,
  setProjectFolderNote,
  updateProjectMapCard,
  type ProjectMapDb
} from "@meowbert/shared";
import type { ProjectMapOperation } from "@meowbert/run-executor/agent-tools/project-map";

export interface ProjectMapScope {
  workspaceId: string;
  environmentId: string;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Turns IDs and refs from earlier operations in the same call into IDs.
class RefResolver {
  private readonly refs = new Map<string, string>();

  remember(ref: string | null, id: string): void {
    if (ref) this.refs.set(ref, id);
  }

  resolve(value: string): string {
    const id = this.refs.get(value) ?? value;
    if (!UUID_PATTERN.test(id)) throw new ProjectMapError(`Unknown ID or ref: ${value}`);
    return id;
  }

  resolveNullable(value: string | null): string | null {
    return value === null ? null : this.resolve(value);
  }
}

function required<T>(value: T | null, field: string, op: string): T {
  if (value === null) throw new ProjectMapError(`${op} needs ${field}.`);
  return value;
}

async function applyOperation(db: ProjectMapDb, scope: ProjectMapScope, refs: RefResolver, operation: ProjectMapOperation): Promise<string | null> {
  const { environmentId } = scope;
  switch (operation.op) {
    case "create_folder": {
      const id = await createProjectFolder(db, { ...scope, parentFolderId: refs.resolveNullable(operation.parent_id),
        name: required(operation.name, "name", operation.op), note: operation.text ?? "" });
      refs.remember(operation.ref, id);
      return id;
    }
    case "rename_folder":
      await renameProjectFolder(db, environmentId, refs.resolve(required(operation.id, "id", operation.op)), required(operation.name, "name", operation.op));
      return null;
    case "delete_folder":
      await deleteProjectFolder(db, environmentId, refs.resolve(required(operation.id, "id", operation.op)));
      return null;
    case "set_note": {
      const text = required(operation.text, "text", operation.op);
      if (operation.id === null) await setProjectBrief(db, environmentId, text);
      else await setProjectFolderNote(db, environmentId, refs.resolve(operation.id), text);
      return null;
    }
    case "create_card": {
      const id = await createProjectMapCard(db, { ...scope, folderId: refs.resolveNullable(operation.parent_id),
        title: required(operation.name, "name", operation.op), body: operation.text ?? "", state: operation.state ?? "idea" });
      refs.remember(operation.ref, id);
      return id;
    }
    case "update_card":
      await updateProjectMapCard(db, environmentId, refs.resolve(required(operation.id, "id", operation.op)),
        { title: operation.name, body: operation.text, state: operation.state });
      return null;
    case "delete_card":
      await deleteProjectMapCard(db, environmentId, refs.resolve(required(operation.id, "id", operation.op)));
      return null;
    case "move":
      await moveProjectMapItems(db, environmentId, required(operation.ids, "ids", operation.op).map((id) => refs.resolve(id)),
        refs.resolveNullable(operation.parent_id));
      return null;
  }
}

// Runs every operation in order on one transaction client, so a failure leaves the map unchanged.
export async function applyProjectMapOperations(
  db: ProjectMapDb,
  scope: ProjectMapScope,
  operations: ProjectMapOperation[]
): Promise<Array<{ op: string; id: string | null; ref: string | null }>> {
  const refs = new RefResolver();
  const results: Array<{ op: string; id: string | null; ref: string | null }> = [];
  for (const [index, operation] of operations.entries()) {
    try {
      results.push({ op: operation.op, id: await applyOperation(db, scope, refs, operation), ref: operation.ref });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new ProjectMapError(`Operation ${index + 1} (${operation.op}) failed: ${message} No changes were made.`);
    }
  }
  return results;
}
