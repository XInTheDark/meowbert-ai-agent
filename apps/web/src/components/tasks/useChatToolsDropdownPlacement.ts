import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type RefObject
} from "react";

export type ChatToolsPopoverPlacement =
  | "auto"
  | "top"
  | "bottom"
  | "top-start"
  | "top-end"
  | "bottom-start"
  | "bottom-end";

export const PREFERRED_MAX_POPOVER_HEIGHT_PX = 440;

export interface ChatToolsDropdownPlacementOptions {
  triggerRef: RefObject<HTMLElement>;
  popoverRef?: RefObject<HTMLDivElement>;
  isOpen: boolean;
  placement?: ChatToolsPopoverPlacement;
  variant?: "icon" | "button";
}

export interface ChatToolsDropdownPlacementResult {
  popoverRef: RefObject<HTMLDivElement>;
  popoverStyle: CSSProperties | undefined;
  popoverClassName: string;
}

interface ContainerBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export function getClippingContainerBounds(element: HTMLElement): ContainerBounds {
  let top = 0;
  let bottom = window.innerHeight;
  let left = 0;
  let right = window.innerWidth;

  let parent = element.parentElement;
  while (parent && parent !== document.body) {
    const style = window.getComputedStyle(parent);
    const isScrollableY =
      style.overflowY === "auto" || style.overflowY === "scroll" || style.overflowY === "hidden";
    const isScrollableX =
      style.overflowX === "auto" || style.overflowX === "scroll" || style.overflowX === "hidden";

    if (isScrollableY || isScrollableX) {
      const rect = parent.getBoundingClientRect();
      if (isScrollableY) {
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
      }
      if (isScrollableX) {
        left = Math.max(left, rect.left);
        right = Math.min(right, rect.right);
      }
    }
    parent = parent.parentElement;
  }

  return { top, bottom, left, right };
}

function resolveVerticalDirection(
  triggerRect: DOMRect,
  bounds: ContainerBounds,
  placement?: ChatToolsPopoverPlacement,
  variant?: "icon" | "button"
): "top" | "bottom" {
  if (placement === "bottom" || placement === "bottom-start" || placement === "bottom-end") {
    return "bottom";
  }
  if (placement === "top" || placement === "top-start" || placement === "top-end") {
    return "top";
  }
  if (variant === "button") {
    return "bottom";
  }

  const spaceAbove = triggerRect.top - bounds.top;
  const spaceBelow = bounds.bottom - triggerRect.bottom;

  if (spaceAbove < 240 && spaceBelow > spaceAbove) {
    return "bottom";
  }
  if (spaceBelow < 240 && spaceAbove >= spaceBelow) {
    return "top";
  }
  return spaceAbove >= 240 ? "top" : "bottom";
}

function computePlacementStyle(
  trigger: HTMLElement,
  popover: HTMLElement | null,
  options: { placement?: ChatToolsPopoverPlacement; variant?: "icon" | "button" }
): { style: CSSProperties; direction: "top" | "bottom" } {
  const triggerRect = trigger.getBoundingClientRect();
  const bounds = getClippingContainerBounds(trigger);
  const direction = resolveVerticalDirection(triggerRect, bounds, options.placement, options.variant);
  const isEndAligned = options.placement === "top-end" || options.placement === "bottom-end";

  const nextStyle: CSSProperties = {
    top: direction === "bottom" ? "calc(100% + 0.35rem)" : "auto",
    bottom: direction === "top" ? "calc(100% + 0.35rem)" : "auto"
  };

  const availableHeight = direction === "bottom"
    ? bounds.bottom - triggerRect.bottom - 12
    : triggerRect.top - bounds.top - 12;

  const clampedMaxHeight = Math.min(PREFERRED_MAX_POPOVER_HEIGHT_PX, Math.floor(availableHeight));
  nextStyle.maxHeight = `${Math.max(0, clampedMaxHeight)}px`;

  if (isEndAligned) {
    nextStyle.left = "auto";
    nextStyle.right = 0;
    return { style: nextStyle, direction };
  }

  const popoverWidth = popover?.offsetWidth || 300;
  const projectedRight = triggerRect.left + popoverWidth;
  const maxAllowedRight = bounds.right - 8;
  let shiftX = 0;

  if (projectedRight > maxAllowedRight) {
    shiftX = Math.min(0, maxAllowedRight - projectedRight);
  }

  const minAllowedLeft = bounds.left + 8;
  if (triggerRect.left + shiftX < minAllowedLeft) {
    shiftX = minAllowedLeft - triggerRect.left;
  }

  if (shiftX !== 0) {
    nextStyle.left = `${shiftX}px`;
    nextStyle.right = "auto";
  }

  return { style: nextStyle, direction };
}

export function useChatToolsDropdownPlacement(
  options: ChatToolsDropdownPlacementOptions
): ChatToolsDropdownPlacementResult {
  const internalPopoverRef = useRef<HTMLDivElement>(null);
  const popoverRef = options.popoverRef ?? internalPopoverRef;

  const getInitialDirection = (): "top" | "bottom" => {
    if (
      options.placement === "bottom"
      || options.placement === "bottom-start"
      || options.placement === "bottom-end"
      || options.variant === "button"
    ) {
      return "bottom";
    }
    return "top";
  };

  const initialDir = getInitialDirection();
  const [direction, setDirection] = useState<"top" | "bottom">(initialDir);
  const [style, setStyle] = useState<CSSProperties | undefined>(() => ({
    top: initialDir === "bottom" ? "calc(100% + 0.35rem)" : "auto",
    bottom: initialDir === "top" ? "calc(100% + 0.35rem)" : "auto"
  }));

  const update = useCallback(() => {
    if (!options.isOpen) {
      return;
    }
    const trigger = options.triggerRef.current;
    if (!trigger) {
      return;
    }

    const { style: nextStyle, direction: nextDirection } = computePlacementStyle(
      trigger,
      popoverRef.current,
      { placement: options.placement, variant: options.variant }
    );

    setDirection(nextDirection);
    setStyle(nextStyle);
  }, [options.isOpen, options.placement, options.triggerRef, options.variant, popoverRef]);

  useLayoutEffect(() => {
    if (!options.isOpen) {
      return;
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [options.isOpen, update]);

  return {
    popoverRef,
    popoverStyle: style,
    popoverClassName: direction === "bottom" ? "placement-bottom" : "placement-top"
  };
}
