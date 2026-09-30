export {
  buildWorkspaceMemoryEnvVars,
  ensureProjectMemoryDir,
  ensureWorkspaceMemoryDir,
  readProjectMemoryMainFile,
  readWorkspaceMemoryMainFile
} from "./shared.js";
export type {
  MemoryMainFile,
  MemorySearchResult,
  MemorySearchResultItem,
  MemorySearchScope,
  MemorySyncStatus
} from "./shared.js";
export { readMemorySyncStatus } from "./storage.js";
export { searchMemoryIndex } from "./search.js";
export {
  ensureWorkspaceMemoryWatcher,
  stopWorkspaceMemoryWatchers,
  syncWorkspaceMemoryNow
} from "./watcher.js";
