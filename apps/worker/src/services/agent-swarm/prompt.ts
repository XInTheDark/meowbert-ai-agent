import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SwarmNote } from "./notes-store.js";

// prompt-texts ships in the worker image next to apps/, the same way as the personality prompts.
const PROMPT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../../prompt-texts/agent-swarm");
let cachedGuide: string | null = null;

// In the prefix of every swarm agent; it covers both the parent and the lane role so lanes inherit
// the leader's prefix unchanged.
export function loadSwarmGuide(): string {
  cachedGuide ??= fs.readFileSync(path.join(PROMPT_DIRECTORY, "guide.md"), "utf-8").trim();
  return cachedGuide;
}

// The lane's own result for the parent's split call; the only lane-specific text in a fork.
export function buildLaneBrief(input: {
  label: string;
  title: string;
  direction: string | null;
  laneDir: string;
  spinePath: string | null;
  siblingTitles: string[];
}): string {
  return [
    `You are lane ${input.label}: ${input.title}.`,
    input.direction ? `Direction: ${input.direction}` : null,
    input.spinePath ? `Spine: ${input.spinePath}. Read it before you start; it is in your parent's directory.` : null,
    input.siblingTitles.length > 0 ? `Your siblings: ${input.siblingTitles.join("; ")}.` : null,
    `Write files only in ${input.laneDir}.`,
    "Work only on your part, share what would change how a sibling acts, and finish with submit."
  ].filter((line): line is string => line !== null).join("\n");
}

export function buildSplitStartedMessage(lanes: Array<{ label: string; title: string }>): string {
  return [
    `Started ${lanes.length} lane${lanes.length === 1 ? "" : "s"}: ${lanes.map((lane) => `${lane.label} (${lane.title})`).join(", ")}.`,
    "Your turn ends now; you resume with their results once every lane has submitted."
  ].join(" ");
}

export function buildNotesBlock(notes: SwarmNote[]): string {
  return [
    "[Swarm notes]",
    ...notes.map((note) => `- ${note.kind === "auto" ? "(auto) " : ""}${note.author_title}: ${note.content}`)
  ].join("\n");
}

export const LANE_STEP_LIMIT_NOTE = "[System: This lane has reached its step limit. Call submit now with your summary and files.]";
export const LANE_PLAIN_TEXT_NOTE = "[System: Lanes finish only with submit. Keep working with tools, then call submit with your summary and files.]";
