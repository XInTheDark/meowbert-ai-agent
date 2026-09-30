import { useEffect, useMemo, useState, type MouseEvent } from "react";
import type { ProjectFileEntry } from "../../../lib/types";
import { sortProjectFileEntries, type FileSortColumn } from "../../../project/projectFiles";

interface UseProjectFileSelectionOptions {
  entries: ProjectFileEntry[];
  onOpenDirectory: (relativePath: string) => void;
  onContextMenuOpening: () => void;
}

export function useProjectFileSelection(options: UseProjectFileSelectionOptions) {
  const [sortColumn, setSortColumn] = useState<FileSortColumn>("name");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [lastSelectedIndex, setLastSelectedIndex] = useState<number | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string | null } | null>(null);
  const sortedEntries = useMemo(
    () => sortProjectFileEntries(options.entries, sortColumn, sortDirection),
    [options.entries, sortColumn, sortDirection]
  );
  const selectedRelativePaths = options.entries
    .filter((entry) => selectedPaths.has(entry.relativePath))
    .map((entry) => entry.relativePath);
  const selectedEntry = selectedPaths.size === 1
    ? options.entries.find((entry) => selectedPaths.has(entry.relativePath)) ?? null
    : null;
  const allEntriesSelected = options.entries.length > 0 && selectedRelativePaths.length === options.entries.length;

  const resetSelection = (): void => {
    setSelectedPaths(new Set());
    setLastSelectedIndex(null);
    setContextMenu(null);
  };
  const selectEntryRange = (targetIndex: number, additive: boolean): void => {
    if (lastSelectedIndex === null || targetIndex < 0 || targetIndex >= sortedEntries.length) {
      return;
    }
    const start = Math.min(lastSelectedIndex, targetIndex);
    const end = Math.max(lastSelectedIndex, targetIndex);
    setSelectedPaths((previous) => {
      const next = additive ? new Set(previous) : new Set<string>();
      for (let index = start; index <= end; index += 1) {
        const entry = sortedEntries[index];
        if (entry) {
          next.add(entry.relativePath);
        }
      }
      return next;
    });
  };
  const onEntryClick = (entry: ProjectFileEntry, index: number, event: MouseEvent): void => {
    if (event.shiftKey && lastSelectedIndex !== null) {
      selectEntryRange(index, event.metaKey || event.ctrlKey);
    } else if (event.ctrlKey || event.metaKey) {
      setSelectedPaths((previous) => togglePath(previous, entry.relativePath));
    } else {
      setSelectedPaths(new Set([entry.relativePath]));
    }
    setLastSelectedIndex(index);
  };
  const onCheckboxClick = (entry: ProjectFileEntry, index: number, event: MouseEvent<HTMLInputElement>): void => {
    event.stopPropagation();
    if (event.shiftKey && lastSelectedIndex !== null) {
      selectEntryRange(index, true);
    } else {
      setSelectedPaths((previous) => togglePath(previous, entry.relativePath));
    }
    setLastSelectedIndex(index);
  };
  const onContextMenu = (event: MouseEvent, entry?: ProjectFileEntry, index?: number): void => {
    event.preventDefault();
    event.stopPropagation();
    options.onContextMenuOpening();
    if (entry && !selectedPaths.has(entry.relativePath)) {
      setSelectedPaths(new Set([entry.relativePath]));
      setLastSelectedIndex(typeof index === "number" ? index : null);
    }
    setContextMenu({ x: event.clientX, y: event.clientY, path: entry?.relativePath ?? null });
  };

  useEffect(() => setLastSelectedIndex(null), [sortColumn, sortDirection]);
  useEffect(() => {
    const closeContextMenu = (): void => setContextMenu(null);
    document.addEventListener("click", closeContextMenu);
    return () => document.removeEventListener("click", closeContextMenu);
  }, []);

  return {
    sortColumn, sortDirection, viewMode, setViewMode, selectedPaths, setSelectedPaths, setLastSelectedIndex,
    contextMenu, setContextMenu, sortedEntries, selectedRelativePaths, selectedEntry, allEntriesSelected,
    resetSelection,
    onSortToggle: (column: FileSortColumn) => setSortColumn((current) => {
      if (current === column) {
        setSortDirection((direction) => direction === "asc" ? "desc" : "asc");
        return current;
      }
      setSortDirection("asc");
      return column;
    }),
    renderSortIndicator: (column: FileSortColumn) => sortColumn !== column ? "↕" : sortDirection === "asc" ? "↑" : "↓",
    onEntryClick,
    onCheckboxClick,
    onToggleSelectAll: () => setSelectedPaths(allEntriesSelected ? new Set() : new Set(options.entries.map((entry) => entry.relativePath))),
    onEntryDoubleClick: (entry: ProjectFileEntry) => entry.kind === "directory" && options.onOpenDirectory(entry.relativePath),
    onContextMenu
  };
}

function togglePath(paths: Set<string>, relativePath: string): Set<string> {
  const next = new Set(paths);
  if (next.has(relativePath)) {
    next.delete(relativePath);
  } else {
    next.add(relativePath);
  }
  return next;
}
