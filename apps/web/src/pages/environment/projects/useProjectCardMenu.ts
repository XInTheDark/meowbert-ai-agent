import { useEffect, useState } from "react";

// One project card menu is open at a time; it closes on Escape or a click outside any menu.
export function useProjectCardMenu(): {
  openMenuProjectId: string | null;
  setMenuOpen: (projectId: string, open: boolean) => void;
} {
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);

  useEffect(() => {
    if (!openMenuProjectId) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-task-actions-menu]")) return;
      setOpenMenuProjectId(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenMenuProjectId(null);
    };
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [openMenuProjectId]);

  return {
    openMenuProjectId,
    setMenuOpen: (projectId, open) => setOpenMenuProjectId(open ? projectId : null)
  };
}
