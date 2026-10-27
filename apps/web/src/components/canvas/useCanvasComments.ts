import { useEffect, useMemo, useState } from "react";
import type { CanvasComment } from "@meowbert/shared";
import type { CanvasElementSelection } from "@meowbert/shared/canvas-frame";
import type { CanvasCommentClient } from "./canvasCommentClient";
import { getCanvasViewKey, type CanvasView } from "./canvasViews";

export function useCanvasComments(client: CanvasCommentClient | undefined, view: CanvasView, revision = 0) {
  const key = getCanvasViewKey(view);
  const scope = useMemo(() => ({ key, version: 0, mutations: new Map<string, { version: number; comment: CanvasComment }>() }), [client, key]);
  const [state, setState] = useState({ scope, items: [] as CanvasComment[], pending: false, error: "" });
  const current = state.scope === scope ? state : { scope, items: [], pending: true, error: "" };
  useEffect(() => {
    let cancelled = false;
    const version = scope.version;
    setState((state) => ({ scope, items: state.scope === scope ? state.items : [], pending: Boolean(client), error: "" }));
    if (client) void client.list(view).then((items) => {
      if (cancelled) return;
      const merged = new Map(items.map((item) => [item.id, item]));
      for (const mutation of scope.mutations.values()) {
        if (mutation.version > version) merged.set(mutation.comment.id, mutation.comment);
      }
      setState({ scope, items: [...merged.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)), pending: false, error: "" });
    }).catch((error: unknown) => {
      if (!cancelled) setState((state) => state.scope !== scope ? state : { ...state, pending: false, error: String(error) });
    });
    return () => { cancelled = true; };
  }, [client, scope, revision]);

  async function mutate(operation: () => Promise<CanvasComment>): Promise<boolean> {
    setState((state) => ({ ...state, pending: true, error: "" }));
    try {
      const comment = await operation();
      scope.mutations.set(comment.id, { version: ++scope.version, comment });
      setState((state) => state.scope !== scope ? state : { ...state, pending: false,
        items: [...state.items.filter((item) => item.id !== comment.id), comment].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) });
      return true;
    } catch (error) {
      setState((state) => state.scope !== scope ? state : { ...state, pending: false, error: String(error) });
      return false;
    }
  }
  return { ...current,
    add: (element: CanvasElementSelection, body: string) => client ? mutate(() => client.add(view, element, body)) : Promise.resolve(false),
    resolve: (id: string, resolved: boolean) => client ? mutate(() => client.resolve(view, id, resolved)) : Promise.resolve(false)
  };
}
