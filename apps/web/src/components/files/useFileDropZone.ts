import { useState, type DragEvent } from "react";

// Tracks drag-over state for an element that accepts dropped files.
export function useFileDropZone(onDropFiles: (files: FileList) => void) {
  const [isDragOver, setIsDragOver] = useState(false);
  return {
    isDragOver,
    dropZoneHandlers: {
      onDragOver: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setIsDragOver(true);
      },
      onDragLeave: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragOver(false);
        }
      },
      onDrop: (event: DragEvent<HTMLElement>) => {
        event.preventDefault();
        setIsDragOver(false);
        onDropFiles(event.dataTransfer.files);
      }
    }
  };
}
