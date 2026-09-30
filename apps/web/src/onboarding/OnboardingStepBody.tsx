import { buildDocsUrl } from "../lib/docs";
import { OnboardingChecklist } from "./OnboardingChecklist";
import { ONBOARDING_SECTIONS, OnboardingResolvedStep } from "./steps";

export function OnboardingStepBody(props: {
  steps: OnboardingResolvedStep[];
  stepIndex: number;
  onSkipSection: () => void;
}) {
  const step = props.steps[props.stepIndex];
  if (!step) {
    return null;
  }

  const sectionTitle = ONBOARDING_SECTIONS.find((section) => section.id === step.section)?.title ?? "";
  const isLastSection = props.steps.every((candidate, index) => index <= props.stepIndex || candidate.section === step.section);

  return (
    <div style={{ display: "grid", gap: "0.6rem", maxWidth: "350px" }}>
      <p style={{ margin: 0, color: "var(--text-muted)", fontSize: "0.82rem" }}>
        {sectionTitle} · Step {props.stepIndex + 1} of {props.steps.length}
      </p>
      <p style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.5 }}>{step.summary}</p>
      <OnboardingChecklist steps={props.steps} currentIndex={props.stepIndex} maxHeight="160px" />
      <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
        <a
          href={buildDocsUrl(step.docsPath)}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: "0.85rem", color: "var(--brand-strong)", textDecoration: "none", fontWeight: 600 }}
        >
          Open docs
        </a>
        {!isLastSection ? (
          <button type="button" className="link-button" onClick={props.onSkipSection}>
            Skip section
          </button>
        ) : null}
      </div>
    </div>
  );
}
