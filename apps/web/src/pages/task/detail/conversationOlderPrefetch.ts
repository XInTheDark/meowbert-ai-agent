import { SCROLL_EDGE_THRESHOLD_PX } from "./taskDetailConstants";

/** How many screens above the reader older messages start loading, so the page lands before the top is reached. */
const OLDER_PREFETCH_VIEWPORTS = 1.5;

/** Whether the reader is close enough to the top of the loaded window to fetch the page before it. */
export function isWithinOlderPrefetchDistance(feed: HTMLElement): boolean {
  const distance = Math.max(SCROLL_EDGE_THRESHOLD_PX, feed.clientHeight * OLDER_PREFETCH_VIEWPORTS);
  return feed.scrollTop <= distance;
}
