import { describe, expect, it } from "vitest";
import { findSwarmWaitCycle, parseSwarmPauses } from "./agent-swarm-dependencies.js";

describe("Agent Swarm wait dependencies", () => {
  it("detects a newly formed cycle even when an older cycle remains", () => {
    const pause = (waitingForTaskIds: string[]) => ({
      waitingForTaskIds,
      triggerSource: "web",
      mode: "agent_swarm_worker"
    });
    const pauses = parseSwarmPauses({
      pausedSwarmAgents: {
        a: pause(["b"]),
        b: pause(["a"]),
        y: pause(["z"]),
        z: pause(["y"])
      }
    });

    expect(findSwarmWaitCycle(pauses, "z")).toEqual(["z", "y", "z"]);
  });
});
