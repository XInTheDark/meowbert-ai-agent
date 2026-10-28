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

## Legacy automatic compaction (V1)

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

## Agent-managed context (Experimental)

When Context management V2 is active, Meowbert keeps the full conversation in private history and starts a fresh context window when needed. It does not summarize or discard the previous window.

As the base context budget runs low, the agent receives a reminder to save progress in private notes. When the base budget is exhausted, it receives a final checkpoint instruction and up to 16,384 additional tokens to save a note and request a new window. The model's hard context limit can shorten this interval. Reaching either the buffered budget or the hard limit starts a new window automatically. The next window includes the continuity note and can use private history to recover details.

By default, the base budget is 90% of the configured model context window, the reminder threshold is 6,144 remaining tokens, and the hard limit is 95%. A configured `auto_compact_token_limit` can lower the base budget; `effective_context_window_percent` changes the hard limit.

### Replacing finished tool calls

Within a window, the agent can also shrink its context without starting a new one. Every tool result it sees carries a `call_number`, counting up across the whole task. After finishing a stretch of work, such as exploring part of a codebase or reading a set of documents, the agent can replace that range of calls with a short summary of what it found:

```
Before:  call 10: read src/parser.ts → 4,000 lines
         call 11: search for "tokenize" → 60 matches
         call 12: read src/lexer.ts → 2,500 lines
After:   summary of calls 10-12: "The bug is in parser.ts:212; lexer.ts is fine. Snippet: …"
```

It can keep the calls themselves and replace only their outputs, or replace both. The original calls stay in private history, so the agent can read them again if it needs exact details. Your task transcript always shows every call as it ran.

In code mode, the agent can read earlier outputs with a script, pull out the exact snippets it needs, and pass them straight into the summary. The extracted text never has to be written out by the model, which saves tokens.

Replacing calls works best for the calls the agent just made. Providers cache the start of the conversation, so replacing calls that many later messages follow makes the next request re-read all of those messages at full price. The agent is told to replace calls right after it finishes with them, not to go back and compact old ones. A summary cannot cover one of your messages, and it is only as complete as the agent writes it.

### Idle compaction for the Project Master

The Project Master is one long conversation that wakes up whenever a task reports back, often long after its last turn. By then the provider's prompt cache has usually expired, so the next turn pays full price for the whole window.

To avoid that, Meowbert compacts an idle Master while its cache is still warm. Once 80% of the cache lifetime has passed since the start of the Master's last model request, and no new turn has happened, Meowbert runs one extra turn. That turn sends the same conversation the next turn would, plus a short instruction to update its notes, so it reads from the cache. Only the notes and history tools work in that turn, and nothing reaches the user. Afterwards the Master starts a fresh window, and its next wake begins from its notes instead of the full history.

Idle compaction is skipped when the last request used fewer tokens than the minimum, when a task report is already waiting (the Master is about to wake anyway), or when the cache has already expired. See [Idle compaction settings](#idle-compaction-settings) to change the cache lifetime and threshold.

The earlier V1 option uses checkpoint-and-compact and checkpoint-and-trim tools. These operate on the legacy compaction flow described above.

The context notice in tool results reports exact API input-token usage for the request that produced the tool call. This reading is one request behind because the current tool result was not part of that completed request. V2 budget tracking and the remaining-token tool also include response output tokens and estimate locally added items after the latest model response, following Codex's total-context accounting approach. Before a provider usage sample is available, V2 estimates the prompt and history instead. These estimates are approximate; a large tool result or a provider context-overflow error can still force a new window before a checkpoint is saved.

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

### Idle compaction settings

Three Model metadata keys control Project Master idle compaction. Like `context_window`, each one is read from the exact model entry first, then from `default`.

| Key | Description | Default |
|---|---|---|
| `prompt_cache_ttl_seconds` | How long the provider keeps a prompt cache, counted from the start of the request that wrote it | `3600` |
| `idle_compaction` | Set to `false` to turn idle compaction off | `true` |
| `idle_compaction_min_tokens` | Skip idle compaction when the last request used fewer input tokens than this | `50000` |

```json
{
  "gpt-5.4": {
    "context_window": 1000000,
    "prompt_cache_ttl_seconds": 300
  },
  "default": {
    "context_window": 256000,
    "type": "openai",
    "idle_compaction_min_tokens": 80000
  }
}
```

Set `prompt_cache_ttl_seconds` to what your provider actually keeps. If it's longer than the real cache lifetime, the compaction turn runs on an expired cache and pays full price.

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
