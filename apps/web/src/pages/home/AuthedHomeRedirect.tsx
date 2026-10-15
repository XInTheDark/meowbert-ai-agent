import { useState, useMemo, useEffect } from "react";
import { Navigate } from "react-router-dom";
import { createApiClient } from "../../lib/api";
import { Workspace } from "../../lib/types";
import { LoadingScreen } from "../../components/LoadingScreen";
import { loadLastWorkspaceId } from "../workspace/layout/utils";

function workspaceHomePath(workspaceId: string): string {
  return `/app/${workspaceId}/projects`;
}

export function AuthedHomeRedirect(props: { token: string; onTokenInvalid: () => void }) {
  const api = useMemo(() => createApiClient(props.token), [props.token]);
  // The workspace page verifies access itself, so a remembered workspace opens without a lookup.
  const [rememberedWorkspaceId] = useState(loadLastWorkspaceId);
  const [targetPath, setTargetPath] = useState<string | null>(null);

  useEffect(() => {
    if (rememberedWorkspaceId) {
      return;
    }

    let cancelled = false;

    async function resolve(): Promise<void> {
      try {
        const me = await api.get<{ workspaces: Workspace[] }>("/api/auth/me");
        if (cancelled) {
          return;
        }

        const preferred = me.workspaces[0];
        if (!preferred) {
          props.onTokenInvalid();
          return;
        }

        setTargetPath(workspaceHomePath(preferred.id));
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
  }, [api, props.onTokenInvalid, rememberedWorkspaceId]);

  if (rememberedWorkspaceId) {
    return <Navigate to={workspaceHomePath(rememberedWorkspaceId)} replace />;
  }

  if (!targetPath) {
    return <LoadingScreen label="Loading your workspace..." />;
  }

  return <Navigate to={targetPath} replace />;
}
