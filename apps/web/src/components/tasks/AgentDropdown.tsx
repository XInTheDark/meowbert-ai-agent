import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { Bot, Check, ChevronDown } from "lucide-react";
import {
  useChatToolsDropdownPlacement,
  type ChatToolsPopoverPlacement
} from "./useChatToolsDropdownPlacement";

export interface AgentSummary {
  id: string;
  name: string;
  description: string;
  mode?: "standard" | "agent_swarm" | "quality_control_reviewer";
  swarmWorkerCount?: number;
  swarmReviewRounds?: number;
}

interface AgentDropdownProps {
  availableAgents?: AgentSummary[];
  modelSliderAgentIds?: string[];
  selectedAgentId?: string | null;
  selectedAgentIds?: string[];
  defaultAgentId?: string | null;
  onChange?: (agentId: string | null) => void;
  onMultiChange?: (agentIds: string[]) => void;
  disabled?: boolean;
  variant?: "icon" | "button";
  allowNoSelection?: boolean;
  noSelectionLabel?: string;
  multiSelect?: boolean;
  popoverPlacement?: ChatToolsPopoverPlacement;
}

function buildAgentDropdownLabel(input: {
  agents: AgentSummary[];
  selectedAgent: AgentSummary | null;
  selectedAgentId?: string | null;
  selectedAgentIds: Set<string>;
  defaultAgent: AgentSummary | null;
  allowNoSelection: boolean;
  noSelectionLabel: string;
  multiSelect: boolean;
}): string {
  if (input.multiSelect) {
    if (input.selectedAgentIds.size === 0) {
      return "No agent access";
    }
    if (input.selectedAgentIds.size === 1) {
      const selectedId = Array.from(input.selectedAgentIds)[0];
      return input.agents.find((agent) => agent.id === selectedId)?.name ?? `Unknown agent (${selectedId})`;
    }
    return `${input.selectedAgentIds.size} agents selected`;
  }

  if (input.selectedAgent) {
    return input.selectedAgent.name;
  }
  if (input.selectedAgentId) {
    return `Unknown agent (${input.selectedAgentId})`;
  }
  if (input.allowNoSelection) {
    return input.defaultAgent ? `${input.noSelectionLabel} (${input.defaultAgent.name})` : input.noSelectionLabel;
  }
  return input.defaultAgent?.name ?? input.agents[0]?.name ?? "Select agent";
}

