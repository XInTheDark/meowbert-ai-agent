import { TaskMessage } from "../lib/types";

const ROOT_PARENT_KEY = "__root__";

function compareMessagesAsc(a: TaskMessage, b: TaskMessage): number {
  const aTime = new Date(a.created_at).getTime();
  const bTime = new Date(b.created_at).getTime();
  if (aTime !== bTime) {
    return aTime - bTime;
  }
  return a.id.localeCompare(b.id);
}

function compareMessagesDesc(a: TaskMessage, b: TaskMessage): number {
  return compareMessagesAsc(b, a);
}

function getParentKey(parentId: string | null): string {
  return parentId ?? ROOT_PARENT_KEY;
}

function getMessagePathToLeaf(byId: Map<string, TaskMessage>, leafMessageId: string): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = leafMessageId;

  while (cursor) {
    if (seen.has(cursor)) {
      break;
    }
    seen.add(cursor);

    const message = byId.get(cursor);
    if (!message) {
      break;
    }

    path.push(message.id);
    cursor = message.parent_message_id;
  }

  return path.reverse();
}

function resolveNewestLeafMessageId(
  messages: TaskMessage[],
  childrenByParent: Map<string, TaskMessage[]>
): string | null {
  const leaves = messages.filter((message) => {
    const children = childrenByParent.get(getParentKey(message.id)) ?? [];
    return children.length === 0;
  });

  if (leaves.length === 0) {
    return null;
  }

  leaves.sort(compareMessagesDesc);
  return leaves[0].id;
}

function resolveNewestDescendantLeafMessageId(
  messageId: string,
  childrenByParent: Map<string, TaskMessage[]>
): string | null {
  const seen = new Set<string>();
  let cursorId: string | null = messageId;

  while (cursorId) {
    if (seen.has(cursorId)) {
      return cursorId;
    }
    seen.add(cursorId);

    const children: TaskMessage[] = childrenByParent.get(getParentKey(cursorId)) ?? [];
    if (children.length === 0) {
      return cursorId;
    }

    const newestChild: TaskMessage | undefined = children[children.length - 1];
    cursorId = newestChild?.id ?? null;
  }

  return null;
}

export interface TaskMessageTree {
  byId: Map<string, TaskMessage>;
  childrenByParent: Map<string, TaskMessage[]>;
  activeLeafMessageId: string | null;
  activePathMessageIds: string[];
  activeMessages: TaskMessage[];
}

export function buildTaskMessageTree(messages: TaskMessage[], requestedLeafMessageId: string | null): TaskMessageTree {
  const byId = new Map<string, TaskMessage>();
  const childrenByParent = new Map<string, TaskMessage[]>();

  for (const message of messages) {
    byId.set(message.id, message);

    const parentKey = getParentKey(message.parent_message_id);
    const children = childrenByParent.get(parentKey) ?? [];
    children.push(message);
    childrenByParent.set(parentKey, children);
  }

  for (const children of childrenByParent.values()) {
    children.sort(compareMessagesAsc);
  }

  const activeLeafMessageId =
    requestedLeafMessageId && byId.has(requestedLeafMessageId)
      ? resolveNewestDescendantLeafMessageId(requestedLeafMessageId, childrenByParent)
      : resolveNewestLeafMessageId(messages, childrenByParent);
  const activePathMessageIds = activeLeafMessageId ? getMessagePathToLeaf(byId, activeLeafMessageId) : [];
  const activeMessages = activePathMessageIds
    .map((messageId) => byId.get(messageId))
    .filter((message): message is TaskMessage => Boolean(message));

  return {
    byId,
    childrenByParent,
    activeLeafMessageId,
    activePathMessageIds,
    activeMessages
  };
}

export function getSiblingsForMessage(tree: TaskMessageTree, message: TaskMessage): TaskMessage[] {
  const parentKey = getParentKey(message.parent_message_id);
  return tree.childrenByParent.get(parentKey) ?? [message];
}

export function resolveLeafFromMessage(tree: TaskMessageTree, messageId: string): string | null {
  let cursorId: string | null = tree.byId.has(messageId) ? messageId : null;

  while (cursorId) {
    const children = tree.childrenByParent.get(getParentKey(cursorId)) ?? [];
    if (children.length === 0) {
      return cursorId;
    }
    const newestChild = [...children].sort(compareMessagesDesc)[0];
    cursorId = newestChild?.id ?? null;
  }

  return null;
}
