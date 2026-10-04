import { CompletedActivityDisclosure } from "./CompletedActivityDisclosure";
import type { ThoughtSummaryContentProps } from "./ThoughtSummaryBubble";
import { ToolActivitySummaryCard } from "./ToolActivitySummaryCard";
import type { TaskMessage } from "../../lib/types";
import { getToolGroupStepSummaries } from "../../task/activityStepSummaries";
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
  collapsed?: boolean;
  expansionKey?: string;
}): JSX.Element {
  const {
    toolGroup,
    groupKey,
    hydratedMessageIds,
    onExpandRequested,
    isSelected = false,
    onInspectRequested,
    thoughtSummary,
    collapsed = false
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

  const card = (
    <ToolActivitySummaryCard
      kicker="Activity"
      title={summary.label}
      count={summary.count}
      preview={summary.preview}
      secondaryLabel={thoughtSummary?.label ?? null}
      steps={getToolGroupStepSummaries(toolGroup)}
      active={isSelected}
      showTitle={!collapsed}
      onClick={handleInspectRequested}
    />
  );

  return (
    <div
      key={groupKey}
      className="chat-bubble tool-group"
      data-message-id={toolGroup[0]?.id}
      data-last-message-id={toolGroup[toolGroup.length - 1]?.id}
      data-message-ids={[...new Set([...toolMessageIds, ...(props.messageIds ?? [])])].join(" ")}
    >
      {collapsed ? (
        <CompletedActivityDisclosure title={summary.label} count={summary.count}
          secondaryLabel={thoughtSummary?.label ?? null} expansionKey={props.expansionKey} active={isSelected}>
          {card}
        </CompletedActivityDisclosure>
      ) : card}
    </div>
  );
}
