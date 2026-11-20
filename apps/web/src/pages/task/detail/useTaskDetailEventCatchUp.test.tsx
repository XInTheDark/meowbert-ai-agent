/** @vitest-environment jsdom */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import type { LiveEvent, TaskEventsPageResponse } from "../../../lib/types";
import { useTaskDetailEventState } from "./useTaskDetailEventState";
import { useTaskDetailEventIngestion } from "./useTaskDetailEventIngestion";
import { useTaskDetailEventEffects } from "./useTaskDetailEventEffects";
import type { UseTaskDetailEventsOptions } from "./taskDetailEventTypes";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; });
const event = (id: string): LiveEvent => ({ id, createdAt: `2026-11-20T00:00:${id.padStart(2, "0")}.000Z`, type: "log", payload: { text: id } });

function mount(api: ApiClient, effects = false) {
  let current!: { state: ReturnType<typeof useTaskDetailEventState>; ingestion: ReturnType<typeof useTaskDetailEventIngestion> };
  const noop = () => {};
  const load = async () => {};
  const options: UseTaskDetailEventsOptions = { api, taskId: "task", token: null, activeTab: "events", taskStatus: "succeeded",
    loadTaskSnapshot: load, setTaskDetail: noop, onError: noop };
  function Probe() {
    const state = useTaskDetailEventState(options);
    const ingestion = useTaskDetailEventIngestion(options, state, noop);
    useTaskDetailEventEffects({ options: { ...options, taskId: effects ? "task" : "" }, state,
      appendLiveEvent: ingestion.appendLiveEvent, catchUpMissedEvents: load, loadInitialEvents: load, streamUrl: ingestion.streamUrl });
    current = { state, ingestion };
    return null;
  }
  root = createRoot(document.createElement("div"));
  act(() => root!.render(<Probe />));
  return () => current;
}

it("paginates missed events from each fetched page even when a newer live event arrives", async () => {
  let finish!: (page: TaskEventsPageResponse) => void;
  const get = vi.fn().mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }))
    .mockResolvedValueOnce({ items: [event("3")], hasMore: false });
  const current = mount({ get } as unknown as ApiClient);
  current().state.activeTaskIdRef.current = "task";
  current().state.lastSeenEventCursorRef.current = event("1");
  let catchup!: Promise<void>;
  await act(async () => { catchup = current().ingestion.catchUpMissedEvents(); });
  await act(async () => {
    current().ingestion.appendLiveEvent(event("9"));
    finish({ direction: "newer", items: [event("2")], hasMore: true });
    await catchup;
  });
  expect(get.mock.calls[1][0]).toContain("cursorId=2");
  expect(current().state.events.map((item) => item.id)).toEqual(expect.arrayContaining(["2", "3", "9"]));
});

it("keeps live events buffered while the reader is scrolled up", async () => {
  const current = mount({} as ApiClient, true);
  current().state.eventsNearBottomRef.current = false;
  await act(async () => { current().ingestion.appendLiveEvent(event("2")); });
  expect(current().state.events).toEqual([]);
  expect(current().state.pendingLiveEvents.map((item) => item.id)).toEqual(["2"]);
  expect(current().state.eventsHasNewer).toBe(true);
});
