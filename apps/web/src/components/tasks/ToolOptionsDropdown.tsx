import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import {
  Check,
  ChevronDown,
  Compass,
  FileText,
  GitBranch,
  Globe,
  Image,
  Monitor,
  Palette,
  Presentation,
  Repeat2,
  Search,
  Sparkles,
  Wrench,
  X
} from "lucide-react";
import type { DesktopComputerStatus, SkillCatalogGroup } from "@meowbert/shared";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { ComputerUseEnableModal } from "../modals/ComputerUseEnableModal";
import {
  useChatToolsDropdownPlacement,
  type ChatToolsPopoverPlacement
} from "./useChatToolsDropdownPlacement";
import type { TaskToolOptions } from "../../lib/types";

const HTML_CANVAS_SKILL_ID = "html-canvas";

export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  catalogGroup?: SkillCatalogGroup;
}

interface ToolOptionsDropdownProps {
  toolOptions: TaskToolOptions;
  onChange?: (options: TaskToolOptions) => void;
  availableSkills?: SkillSummary[];
  showMemorySearch?: boolean;
  showComputerUse?: boolean;
  showInteractiveCanvas?: boolean;
  allowScheduleTaskOption?: boolean;
  allowSubtasksOption?: boolean;
  disabled?: boolean;
  variant?: "icon" | "button";
  label?: string;
  popoverPlacement?: ChatToolsPopoverPlacement;
}

export function renderSkillIcon(skillId: string): ReactNode {
  switch (skillId) {
    case "html-canvas":
      return <Palette size={14} />;
    case "image-generation":
      return <Image size={14} />;
    case "docx-studio":
    case "openai-doc":
      return <FileText size={14} />;
    case "pptx-studio":
      return <Presentation size={14} />;
    case "deep-ai-search":
      return <Search size={14} />;
    case "browser-use":
      return <Compass size={14} />;
    default:
      return <Sparkles size={14} />;
  }
}

function normalizeToolsMenuQuery(query: string): string {
  return query.trim().toLowerCase();
}

export function matchesToolsMenuQuery(query: string, ...values: Array<string | null | undefined>): boolean {
  const normalizedQuery = normalizeToolsMenuQuery(query);
  if (!normalizedQuery) {
    return true;
  }
  return values.some((value) => value?.toLowerCase().includes(normalizedQuery));
}

export function filterToolsMenuSkills(skills: SkillSummary[] | undefined, query: string): SkillSummary[] {
  if (!skills || skills.length === 0) {
    return [];
  }
  return [...skills]
    .filter((skill) => matchesToolsMenuQuery(query, skill.name, skill.description, skill.id))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function getSkillCatalogGroup(skill: SkillSummary): SkillCatalogGroup {
  const group = skill.catalogGroup;
  if (group === "core" || group === "visuals" || group === "documents" || group === "web") {
    return group;
  }
  return "custom";
}

export function partitionToolsMenuSkills(skills: SkillSummary[]): {
  coreSkills: SkillSummary[];
  visualSkills: SkillSummary[];
  documentSkills: SkillSummary[];
  webSkills: SkillSummary[];
  customSkills: SkillSummary[];
} {
  const coreSkills: SkillSummary[] = [];
  const visualSkills: SkillSummary[] = [];
  const documentSkills: SkillSummary[] = [];
  const webSkills: SkillSummary[] = [];
  const customSkills: SkillSummary[] = [];

  for (const skill of skills) {
    const group = getSkillCatalogGroup(skill);
    if (group === "core") {
      coreSkills.push(skill);
    } else if (group === "visuals") {
      visualSkills.push(skill);
    } else if (group === "documents") {
      documentSkills.push(skill);
    } else if (group === "web") {
      webSkills.push(skill);
    } else {
      customSkills.push(skill);
    }
  }

  return { coreSkills, visualSkills, documentSkills, webSkills, customSkills };
}

function ToolOptionItem(props: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={`chat-tools-item ${props.active ? "active" : ""}`}
      onClick={props.onClick}
      role="menuitemcheckbox"
      aria-checked={props.active}
      title={props.title}
    >
      <span className="chat-tools-item-label">
        {props.icon}
        {props.label}
      </span>
      {props.active ? <Check size={14} /> : null}
    </button>
  );
}

