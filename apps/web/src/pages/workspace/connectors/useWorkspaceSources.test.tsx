/** @vitest-environment jsdom */

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SetURLSearchParams } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApiClient } from "../../../lib/api";
import { useWorkspaceSources } from "./useWorkspaceSources";

function createApiClientMock(): ApiClient {
  const getImpl: ApiClient["get"] = async <T,>(path: string): Promise<T> => {
    if (path.endsWith("/sources")) {
      return {
        sources: [],
        canManage: true
      } as T;
    }

    throw new Error(`Unexpected path: ${path}`);
  };
  const get = vi.fn(getImpl) as ApiClient["get"];

  return {
    get,
    post: vi.fn() as ApiClient["post"],
    postForm: vi.fn() as ApiClient["postForm"],
    patch: vi.fn() as ApiClient["patch"],
    put: vi.fn() as ApiClient["put"],
    delete: vi.fn() as ApiClient["delete"]
  };
}

function HookHarness(props: {
  api: ApiClient;
  searchParams: URLSearchParams;
  setSearchParams: SetURLSearchParams;
}) {
  const setFlash = useMemo(() => vi.fn(), []);
  const platform = useMemo(() => ({ openExternal: vi.fn(async () => undefined) }), []);

  useWorkspaceSources({
    api: props.api,
    activeWorkspaceId: "ws_1",
    capabilities: { isDesktop: false },
    platform,
    searchParams: props.searchParams,
    setSearchParams: props.setSearchParams,
    setFlash
  });

  return <div />;
}

describe("useWorkspaceSources", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  let container: HTMLDivElement | null = null;
  let root: Root | null = null;

  afterEach(async () => {
    if (root) {
      await act(async () => {
        root?.unmount();
      });
    }

    container?.remove();
    container = null;
    root = null;
  });

  it("clears source oauth status without dropping a newer tab query param", async () => {
    const api = createApiClientMock();
    const setSearchParams = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <HookHarness
          api={api}
          searchParams={new URLSearchParams("source_oauth=success")}
          setSearchParams={setSearchParams}
        />
      );
    });

    expect(setSearchParams).toHaveBeenCalledTimes(1);
    expect(setSearchParams).toHaveBeenCalledWith(expect.any(Function), { replace: true });

    const updater = setSearchParams.mock.calls[0]?.[0] as ((params: URLSearchParams) => URLSearchParams);
    const nextParams = updater(new URLSearchParams("source_oauth=success&tab=sources"));

    expect(nextParams.toString()).toBe("tab=sources");
  });
});
