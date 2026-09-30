import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { ChevronDown, ChevronUp, Search, X } from "lucide-react";
import type { ApiClient } from "../../../lib/api";
import type {
  TaskConversationSearchResult,
  TaskConversationSearchResponse
} from "../../../lib/types";

interface TaskConversationSearchPanelProps {
  api: ApiClient;
  taskId: string;
  activeLeafMessageId: string | null;
  chatFeedRef: RefObject<HTMLDivElement>;
  isMobileDrawer: boolean;
  onResultSelected: (result: TaskConversationSearchResult) => void;
  onSelectedResultChange: (messageId: string | null) => void;
  onClose?: () => void;
}

export function TaskConversationSearchPanel(props: TaskConversationSearchPanelProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [committedQuery, setCommittedQuery] = useState("");
  const [results, setResults] = useState<TaskConversationSearchResponse | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    const input = inputRef.current;
    if (input) {
      input.focus();
      input.select();
    }
  }, []);

  const runSearch = useCallback(async (searchQuery: string, page: number, initialIndex?: number) => {
    if (!searchQuery.trim()) {
      return;
    }

    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        q: searchQuery.trim(),
        page: String(page)
      });
      if (props.activeLeafMessageId) {
        params.set("activeLeafMessageId", props.activeLeafMessageId);
      }

      const response = await props.api.get<TaskConversationSearchResponse>(
        `/api/tasks/${props.taskId}/conversation/search?${params.toString()}`
      );

      if (requestIdRef.current !== requestId) {
        return;
      }

      setResults(response);
      setCommittedQuery(searchQuery.trim());
      if (response.items.length > 0) {
        const targetIndex = typeof initialIndex === "number"
          ? Math.min(initialIndex, response.items.length - 1)
          : 0;
        setSelectedIndex(targetIndex);
        const item = response.items[targetIndex];
        if (item) {
          props.onResultSelected(item);
          props.onSelectedResultChange(item.messageId);
        }
      } else {
        setSelectedIndex(-1);
        props.onSelectedResultChange(null);
      }
    } catch (err) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      setError(err instanceof Error ? err.message : "Search failed");
    } finally {
      if (requestIdRef.current === requestId) {
        setIsLoading(false);
      }
    }
  }, [props.activeLeafMessageId, props.api, props.onResultSelected, props.onSelectedResultChange, props.taskId]);

  function selectResult(index: number): void {
    if (!results || results.items.length === 0) {
      return;
    }

    const clampedIndex = Math.max(0, Math.min(index, results.items.length - 1));
    setSelectedIndex(clampedIndex);
    const item = results.items[clampedIndex];
    if (item) {
      props.onResultSelected(item);
      props.onSelectedResultChange(item.messageId);
    }
  }

  function goToNext(): void {
    if (!results || results.items.length === 0) {
      return;
    }

    if (selectedIndex < results.items.length - 1) {
      selectResult(selectedIndex + 1);
      return;
    }

    if (results.hasNextPage) {
      void runSearch(committedQuery, results.page + 1);
    }
  }

  function goToPrevious(): void {
    if (!results || results.items.length === 0) {
      return;
    }

    if (selectedIndex > 0) {
      selectResult(selectedIndex - 1);
      return;
    }

    if (results.hasPreviousPage) {
      void runSearch(committedQuery, results.page - 1, results.pageSize - 1);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === "Enter") {
      event.preventDefault();

      if (query !== committedQuery) {
        void runSearch(query, 1);
        return;
      }

      if (event.shiftKey) {
        goToPrevious();
      } else {
        goToNext();
      }
    }
  }

  function handleSubmit(): void {
    if (query !== committedQuery) {
      void runSearch(query, 1);
    } else {
      goToNext();
    }
  }

  function getGlobalIndex(itemIndex: number): number {
    if (!results) {
      return itemIndex;
    }
    return (results.page - 1) * results.pageSize + itemIndex + 1;
  }

  useEffect(() => {
    props.onSelectedResultChange(null);
    return () => {
      props.onSelectedResultChange(null);
    };
  }, []);

  return (
    <aside className={`task-search-panel${props.isMobileDrawer ? " mobile-drawer" : ""}`}>
      <div className="task-search-panel-header">
        <div className="task-search-panel-header-text">
          <strong><Search size={15} /> Search</strong>
        </div>
        {props.onClose ? (
          <button
            type="button"
            className="task-search-panel-close-btn"
            onClick={props.onClose}
            aria-label="Close search"
            title="Close search"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      <div className="task-search-panel-input-row">
        <input
          ref={inputRef}
          type="text"
          className="task-search-panel-input"
          placeholder="Search conversation..."
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <button
          type="button"
          className="task-search-panel-search-btn"
          onClick={handleSubmit}
          disabled={isLoading || !query.trim()}
          title="Search"
          aria-label="Search"
        >
          <Search size={14} />
        </button>
      </div>

      {results && results.totalItems > 0 ? (
        <div className="task-search-panel-nav">
          <span className="task-search-panel-count">
            {selectedIndex >= 0 ? getGlobalIndex(selectedIndex) : "–"} of {results.totalItems}
          </span>
          <div className="task-search-panel-nav-buttons">
            <button
              type="button"
              className="task-search-panel-nav-btn"
              onClick={goToPrevious}
              disabled={selectedIndex <= 0 && !results.hasPreviousPage}
              title="Previous result (Shift+Enter)"
              aria-label="Previous result"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              className="task-search-panel-nav-btn"
              onClick={goToNext}
              disabled={selectedIndex >= results.items.length - 1 && !results.hasNextPage}
              title="Next result (Enter)"
              aria-label="Next result"
            >
              <ChevronDown size={14} />
            </button>
          </div>
        </div>
      ) : null}

      <div className="task-search-panel-results" ref={listRef}>
        {isLoading ? (
          <p className="task-search-panel-status">Searching...</p>
        ) : null}

        {error ? (
          <p className="task-search-panel-status task-search-panel-error">{error}</p>
        ) : null}

        {!isLoading && !error && results && results.totalItems === 0 && committedQuery ? (
          <p className="task-search-panel-status">No results found.</p>
        ) : null}

        {!isLoading && !error && !results ? (
          <p className="task-search-panel-status task-search-panel-hint">
            Type a query and press Enter to search.
          </p>
        ) : null}

        {results && results.items.length > 0 ? (
          <div className="task-search-panel-result-list">
            {results.items.map((item, itemIndex) => (
              <button
                key={`${item.messageId}-${getGlobalIndex(itemIndex)}`}
                type="button"
                className={`task-search-panel-result${itemIndex === selectedIndex ? " active" : ""}`}
                onClick={() => selectResult(itemIndex)}
              >
                <span className={`task-search-panel-result-role task-search-panel-result-role-${item.role}`}>
                  {item.role === "assistant" ? "A" : "U"}
                </span>
                <span className="task-search-panel-result-main">
                  <span className="task-search-panel-result-meta">
                    <span className="task-search-panel-result-index">#{item.messageIndex + 1}</span>
                    <span className="task-search-panel-result-number">#{getGlobalIndex(itemIndex)}</span>
                  </span>
                  <span className="task-search-panel-result-snippet">
                    {item.snippetBefore}
                    <mark>{item.matchText}</mark>
                    {item.snippetAfter}
                  </span>
                </span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}
