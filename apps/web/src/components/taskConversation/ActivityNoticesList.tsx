import type { TaskMessage } from "../../lib/types";
import { getMessageText, formatDateTime } from "../../lib/utils";
import { RetryStatusError } from "./RetryStatusError";

export function ActivityNoticesList({ notices }: { notices: TaskMessage[] }): JSX.Element {
  return (
    <ol className="activity-notices-list">
      {notices.map((notice) => (
        <li key={notice.id}>
          <time dateTime={notice.created_at}>{formatDateTime(notice.created_at)}</time>
          <RetryStatusError error={getMessageText(notice)} />
        </li>
      ))}
    </ol>
  );
}
