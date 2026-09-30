import { ONBOARDING_SECTIONS, OnboardingResolvedStep } from "./steps";

function stepMarker(index: number, currentIndex: number): string {
  if (index < currentIndex) {
    return "✓";
  }
  return index === currentIndex ? "→" : "○";
}

export function OnboardingChecklist(props: { steps: OnboardingResolvedStep[]; currentIndex: number; maxHeight: string }) {
  const currentSection = props.steps[props.currentIndex]?.section;

  return (
    <div style={{ display: "grid", gap: "0.3rem", maxHeight: props.maxHeight, overflowY: "auto", paddingRight: "0.2rem" }}>
      {ONBOARDING_SECTIONS.map((section) => {
        const sectionSteps = props.steps
          .map((step, index) => ({ step, index }))
          .filter(({ step }) => step.section === section.id);
        if (sectionSteps.length === 0) {
          return null;
        }

        const isCurrent = section.id === currentSection;
        const isDone = sectionSteps.every(({ index }) => index < props.currentIndex);
        return (
          <div key={section.id} style={{ display: "grid", gap: "0.15rem" }}>
            <span style={{ fontSize: "0.8rem", fontWeight: 600, color: isCurrent ? "var(--text)" : "var(--text-muted)" }}>
              {isDone ? "✓ " : ""}{section.title}
            </span>
            {isCurrent
              ? sectionSteps.map(({ step, index }) => (
                <span
                  key={step.id}
                  style={{ fontSize: "0.8rem", paddingLeft: "0.75rem", color: index === props.currentIndex ? "var(--text)" : "var(--text-muted)" }}
                >
                  {stepMarker(index, props.currentIndex)} {step.checklistLabel}
                </span>
              ))
              : null}
          </div>
        );
      })}
    </div>
  );
}
