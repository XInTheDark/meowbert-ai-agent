import { useCallback, useEffect, useState } from "react";
import type { CanvasElementSelection } from "@meowbert/shared/canvas-frame";

/** What the picked element is for: a request sent to Meowbert, or a saved comment. */
export type CanvasSelectionIntent = "ask" | "comment";

interface SelectionState {
  key: string;
  enabled: boolean;
  intent: CanvasSelectionIntent;
  element: CanvasElementSelection | null;
}

export function useCanvasSelection(key: string) {
  const [state, setState] = useState<SelectionState>({ key, enabled: false, intent: "ask", element: null });
  const current = state.key === key ? state : { key, enabled: false, intent: state.intent, element: null };
  useEffect(() => setState((state) => ({ key, enabled: false, intent: state.intent, element: null })), [key]);
  const select = useCallback((element: CanvasElementSelection | null) => {
    setState((state) => ({ key, enabled: element !== null, intent: state.intent, element }));
  }, [key]);
  const clear = useCallback(() => setState((state) => state.key === key ? { ...state, enabled: false, element: null } : state), [key]);
  const clearIfSelected = useCallback((element: CanvasElementSelection) => setState((state) =>
    state.key === key && state.element === element ? { ...state, enabled: false, element: null } : state), [key]);
  const toggle = (intent: CanvasSelectionIntent) => setState({
    key, enabled: !(current.enabled && current.intent === intent), intent, element: null
  });
  return { enabled: current.enabled, intent: current.intent, element: current.element, select, clear, clearIfSelected, toggle };
}
