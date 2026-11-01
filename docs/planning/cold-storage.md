# Cold Storage: Browsing and Retention

Status: implemented and locally validated on 2026-11-01. Migration 160 is included; deployment is not part of this change.

## Overview

Opening an old task should read its conversation without restoring its execution state into PostgreSQL. A read should not restart the configured task inactivity window. Resuming work should load the execution state it actually needs. Older, completed portions of a long-lived task should be able to move to the archive independently of its current work.

Keep the mounted archive, gzip compression, PostgreSQL row identities, existing worker loop, and normal retention setting. Add bounded archive chunks and one shared payload reader. Use a small set of explicit rules rather than a scoring engine or a new cache service.

## Original boundaries

These describe the starting point before this implementation.

- `packages/shared/src/task-history-archive.ts` owns the per-task gzip document and full restore.
- Conversation, content, navigation, public-share, event/SSE, and history-reading routes can currently trigger full warming. Changing only the conversation route would leave the problem in place.
- `apps/worker/src/services/agent-db/snapshot.ts` warms a task before execution. Cross-task history readers also warm their targets; they belong on the read path instead.
- Context management V2 already records `task_context_windows.closed_at`, owns history items by window, and locks the window when recording items. This provides a boundary for archiving past windows.
- History files and the optional history search index are derived data. Their readers and rebuild paths must resolve archived payloads, preserving the history-files contract in `docs/planning/history-files-and-search.md`.

## Search and storage

Keeping message-content search for a cold task requires retaining searchable text somewhere. That has a storage cost even if it is smaller than the complete execution payload. This work will preserve the existing title/metadata-only global search behavior for fully cold tasks rather than introduce another retained copy of their conversation. Searching inside an explicitly opened conversation may read its archived message chunks on demand; that operation can require more chunks than displaying one page.

## Storage layout and payload reads

Introduce a versioned chunk format alongside the existing v1 task documents.

- Store message bodies in bounded gzip chunks. Start with the existing batching convention of 128 records or approximately 2 MB of uncompressed JSON, flushing before adding the next record. A single oversized record is handled explicitly and is not admitted to the read cache.
- Keep execution payloads separate from visible conversation chunks. Group past private context by its existing window. Keep media independently addressable by its existing hash so reading one message does not fetch every blob.
- Keep IDs, branch ancestry, ordering, roles, timestamps, and small navigation metadata in PostgreSQL. Add explicit archive references and compact chunk metadata through a new numbered migration. Do not use an empty JSON payload as the signal that a row is cold.
- Read authorization and branch selection remain in the existing API/worker boundaries. The shared payload reader loads only the referenced chunks for the selected rows.
- Write immutable archive files, verify them before publishing their references and stubbing payloads, and preserve the existing recheck for concurrent activity. Database publication is transactional. Failed publication leaves the warm payloads usable; retries use known chunk identities.
- Reuse a valid chunk when its payload has not changed. An edit first loads the affected payload, then invalidates its archive reference as part of the write. Other chunks are untouched.
- Keep a compatible v1 reader. Its first uncached read still needs to decompress the old single-file archive, but does not restore PostgreSQL. Mark accessed v1 tasks for bounded conversion in the existing worker loop. Publish the converted references before retiring the original file. No startup scan or bulk conversion.

## Residency rules

1. Browsing reads directly from the archive. Cache chunks for a fixed one hour, with a 128 MiB payload cap per process and least-recently-used eviction. Concurrent reads of the same chunk share one load.
2. Actual work uses the existing warm-retention setting. Reads do not update activity or extend database residency. Zero still disables automatic archiving.
3. Archive unchanged payloads once and reuse their files. Older completed segments follow the same retention setting, independently of current task activity.

There are no visit counters, adaptive lifetimes, database pressure settings, or new cache service. The read cache is local and disposable. Oversized chunks bypass it; expiry is checked on access. The cap accounts for retained payload bytes rather than total process RSS.

## Older portions of active tasks

Archive finalized older turns and closed V2 context windows independently. The normal age rule applies to the segment's last change/closure, rather than the most recent activity anywhere in the task. An active schedule no longer blocks its old immutable segments from cooling.

Keep open windows, in-progress messages, effective notes, pending mail/results, and execution dependencies warm. A window being closed does not by itself prove that all payloads it references are safe to evict: protect the current request state, resumable fork seeds, and referenced media, and recheck under the existing task/window locks before publication. Preserve IDs, branch ancestry, and call numbers.

Legacy context mode continues to load any archived messages its request construction needs through the same reader. V2 startup restores open-window state and durable execution dependencies while leaving closed windows cold. Historical tools and history-file rebuilds fetch past windows explicitly.

Archiving an older segment must not mark the whole task archived, delete its live scratch/history directory, or expire its standing swarm. Those remain whole-task cleanup actions.

