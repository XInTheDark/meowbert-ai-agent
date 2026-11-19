import { useCallback, useRef, useState, type ReactNode } from "react";
import { useDismissOnOutsidePointer } from "../../hooks/useDismissOnOutsidePointer";

// Runs younger than this stop on one click; older ones need a second click to confirm.
export const STOP_CONFIRMATION_AFTER_MS = 60_000;

interface ConfirmStopButtonProps {
  className: string;
  title: string;
  ariaLabel?: string;
  // When the run started. Unknown counts as just started.
  runningSince: string | null;
  onStop: () => void;
  children: ReactNode;
}

function needsConfirmation(runningSince: string | null): boolean {
  if (!runningSince) return false;
  const startedAt = new Date(runningSince).getTime();
  return Number.isFinite(startedAt) && Date.now() - startedAt >= STOP_CONFIRMATION_AFTER_MS;
}

/**
 * A stop button that, for a run going for a minute or more, turns red on the first click and stops on
 * the second. Clicking anywhere else or pressing Escape resets it.
 */
export function ConfirmStopButton(props: ConfirmStopButtonProps) {
  const [armed, setArmed] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const disarm = useCallback(() => setArmed(false), []);
  useDismissOnOutsidePointer(armed, [buttonRef], disarm);

  function handleClick(): void {
    if (!armed && needsConfirmation(props.runningSince)) {
      setArmed(true);
      return;
    }
    setArmed(false);
    props.onStop();
  }

  const label = props.ariaLabel ?? props.title;
  return (
    <button
      ref={buttonRef}
      type="button"
      className={armed ? `${props.className} stop-confirm-armed` : props.className}
      title={armed ? "Click again to stop" : props.title}
      aria-label={armed ? `${label}: click again to confirm` : label}
      onClick={handleClick}
    >
      {props.children}
    </button>
  );
}
