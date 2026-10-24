import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { SwarmNote } from "./lane-types.js";

// prompt-texts ships in the worker image next to apps/, the same way as the personality prompts.
const PROMPT_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../prompt-texts/agent-swarm");
const cachedPrompts = new Map<string, string>();

function loadPrompt(name: string): string {
  let prompt = cachedPrompts.get(name);
  if (prompt === undefined) {
    prompt = fs.readFileSync(path.join(PROMPT_DIRECTORY, name), "utf-8").trim();
    cachedPrompts.set(name, prompt);
  }
  return prompt;
}

// In the prefix of every forked swarm agent; it covers both the parent and the lane role so lanes
// inherit the leader's prefix unchanged.
export function loadSwarmGuide(): string {
  return loadPrompt("guide.md");
}

// Check lanes are fresh reviewers, not forks, so they get their own prompt instead of the guide.
export function loadCheckPrompt(): string {
  return loadPrompt("check.md");
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

// The diverge counterpart of buildLaneBrief: the same question for every lane, worked alone.
export function buildDivergeBrief(input: {
  label: string;
  question: string;
  direction: string | null;
  laneDir: string;
}): string {
  return [
    `You are lane ${input.label}, one of several lanes answering the same question independently.`,
    `Question: ${input.question}`,
    input.direction ? `Your angle: ${input.direction}` : "Answer it your own way; you have no angle.",
    `Write files only in ${input.laneDir}.`,
    "You will not see the other answers. Work it out fully, then submit your answer with decisions: each key choice, why you made it, and what would make you choose differently."
  ].join("\n");
}

// The first message of a Check lane. It sees what the user asked and what would be delivered,
// never the author's reasoning.
export function buildCheckBrief(input: {
  userMessages: string[];
  draft: string;
  files: string[];
  spinePath: string | null;
  focus: string | null;
  laneDir: string;
}): string {
  return [
    "Check this deliverable for the user before it is sent.",
    "## What the user wrote",
    input.userMessages.length > 0 ? input.userMessages.map((text, index) => `${index + 1}. ${text}`).join("\n\n") : "(no messages)",
    "## Draft reply",
    input.draft,
    input.files.length > 0 ? `## Files\n${input.files.map((file) => `- ${file}`).join("\n")}` : null,
    input.spinePath ? `## Spine\nThe deliverable was written in parts from the spine at ${input.spinePath}. Look for seams first.` : null,
    input.focus ? `## Focus\n${input.focus}` : null,
    `Write any files only in ${input.laneDir}. Finish with submit and your findings.`
  ].filter((line): line is string => line !== null).join("\n\n");
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

export function buildCheckStartedMessage(): string {
  return "A fresh reviewer is checking this before it is delivered. Your turn ends now; you resume with its findings. Fix what matters, then reply again.";
}

export function buildResumeStartedMessage(title: string): string {
  return `Resumed lane ${title}. Your turn ends now; you resume with its new result.`;
}

export function buildLaneInboxMessage(kind: "steer" | "resume", body: string): string {
  return kind === "resume" ? `[Your parent resumed you]\n${body}` : `[Message from your parent]\n${body}`;
}

export const LANE_STOP_REASON = "Your parent stopped this lane";

export function buildForcedSubmitNote(reason: string): string {
  return `[System: ${reason}. Call submit now with your summary and files.]`;
}

export function buildLaneWrapUpNote(percent: number): string {
  return `[System: This lane has used ${percent}% of its budget share. Wrap up: finish what matters most, then submit.]`;
}

export const LEADER_BUDGET_SPENT_NOTE = "[System: The swarm's token budget is used up. Start no more lanes; deliver now with what you have.]";
export const LEADER_DEADLINE_NOTE = "[System: The swarm's time budget is up. Your lanes are submitting what they have; deliver with what you have.]";

export const RECON_NUDGE_NOTE = "[System: You have worked alone for a while this turn. If the rest has independent parts, split now; otherwise carry on.]";

export const LANE_STEP_LIMIT_NOTE = "[System: This lane has reached its step limit. Call submit now with your summary and files.]";
export const LANE_PLAIN_TEXT_NOTE = "[System: Lanes finish only with submit. Keep working with tools, then call submit with your summary and files.]";
