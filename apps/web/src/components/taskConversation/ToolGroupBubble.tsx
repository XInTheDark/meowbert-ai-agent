import { CompletedActivityDisclosure } from "./CompletedActivityDisclosure";
import { ToolActivitySummaryCard } from "./ToolActivitySummaryCard";
import type { TaskMessage } from "../../lib/types";
import type { ActivityTurnState } from "../../task/activityTurnState";
import { getToolGroupStepSummaries } from "../../task/activityStepSummaries";
import { getToolGroupSummary, type ActivityThoughtSummary } from "./shared";

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
    thoughtSummary?: ActivityThoughtSummary;
  }) => void;
  thoughtSummary?: ActivityThoughtSummary;
  collapsed?: boolean;
  running?: boolean;
  turnState?: ActivityTurnState;
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
      progress={props.turnState?.progress ?? null}
      artifactPaths={props.turnState?.artifactPaths ?? []}
      running={props.running === true}
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
