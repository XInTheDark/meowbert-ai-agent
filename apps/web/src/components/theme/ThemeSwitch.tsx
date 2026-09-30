import { Check, ChevronDown, Moon, Sun } from "lucide-react";
import { type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ThemeMode } from "../../lib/types";
import { THEME_OPTIONS, type ThemeOption } from "../../lib/theme";

const THEME_GROUP_ORDER: Array<ThemeOption["group"]> = [
  "Popular",
  "Original",
  "Special",
  "System"
];

interface ThemeFamily {
  id: string;
  label: string;
  group: ThemeOption["group"];
  description: string;
  options: ThemeOption[];
  preview: string[];
}

export function ThemeSwitch(props: { themeMode: ThemeMode; setThemeMode: (mode: ThemeMode) => void }) {
  const switchId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const selectedTheme = THEME_OPTIONS.find((option) => option.id === props.themeMode) ?? THEME_OPTIONS.find((option) => option.id === "dark")!;
  const themeFamilies = useMemo(() => buildThemeFamilies(THEME_OPTIONS), []);
  const selectedFamily = themeFamilies.find((family) => family.options.some((option) => option.id === selectedTheme.id)) ?? themeFamilies[0];
  const groupedFamilies = useMemo(() => THEME_GROUP_ORDER.map((group) => ({
    group,
    families: themeFamilies.filter((family) => family.group === group)
  })).filter((entry) => entry.families.length > 0), [themeFamilies]);
  const selectedLabel = buildSelectedLabel(selectedFamily, selectedTheme);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handlePointerDown(event: PointerEvent): void {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popoverRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <div className="theme-switch" ref={rootRef}>
      <span className="theme-switch-label" id={`${switchId}-label`}>Theme</span>
      <button
        type="button"
        className="theme-switch-trigger"
        aria-labelledby={`${switchId}-label ${switchId}-value`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ThemePreview preview={selectedTheme.preview} compact />
        <span className="theme-switch-trigger-text" id={`${switchId}-value`}>{selectedLabel}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>

      {open ? createPortal(
        <ThemePopover
          labelId={`${switchId}-label`}
          popoverRef={popoverRef}
          groupedFamilies={groupedFamilies}
          themeMode={props.themeMode}
          setThemeMode={(mode) => {
            props.setThemeMode(mode);
            setOpen(false);
          }}
        />,
        document.body
      ) : null}
    </div>
  );
}

function ThemePopover(props: {
  labelId: string;
  popoverRef: RefObject<HTMLDivElement>;
  groupedFamilies: Array<{ group: ThemeOption["group"]; families: ThemeFamily[] }>;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  return (
    <div className="theme-popover" ref={props.popoverRef} role="dialog" aria-labelledby={props.labelId}>
      {props.groupedFamilies.map(({ group, families }) => (
        <section className="theme-popover-group" key={group}>
          <h3>{group}</h3>
          <div className="theme-option-grid">
            {families.map((family) => {
              const selectedOption = family.options.find((option) => option.id === props.themeMode);
              const selected = selectedOption !== undefined;

              if (family.options.length === 1) {
                const option = family.options[0];
                return (
                  <button
                    type="button"
                    key={family.id}
                    className={`theme-option-card theme-option-single-card${selected ? " selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => props.setThemeMode(option.id)}
                  >
                    <ThemePreview preview={family.preview} />
                    <ThemeOptionCopy family={family} selected={selected} />
                  </button>
                );
              }

              const lightOption = family.options.find((option) => option.mode === "light") ?? family.options[0];
              const darkOption = family.options.find((option) => option.mode === "dark") ?? family.options[family.options.length - 1];
              return (
                <div
                  key={family.id}
                  className={`theme-option-card theme-option-family-card${selected ? " selected" : ""}`}
                  role="group"
                  aria-label={`${family.label} theme`}
                >
                  <ThemePreview preview={family.preview} />
                  <ThemeOptionCopy family={family} selected={selected} />
                  <div className="theme-mode-options" aria-label={`${family.label} modes`}>
                    <ThemeModeButton
                      mode="light"
                      option={lightOption}
                      selected={props.themeMode === lightOption.id}
                      setThemeMode={props.setThemeMode}
                    />
                    <ThemeModeButton
                      mode="dark"
                      option={darkOption}
                      selected={props.themeMode === darkOption.id}
                      setThemeMode={props.setThemeMode}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

function ThemeOptionCopy(props: { family: ThemeFamily; selected: boolean }) {
  return (
    <span className="theme-option-copy">
      <strong>
        {props.family.label}
        {props.selected ? <Check size={14} aria-hidden="true" /> : null}
      </strong>
      <span>{props.family.description}</span>
    </span>
  );
}

function ThemeModeButton(props: {
  mode: "light" | "dark";
  option: ThemeOption;
  selected: boolean;
  setThemeMode: (mode: ThemeMode) => void;
}) {
  const Icon = props.mode === "light" ? Sun : Moon;
  const label = props.mode === "light" ? "Light" : "Dark";
  return (
    <button
      type="button"
      className={`theme-mode-choice ${props.mode}${props.selected ? " selected" : ""}`}
      aria-pressed={props.selected}
      aria-label={`Use ${props.option.label}`}
      onClick={() => props.setThemeMode(props.option.id)}
    >
      <Icon size={16} aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}

function buildThemeFamilies(options: ThemeOption[]): ThemeFamily[] {
  const familyMap = new Map<string, ThemeFamily>();

  for (const option of options) {
    const familyId = option.familyId ?? option.id;
    const existingFamily = familyMap.get(familyId);
    if (existingFamily) {
      existingFamily.options.push(option);
      continue;
    }

    familyMap.set(familyId, {
      id: familyId,
      label: option.familyLabel ?? option.label,
      group: option.group,
      description: option.familyDescription ?? option.description,
      options: [option],
      preview: option.preview
    });
  }

  return [...familyMap.values()].map((family) => {
    const sortedOptions = [...family.options].sort((first, second) => themeModeSortValue(first) - themeModeSortValue(second));
    const lightOption = sortedOptions.find((option) => option.mode === "light");
    const darkOption = sortedOptions.find((option) => option.mode === "dark");
    return {
      ...family,
      options: sortedOptions,
      preview:
        lightOption && darkOption
          ? [lightOption.preview[0], lightOption.preview[1], darkOption.preview[0]]
          : family.preview
    };
  });
}

function themeModeSortValue(option: ThemeOption): number {
  if (option.mode === "light") {
    return 0;
  }
  if (option.mode === "dark") {
    return 1;
  }
  return 2;
}

function buildSelectedLabel(family: ThemeFamily, option: ThemeOption): string {
  if (family.options.length <= 1 || option.mode === undefined) {
    return family.label;
  }

  return `${family.label} ${option.mode === "dark" ? "Dark" : "Light"}`;
}

function ThemePreview(props: { preview: string[]; compact?: boolean }) {
  return (
    <span className={props.compact ? "theme-preview compact" : "theme-preview"} aria-hidden="true">
      {props.preview.map((color) => (
        <span key={color} style={{ background: color }} />
      ))}
    </span>
  );
}
