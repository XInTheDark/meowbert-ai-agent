import { SlidersHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { hasTaskRestrictions, type TaskRestrictions } from "./taskRestrictions";

interface AdvancedOption {
  key: keyof TaskRestrictions;
  label: string;
  hint: string;
}

const OPTIONS: AdvancedOption[] = [
  { key: "readOnly", label: "Read-only filesystem", hint: "Can read project files but not change them." },
  { key: "networkDisabled", label: "Disable network access", hint: "Commands can't reach the internet, and web search is off." }
];

export function TaskAdvancedOptions(props: {
  value: TaskRestrictions;
  onChange: (value: TaskRestrictions) => void;
  // Switched off entirely, with the reason shown in the panel (canvas, workflows, Host mode).
  disabledReason: string | null;
  // The project's sandbox already has no network, so the choice is made for the user.
  networkAlreadyOff: boolean;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const active = !props.disabledReason && hasTaskRestrictions(props.value);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div className="task-composer-advanced" ref={rootRef}>
      <button
        type="button"
        className={`task-composer-mode-toggle${active ? " active advanced" : ""}`}
        aria-expanded={open}
        aria-label="Advanced options"
        title={active ? "Advanced options (changed)" : "Advanced options"}
        disabled={props.disabled}
        onClick={() => setOpen((current) => !current)}
      >
        <SlidersHorizontal size={18} />
      </button>
      {open ? (
        <div className="task-composer-advanced-panel" role="group" aria-label="Advanced options">
          {props.disabledReason ? <p className="task-composer-advanced-note">{props.disabledReason}</p> : null}
          {OPTIONS.map((option) => {
            const locked = option.key === "networkDisabled" && props.networkAlreadyOff;
            const checked = locked || props.value[option.key];
            return (
              <label key={option.key} className="task-composer-advanced-row">
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked || props.disabledReason !== null}
                  onChange={(event) => props.onChange({ ...props.value, [option.key]: event.target.checked })}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{locked ? "Already off for this project." : option.hint}</small>
                </span>
              </label>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
