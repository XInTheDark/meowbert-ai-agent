import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const locationSchema = z.object({ workspaceRoot: z.string(), envRoot: z.string(), note: z.string().optional() });

/** Travels with the task folder, so relinking on another device retains the previous location. */
export async function localRunRelocationNote(taskDir: string, roots: { workspaceRoot: string; envRoot: string }): Promise<string | undefined> {
  const file = path.join(taskDir, ".meowbert-executor-paths.json");
  const previous = await fs.readFile(file, "utf8").then((value) => locationSchema.parse(JSON.parse(value))).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (previous?.workspaceRoot === roots.workspaceRoot && previous.envRoot === roots.envRoot) return previous.note;
  const note = previous ? "The workspace moved from " + JSON.stringify(previous.workspaceRoot) + " to " + JSON.stringify(roots.workspaceRoot)
    + ". The project folder moved from " + JSON.stringify(previous.envRoot) + " to " + JSON.stringify(roots.envRoot)
    + ". Earlier messages may refer to the old paths; use the current paths." : undefined;
  await fs.mkdir(taskDir, { recursive: true });
  await fs.writeFile(file + ".tmp", JSON.stringify({ ...roots, note }) + "\n", { mode: 0o600 });
  await fs.rename(file + ".tmp", file);
  return note;
}
