import { expect, it, vi } from "vitest";
vi.mock("../../lib/config.js", () => ({config:{localExecution:{enabled:true}}}));
vi.mock("../../lib/db.js", () => ({query:vi.fn()}));
vi.mock("./device-service.js", () => ({listDevices:vi.fn()}));
import { query } from "../../lib/db.js";
import { localTaskFeatureError, localTaskMutationError } from "./execution-targets.js";
it.each([{workflow:{type:"agent_swarm"}},{workflow:{type:"long_horizon"}},{schedule:{mode:"infinite"}},{tools:{subtasks:true}},{tools:{computerUse:true}},{tools:{scheduleTask:true}}])("rejects unsupported local feature %j", (input) => {
  expect(localTaskFeatureError(input)).toBeTruthy();
});
it("allows standard sandbox settings", () => {
  expect(localTaskFeatureError({workflow:{type:"standard"},tools:{subtasks:false}})).toBeNull();
});
it("enforces the feature guard on followups schedules and threads while leaving cloud unchanged", async () => {
  vi.mocked(query).mockResolvedValue({rows:[{execution_target:{kind:"local"}}]} as never);
  for (const input of [{tools:{subtasks:true}},{schedule:{mode:"infinite"}},{thread:true}]) {
    expect(await localTaskMutationError("t","u",input)).toBeTruthy();
  }
  expect(await localTaskMutationError("t","u",{tools:{subtasks:false}})).toBeNull();
  vi.mocked(query).mockResolvedValue({rows:[{execution_target:{kind:"cloud"}}]} as never);
  expect(await localTaskMutationError("t","u",{thread:true,tools:{subtasks:true}})).toBeNull();
});
