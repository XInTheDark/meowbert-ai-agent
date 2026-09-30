import type { ThoughtSummaryContentProps } from "./ThoughtSummaryBubble";
import { ToolActivitySummaryCard } from "./ToolActivitySummaryCard";
import type { TaskMessage } from "../../lib/types";
import { getToolGroupSummary } from "./shared";

export function ToolGroupBubble(props: {
  toolGroup: TaskMessage[];
  groupKey: string;
  messageIds?: string[];
  hydratedMessageIds: Set<string>;
  onExpandRequested?: (messageIds: string[]) => void;
  isSelected?: boolean;
  onInspectRequested?: (selection: {
    groupKey: string;
    toolGroup: TaskMessage[];
    thoughtSummary?: ThoughtSummaryContentProps;
  }) => void;
  thoughtSummary?: ThoughtSummaryContentProps;
}): JSX.Element {
  const {
    toolGroup,
    groupKey,
    hydratedMessageIds,
    onExpandRequested,
    isSelected = false,
    onInspectRequested,
    thoughtSummary
  } = props;
  const toolMessageIds = toolGroup.map((toolMessage) => toolMessage.id);
  const summary = getToolGroupSummary(toolGroup);

  function handleInspectRequested(): void {
    const allHydrated = toolMessageIds.every((messageId) => hydratedMessageIds.has(messageId));
    if (!allHydrated) {
      onExpandRequested?.(toolMessageIds);
    }

    onInspectRequested?.({
      groupKey,
      toolGroup,
      thoughtSummary
    });
  }

  return (
    <div
      key={groupKey}
      className="chat-bubble tool-group"
      data-message-id={toolGroup[0]?.id}
      data-last-message-id={toolGroup[toolGroup.length - 1]?.id}
      data-message-ids={[...new Set([...toolMessageIds, ...(props.messageIds ?? [])])].join(" ")}
    >
      <ToolActivitySummaryCard
        kicker="Activity"
        title={summary.label}
        count={summary.count}
        preview={summary.preview}
        secondaryLabel={thoughtSummary?.label ?? null}
        active={isSelected}
        onClick={handleInspectRequested}
      />
    </div>
  );
}
