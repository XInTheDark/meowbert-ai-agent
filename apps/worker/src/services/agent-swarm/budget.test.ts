import { describe, expect, it } from "vitest";
import { allocateLaneShares, MINIMUM_LANE_SHARE_TOKENS } from "./budget-shares.js";
import { judgeBudget, LANE_SHARE_SPENT_REASON, SWARM_BUDGET_SPENT_REASON, SWARM_DEADLINE_REASON } from "./budget.js";
import { SwarmToolError } from "./tool-error.js";

function state(overrides: Partial<Parameters<typeof judgeBudget>[0]> = {}): Parameters<typeof judgeBudget>[0] {
  return {
    token_budget: "1000000",
    reserve_tokens: "150000",
    swarm_spent: "0",
    deadline_passed: false,
    share_tokens: "100000",
    lane_spent: "0",
    given: "0",
    wrap_up_notified: false,
    ...overrides
  };
}

const lane = { isLane: true, isCheck: false, wrapUpPercent: 80 };

describe("lane shares", () => {
  it("divides what the parent can give by weight", () => {
    expect(allocateLaneShares(900_000, [1, 2])).toEqual([300_000, 600_000]);
  });

  it("refuses lanes that would not get enough for a few steps", () => {
    expect(() => allocateLaneShares(MINIMUM_LANE_SHARE_TOKENS * 3 - 1, [1, 1, 1])).toThrow(SwarmToolError);
    expect(() => allocateLaneShares(-5, [1])).toThrow(/not enough for 1 lane/);
  });
});

describe("budget enforcement", () => {
  it("tells a lane once to wrap up, then makes it submit at its share", () => {
    expect(judgeBudget(state({ lane_spent: "79000" }), lane)).toEqual({ kind: "ok" });
    expect(judgeBudget(state({ lane_spent: "80000" }), lane)).toEqual({ kind: "wrap_up" });
    expect(judgeBudget(state({ lane_spent: "90000", wrap_up_notified: true }), lane)).toEqual({ kind: "ok" });
    expect(judgeBudget(state({ lane_spent: "100000", wrap_up_notified: true }), lane)).toEqual({ kind: "force", reason: LANE_SHARE_SPENT_REASON });
  });

  it("counts what a lane gave its own lanes against its share", () => {
    expect(judgeBudget(state({ lane_spent: "40000", given: "60000" }), lane)).toEqual({ kind: "force", reason: LANE_SHARE_SPENT_REASON });
  });

  it("stops working lanes when the lanes' part is spent, but leaves the reserve to Check and the leader", () => {
    const spent = state({ swarm_spent: "850000" });
    expect(judgeBudget(spent, lane)).toEqual({ kind: "force", reason: SWARM_BUDGET_SPENT_REASON });
    expect(judgeBudget({ ...spent, share_tokens: null }, { ...lane, isCheck: true })).toEqual({ kind: "ok" });
    expect(judgeBudget(spent, { ...lane, isLane: false })).toEqual({ kind: "ok" });
    expect(judgeBudget(state({ swarm_spent: "1000000" }), { ...lane, isLane: false }).kind).toBe("leader_note");
  });

  it("makes every lane submit at the deadline and tells the leader to deliver", () => {
    expect(judgeBudget(state({ deadline_passed: true }), lane)).toEqual({ kind: "force", reason: SWARM_DEADLINE_REASON });
    expect(judgeBudget(state({ deadline_passed: true }), { ...lane, isLane: false }).kind).toBe("leader_note");
  });
});
