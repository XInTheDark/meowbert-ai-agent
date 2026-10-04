import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { isTaskMessageExpanded, persistTaskMessageExpanded } from "../../task/taskMessageExpansionPreferences";

// Folds a finished activity group down to one line; the open state is remembered per group.
export function CompletedActivityDisclosure(props: {
  title: string;
  count: number;
  secondaryLabel?: string | null;
  expansionKey?: string;
  active?: boolean;
  children: ReactNode;
}): JSX.Element {
  const [isExpanded, setIsExpanded] = useState(() => isTaskMessageExpanded(props.expansionKey));

  useEffect(() => {
    setIsExpanded(isTaskMessageExpanded(props.expansionKey));
  }, [props.expansionKey]);

  const toggleExpanded = useCallback((): void => {
    setIsExpanded((current) => {
      persistTaskMessageExpanded(props.expansionKey, !current);
      return !current;
    });
  }, [props.expansionKey]);

  const meta = [`${props.count} call${props.count === 1 ? "" : "s"}`, props.secondaryLabel].filter(Boolean).join(" · ");

  return (
    <div className={`activity-disclosure${isExpanded ? " expanded" : ""}`}>
      <button
        type="button"
        className={`activity-disclosure-toggle${props.active && !isExpanded ? " active" : ""}`}
        aria-expanded={isExpanded}
        onClick={toggleExpanded}
      >
        <span className="activity-disclosure-title">{props.title}</span>
        <span className="activity-disclosure-meta">{meta}</span>
        <ChevronRight size={14} className="activity-disclosure-chevron" aria-hidden="true" />
      </button>
      {isExpanded ? <div className="activity-disclosure-body">{props.children}</div> : null}
    </div>
  );
}
