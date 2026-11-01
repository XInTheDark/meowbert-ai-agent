# Context History as Files, with Semantic Search

Status: implemented. Section 9 records where the build differs from this plan and what is still open.

## 1. Summary

Under Context management V2 the agent can only reach its earlier context windows through four tools: `history_list_windows`, `history_list_items`, `history_read_item` and `history_search_contents`. Search is a case-sensitive `LIKE` over `payload_json::text`, so it matches JSON keys and escaped text, can't rank results, and misses text that contains quotes or newlines.

This plan replaces those tools with two things:

1. **History files.** Every context window on the run's lineage is a read-only JSONL file in the sandbox. The agent uses `ls`, `rg`, `jq` and `sed` on them like any other file.
2. **`history_search`.** One semantic search tool backed by a LanceDB index, built the same way as workspace Memory search (chunking, embeddings, keyword + vector ranking).

Postgres stays the source of truth. The files and the index are both derived copies that can be rebuilt from it.

Admins can switch embedding features on and off in **Admin Panel → Platform → Embeddings**. Memory search defaults on. History search defaults off; with it off, the history files still exist and only `history_search` is hidden.

```
                 Postgres (source of truth)
           task_context_history_items, lineage, archive
              │                               │
   executor appends on record          worker indexes past watermark
              ▼                               ▼
   history/<ordinal>-<window>.jsonl    LanceDB history_chunks table
   (read-only mount, rg / jq / sed)    (history_search, if enabled)
```

## 2. History files

### 2.1 Location

- One directory per task on the executor's local disk, under a new root that sits next to the task scratch root and isn't counted in the scratch quota. Never on workspace or project storage.
- Mounted read-only into the sandbox the same way `skillsRootDir` is (`buildTaskSandboxMounts` in `packages/run-executor/src/agent/task-write-scope.ts`), and exposed as `TASK_HISTORY_DIR` next to `TASK_SCRATCH_DIR`. In host mode there's no sandbox, so read-only applies only by convention.
- A new `prepareHistoryDir` on the machine host port (`packages/run-executor/src/agent/ports/machine-host.ts`), implemented for the worker and desktop hosts like `prepareScratchDir`.
- File name: `<window ordinal, zero-padded>-<window_id>.jsonl`, so `ls` lists windows in order.
- Size: at most the task's history rows, minus the dropped encrypted reasoning and image data. The files are removed whenever the task's scratch is removed (archive, task delete).

### 2.2 Line format

Each line is one history item, with exactly these fields:

```json
{"id":"<item uuid>","call_number":12,"role":"assistant","type":"function_call","tool":"shell.exec","content":"<text>"}
```

- `id`: the history item ID, the same one that appears as `[id: …]` in context.
- `call_number`: the item's call number, or `null`.
- `role`, `type`: the existing `role` and `item_type` columns.
- `tool`: `tool_namespace.tool_name`, or `tool_name` alone, or `null`.
- `content`: the item's text, never truncated.

`content` comes from one switch on the item type:

- `message`: the text parts joined with newlines. Images become `[image]`.
- `function_call`: the `arguments` string.
- `function_call_output`: the `output` string, or its text parts if it's an array.
- `reasoning`: the summary text only. `encrypted_content` is dropped.
- Anything else: `JSON.stringify(item)`.

The function lives in `packages/run-executor/src/context-management-v2/history-file.ts` (new). Both the live append and the rebuild use it, so the two paths can't drift apart.

### 2.3 Writing and rebuilding

- **Append.** In `recordContextItems` (`packages/run-executor/src/context-management-v2/window.ts`), append the projected lines to the current window's file after `store.recordItems` succeeds. The executor already has the records, so this costs no extra Postgres query.
- **Run start.**
  - Rewrite the current window's file. That repairs a crash between the DB write and the file append.
  - Write any lineage window whose file is missing.
  - Windows that are already closed never change, so existing files for them are kept.
- **Rebuild source.** A new run-control method returns one window's rows in ordinal order for the current lineage, with `payload_json`. The executor projects them. The read uses the existing `(window_id, ordinal)` index.
- **Lineage marker.** A `.lineage` file records the context node the directory was built for. If a run starts on a different branch, every file is rebuilt (see 7.1).
- The directory is a small one Meowbert owns, so listing it at run start is allowed under the filesystem cost contract.

### 2.4 Tools removed

`history_list_windows`, `history_list_items`, `history_read_item` and `history_search_contents` are removed from:

- the function tool list and availability,
- the code-mode tool catalog,
- dispatch,
- the run API and run-control port,
- `db-store.ts`.

