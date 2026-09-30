import { useEffect, useRef, useState } from "react";
import type { ProjectCanvasSummary } from "../../../lib/types";
import type { ToolInspectorSelection } from "../../../components/taskConversation/ToolActivityInspectorPanel";
import type { WorkspaceSourceSummary } from "../../../sources/sourceTypes";
import type { TaskDetailTab } from "./taskDetailConstants";
import { useTaskDetailLayoutState } from "./useTaskDetailLayoutState";
import { useTaskDetailWorkflowSidebar } from "./useTaskDetailWorkflowSidebar";

export function useTaskDetailViewState(taskId: string, debugModeEnabled: boolean) {
  const [tab, setTab] = useState<TaskDetailTab>("conversation");
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [contextChipExpanded, setContextChipExpanded] = useState(false);
  const [isProjectFilePickerOpen, setIsProjectFilePickerOpen] = useState(false);
  const [isCanvasPickerOpen, setIsCanvasPickerOpen] = useState(false);
  const [selectedFollowUpCanvas, setSelectedFollowUpCanvas] = useState<ProjectCanvasSummary | null>(null);
  const [selectedSource, setSelectedSource] = useState<WorkspaceSourceSummary | null>(null);
  const [activityInspectorSelection, setActivityInspectorSelection] = useState<ToolInspectorSelection | null>(null);
  const [toolDisclosureState, setToolDisclosureState] = useState<Record<string, boolean>>({});
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const autoOpenedCanvasIdRef = useRef<string | null>(null);
  const latestArtifactEventIdRef = useRef<string | null>(null);
  const layout = useTaskDetailLayoutState(taskId);
  const workflowSidebar = useTaskDetailWorkflowSidebar();

  useEffect(() => {
    if (!actionsMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [actionsMenuOpen]);

  useEffect(() => {
    setActivityInspectorSelection(null);
    setToolDisclosureState({});
    latestArtifactEventIdRef.current = null;
    workflowSidebar.closeSidebar();
  }, [taskId]);

  useEffect(() => {
    if (tab === "debug" && !debugModeEnabled) setTab("conversation");
  }, [debugModeEnabled, tab]);

  return {
    tab,
    setTab,
    actionsMenuOpen,
    setActionsMenuOpen,
    contextChipExpanded,
    setContextChipExpanded,
    isProjectFilePickerOpen,
    setIsProjectFilePickerOpen,
    isCanvasPickerOpen,
    setIsCanvasPickerOpen,
    selectedFollowUpCanvas,
    setSelectedFollowUpCanvas,
    selectedSource,
    setSelectedSource,
    activityInspectorSelection,
    setActivityInspectorSelection,
    toolDisclosureState,
    setToolDisclosureState,
    actionsMenuRef,
    autoOpenedCanvasIdRef,
    latestArtifactEventIdRef,
    layout,
    workflowSidebar
  };
}

export type TaskDetailViewState = ReturnType<typeof useTaskDetailViewState>;
