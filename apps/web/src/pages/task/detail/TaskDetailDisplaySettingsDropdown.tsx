import { useEffect, useRef, useState } from "react";
import { Check, Settings2 } from "lucide-react";
import { hasCustomTaskAssistantMessageDisplayPreferences } from "../../../task/taskPagePreferences";
import type { TaskAssistantMessageDisplayPreferences } from "../../../lib/types";

interface TaskDetailDisplaySettingsDropdownProps {
  newMessageOrganizationEnabled?: boolean;
  value: TaskAssistantMessageDisplayPreferences;
  onChange: (nextValue: TaskAssistantMessageDisplayPreferences) => void;
  disabled?: boolean;
  isSaving?: boolean;
}

interface DisplaySetting {
  key: keyof TaskAssistantMessageDisplayPreferences;
  label: string;
  nested?: boolean;
}

function getDisplaySettingsSections(value: TaskAssistantMessageDisplayPreferences, showSummaries: boolean): Array<{
  title: string;
  settings: DisplaySetting[];
}> {
  return [
    {
      title: "Message layout",
      settings: [
        ...(showSummaries ? [{ key: "showMessageSummaries" as const, label: "Show message summaries" }] : []),
        { key: "collapseLongMessages", label: "Collapse long messages" },
        { key: "showThoughts", label: "Show thoughts" }
      ]
    },
    {
      title: "Text rendering",
      settings: [
        { key: "renderMarkdown", label: "Markdown rendering" },
        ...(value.renderMarkdown ? [{ key: "renderCommonHtml" as const, label: "Render common HTML tags", nested: true }] : []),
        { key: "renderUserMessages", label: "Render user messages" },
        { key: "renderLatex", label: "LaTeX rendering" },
        ...(value.renderLatex ? [{ key: "allowSingleDollarLatex" as const, label: "Allow single dollar", nested: true }] : [])
      ]
    },
    {
      title: "Text cleanup",
      settings: [{ key: "hideCitationMarkers", label: "Hide citation markers" }]
    },
    {
      title: "Conversation controls",
      settings: [
        { key: "showScrollToBottomButton", label: "Scroll to bottom button" },
        { key: "showSelectionThreadActions", label: "Selected text thread actions" },
        { key: "showSelectionThreadHighlights", label: "Selected text highlights" }
      ]
    }
  ];
}

export function TaskDetailDisplaySettingsDropdown(props: TaskDetailDisplaySettingsDropdownProps) {
  const { value, onChange, disabled = false, isSaving = false } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const hasCustomPreferences = hasCustomTaskAssistantMessageDisplayPreferences(value);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && event.target instanceof Node && !menuRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  function togglePreference(key: keyof TaskAssistantMessageDisplayPreferences): void {
    onChange({ ...value, [key]: !value[key] });
  }

  return (
    <div ref={menuRef} className="chat-tools-menu">
      <button
        type="button"
        className={`icon-btn-subtle ${hasCustomPreferences ? "active" : ""}`}
        onClick={() => setIsOpen((current) => !current)}
        title="Display settings"
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={isOpen}
      >
        <Settings2 size={18} />
      </button>
      {isOpen ? (
        <div
          className="chat-tools-popover task-detail-display-settings-popover"
          role="menu"
          aria-label="Message display settings"
          style={{ top: "calc(100% + 0.35rem)", bottom: "auto", left: "auto", right: 0 }}
        >
          <div className="chat-tools-popover-scroll">
            {getDisplaySettingsSections(value, props.newMessageOrganizationEnabled === true).map((section) => (
              <div className="task-detail-display-settings-section" key={section.title}>
                <div className="chat-tools-section-label">{section.title}</div>
                {section.settings.map((setting) => (
                  <button
                    key={setting.key}
                    type="button"
                    className={`chat-tools-item${setting.nested ? " chat-tools-item-nested" : ""}${value[setting.key] ? " active" : ""}`}
                    onClick={() => togglePreference(setting.key)}
                    role="menuitemcheckbox"
                    aria-checked={value[setting.key]}
                    disabled={disabled || isSaving}
                  >
                    <span className="chat-tools-item-label">{setting.label}</span>
                    {value[setting.key] ? <Check size={14} /> : null}
                  </button>
                ))}
              </div>
            ))}
          </div>
          {isSaving ? <p className="task-detail-display-settings-status">Saving…</p> : null}
        </div>
      ) : null}
    </div>
  );
}
