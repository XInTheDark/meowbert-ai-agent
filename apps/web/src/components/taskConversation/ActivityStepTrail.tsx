const VISIBLE_STEP_COUNT = 3;

// Rendered inside the activity card's button, so it uses spans rather than a list element.
export function ActivityStepTrail(props: { steps: string[]; running: boolean }): JSX.Element | null {
  const firstVisibleIndex = Math.max(0, props.steps.length - VISIBLE_STEP_COUNT);
  const visibleSteps = props.steps.slice(firstVisibleIndex);
  if (visibleSteps.length === 0) {
    return null;
  }

  return (
    <span className="tool-activity-steps" role="list" aria-label="Recent steps">
      {visibleSteps.map((step, offset) => {
        const isLatest = offset === visibleSteps.length - 1;
        const className = `tool-activity-step${isLatest ? " latest" : ""}${isLatest && props.running ? " running" : ""}`;
        return (
          <span key={firstVisibleIndex + offset} className={className} role="listitem">
            <span className="tool-activity-step-marker" aria-hidden="true" />
            <span className="tool-activity-step-text">{step}</span>
          </span>
        );
      })}
    </span>
  );
}
