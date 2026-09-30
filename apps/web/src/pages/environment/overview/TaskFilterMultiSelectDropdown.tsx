import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export interface TaskFilterMultiSelectOption {
  value: string;
  label: string;
}

interface TaskFilterMultiSelectDropdownProps {
  label: string;
  placeholder: string;
  options: TaskFilterMultiSelectOption[];
  selectedValues: string[];
  onChange: (values: string[]) => void;
  summaryText?: string;
}

export function TaskFilterMultiSelectDropdown(props: TaskFilterMultiSelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const selectedValueSet = useMemo(() => new Set(props.selectedValues), [props.selectedValues]);
  const isAllSelected = props.options.length > 0 && props.selectedValues.length === props.options.length;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  function toggleValue(value: string, checked: boolean): void {
    props.onChange(
      checked
        ? Array.from(new Set([...props.selectedValues, value]))
        : props.selectedValues.filter((entry) => entry !== value)
    );
  }

  function selectAll(): void {
    props.onChange(props.options.map((option) => option.value));
  }

  function clearAll(): void {
    props.onChange([]);
  }

  return (
    <div className="task-filter-group" ref={containerRef}>
      <span className="task-filter-label">{props.label}</span>
      <div className={`task-filter-dropdown ${isOpen ? "is-open" : ""}`}>
        <button
          type="button"
          className="task-filter-dropdown-trigger"
          onClick={() => setIsOpen((value) => !value)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <span className="task-filter-dropdown-trigger-text">{props.summaryText ?? props.placeholder}</span>
          {props.selectedValues.length > 0 ? <span className="task-filter-dropdown-count">{props.selectedValues.length}</span> : null}
          <ChevronDown size={16} className="task-filter-dropdown-icon" />
        </button>

        {isOpen ? (
          <div className="task-filter-dropdown-menu" role="menu">
            <div className="task-filter-dropdown-actions">
              <button
                type="button"
                className="task-filter-dropdown-action"
                onClick={isAllSelected ? clearAll : selectAll}
              >
                {isAllSelected ? "Clear" : "Select all"}
              </button>
            </div>
            <div className="task-filter-dropdown-options">
              {props.options.map((option) => {
                const isSelected = selectedValueSet.has(option.value);
                return (
                  <label key={option.value} className={`task-filter-dropdown-option ${isSelected ? "is-selected" : ""}`}>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={(event) => toggleValue(option.value, event.target.checked)}
                    />
                    <span className="task-filter-dropdown-option-label">{option.label}</span>
                    {isSelected ? <Check size={14} className="task-filter-dropdown-option-check" /> : null}
                  </label>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
