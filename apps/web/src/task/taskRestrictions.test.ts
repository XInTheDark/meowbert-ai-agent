import { describe, expect, it } from "vitest";
import { buildEmptyTaskInputDraft, normalizeTaskInputDraft } from "./taskInputDrafts";
import { buildCreateTaskRestrictionsPayload, normalizeTaskRestrictions } from "./taskRestrictions";

describe("task restrictions", () => {
  it("sends nothing for a default task and only the switched-on options otherwise", () => {
    expect(buildCreateTaskRestrictionsPayload({ readOnly: false, networkDisabled: false })).toBeNull();
    expect(buildCreateTaskRestrictionsPayload({ readOnly: true, networkDisabled: false })).toEqual({ readOnly: true });
    expect(buildCreateTaskRestrictionsPayload({ readOnly: true, networkDisabled: true })).toEqual({ readOnly: true, networkDisabled: true });
  });

  it("treats anything but an explicit true as off", () => {
    expect(normalizeTaskRestrictions({ readOnly: "true", networkDisabled: 1 })).toEqual({ readOnly: false, networkDisabled: false });
    expect(normalizeTaskRestrictions(null)).toEqual({ readOnly: false, networkDisabled: false });
  });

  it("keeps a project's restrictions when its draft is saved and read back", () => {
    const draft = { ...buildEmptyTaskInputDraft(), restrictions: { readOnly: true, networkDisabled: false } };

    expect(normalizeTaskInputDraft(JSON.parse(JSON.stringify(draft))).restrictions).toEqual({ readOnly: true, networkDisabled: false });
  });
});
