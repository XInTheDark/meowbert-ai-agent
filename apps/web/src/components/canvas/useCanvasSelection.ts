import { useCallback, useEffect, useState } from "react";
import type { CanvasElementSelection } from "@meowbert/shared/canvas-frame";

interface SelectionState {
  key: string;
  enabled: boolean;
  element: CanvasElementSelection | null;
}

export function useCanvasSelection(key: string) {
  const [state, setState] = useState<SelectionState>({ key, enabled: false, element: null });
  const current = state.key === key ? state : { key, enabled: false, element: null };
  useEffect(() => setState({ key, enabled: false, element: null }), [key]);
  const select = useCallback((element: CanvasElementSelection | null) => {
    setState({ key, enabled: element !== null, element });
  }, [key]);
  const clear = useCallback(() => setState({ key, enabled: false, element: null }), [key]);
  const toggle = () => setState({ key, enabled: !current.enabled, element: null });
  return { enabled: current.enabled, element: current.element, select, clear, toggle };
}