## Implementation sequence

1. **Add chunk storage and compatible readers.** Introduce the migration, immutable chunk writer, identity/integrity checks, archive references, v1 dispatch, and bounded conversion. Existing tasks and archive files remain readable throughout.
2. **Separate browsing from execution.** Route conversation pages, requested message contents, navigation, public shares, event pages/SSE replay, and worker history reads through the payload reader. Remove their full-warm calls. Keep full/required-state restoration only at mutation and execution boundaries; batch any necessary database restoration using the repository's existing recordset pattern. Add the bounded cache and request coalescing here.
3. **Apply retention and segment cooling.** Separate real activity from reads, apply the fixed cache and existing retention rules, and extend the existing archive loop to safe completed segments. Ensure active-task readers, context windows, effective notes, media, forks, and history-file/search rebuilds work across warm and cold data.
4. **Verify behavior and document the result.** Keep existing storage controls and make their counts accurate; document browsing versus execution and legacy conversion limitations. Update `CHANGELOG.md` when authorized.

Complete each phase with focused regression coverage before continuing. This is a storage/read-path change; the settings change alone would not satisfy it.

## Acceptance checks

- Reading one cold conversation page returns the same messages and branch controls without updating large PostgreSQL payloads or reading unrelated execution/media chunks. SSE, navigation, and public shares do not secretly warm the task.
- A read-only visit never buys another full warm-retention period. Fake-clock tests enforce fixed expiry, the byte cap, eviction order, and bounded cache bookkeeping.
- Concurrent same-chunk reads share one load per process; failures clear the pending load so a later request can retry.
- Cold edits, follow-ups, branch changes, and execution resume preserve the complete original payload and only materialize required state. Test v1 and V2 context modes.
- Old segments of an active/scheduled task cool while its current run, open windows, notes, media, pending work, scratch, and swarm remain usable. History files rebuild correctly from cold windows.
- Retention disabled means no background archiving. Browsing does not change real activity or delay normal archival.
- Unchanged chunks are reused. Missing/corrupt files, interrupted publication, concurrent writes, and failed legacy conversion do not erase the warm source or publish a usable-looking empty result.
- Legacy archives work before conversion, after conversion, and after a failed conversion. Global cold-task search remains deliberately title/metadata-only; explicit conversation search still returns matching archived text.
- Run the focused suites, PostgreSQL integration coverage for archive publication/concurrent activity, then the required `npm run test`, `npm run lint`, `npm run build`, and `git diff --check`. Keep local validation distinct from real mounted-storage latency and deployment acceptance.

## Delivery and validation

The three residency rules are implemented without additional settings. Browsing, public shares, navigation, event replay, and worker history reads use the shared payload reader. Follow-ups restore execution state; edits hydrate their source messages, and forks/threads explicitly materialize history before copying it. Warm values and archive references are selected together so a concurrent restore cannot expose stale stubs.

Active-task cooling processes at most 128 older messages and 128 history items from one closed window per pass, keeping the latest 128 messages and current-run payloads warm. Media, effective notes, pending work, and fork seeds are retained during segment cooling. Only whole-task archival removes scratch or expires swarm lanes. Storage eligibility counts include eligible segments.

Legacy conversion publishes v2 references transactionally and retains the original v1 file until task deletion, so readers that already selected the old key remain safe. Content-addressed chunks are reused when their contents match; superseded files are removed with the task's archive directory. This deliberately avoids adding a separate garbage collector.

Validated locally:

- Full `npm run test`: 2,695 passed and 78 skipped, including 17 PostgreSQL cold-storage cases and five conversation-navigation cases against a disposable database.
- `npm run lint`, `npm run build`, `npm run build:docs`, and `git diff --check`.
- Fixed cache expiry, byte/entry caps, request coalescing, oversized chunk bypass, and corruption failures.
- Active/scheduled segment cooling, mixed warm/cold reads, execution restoration, fork materialization, concurrent edits/restores, archive-write failures, failed legacy publication, task deletion, and repeated archive/index/device-cleanup transitions.
- Search-index rebuilds recover archived tool-output excerpts.
- Check lanes hydrate branch requirements before building their brief. All three reviewer workflow conversions retain cooled initial prompts, and navigation query/hydration results remain bounded with a 2 MB response body, including a concurrent restore. Full payload reads retain the original data.

No deployment or mounted-storage latency test was performed. The changelog, user follow-up/files guidance, archive configuration, and backup/restore instructions now describe the new behavior.

### Remaining review finding

Events appended after whole-task archival can still fail pagination or SSE replay until the task is warmed. The payload reader currently assumes every row in an archived task must be cold, even when a newly appended row has a warm payload. This finding was outside the three selected reader fixes and remains open.