The four tools map to `ls`, `head`/`jq`, `rg <item_id>` and `rg`. `CONTEXT_WINDOW_GUIDANCE` in `packages/run-executor/src/context-management-v2/prompts.ts` changes to point at the history directory, and names `history_search` only when it's available. The guidance only changes when the run's tool set changes, so the prompt prefix stays stable within a run.

Notes stay as they are.

## 3. `history_search`

### 3.1 Index

- A new LanceDB table, `history_chunks`, in the worker's existing memory index cache root (on local disk), opened with the same storage helpers as memory.
- Row fields: `task_id`, `context_node_id`, `window_id`, `item_id`, `call_number`, `role`, `tool`, `text`, `vector`.
- Rows carry their own text, so a search never reads Postgres.
- Embedding uses the existing `embedTexts`, chunker and embedding settings, so nothing new is needed for providers or models. LanceDB stores and searches the vectors. Our code calls the embedding API, as it does for memory.
- A long item is chunked like a memory file, so the whole item is indexed. One constant caps the characters embedded per item at 16,000, to bound cost on huge tool outputs. Only the index is capped. The history file always holds the full text.

### 3.2 When items get indexed

- **Watermark.** A per-window watermark (the highest ordinal indexed) lives in a manifest next to the table, like memory's manifest.
- **After each write.** Once `recordContextHistoryRecords` commits, the worker schedules a debounced job per task. The job embeds the items past the watermark in one batch, writes them in one LanceDB add, and runs `maybeOptimizeTable` afterwards. It never blocks the run.
- **Before each search.** `history_search` first catches up whatever is past the watermark. A missed job, a worker restart or a restored task is therefore never searched with a stale index.
- **Write lock.** Writes take the same advisory-lock pattern as `withWorkspaceMemoryWriteLock`, keyed per workspace.

### 3.3 Search

- **Arguments:** `query`, `limit`, `window_id`, `role`, `tool`. All are required in the strict schema, and the filters are nullable.
- **Filter:** `task_id = X AND context_node_id IN (<lineage ids>)`. The lineage IDs come from one CTE query (`accessibleNodesCte`).
- **Ranking:** hybrid keyword + vector with Reciprocal Rank Fusion, reusing `runMemoryQuery`'s approach.
- **Results:** `item_id`, `window_id`, `call_number`, `role`, `tool` and the matching chunk. The agent opens the full item with `rg <item_id> $TASK_HISTORY_DIR`.

## 4. Cold storage

- **Archive.** After the existing archive succeeds:
  - delete the task's `history_chunks` rows and manifest entries with one `task_id` predicate,
  - drop its history directory along with its scratch.

  This holds whether history search is on or off.
- **Restore.** Nothing is re-embedded up front. The history files are rebuilt at the next run start. The index catches up the first time `history_search` runs on that task. A task restored only to be viewed never adds anything to LanceDB.
- Vectors aren't stored in the cold archive. Re-embedding a restored task that gets searched again is cheaper than carrying vectors in every archive.

## 5. Admin switches

- **Storage.** A new migration adds `memory_search_enabled boolean NOT NULL DEFAULT true` and `history_search_enabled boolean NOT NULL DEFAULT false` to `memory_embedding_settings`. The table keeps its legacy name.
- **Shared.** Add both fields to `memoryEmbeddingSettingsInputSchema` and `readMemoryEmbeddingSettings` in `packages/shared/src/memory-embeddings.ts`.
- **API.** Add both fields to `GET` and `PUT /api/admin/memory-embeddings`.
- **Web.** Add a **Features** group at the top of `EmbeddingsTab.tsx`, with two switches: **Memory search** and **Session history search**. The tab's description changes from Memory-only to "The model used to index and search Memory and session history."
- **Memory search off:**
  - no memory watchers are started and nothing is indexed,
  - `memory_search` is hidden,
  - the Memory files are unchanged,
  - the existing index is kept, so switching it back on is immediate.
- **History search off:**
  - no history indexing jobs are scheduled,
  - `history_search` is hidden,
  - history files work as normal,
  - archive cleanup still runs,
  - switching it back on catches up through the watermark.
- **Run flags.** The worker reads both flags when it prepares a run and passes them in `ResponseToolAvailability` as `allowMemorySearch` and `allowHistorySearch`. The desktop executor receives them through the run API.
- **Mid-task changes.** A switch changed during a task applies from the next run, which changes that task's tool list once.

## 6. Docs

