import { useCallback, useLayoutEffect, useRef, type RefObject } from "react";

const SCROLL_NEAR_BOTTOM_THRESHOLD_PX = 48;

interface UseToolInspectorScrollOptions {
  groupKey: string | null;
  itemCount: number;
  contentVersion?: unknown;
}

export function useToolInspectorScroll(options: UseToolInspectorScrollOptions): {
  bodyRef: RefObject<HTMLDivElement>;
  handleScroll: () => void;
} {
  const bodyRef = useRef<HTMLDivElement>(null);
  const isNearBottomRef = useRef(true);
  const previousGroupKeyRef = useRef<string | null>(null);

  const handleScroll = useCallback(() => {
    const element = bodyRef.current;
    if (!element) {
      return;
    }
    const distanceFromBottom = element.scrollHeight - element.scrollTop - element.clientHeight;
    isNearBottomRef.current = distanceFromBottom <= SCROLL_NEAR_BOTTOM_THRESHOLD_PX;
  }, []);

  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element || !options.groupKey) {
      return;
    }

    if (previousGroupKeyRef.current !== options.groupKey) {
      previousGroupKeyRef.current = options.groupKey;
      isNearBottomRef.current = true;
      element.scrollTop = 0;
      return;
    }

    if (isNearBottomRef.current) {
      element.scrollTop = element.scrollHeight;
    }
  }, [options.groupKey, options.itemCount, options.contentVersion]);

  return { bodyRef, handleScroll };
}