interface ToolsPopoverContentProps {
  popoverRef: RefObject<HTMLDivElement>;
  popoverStyle: CSSProperties | undefined;
  popoverClassName: string;
  label: string;
  variant: "icon" | "button";
  searchQuery: string;
  onSearchChange: (value: string) => void;
  resolvedToolOptions: TaskToolOptions;
  onUpdateToolOptions: (next: Partial<TaskToolOptions>) => void;
  onOpenComputerUseModal: () => void;
  onToggleSkill: (skillId: string) => void;
  showWebSearch: boolean;
  showMemorySearchTool: boolean;
  scheduleTaskMatchesQuery: boolean;
  subtasksMatchQuery: boolean;
  showComputerUseTool: boolean;
  showInteractiveCanvasTool: boolean;
  coreSkills: SkillSummary[];
  visualSkills: SkillSummary[];
  documentSkills: SkillSummary[];
  webSkills: SkillSummary[];
  customSkills: SkillSummary[];
  hasAnyToolMatches: boolean;
}

function ToolsPopoverContent(props: ToolsPopoverContentProps) {
  const hasCoreMatches =
    props.showWebSearch
    || props.showMemorySearchTool
    || props.scheduleTaskMatchesQuery
    || props.subtasksMatchQuery
    || props.showComputerUseTool
    || props.coreSkills.length > 0;

  const hasVisualMatches = props.showInteractiveCanvasTool || props.visualSkills.length > 0;
  const hasDocumentMatches = props.documentSkills.length > 0;
  const hasWebMatches = props.webSkills.length > 0;
  const hasCustomMatches = props.customSkills.length > 0;

  const sections: ReactNode[] = [];

  if (hasCoreMatches) {
    sections.push(
      <div key="core" className="chat-tools-group">
        <div className="chat-tools-section-label">Core tools</div>
        {props.showWebSearch ? (
          <ToolOptionItem
            active={props.resolvedToolOptions.webSearch}
            onClick={() => props.onUpdateToolOptions({ webSearch: !props.resolvedToolOptions.webSearch })}
            icon={<Globe size={14} />}
            label="Web search"
          />
        ) : null}
        {props.showMemorySearchTool ? (
          <ToolOptionItem
            active={props.resolvedToolOptions.memorySearch}
            onClick={() => props.onUpdateToolOptions({ memorySearch: !props.resolvedToolOptions.memorySearch })}
            icon={<Search size={14} />}
            label="Memory"
          />
        ) : null}
        {props.scheduleTaskMatchesQuery ? (
          <ToolOptionItem
            active={props.resolvedToolOptions.scheduleTask}
            onClick={() => props.onUpdateToolOptions({ scheduleTask: !props.resolvedToolOptions.scheduleTask })}
            icon={<Repeat2 size={14} />}
            label="Schedule tasks"
          />
        ) : null}
        {props.subtasksMatchQuery ? (
          <ToolOptionItem
            active={props.resolvedToolOptions.subtasks}
            onClick={() => props.onUpdateToolOptions({ subtasks: !props.resolvedToolOptions.subtasks })}
            icon={<GitBranch size={14} />}
            label="Subtasks"
          />
        ) : null}
        {props.showComputerUseTool ? (
          <ToolOptionItem
            active={props.resolvedToolOptions.computerUse}
            onClick={() => {
              if (props.resolvedToolOptions.computerUse) {
                props.onUpdateToolOptions({ computerUse: false });
              } else {
                props.onOpenComputerUseModal();
              }
            }}
            icon={<Monitor size={14} />}
            label="Computer use"
          />
        ) : null}
        {props.coreSkills.map((skill) => (
          <ToolOptionItem
            key={skill.id}
            active={props.resolvedToolOptions.enabledSkills.includes(skill.id)}
            onClick={() => props.onToggleSkill(skill.id)}
            icon={renderSkillIcon(skill.id)}
            label={skill.name}
            title={skill.description}
          />
        ))}
      </div>
    );
  }

  if (hasVisualMatches) {
    sections.push(
      <div key="visuals" className="chat-tools-group">
        <div className="chat-tools-section-label">Design &amp; Visuals</div>
        {props.showInteractiveCanvasTool ? (
          <ToolOptionItem
            active={props.resolvedToolOptions.interactiveCanvas === true}
            onClick={() => {
              const nextInteractiveCanvas = props.resolvedToolOptions.interactiveCanvas !== true;
              props.onUpdateToolOptions({
                interactiveCanvas: nextInteractiveCanvas,
                ...(nextInteractiveCanvas
                  ? {
                      enabledSkills: props.resolvedToolOptions.enabledSkills.filter((id) => id !== HTML_CANVAS_SKILL_ID)
                    }
                  : {})
              });
            }}
            icon={<Palette size={14} />}
            label="Interactive Canvas"
          />
        ) : null}
        {props.visualSkills.map((skill) => (
          <ToolOptionItem
            key={skill.id}
            active={props.resolvedToolOptions.enabledSkills.includes(skill.id)}
            onClick={() => props.onToggleSkill(skill.id)}
            icon={renderSkillIcon(skill.id)}
            label={skill.name}
            title={skill.description}
          />
        ))}
      </div>
    );
  }

  if (hasDocumentMatches) {
    sections.push(
      <div key="documents" className="chat-tools-group">
        <div className="chat-tools-section-label">Documents &amp; Data</div>
        {props.documentSkills.map((skill) => (
          <ToolOptionItem
            key={skill.id}
            active={props.resolvedToolOptions.enabledSkills.includes(skill.id)}
            onClick={() => props.onToggleSkill(skill.id)}
            icon={renderSkillIcon(skill.id)}
            label={skill.name}
            title={skill.description}
          />
        ))}
      </div>
    );
  }

  if (hasWebMatches) {
    sections.push(
      <div key="web" className="chat-tools-group">
        <div className="chat-tools-section-label">Web &amp; Automation</div>
        {props.webSkills.map((skill) => (
          <ToolOptionItem
            key={skill.id}
            active={props.resolvedToolOptions.enabledSkills.includes(skill.id)}
            onClick={() => props.onToggleSkill(skill.id)}
            icon={renderSkillIcon(skill.id)}
            label={skill.name}
            title={skill.description}
          />
        ))}
      </div>
    );
  }

  if (hasCustomMatches) {
    sections.push(
      <div key="custom" className="chat-tools-group">
        <div className="chat-tools-section-label">Other skills</div>
        {props.customSkills.map((skill) => (
          <ToolOptionItem
            key={skill.id}
            active={props.resolvedToolOptions.enabledSkills.includes(skill.id)}
            onClick={() => props.onToggleSkill(skill.id)}
            icon={renderSkillIcon(skill.id)}
            label={skill.name}
            title={skill.description}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      ref={props.popoverRef}
      className={`chat-tools-popover ${props.popoverClassName}`}
      role="menu"
      aria-label={props.label}
      style={props.popoverStyle}
    >
      <div className="chat-tools-search" role="search">
        <Search size={14} />
        <input
          type="text"
          className="chat-tools-search-input"
          placeholder="Search tools and skills"
          value={props.searchQuery}
          onChange={(event) => props.onSearchChange(event.target.value)}
          aria-label="Search tools and skills"
          autoFocus
        />
        {props.searchQuery ? (
          <button
            type="button"
            className="chat-tools-search-clear"
            onClick={() => props.onSearchChange("")}
            aria-label="Clear tools search"
          >
            <X size={13} />
          </button>
        ) : null}
      </div>
      <div className="chat-tools-popover-scroll">
        {sections.map((sectionNode, index) => (
          <div key={index}>
            {index > 0 ? <div className="chat-tools-separator" /> : null}
            {sectionNode}
          </div>
        ))}
        {!props.hasAnyToolMatches ? (
          <div className="chat-tools-empty">
            No tools or skills match "{props.searchQuery.trim()}".
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ToolOptionsDropdown(props: ToolOptionsDropdownProps) {
  const {
    toolOptions,
    onChange,
    availableSkills,
    showMemorySearch = false,
    showComputerUse = false,
    showInteractiveCanvas = true,
    allowScheduleTaskOption = true,
    allowSubtasksOption = true,
    disabled = false,
    variant = "icon",
    label = "Tools selection",
    popoverPlacement
  } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [toolsSearchQuery, setToolsSearchQuery] = useState("");
  const [isComputerUseModalOpen, setIsComputerUseModalOpen] = useState(false);
  const [computerStatus, setComputerStatus] = useState<DesktopComputerStatus | null>(null);
  const [computerStatusLoading, setComputerStatusLoading] = useState(false);
  const [computerStatusError, setComputerStatusError] = useState<string | null>(null);
  const [computerActionMessage, setComputerActionMessage] = useState<string | null>(null);
  const { capabilities, platform } = useAppRuntime();

  const resolvedToolOptions: TaskToolOptions = {
    webSearch: toolOptions.webSearch === true,
    memorySearch: showMemorySearch && toolOptions.memorySearch === true,
    scheduleTask: toolOptions.scheduleTask === true,
    subtasks: toolOptions.subtasks === true,
    computerUse: showComputerUse && toolOptions.computerUse === true,
    interactiveCanvas: toolOptions.interactiveCanvas === true,
    enabledSkills: toolOptions.interactiveCanvas === true
      ? (toolOptions.enabledSkills ?? []).filter((skillId) => skillId !== HTML_CANVAS_SKILL_ID)
      : toolOptions.enabledSkills ?? [],
    enabledSources: toolOptions.enabledSources ?? []
  };

  const filteredSkills = useMemo(
    () => filterToolsMenuSkills(availableSkills, toolsSearchQuery),
    [availableSkills, toolsSearchQuery]
  );
  const { coreSkills, visualSkills, documentSkills, webSkills, customSkills } = useMemo(
    () => partitionToolsMenuSkills(filteredSkills),
    [filteredSkills]
  );

  const showWebSearch = matchesToolsMenuQuery(toolsSearchQuery, "web search", "search the web", "internet", "browse online");
  const showMemorySearchTool = showMemorySearch
    && matchesToolsMenuQuery(toolsSearchQuery, "memory", "semantic search", "rag", ".memory", "workspace memory");
  const scheduleTaskMatchesQuery = allowScheduleTaskOption
    && matchesToolsMenuQuery(toolsSearchQuery, "schedule tasks", "schedule", "recurring task", "automation");
  const subtasksMatchQuery = allowSubtasksOption
    && matchesToolsMenuQuery(toolsSearchQuery, "subtasks", "subtask", "delegate", "parallel work");
  const showComputerUseTool = showComputerUse
    && matchesToolsMenuQuery(toolsSearchQuery, "computer use", "desktop control", "mouse", "keyboard", "screenshot");
  const showInteractiveCanvasTool = showInteractiveCanvas
    && matchesToolsMenuQuery(toolsSearchQuery, "interactive canvas", "canvas website", "project canvas", "live website");

  const hasCoreMatches = showWebSearch || showMemorySearchTool || scheduleTaskMatchesQuery || subtasksMatchQuery || showComputerUseTool || coreSkills.length > 0;
  const hasVisualMatches = showInteractiveCanvasTool || visualSkills.length > 0;
  const hasDocumentMatches = documentSkills.length > 0;
  const hasWebMatches = webSkills.length > 0;
  const hasCustomMatches = customSkills.length > 0;
  const hasAnyToolMatches = hasCoreMatches || hasVisualMatches || hasDocumentMatches || hasWebMatches || hasCustomMatches;

  const activeToolsCount =
    resolvedToolOptions.enabledSkills.length
    + Number(resolvedToolOptions.webSearch)
    + Number(resolvedToolOptions.memorySearch)
    + Number(resolvedToolOptions.scheduleTask)
    + Number(resolvedToolOptions.subtasks)
    + Number(resolvedToolOptions.computerUse)
    + Number(resolvedToolOptions.interactiveCanvas === true);

  useEffect(() => {
    if (!isOpen && toolsSearchQuery) {
      setToolsSearchQuery("");
    }
  }, [isOpen, toolsSearchQuery]);

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
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  function updateToolOptions(next: Partial<TaskToolOptions>): void {
    if (!onChange) {
      return;
    }
    onChange({
      ...resolvedToolOptions,
      ...next
    });
  }

  async function refreshComputerStatus(): Promise<void> {
    if (!capabilities.supportsComputerUse) {
      setComputerStatus(null);
      return;
    }
    setComputerStatusLoading(true);
    setComputerStatusError(null);
    try {
      setComputerStatus(await platform.getComputerStatus());
    } catch (error) {
      setComputerStatusError(error instanceof Error ? error.message : String(error));
    } finally {
      setComputerStatusLoading(false);
    }
  }

  function toggleSkill(skillId: string): void {
    const current = resolvedToolOptions.enabledSkills;
    const next = current.includes(skillId)
      ? current.filter((id) => id !== skillId)
      : [...current, skillId];

    updateToolOptions({
      enabledSkills: next,
      ...(skillId === HTML_CANVAS_SKILL_ID && !current.includes(skillId) ? { interactiveCanvas: false } : {})
    });
  }

  useEffect(() => {
    if (!isComputerUseModalOpen) {
      return;
    }
    void refreshComputerStatus();
  }, [isComputerUseModalOpen]);

  const { popoverRef, popoverStyle, popoverClassName } = useChatToolsDropdownPlacement({
    triggerRef: menuRef,
    isOpen,
    placement: popoverPlacement,
    variant
  });

  return (
    <div ref={menuRef} className="chat-tools-menu">
      {variant === "icon" ? (
        <button
          type="button"
          className={`icon-btn-subtle ${activeToolsCount > 0 ? "active" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          title={label}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <Wrench size={18} />
        </button>
      ) : (
        <button
          type="button"
          className={`btn ghost ${activeToolsCount > 0 ? "active" : ""}`}
          onClick={() => setIsOpen((current) => !current)}
          disabled={disabled}
          aria-haspopup="menu"
          aria-expanded={isOpen}
          style={{
            width: "100%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "0.6rem"
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", minWidth: 0 }}>
            <Wrench size={16} />
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {label}{activeToolsCount > 0 ? ` (${activeToolsCount} selected)` : ""}
            </span>
          </span>
          <ChevronDown size={16} />
        </button>
      )}
      {isOpen ? (
        <ToolsPopoverContent
          popoverRef={popoverRef}
          popoverStyle={popoverStyle}
          popoverClassName={popoverClassName}
          label={label}
          variant={variant}
          searchQuery={toolsSearchQuery}
          onSearchChange={setToolsSearchQuery}
          resolvedToolOptions={resolvedToolOptions}
          onUpdateToolOptions={updateToolOptions}
          onOpenComputerUseModal={() => {
            setIsOpen(false);
            setIsComputerUseModalOpen(true);
            setComputerActionMessage(null);
          }}
          onToggleSkill={toggleSkill}
          showWebSearch={showWebSearch}
          showMemorySearchTool={showMemorySearchTool}
          scheduleTaskMatchesQuery={scheduleTaskMatchesQuery}
          subtasksMatchQuery={subtasksMatchQuery}
          showComputerUseTool={showComputerUseTool}
          showInteractiveCanvasTool={showInteractiveCanvasTool}
          coreSkills={coreSkills}
          visualSkills={visualSkills}
          documentSkills={documentSkills}
          webSkills={webSkills}
          customSkills={customSkills}
          hasAnyToolMatches={hasAnyToolMatches}
        />
      ) : null}
      {isComputerUseModalOpen ? (
        <ComputerUseEnableModal
          status={computerStatus}
          loading={computerStatusLoading}
          error={computerStatusError}
          actionMessage={computerActionMessage}
          onClose={() => {
            setIsComputerUseModalOpen(false);
            setComputerStatusError(null);
            setComputerActionMessage(null);
          }}
          onConfirm={() => {
            updateToolOptions({ computerUse: true });
            setIsComputerUseModalOpen(false);
            setComputerStatusError(null);
            setComputerActionMessage(null);
          }}
          onRefresh={() => {
            setComputerActionMessage(null);
            void refreshComputerStatus();
          }}
          onPromptAccessibility={async () => {
            setComputerStatusError(null);
            setComputerActionMessage(null);
            try {
              setComputerStatusLoading(true);
              const nextStatus = await platform.requestAccessibilityPermission();
              setComputerStatus(nextStatus);
              setComputerActionMessage("Accessibility prompt opened. If you granted access, refresh once macOS returns you here.");
            } catch (error) {
              setComputerStatusError(error instanceof Error ? error.message : String(error));
            } finally {
              setComputerStatusLoading(false);
            }
          }}
          onOpenScreenRecordingSettings={async () => {
            setComputerStatusError(null);
            setComputerActionMessage(null);
            try {
              const result = await platform.openScreenRecordingSettings();
              if (!result.ok) {
                throw new Error(result.error ?? "Unable to open Screen Recording settings.");
              }
              setComputerActionMessage("Screen Recording settings opened. Enable Meowbert there, then come back and refresh this status.");
            } catch (error) {
              setComputerStatusError(error instanceof Error ? error.message : String(error));
            }
          }}
          onOpenDesktopPreferences={() => {
            setIsComputerUseModalOpen(false);
            setComputerStatusError(null);
            setComputerActionMessage(null);
            void platform.focusMainWindow("/desktop/preferences");
          }}
        />
      ) : null}
    </div>
  );
}
