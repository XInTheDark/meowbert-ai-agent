import { describe, expect, it } from "vitest";
import { LiveEvent } from "../lib/types";
import {
  appendEventsWithCap,
  arraysEqual,
  buildEventWindowKey,
  buildTailWindow,
  collectConversationHydrationIds,
  collectMissingMessageIds,
  countHydratedMessageIds,
  expandRangeToToolBoundaries,
  isPathAppendOnly,
  prependEventsWithCap,
  rangesEqual,
  trimWindowToLimit
} from "./taskDetailWindowing";
import type { TaskMessage } from "../lib/types";

function createEvent(id: string): LiveEvent {
  return {
    id,
    type: "log",
    createdAt: `2026-03-04T00:00:${id.padStart(2, "0")}.000Z`,
    payload: {}
  };
}

function createMessage(input: {
  id: string;
  role?: TaskMessage["role"];
  createdAt: string;
}): TaskMessage {
  return {
    id: input.id,
    role: input.role ?? "assistant",
    content_json: { text: input.id },
    parent_message_id: null,
    edited_from_message_id: null,
    created_at: input.createdAt
  };
}

describe("taskDetailWindowing", () => {
  it("compares ranges and arrays", () => {
    expect(rangesEqual({ start: 1, end: 2 }, { start: 1, end: 2 })).toBe(true);
    expect(rangesEqual({ start: 1, end: 2 }, { start: 1, end: 3 })).toBe(false);
    expect(arraysEqual(["a", "b"], ["a", "b"])).toBe(true);
    expect(arraysEqual(["a", "b"], ["a", "c"])).toBe(false);
  });

  it("detects append-only path growth", () => {
    expect(isPathAppendOnly(["a", "b"], ["a", "b", "c"])).toBe(true);
    expect(isPathAppendOnly(["a", "b"], ["a", "x", "c"])).toBe(false);
    expect(isPathAppendOnly(["a", "b"], ["a"])).toBe(false);
  });

  it("builds and trims windows from the tail", () => {
    expect(buildTailWindow(0, 50, 250)).toEqual({ start: 0, end: 0 });
    expect(buildTailWindow(40, 50, 250)).toEqual({ start: 0, end: 40 });
    expect(buildTailWindow(500, 50, 250)).toEqual({ start: 450, end: 500 });
    expect(trimWindowToLimit({ start: 100, end: 400 }, 250)).toEqual({ start: 150, end: 400 });
  });

  it("expands message windows so tool groups are not split", () => {
    const messages = [
      createMessage({ id: "m-1", role: "assistant", createdAt: "2026-03-10T00:00:01.000Z" }),
      createMessage({ id: "m-2", role: "tool", createdAt: "2026-03-10T00:00:02.000Z" }),
      createMessage({ id: "m-3", role: "tool", createdAt: "2026-03-10T00:00:03.000Z" }),
      createMessage({ id: "m-4", role: "tool", createdAt: "2026-03-10T00:00:04.000Z" }),
      createMessage({ id: "m-5", role: "assistant", createdAt: "2026-03-10T00:00:05.000Z" })
    ];
    const byId = new Map(messages.map((message) => [message.id, message]));
    const orderedIds = messages.map((message) => message.id);

    expect(
      expandRangeToToolBoundaries({ start: 3, end: 5 }, orderedIds, byId)
    ).toEqual({ start: 1, end: 5 });

    expect(
      expandRangeToToolBoundaries({ start: 0, end: 2 }, orderedIds, byId)
    ).toEqual({ start: 0, end: 4 });
  });

  it("prepends and appends events with dedupe + cap", () => {
    const current = [createEvent("01"), createEvent("02"), createEvent("03")];

    const prepended = prependEventsWithCap(current, [createEvent("00"), createEvent("02")], 4);
    expect(prepended.map((event) => event.id)).toEqual(["00", "01", "02", "03"]);

    const appended = appendEventsWithCap(current, [createEvent("03"), createEvent("04"), createEvent("05")], 4);
    expect(appended.map((event) => event.id)).toEqual(["02", "03", "04", "05"]);
  });

  it("builds a stable key for the visible event window", () => {
    expect(buildEventWindowKey([])).toBe("0");
    expect(buildEventWindowKey([createEvent("01"), createEvent("02")])).toBe("2:01:02");
    expect(buildEventWindowKey([createEvent("00"), createEvent("02")])).toBe("2:00:02");
  });

  it("counts hydrated message ids in the current window", () => {
    expect(countHydratedMessageIds(["m-1", "m-2", "m-3"], { "m-1": {}, "m-3": {} })).toBe(2);
  });

  it("collects only message ids that still need content", () => {
    const inFlight = new Set<string>(["m-4"]);
    const hydrated = { "m-1": { text: "ready" }, "m-3": { text: "ready" } };

    expect(
      collectMissingMessageIds(["m-1", "m-2", "m-3", "m-4", "m-5"], hydrated, inFlight)
    ).toEqual(["m-2", "m-5"]);
  });

  it("hydrates non-tool messages eagerly, keeps the latest tool group hot, and loads older tools on demand", () => {
    const messages = [
      createMessage({ id: "u-1", role: "user", createdAt: "2026-03-10T00:00:01.000Z" }),
      createMessage({ id: "t-1", role: "tool", createdAt: "2026-03-10T00:00:02.000Z" }),
      createMessage({ id: "a-1", role: "assistant", createdAt: "2026-03-10T00:00:03.000Z" }),
      createMessage({ id: "t-2", role: "tool", createdAt: "2026-03-10T00:00:04.000Z" }),
      createMessage({ id: "t-3", role: "tool", createdAt: "2026-03-10T00:00:05.000Z" })
    ];
    const byId = new Map(messages.map((message) => [message.id, message]));

    expect(
      collectConversationHydrationIds(
        messages.map((message) => message.id),
        byId,
        new Set<string>(["t-1"])
      )
    ).toEqual(["u-1", "t-1", "a-1", "t-2", "t-3"]);
  });
});