function AgentDropdownTrigger(props: {
  variant: "icon" | "button";
  active: boolean;
  disabled: boolean;
  isOpen: boolean;
  label: string;
  onToggle: () => void;
}) {
  if (props.variant === "icon") {
    return (
      <button
        type="button"
        className={`icon-btn-subtle ${props.active ? "active" : ""}`}
        onClick={props.onToggle}
        title="Agent"
        disabled={props.disabled}
        aria-haspopup="menu"
        aria-expanded={props.isOpen}
      >
        <Bot size={18} />
      </button>
    );
  }

  return (
    <button
      type="button"
      className="btn ghost"
      onClick={props.onToggle}
      disabled={props.disabled}
      aria-haspopup="menu"
      aria-expanded={props.isOpen}
      style={{
        width: "100%",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: "0.6rem"
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", minWidth: 0 }}>
        <Bot size={16} />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{props.label}</span>
      </span>
      <ChevronDown size={16} />
    </button>
  );
}

function AgentSliderMenu(props: {
  popoverRef: RefObject<HTMLDivElement>;
  popoverStyle: CSSProperties | undefined;
  popoverClassName: string;
  agents: AgentSummary[];
  resolvedAgent: AgentSummary | null;
  modelSliderAgentIds: string[];
  onSelect: (agentId: string) => void;
  onShowFullList: () => void;
}) {
  const configuredSliderAgents = props.modelSliderAgentIds
    .map((id) => props.agents.find((agent) => agent.id === id))
    .filter((agent): agent is AgentSummary => Boolean(agent));
  const availableSliderAgents = configuredSliderAgents.length > 0 ? configuredSliderAgents : props.agents;
  const sliderAgents = props.resolvedAgent && !availableSliderAgents.some((agent) => agent.id === props.resolvedAgent?.id)
    ? [props.resolvedAgent, ...availableSliderAgents]
    : availableSliderAgents;
  const selectedSliderIndex = Math.max(0, sliderAgents.findIndex((agent) => agent.id === props.resolvedAgent?.id));
  const selectedSliderAgent = sliderAgents[selectedSliderIndex] ?? sliderAgents[0];
  const sliderPosition = sliderAgents.length > 1 ? selectedSliderIndex / (sliderAgents.length - 1) : 0;
  const markerCount = Math.min(sliderAgents.length, 5);

  if (!selectedSliderAgent) {
    return null;
  }

  return (
    <div
      ref={props.popoverRef}
      className={`chat-tools-popover ${props.popoverClassName} model-slider-popover`}
      role="menu"
      aria-label="Model presets"
      style={props.popoverStyle}
    >
      <div className="chat-tools-popover-scroll">
        <div className="chat-tools-section-label">Models</div>
        <div className="model-slider-panel">
          <strong className="model-slider-current">{selectedSliderAgent.name}</strong>
          <div className="model-slider-track" style={{ "--model-slider-position": sliderPosition } as CSSProperties}>
            <div className="model-slider-ticks" aria-hidden="true">
              {Array.from({ length: markerCount }, (_, index) => (
                <span key={index} className={index / Math.max(1, markerCount - 1) < sliderPosition ? "complete" : ""} />
              ))}
            </div>
            <input
              className="model-slider"
              type="range"
              min={0}
              max={Math.max(0, sliderAgents.length - 1)}
              step={1}
              value={selectedSliderIndex}
              aria-label="Select model"
              onChange={(event) => props.onSelect(sliderAgents[Number(event.target.value)].id)}
            />
          </div>
        </div>
        <button type="button" className="chat-tools-link" onClick={props.onShowFullList}>
          Show full list
        </button>
      </div>
    </div>
  );
}

function AgentDropdownMenu(props: {
  popoverRef: RefObject<HTMLDivElement>;
  popoverStyle: CSSProperties | undefined;
  popoverClassName: string;
  agents: AgentSummary[];
  variant: "icon" | "button";
  multiSelect: boolean;
  allowNoSelection: boolean;
  selectedAgentId?: string | null;
  selectedAgentIds: Set<string>;
  defaultAgent: AgentSummary | null;
  resolvedAgent: AgentSummary | null;
  noSelectionLabel: string;
  onSelect: (agentId: string) => void;
  onClearSingle: () => void;
  onClearMulti: () => void;
  modelSliderAgentIds?: string[];
  onShowFullList: () => void;
  showFullList: boolean;
}) {
  if (props.modelSliderAgentIds && !props.showFullList && !props.multiSelect) {
    return (
      <AgentSliderMenu
        popoverRef={props.popoverRef}
        popoverStyle={props.popoverStyle}
        popoverClassName={props.popoverClassName}
        agents={props.agents}
        resolvedAgent={props.resolvedAgent}
        modelSliderAgentIds={props.modelSliderAgentIds}
        onSelect={props.onSelect}
        onShowFullList={props.onShowFullList}
      />
    );
  }

  return (
    <div
      ref={props.popoverRef}
      className={`chat-tools-popover ${props.popoverClassName}`}
      role="menu"
      aria-label="Agent presets"
      style={props.popoverStyle}
    >
      <div className="chat-tools-popover-scroll">
        <div className="chat-tools-section-label">Agents</div>
        {props.multiSelect && props.selectedAgentIds.size > 0 ? (
          <button type="button" className="chat-tools-item" onClick={props.onClearMulti} role="menuitem">
            <span className="chat-tools-item-label">
              <Bot size={14} />
              Clear selection
            </span>
          </button>
        ) : null}
        {!props.multiSelect && props.allowNoSelection ? (
          <button
            type="button"
            className={`chat-tools-item ${props.selectedAgentId ? "" : "active"}`}
            onClick={props.onClearSingle}
            role="menuitemradio"
            aria-checked={!props.selectedAgentId}
            title={props.defaultAgent ? `Default agent: ${props.defaultAgent.name}` : props.noSelectionLabel}
          >
            <span className="chat-tools-item-label">
              <Bot size={14} />
              {props.defaultAgent ? `${props.noSelectionLabel} (${props.defaultAgent.name})` : props.noSelectionLabel}
            </span>
            {!props.selectedAgentId ? <Check size={14} /> : null}
          </button>
        ) : null}
        {props.agents.map((agent) => {
          const isSelected = props.multiSelect ? props.selectedAgentIds.has(agent.id) : props.resolvedAgent?.id === agent.id;
          return (
            <button
              key={agent.id}
              type="button"
              className={`chat-tools-item ${isSelected ? "active" : ""}`}
              onClick={() => props.onSelect(agent.id)}
              role={props.multiSelect ? "menuitemcheckbox" : "menuitemradio"}
              aria-checked={isSelected}
              title={agent.description}
            >
              <span className="chat-tools-item-label">
                <Bot size={14} />
                {agent.name}
              </span>
              {isSelected ? <Check size={14} /> : null}
            </button>
          );
        })}
        {props.modelSliderAgentIds && !props.multiSelect ? (
          <button type="button" className="chat-tools-link" onClick={props.onShowFullList}>
            Back to slider
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function AgentDropdown(props: AgentDropdownProps) {
  const {
    availableAgents,
    modelSliderAgentIds,
    selectedAgentId,
    selectedAgentIds,
    defaultAgentId,
    onChange,
    onMultiChange,
    disabled = false,
    variant = "icon",
    allowNoSelection = false,
    noSelectionLabel = "Use default agent",
    multiSelect = false
  } = props;
  const menuRef = useRef<HTMLDivElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [showFullList, setShowFullList] = useState(false);

  const agents = Array.isArray(availableAgents) ? availableAgents : [];
  const shouldRender = agents.length > 0 && (multiSelect ? typeof onMultiChange === "function" : typeof onChange === "function");
  const selectedAgentIdSet = useMemo(() => new Set(selectedAgentIds ?? []), [selectedAgentIds]);
  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const defaultAgent = useMemo(
    () => agents.find((agent) => agent.id === defaultAgentId) ?? null,
    [agents, defaultAgentId]
  );
  const resolvedAgent = selectedAgent ?? (allowNoSelection ? null : defaultAgent ?? agents[0] ?? null);
  const hasMultiSelection = selectedAgentIdSet.size > 0;
  const hasNonDefaultAgent = multiSelect
    ? hasMultiSelection
    : Boolean(
      selectedAgentId
        && defaultAgentId
        && selectedAgentId !== defaultAgentId
    );
  const buttonLabel = buildAgentDropdownLabel({
    agents,
    selectedAgent,
    selectedAgentId,
    selectedAgentIds: selectedAgentIdSet,
    defaultAgent,
    allowNoSelection,
    noSelectionLabel,
    multiSelect
  });

  function toggleMultiAgent(agentId: string): void {
    const nextIds = selectedAgentIdSet.has(agentId)
      ? (selectedAgentIds ?? []).filter((id) => id !== agentId)
      : [...(selectedAgentIds ?? []), agentId];

    onMultiChange?.(nextIds);
  }

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

  if (!shouldRender) {
    return null;
  }

  const { popoverRef, popoverStyle, popoverClassName } = useChatToolsDropdownPlacement({
    triggerRef: menuRef,
    isOpen,
    placement: props.popoverPlacement,
    variant
  });

  return (
    <div ref={menuRef} className="chat-tools-menu">
      <AgentDropdownTrigger
        variant={variant}
        active={hasNonDefaultAgent}
        disabled={disabled}
        isOpen={isOpen}
        label={buttonLabel}
        onToggle={() => {
          setShowFullList(false);
          setIsOpen((current) => !current);
        }}
      />
      {isOpen ? (
        <AgentDropdownMenu
          popoverRef={popoverRef}
          popoverStyle={popoverStyle}
          popoverClassName={popoverClassName}
          agents={agents}
          variant={variant}
          multiSelect={multiSelect}
          allowNoSelection={allowNoSelection}
          selectedAgentId={selectedAgentId}
          selectedAgentIds={selectedAgentIdSet}
          defaultAgent={defaultAgent}
          resolvedAgent={resolvedAgent}
          noSelectionLabel={noSelectionLabel}
          onSelect={(agentId) => {
            if (multiSelect) {
              toggleMultiAgent(agentId);
              return;
            }
            onChange?.(agentId);
            if (!modelSliderAgentIds || showFullList) {
              setIsOpen(false);
            }
          }}
          onClearSingle={() => {
            onChange?.(null);
            setIsOpen(false);
          }}
          onClearMulti={() => onMultiChange?.([])}
          modelSliderAgentIds={modelSliderAgentIds}
          showFullList={showFullList}
          onShowFullList={() => setShowFullList((current) => !current)}
        />
      ) : null}
    </div>
  );
}
