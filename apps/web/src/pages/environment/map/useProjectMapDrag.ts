import { useState, type DragEvent } from "react";

const DRAG_TYPE = "application/x-meowbert-map-items";
const TOP_LEVEL = "__top__";

// Dragging map items onto a folder (or the top level) moves them there. Dragging a selected item
// moves the whole selection.
export function useProjectMapDrag(input: { selected: string[]; onMove: (ids: string[], folderId: string | null) => void }) {
  const [overTarget, setOverTarget] = useState<string | null>(null);

  function itemProps(id: string) {
    return {
      draggable: true,
      onDragStart: (event: DragEvent) => {
        const ids = input.selected.includes(id) ? input.selected : [id];
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData(DRAG_TYPE, JSON.stringify(ids));
        event.stopPropagation();
      },
      onDragEnd: () => setOverTarget(null)
    };
  }

  function dropProps(folderId: string | null) {
    const key = folderId ?? TOP_LEVEL;
    return {
      onDragOver: (event: DragEvent) => {
        if (!event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = "move";
        setOverTarget(key);
      },
      onDragLeave: (event: DragEvent) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOverTarget((current) => current === key ? null : current);
      },
      onDrop: (event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setOverTarget(null);
        try {
          const ids = JSON.parse(event.dataTransfer.getData(DRAG_TYPE)) as unknown;
          const movable = Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id !== folderId) : [];
          if (movable.length) input.onMove(movable, folderId);
        } catch {
          // Not a map drag.
        }
      }
    };
  }

  return { itemProps, dropProps, isOver: (folderId: string | null) => overTarget === (folderId ?? TOP_LEVEL) };
}

export type ProjectMapDrag = ReturnType<typeof useProjectMapDrag>;
