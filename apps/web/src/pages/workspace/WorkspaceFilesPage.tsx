import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { fileScopeRoute, workspaceFileScope } from "../../components/files/fileScope";
import { FilesView } from "../../components/files/FilesView";
import { useFileBrowser } from "../../components/files/useFileBrowser";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";

export function WorkspaceFilesPage() {
  const { api, token, activeWorkspaceId, environments } = useWorkspaceApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const scope = useMemo(() => (activeWorkspaceId ? workspaceFileScope(activeWorkspaceId) : null), [activeWorkspaceId]);
  const browser = useFileBrowser({ api, scope, initialPath: searchParams.get("path") ?? "" });

  if (!activeWorkspaceId || !scope) {
    return (
      <section className="page-content">
        <article className="section-card empty-card">
          <h3>No workspace selected</h3>
          <p>Select a workspace to browse files.</p>
        </article>
      </section>
    );
  }

  return (
    <FilesView
      browser={browser}
      scope={scope}
      scopeValue="workspace"
      projects={environments}
      token={token}
      onScopeChange={(target) => {
        if (target !== "workspace") navigate(fileScopeRoute(activeWorkspaceId, target, browser.listing.cwd));
      }}
      onDelete={(paths) => void browser.deletion.deletePaths(paths)}
    />
  );
}
