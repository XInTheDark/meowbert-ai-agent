import { useEffect, useState, type MouseEvent as ReactMouseEvent } from "react";
import {
  readTaskMessageOutlineOpenPreference,
  writeTaskMessageOutlineOpenPreference
} from "../../../task/taskMessageOutlinePreferences";
import {
  DEFAULT_TASK_RIGHT_SIDEBAR_WIDTH,
  MAX_TASK_RIGHT_SIDEBAR_WIDTH,
  MIN_TASK_RIGHT_SIDEBAR_WIDTH,
  readTaskRightSidebarWidthPreference,
  writeTaskRightSidebarWidthPreference
} from "../../../task/taskRightSidebarWidthPreferences";
import { MOBILE_VIEWPORT_QUERY } from "./taskDetailConstants";

function getDefaultMessageOutlineOpenState(): boolean {
  return false;
}

export function useTaskDetailLayoutState(taskId: string) {
  const [isMobileViewport, setIsMobileViewport] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
  });
  const [isMobileInputExpanded, setIsMobileInputExpanded] = useState(() => {
    if (typeof window === "undefined") {
      return true;
    }
    return !window.matchMedia(MOBILE_VIEWPORT_QUERY).matches;
  });
  const [threadSidebarWidth, setThreadSidebarWidth] = useState(() => (
    readTaskRightSidebarWidthPreference(DEFAULT_TASK_RIGHT_SIDEBAR_WIDTH)
  ));
  const [isMessageOutlineOpen, setIsMessageOutlineOpen] = useState(() => (
    readTaskMessageOutlineOpenPreference(getDefaultMessageOutlineOpenState())
  ));

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const mediaQuery = window.matchMedia(MOBILE_VIEWPORT_QUERY);
    setIsMobileViewport(mediaQuery.matches);

    const handleViewportChange = (event: MediaQueryListEvent) => {
      setIsMobileViewport(event.matches);
    };

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleViewportChange);
      return () => mediaQuery.removeEventListener("change", handleViewportChange);
    }

    mediaQuery.addListener(handleViewportChange);
    return () => mediaQuery.removeListener(handleViewportChange);
  }, []);

  useEffect(() => {
    setIsMobileInputExpanded(!isMobileViewport);
  }, [isMobileViewport, taskId]);

  useEffect(() => {
    writeTaskMessageOutlineOpenPreference(isMessageOutlineOpen);
  }, [isMessageOutlineOpen]);

  useEffect(() => {
    writeTaskRightSidebarWidthPreference(threadSidebarWidth);
  }, [threadSidebarWidth]);

  function beginThreadSidebarResize(event: ReactMouseEvent<HTMLDivElement>): void {
    const initialPointerX = event.clientX;
    const initialWidth = threadSidebarWidth;

    const handlePointerMove = (moveEvent: MouseEvent): void => {
      const deltaX = initialPointerX - moveEvent.clientX;
      const nextWidth = Math.min(Math.max(initialWidth + deltaX, MIN_TASK_RIGHT_SIDEBAR_WIDTH), MAX_TASK_RIGHT_SIDEBAR_WIDTH);
      setThreadSidebarWidth(nextWidth);
    };

    const handlePointerUp = (): void => {
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerUp);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    };

    document.body.style.setProperty("cursor", "col-resize");
    document.body.style.setProperty("user-select", "none");
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerUp);
  }

  return {
    isMobileViewport,
    isMobileInputExpanded,
    setIsMobileInputExpanded,
    threadSidebarWidth,
    isMessageOutlineOpen,
    setIsMessageOutlineOpen,
    beginThreadSidebarResize
  };
}
