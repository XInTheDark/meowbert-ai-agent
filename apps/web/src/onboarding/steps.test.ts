import { describe, expect, it } from "vitest";
import { ONBOARDING_SECTIONS, findNextSectionStepIndex, getOnboardingResolvedSteps, isOnStepRoute } from "./steps";

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

describe("isOnStepRoute", () => {
  it("accepts a redirect below the step route only when nested paths are allowed", () => {
    const projectPath = "/app/w1/projects/p1";
    const masterPath = `${projectPath}/tasks/t1`;

    expect(isOnStepRoute(projectPath, projectPath, false)).toBe(true);
    expect(isOnStepRoute(masterPath, projectPath, false)).toBe(false);
    expect(isOnStepRoute(masterPath, projectPath, true)).toBe(true);
    expect(isOnStepRoute("/app/w1/projects/p10", projectPath, true)).toBe(false);
  });
});
