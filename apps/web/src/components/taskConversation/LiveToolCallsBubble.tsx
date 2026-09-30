import { ToolActivitySummaryCard } from "./ToolActivitySummaryCard";
import type { LiveToolCall } from "../../lib/types";
import { getLiveToolCallsPreview } from "./shared";

export function LiveToolCallsBubble(props: {
  liveToolCalls: LiveToolCall[];
  isSelected?: boolean;
  onInspectRequested?: (selection: {
    groupKey: string;
    liveToolCalls: LiveToolCall[];
  }) => void;
}): JSX.Element {
  const liveToolGroupKey = "live-tool-calls";
  const preview = getLiveToolCallsPreview(props.liveToolCalls);

  return (
    <div key="live-tool-calls" className="chat-bubble tool-group">
      <ToolActivitySummaryCard
        kicker="Running now"
        title="Live tool activity"
        count={props.liveToolCalls.length}
        preview={preview}
        badgeTone="running"
        active={props.isSelected === true}
        onClick={() =>
          props.onInspectRequested?.({
            groupKey: liveToolGroupKey,
            liveToolCalls: props.liveToolCalls
          })
        }
      />
    </div>
  );
}
