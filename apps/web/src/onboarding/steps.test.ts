import { describe, expect, it } from "vitest";
import { ONBOARDING_SECTIONS, findNextSectionStepIndex, getOnboardingResolvedSteps } from "./steps";

describe("onboarding sections", () => {
  const steps = getOnboardingResolvedSteps();

  it("keeps each section's steps together, in section order", () => {
    const sectionOrder = steps
      .map((step) => step.section)
      .filter((section, index, all) => index === 0 || all[index - 1] !== section);

    expect(sectionOrder).toEqual(ONBOARDING_SECTIONS.map((section) => section.id));
  });

  it("skips from any step to the first step of the next section", () => {
    const firstFilesStep = steps.findIndex((step) => step.section === "files");

    expect(findNextSectionStepIndex(steps, 0)).toBe(firstFilesStep);
    expect(findNextSectionStepIndex(steps, firstFilesStep - 1)).toBe(firstFilesStep);
  });

  it("reports the end of the tour when skipping the last section", () => {
    expect(findNextSectionStepIndex(steps, steps.length - 1)).toBe(steps.length);
  });
});
