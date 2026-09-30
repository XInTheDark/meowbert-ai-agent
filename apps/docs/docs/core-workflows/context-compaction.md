---
title: Context Compaction
summary: How Meowbert automatically manages long task conversations to stay within model context limits.
---

# Context Compaction

Every model has a maximum context window — a limit on how much conversation history it can process at once. For long-running or multi-turn tasks, the conversation can grow large enough to approach this limit. **Context compaction** is Meowbert's mechanism for handling this gracefully, automatically summarizing older parts of the conversation so the task can continue without losing important information.

---

## Why compaction exists

Without compaction, a task that approached the context limit would either:
- Fail with a context-overflow error, or
- Silently drop old messages, causing the agent to "forget" earlier decisions.

Compaction solves this by replacing the oldest messages with a dense, structured summary written by a dedicated fast model. The summary preserves:
- The user's original goals and constraints.
- Key decisions made and their rationale.
- Actions taken and their results.
- Errors encountered and how they were resolved.
- Unresolved questions and open items.
- Technical details (file paths, variable names, commands used).

The agent then continues the conversation with the summary standing in for the full history — it retains all the context it needs to complete the task, in a fraction of the token budget.

---

## Automatic compaction

Compaction triggers automatically. You don't need to do anything.

### When it triggers

The worker estimates the token count of the current conversation before each model call. If that estimate exceeds **80% of the configured context window**, compaction runs.

### What gets compacted

The compaction algorithm keeps the most recent messages intact (the "live tail") and summarizes the older portion. By default, the last 8 messages are always kept verbatim — this preserves the most recent context (your latest instructions, the agent's most recent output) while summarizing everything before that.

The result is a single summary block that replaces the compacted messages. Future model calls include this summary followed by the live tail.

### The fast model

Compaction uses the platform's dedicated **fast model**, configured in **Admin → Models → Specialized models**, rather than the main task model. This keeps compaction fast and cost-efficient. If it is unset, Meowbert uses the task's resolved model.

### Cooldown after errors

If compaction fails (e.g., the fast model returns an error), a **10-minute cooldown** prevents repeated failed attempts. During the cooldown, the task continues without compaction — if it hits the context limit before the cooldown expires, it may fail. If this happens frequently, check the fast model configuration and API key.

---

## How compaction appears in the UI

When compaction runs, a **context compaction event** appears in the task's events stream. It shows:

- Whether it was triggered automatically or manually.
- Which backend was used (`summary` or `native`).
- The number of messages that were summarized.
- The token estimates before and after compaction.
- The summary text itself (expandable).

This makes it transparent — you can always inspect what was summarized and verify the summary looks correct.

If you enable the experimental native backend, Meowbert stores an opaque OpenAI compaction item instead of a readable summary. In that mode the UI shows a short placeholder note rather than the underlying compacted state.

---

## Manual compaction

In addition to automatic compaction, you can trigger compaction manually from the Task Detail view. This is useful when:

- You want to free up context space before sending a large follow-up.
- The task is in `awaiting_input` and you want to compact before resuming.
- You want to force a fresh summary at a specific point in the conversation.

Look for the **Compact now** button in the Task Detail actions menu.

---

## Agent-managed checkpoints (Experimental)

Workspace owners can enable **Context management tools** under **Workspace Settings → Experiments**. When enabled, Meowbert can manage its own active context during a task:

- **Checkpoint and compact** saves a detailed continuity checkpoint, then runs the same configured compaction flow described above.
- **Checkpoint and trim** is intended for low-impact cleanup. It removes a precise number of the oldest completed tool calls and their results while preserving regular conversation messages. Meowbert also records a detailed summary of what those tools did.

Each saved checkpoint appears in the conversation as a **Context checkpoint saved** card. Choose **View checkpoint** to inspect the description Meowbert recorded.

Tool results also include the exact API-reported input-token usage for the model request that produced the tool call. This reading is one request behind, because the current tool result was not part of that completed request. If the provider does not return input-token usage, Meowbert marks it unavailable instead of substituting an estimate.

These tools are on by default. Automatic and manual compaction continue to work normally whether or not the experiment is enabled.

---

## Configuration

| Config key | Description | Default |
|---|---|---|
| `Admin → Models → Specialized models → fastModel` | Model used for compaction summarization | Resolved task model |
| `Admin → Model → Model metadata` | Per-model context window and provider metadata JSON | `{"default":{"context_window":256000,"type":"openai"}}` |
| `Workspace Settings → Experiments → Native context compaction` | Experimental Responses API compaction-trigger backend | On |
| `Workspace Settings → Experiments → Context management tools` | Lets Meowbert save checkpoints and compact or trim its active context | On |

You can also set `modelRequestTimeoutMs` (or `modelRequestTimeoutSeconds`) per-workspace in `workspace_settings.model_defaults_json` to control how long compaction model calls are allowed to run before timing out.

### Changing the context window

If you're using models with larger or smaller context windows than the default, update the **Model metadata** JSON in the admin panel. Meowbert matches the exact model id first and falls back to the `default` entry.

```json
{
  "gpt-5.4": {
    "context_window": 1000000,
    "type": "openai"
  },
  "default": {
    "context_window": 256000,
    "type": "openai"
  }
}
```

Setting it too high won't cause errors but may delay compaction longer than necessary. Setting it too low will cause more frequent compaction, adding latency and cost.

### Changing the provider type

Model metadata can also set `type` to control provider-specific request shaping. It defaults to `openai`. Set exact Google model ids to `google` when routing through a Google/OpenAI-compatible endpoint:

```json
{
  "gemini-2.5-pro": {
    "context_window": 1000000,
    "type": "google"
  },
  "default": {
    "context_window": 256000,
    "type": "openai"
  }
}
```

Set Claude model ids to `claude` when they're served through a Responses-compatible proxy. Web search then uses Claude's own search instead of the OpenAI-only built-in tool.

---

## Tips

- Compaction is transparent to the agent — it receives the summary as part of its context and continues as if the full history were there.
- For tasks where continuity is critical (e.g., complex multi-file refactors), verify the summary in the events stream before continuing.
- The summary is written in markdown and includes headings for each category of preserved information. It's designed to be dense and implementation-ready.
