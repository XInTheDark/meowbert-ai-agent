import { useEffect, useState } from "react";

interface InlineProgressBarProps {
  /** Optional label text shown above the bar */
  label?: string;
  /** "top" pins the bar to the top of the viewport */
  pin?: "top";
  /** Delay before showing the bar, to avoid flicker for very short loads. */
  delayMs?: number;
}

/**
 * A compact indeterminate progress bar following Material's linear motion: two bars
 * sweep the track on offset schedules rather than one block wiping across.
 *
 * - 400ms show delay to avoid flashing on fast loads
 * - pin="top" fixes it to the top of the viewport
 */
export function InlineProgressBar({ label, pin, delayMs = 400 }: InlineProgressBarProps) {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
    setVisible(delayMs === 0);
    if (delayMs === 0) {
      return;
    }

    const timer = window.setTimeout(() => setVisible(true), delayMs);
    return () => window.clearTimeout(timer);
  }, [delayMs]);

  if (!visible) {
    return null;
  }

  return (
    <div
      className="inline-progress-bar"
      data-pin={pin ?? undefined}
      role="progressbar"
      aria-busy="true"
      aria-label={label ?? "Loading"}
    >
      {label ? <span className="inline-progress-bar-label">{label}</span> : null}
      <div className="inline-progress-bar-track">
        <div className="inline-progress-bar-bar primary">
          <span className="inline-progress-bar-bar-inner" />
        </div>
        <div className="inline-progress-bar-bar secondary">
          <span className="inline-progress-bar-bar-inner" />
        </div>
      </div>
    </div>
  );
}
