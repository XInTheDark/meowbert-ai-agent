import { useEffect, useState, type FocusEvent, type InputHTMLAttributes } from "react";
import {
  clampDraftNumberValue,
  formatDraftNumberValue,
  isDraftNumberWithinBounds,
  parseDraftNumberValue,
  type DraftNumberMode
} from "../../lib/draft-number";

interface DraftNumberInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> {
  value: number;
  mode?: DraftNumberMode;
  min?: number;
  max?: number;
  step?: number | "any";
  onValueChange: (value: number) => void;
}

export function DraftNumberInput(props: DraftNumberInputProps) {
  const {
    value,
    mode = "integer",
    min,
    max,
    step,
    onValueChange,
    onBlur,
    ...inputProps
  } = props;
  const [draftValue, setDraftValue] = useState(() => formatDraftNumberValue(value, mode));

  useEffect(() => {
    setDraftValue((currentValue) => {
      const parsedCurrentValue = parseDraftNumberValue(currentValue, mode);
      if (parsedCurrentValue !== null && parsedCurrentValue === value) {
        return currentValue;
      }
      return formatDraftNumberValue(value, mode);
    });
  }, [mode, value]);

  function handleChange(rawValue: string): void {
    setDraftValue(rawValue);

    const parsedValue = parseDraftNumberValue(rawValue, mode);
    if (parsedValue === null) {
      return;
    }
    if (!isDraftNumberWithinBounds({ value: parsedValue, min, max })) {
      return;
    }

    const nextValue = clampDraftNumberValue({
      value: parsedValue,
      mode,
      min,
      max
    });
    if (nextValue !== value) {
      onValueChange(nextValue);
    }
  }

  function handleBlur(event: FocusEvent<HTMLInputElement>): void {
    const parsedValue = parseDraftNumberValue(draftValue, mode);
    if (parsedValue === null) {
      setDraftValue(formatDraftNumberValue(value, mode));
      onBlur?.(event);
      return;
    }

    const nextValue = clampDraftNumberValue({
      value: parsedValue,
      mode,
      min,
      max
    });
    if (nextValue !== value) {
      onValueChange(nextValue);
    }
    setDraftValue(formatDraftNumberValue(nextValue, mode));
    onBlur?.(event);
  }

  return (
    <input
      {...inputProps}
      type="number"
      min={min}
      max={max}
      step={step ?? (mode === "integer" ? 1 : "any")}
      value={draftValue}
      onChange={(event) => handleChange(event.target.value)}
      onBlur={handleBlur}
    />
  );
}
