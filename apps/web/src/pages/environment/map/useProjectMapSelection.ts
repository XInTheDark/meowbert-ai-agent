import { useCallback, useState } from "react";

// Folders, cards and tasks the user ticked on the map, in the order they were picked.
export function useProjectMapSelection() {
  const [selected, setSelected] = useState<string[]>([]);
  const toggle = useCallback((id: string) => {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }, []);
  const clear = useCallback(() => setSelected([]), []);
  return { selected, isSelected: (id: string) => selected.includes(id), toggle, clear };
}

export type ProjectMapSelection = ReturnType<typeof useProjectMapSelection>;
