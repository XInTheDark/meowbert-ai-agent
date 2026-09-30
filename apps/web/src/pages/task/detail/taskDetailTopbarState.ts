export const MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX = 40;

interface NextTopbarCollapsedStateInput {
  currentScrollTop: number;
  previousScrollTop: number;
  wasCollapsed: boolean;
}

export function getNextTopbarCollapsedState(input: NextTopbarCollapsedStateInput): boolean {
  const scrollingDown = input.currentScrollTop > input.previousScrollTop;
  if (input.currentScrollTop > MOBILE_TOPBAR_COLLAPSE_SCROLL_TOP_PX && scrollingDown) {
    return true;
  }

  return input.wasCollapsed;
}
