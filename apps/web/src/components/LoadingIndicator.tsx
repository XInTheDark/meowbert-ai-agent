import { useEffect, useState } from "react";

interface LoadingIndicatorProps {
  /** Diameter in pixels. */
  size?: number;
  /** Optional caption rendered under the indicator. */
  label?: string;
  /** Centres the indicator in a padded block, for empty regions awaiting content. */
  center?: boolean;
  /** Delay in ms before showing, to avoid flashing on fast loads. Set 0 to show at once. */
  delayMs?: number;
  className?: string;
}

/**
 * Google-style circular indeterminate activity indicator.
 *
 * Combines continuous 360-degree linear SVG rotation with an expanding and contracting
 * stroke-dash arc matching Google Material Design. On the Google themes, the stroke also
 * cycles through the four Google brand colours.
 */
export function LoadingIndicator({
  size = 36,
  label,
  center = false,
  delayMs = 400,
  className
}: LoadingIndicatorProps) {
  const [visible, setVisible] = useState(delayMs === 0);

  useEffect(() => {
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
      className={[
        "loading-indicator",
        center ? "loading-indicator-center" : "",
        className ?? ""
      ].filter(Boolean).join(" ")}
      role="status"
      aria-busy="true"
      aria-label={label ?? "Loading"}
    >
      <svg
        className="loading-indicator-spinner"
        viewBox="0 0 48 48"
        width={size}
        height={size}
        aria-hidden="true"
      >
        <circle
          className="loading-indicator-arc"
          cx="24"
          cy="24"
          r="20"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
        />
      </svg>
      {label ? <span className="loading-indicator-label">{label}</span> : null}
    </div>
  );
}
