import { useCallback, useMemo, useState } from "react";
import type { TaskConversationMessagesProps } from "./TaskConversationMessages";
import { resolveToolInspectorSelection, type ToolInspectorSelection } from "./shared";

export function useConversationActivityInspector(props: Pick<TaskConversationMessagesProps,
  "messages" | "liveToolCalls" | "toolInspectorSelection" | "onToolInspectorSelectionChange"
  | "toolDisclosureState" | "onToolDisclosureStateChange"
>) {
  const {
    messages, liveToolCalls = [], toolInspectorSelection, onToolInspectorSelectionChange,
    toolDisclosureState: controlledToolDisclosureState, onToolDisclosureStateChange
  } = props;
  const [internalToolDisclosureState, setInternalToolDisclosureState] = useState<Record<string, boolean>>({});
  const [internalSelectedInspector, setInternalSelectedInspector] = useState<ToolInspectorSelection | null>(null);
  const toolDisclosureState = controlledToolDisclosureState ?? internalToolDisclosureState;
  const selectedInspector = toolInspectorSelection === undefined ? internalSelectedInspector : toolInspectorSelection;
  const resolvedInspectorSelection = useMemo(
    () => resolveToolInspectorSelection(selectedInspector, messages, liveToolCalls),
    [liveToolCalls, messages, selectedInspector]
  );
  const setSelectedInspector = useCallback((selection: ToolInspectorSelection | null): void => {
    if (toolInspectorSelection === undefined) {
      setInternalSelectedInspector(selection);
    }
    onToolInspectorSelectionChange?.(selection);
  }, [onToolInspectorSelectionChange, toolInspectorSelection]);

  const handleToolDisclosureChange = useCallback((key: string, open: boolean): void => {
    const applyUpdate = (current: Record<string, boolean>): Record<string, boolean> => {
      if (current[key] === open) {
        return current;
      }
      return { ...current, [key]: open };
    };
    if (controlledToolDisclosureState === undefined) {
      setInternalToolDisclosureState((current) => applyUpdate(current));
      return;
    }
    const nextState = applyUpdate(controlledToolDisclosureState);
    if (nextState !== controlledToolDisclosureState) {
      onToolDisclosureStateChange?.(nextState);
    }
  }, [controlledToolDisclosureState, onToolDisclosureStateChange]);

  const handleToolGroupInspectorRequested = useCallback((
    selection: Omit<Extract<ToolInspectorSelection, { kind: "historical" }>, "kind">
  ): void => {
    setSelectedInspector({ kind: "historical", ...selection });
  }, [setSelectedInspector]);
  const handleLiveToolInspectorRequested = useCallback((
    selection: Omit<Extract<ToolInspectorSelection, { kind: "live" }>, "kind">
  ): void => {
    setSelectedInspector({ kind: "live", ...selection });
  }, [setSelectedInspector]);

  return {
    resolvedInspectorSelection, toolDisclosureState, setSelectedInspector, handleToolDisclosureChange,
    handleToolGroupInspectorRequested, handleLiveToolInspectorRequested
  };
}