- `apps/docs/docs/core-workflows/context-compaction.md`, V2 section: the agent can read every earlier window of its task as files, and can search them by meaning when the admin has turned that on. No server internals.
- `apps/docs/docs/self-hosting/models-and-providers.md`: rename "Memory embeddings" to "Embeddings". Document the two switches, their defaults, and that session history search embeds tool output and costs more.
- `apps/docs/docs/core-workflows/workspace-memory.md`: the self-hosted embedding note mentions that Memory search can be switched off.

## 7. Performance notes and open questions

### 7.1 Branch switching rebuilds every window

A run that starts on a different branch rewrites every history file on its lineage, which is one ordered read per window. That means reading the task's whole history from Postgres once. Normal runs only rewrite the current window.

Sub-option: if windows turn out to never hold items from more than one branch, windows of a shared ancestor are identical on every branch. Then only the windows after the fork point need rewriting. This depends on 7.2.

### 7.2 Can one window hold items from several context nodes?

Items carry their own `context_node_id`, separate from the window's, and visible nodes are created mid-window. Before choosing the rebuild rule in 7.1, confirm whether a branch always opens a new window.

### 7.3 Desktop executor leftovers

When a task is archived, the worker can't delete history files on a user's machine. The desktop host should drop a task's history directory when the run API reports the task as archived. Alternatively, it can reuse whatever cleanup desktop scratch already gets.

### 7.4 Embedding cost

With history search on, every turn's new items are embedded, up to the 16,000-character cap. This is why it defaults off.

### 7.5 Postgres load

- **Lower than today:** the `LIKE` scan over `payload_json::text` is gone.
- **Appends:** no new queries.
- **Run start:** the existing window list, plus one indexed read per window being rewritten.
- **Indexing:** one indexed read per batch, past the watermark.
- **Search:** one lineage CTE.

## 8. Milestones

Each milestone passes `npm run test`, `npm run lint` and `npm run build`.

1. **Projection and files.** The projection function, the history directory, append and rebuild, mount and env var. Tests:
   - the projection for each item type, including dropped encrypted reasoning,
   - a rebuilt file matches the appended one,
   - a branch only sees its own lineage's windows.
2. **Remove old tools.** Remove the four tools and update `CONTEXT_WINDOW_GUIDANCE`. Tests: tool availability under v1, v2 and the recovery phases.
3. **Admin switches.** The migration, settings, API, the Embeddings tab, and tool availability for `memory_search` and `history_search`. Tests: availability follows the flags, and memory watchers don't start when Memory search is off.
4. **Index and `history_search`.** The table, the watermark, debounced indexing, search. Tests:
   - search returns only lineage items,
   - catch-up indexes items a missed job skipped.
5. **Cold storage.** Archive deletes the index rows and the directory; restore rebuilds lazily. Tests: no `history_chunks` rows remain for an archived task.
6. **Docs.**

## 9. As built

- **Lineage (7.1, 7.2).** A branch can keep appending to a window it shares with another branch, and the agent's context replays every item in that window. So a file holds all of its window's items, and only the list of windows is filtered by lineage. Run start lists the lineage windows with each one's last item id, rewrites the open window only when its file does not end with that item, writes missing files and removes files of other branches. Windows the branches share are reused, so switching branches only writes the windows that differ.
- **Location.** `<scratch root>/.history/<workspace id>/<task id>`, created by `prepareHistoryDir` on each machine provider and removed with the task's scratch (server cleanup and desktop scratch tombstones).
- **Index layout.** One `history_chunks` table per host under `<memory index cache root>/v1/session-history`, not one per workspace. Rows are filtered by `task_id`, so one table serves every workspace, and one write lock covers it. Embedding happens outside the lock. Watermarks live in `tasks/<task id>.json` next to the table, per window, with closed windows marked done so later passes skip them.
- **Settings change.** A different embedding config hash or vector size drops the whole history index. It rebuilds as tasks are indexed or searched again.
- **Removal.** Triggers on `tasks` queue every archived or deleted task in `history_index_deletions`, whichever path removed it (worker cleanup, API trash, workspace deletion). Each worker host applies the queue to its own index once a minute, keeping a `deletions.json` cursor next to the table and looking back ten minutes on each pass so late commits are not missed. Queue rows are pruned after 30 days; a host whose cursor is older than that drops its whole index and rebuilds it. An archived device task also gets a scratch tombstone, so the device removes its scratch and history files.
- **Search catch-up.** `history_search` waits up to three seconds for the task's index to catch up, then answers from what is indexed with a notice, while indexing carries on in the background.
- **Restore.** A restored task is indexed again from its next recorded turn (when the switch is on), not only on its first search. A restored task that is only viewed adds nothing.
