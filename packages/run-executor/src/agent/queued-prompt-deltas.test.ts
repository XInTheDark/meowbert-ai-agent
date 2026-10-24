import { describe, expect, it } from "vitest";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import type { AgentExecutionContext } from "./execution-types.js";
import {
  appendPromptEnvelopeDelta,
  createPromptEnvelope,
  promptEnvelopeToPrefixItems,
  sealPromptEnvelope
} from "./prompt-envelope.js";
import { appendQueuedPromptDeltas } from "./queued-prompt-deltas.js";

function createExecution(conversationItems: ResponseInputItem[]) {
  const promptEnvelope = createPromptEnvelope("Base prompt.");
  const runPersistedItems: ResponseInputItem[] = [];
  const execution = {
    promptEnvelope,
    state: { contextManagement: { version: "v1" }, dispatchState: { conversationItems, runPersistedItems } }
  } as unknown as AgentExecutionContext;
  return { execution, promptEnvelope, conversationItems, runPersistedItems };
}

describe("appendQueuedPromptDeltas", () => {
  it("keeps the sealed prefix unchanged and appends later notes to the conversation", async () => {
    const { execution, promptEnvelope, conversationItems } = createExecution([{ role: "user", content: "Hi" }]);
    appendPromptEnvelopeDelta(promptEnvelope, { reason: "project-master", content: "Setup note." });
    sealPromptEnvelope(promptEnvelope);
    const prefixBefore = promptEnvelopeToPrefixItems(promptEnvelope);

    appendPromptEnvelopeDelta(promptEnvelope, { reason: "canvas", content: "Canvas created." });
    await appendQueuedPromptDeltas(execution);

    expect(promptEnvelopeToPrefixItems(promptEnvelope)).toEqual(prefixBefore);
    expect(conversationItems).toEqual([
      { role: "user", content: "Hi" },
      { role: "system", content: "Canvas created." }
    ]);
  });

  it("does not repeat an unchanged per-step notice", async () => {
    const { execution, promptEnvelope, conversationItems } = createExecution([]);
    sealPromptEnvelope(promptEnvelope);

    for (let step = 0; step < 3; step += 1) {
      appendPromptEnvelopeDelta(promptEnvelope, { reason: "computer", content: "Computer unavailable." });
      appendPromptEnvelopeDelta(promptEnvelope, { reason: "skill_enabled", content: `Skill ${step}.` });
      await appendQueuedPromptDeltas(execution);
    }

    expect(conversationItems.filter((item) => (item as { content?: string }).content === "Computer unavailable."))
      .toHaveLength(1);
  });

  it("moves a note back into the prefix when a conversation rebuild drops it", async () => {
    const { execution, promptEnvelope, conversationItems } = createExecution([]);
    sealPromptEnvelope(promptEnvelope);
    appendPromptEnvelopeDelta(promptEnvelope, { reason: "skill_enabled", content: "Skill docs." });
    await appendQueuedPromptDeltas(execution);

    conversationItems.splice(0, conversationItems.length, { role: "user", content: "Compacted summary" });
    await appendQueuedPromptDeltas(execution);

    expect(promptEnvelopeToPrefixItems(promptEnvelope)).toContainEqual({ role: "system", content: "Skill docs." });
    expect(conversationItems).toEqual([{ role: "user", content: "Compacted summary" }]);
  });
});

describe("appendQueuedPromptDeltas persistence", () => {
  it("writes notes to run history unless they are run-scoped", async () => {
    const { execution, promptEnvelope, runPersistedItems } = createExecution([]);
    sealPromptEnvelope(promptEnvelope);
    appendPromptEnvelopeDelta(promptEnvelope, { reason: "canvas", content: "Canvas created." });
    appendPromptEnvelopeDelta(promptEnvelope, { reason: "timed-run-finalizing", content: "Wrap up.", runScoped: true });

    await appendQueuedPromptDeltas(execution);

    expect(runPersistedItems).toEqual([{ role: "system", content: "Canvas created." }]);
  });

  it("keeps a persisted note in the conversation when a rebuild reloads it from history", async () => {
    const { execution, promptEnvelope, conversationItems } = createExecution([]);
    sealPromptEnvelope(promptEnvelope);
    appendPromptEnvelopeDelta(promptEnvelope, { reason: "canvas", content: "Canvas created." });
    await appendQueuedPromptDeltas(execution);
    const prefixBefore = promptEnvelopeToPrefixItems(promptEnvelope);

    conversationItems.splice(0, conversationItems.length, { role: "system", content: "Canvas created." });
    await appendQueuedPromptDeltas(execution);

    expect(promptEnvelopeToPrefixItems(promptEnvelope)).toEqual(prefixBefore);
  });
});
