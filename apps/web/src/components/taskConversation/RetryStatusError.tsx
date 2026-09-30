import { useState } from "react";

const RETRY_ERROR_COLLAPSED_LINE_COUNT = 6;
const RETRY_ERROR_COLLAPSED_CHAR_COUNT = 360;

export function RetryStatusError({ error }: { error: string }): JSX.Element {
  const normalized = error.trimEnd();
  const lineCount = normalized.length === 0 ? 1 : normalized.split("\n").length;
  const isLong =
    lineCount > RETRY_ERROR_COLLAPSED_LINE_COUNT
    || normalized.length > RETRY_ERROR_COLLAPSED_CHAR_COUNT;
  const [isExpanded, setIsExpanded] = useState(!isLong);
  const isCollapsed = isLong && !isExpanded;

  return (
    <div className="retry-status-error">
      <div className={`retry-status-error-shell${isCollapsed ? " collapsed" : ""}`}>
        <pre>{normalized.length > 0 ? normalized : "(empty)"}</pre>
        {isCollapsed ? <div className="retry-status-error-fade" aria-hidden="true" /> : null}
      </div>
      {isLong ? (
        <button
          type="button"
          className="retry-status-error-toggle"
          onClick={() => setIsExpanded((current) => !current)}
        >
          {isExpanded ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
