import { useState, useMemo, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { createApiClient } from "../../lib/api";
import { Workspace } from "../../lib/types";
import { LoadingScreen } from "../../components/LoadingScreen";
import { loadLastWorkspaceId } from "../workspace/layout/utils";

export function AuthedHomeRedirect(props: { token: string; onTokenInvalid: () => void }) {
  const api = useMemo(() => createApiClient(props.token), [props.token]);
  const [targetPath, setTargetPath] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function resolve(): Promise<void> {
      try {
        const me = await api.get<{ workspaces: Workspace[] }>("/api/auth/me");
        if (cancelled) {
          return;
        }

        const remembered = loadLastWorkspaceId();
        const preferred = me.workspaces.find((workspace) => workspace.id === remembered) ?? me.workspaces[0];

        if (!preferred) {
          props.onTokenInvalid();
          return;
        }

        setTargetPath(`/app/${preferred.id}/projects`);
      } catch {
        if (!cancelled) {
          props.onTokenInvalid();
        }
      }
    }

    resolve().catch(() => props.onTokenInvalid());
    return () => {
      cancelled = true;
    };
  }, [api, props.onTokenInvalid]);

  if (!targetPath) {
    return <LoadingScreen label="Loading your workspace..." />;
  }

  return <Navigate to={targetPath} replace />;
}
