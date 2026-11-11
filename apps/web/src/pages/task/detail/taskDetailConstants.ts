export type TaskDetailTab = "conversation" | "events" | "notifications" | "shells" | "artifacts" | "debug";

export const MOBILE_VIEWPORT_QUERY = "(max-width: 1120px)";
export const MESSAGE_CHUNK_SIZE = 50;
// Older pages are mostly collapsed tool calls that add little height, so fetch more per request.
export const MESSAGE_OLDER_CHUNK_SIZE = 200;
export const MESSAGE_MAX_WINDOW_ITEMS = 1200;
export const MESSAGE_CACHE_MAX_ITEMS = 1200;
export const EVENT_CHUNK_SIZE = 120;
export const EVENT_MAX_WINDOW_ITEMS = 600;
export const EVENT_LIVE_BUFFER_MAX_ITEMS = 200;
export const SCROLL_EDGE_THRESHOLD_PX = 200;
export const NEAR_BOTTOM_THRESHOLD_PX = 140;
