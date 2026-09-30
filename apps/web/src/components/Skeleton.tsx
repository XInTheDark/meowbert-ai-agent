import type { CSSProperties, ReactNode } from "react";

interface SkeletonProps {
  /** CSS width, e.g. "8rem" or "60%". Defaults to filling the container. */
  width?: string;
  /** CSS height. Defaults to a single line of text. */
  height?: string;
  /** Renders as a circle, for avatars and status dots. */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * A single shimmering placeholder block.
 *
 * Skeletons are decorative: the surrounding region carries the `aria-busy` and
 * live-region semantics, and each skeleton is hidden from assistive tech.
 */
export function Skeleton({ width, height, circle, className, style }: SkeletonProps) {
  return (
    <span
      aria-hidden="true"
      className={`skeleton${circle ? " skeleton-circle" : ""}${className ? ` ${className}` : ""}`}
      style={{ width, height, ...style }}
    />
  );
}

/**
 * Wraps a set of skeletons so screen readers announce the load once rather than
 * reading a wall of empty placeholders.
 */
export function SkeletonRegion({
  label,
  className,
  children
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className} role="status" aria-busy="true" aria-live="polite" aria-label={label}>
      {children}
    </div>
  );
}
