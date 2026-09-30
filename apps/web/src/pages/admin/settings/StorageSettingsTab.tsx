import type {
  AdminActiveWorkspaceStorageMigrationSummary,
  AdminStorageOverview,
  AdminStorageUserSummary,
  AdminWorkspaceStorageSummary
} from "./shared";

interface StorageSettingsTabProps {
  storage: AdminStorageOverview | null;
  defaultBackendIdDraft: string;
  migrateExistingOnDefaultChange: boolean;
  workspaceBackendDrafts: Record<string, string>;
  storageUserSearchDraft: string;
  storageUserSearchResults: AdminStorageUserSummary[];
  selectedStorageUser: AdminStorageUserSummary | null;
  hasSearchedStorageUsers: boolean;
  isSaving: boolean;
  testingStorageBackendId: string | null;
  isSearchingStorageUsers: boolean;
  isLoadingSelectedStorageUserWorkspaces: boolean;
  error: string | null;
  onDefaultBackendIdChange: (value: string) => void;
  onMigrateExistingOnDefaultChange: (value: boolean) => void;
  onWorkspaceBackendDraftChange: (workspaceId: string, backendId: string) => void;
  onStorageUserSearchDraftChange: (value: string) => void;
  onSaveDefault: () => Promise<void>;
  onTestBackend: (backendId: string) => Promise<void>;
  onSearchStorageUsers: () => Promise<void>;
  onClearStorageUserSearch: () => void;
  onSelectStorageUser: (user: AdminStorageUserSummary) => Promise<void>;
  onClearSelectedStorageUser: () => Promise<void>;
  onMigrateWorkspace: (workspaceId: string) => Promise<void>;
}

interface StorageWorkspaceListSectionProps {
  storage: AdminStorageOverview;
  workspaceBackendDrafts: Record<string, string>;
  selectedStorageUser: AdminStorageUserSummary | null;
  isSaving: boolean;
  isLoadingSelectedStorageUserWorkspaces: boolean;
  onWorkspaceBackendDraftChange: (workspaceId: string, backendId: string) => void;
  onMigrateWorkspace: (workspaceId: string) => Promise<void>;
}

interface StorageUserLookupSectionProps {
  storageUserSearchDraft: string;
  storageUserSearchResults: AdminStorageUserSummary[];
  selectedStorageUser: AdminStorageUserSummary | null;
  hasSearchedStorageUsers: boolean;
  isSaving: boolean;
  isSearchingStorageUsers: boolean;
  isLoadingSelectedStorageUserWorkspaces: boolean;
  onStorageUserSearchDraftChange: (value: string) => void;
  onSearchStorageUsers: () => Promise<void>;
  onClearStorageUserSearch: () => void;
  onSelectStorageUser: (user: AdminStorageUserSummary) => Promise<void>;
  onClearSelectedStorageUser: () => Promise<void>;
}

type StorageMigrationStatus = "queued" | "running" | "failed" | "completed" | "cancelled";
type StorageMigrationRequestSource = "manual" | "default_change_bulk";

function formatTimestamp(value: string | null): string {
  if (!value) {
    return "—";
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }

  return parsed.toLocaleString();
}

function formatBackendTypeLabel(value: AdminStorageOverview["backends"][number]["type"]): string {
  if (value === "mounted") {
    return "Mounted path";
  }
  return "Local";
}

function formatOwnedWorkspaceCount(count: number): string {
  return `${count} owned workspace${count === 1 ? "" : "s"}`;
}

function formatStorageMigrationStatusLabel(status: StorageMigrationStatus): string {
  if (status === "completed") {
    return "Completed";
  }
  if (status === "cancelled") {
    return "Cancelled";
  }
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function resolveStorageMigrationBadgeClass(status: StorageMigrationStatus): string {
  if (status === "completed") {
    return "good";
  }
  if (status === "queued" || status === "running") {
    return "warning";
  }
  return "danger";
}

function formatStorageMigrationRequestSource(requestSource: StorageMigrationRequestSource): string {
  if (requestSource === "default_change_bulk") {
    return "Default backend bulk queue";
  }
  return "Manual queue";
}

function resolveStorageBackendLabel(storage: AdminStorageOverview, backendId: string): string {
  return storage.backends.find((backend) => backend.id === backendId)?.label ?? backendId;
}

function getWorkspaceMigrationPriority(status: StorageMigrationStatus | null | undefined): number {
  if (status === "running") {
    return 0;
  }
  if (status === "queued") {
    return 1;
  }
  if (status === "failed") {
    return 2;
  }
  if (status === "completed") {
    return 3;
  }
  if (status === "cancelled") {
    return 4;
  }
  return 5;
}

function compareWorkspaceStorageCards(a: AdminWorkspaceStorageSummary, b: AdminWorkspaceStorageSummary): number {
  const priorityDifference = getWorkspaceMigrationPriority(a.latestMigration?.status) - getWorkspaceMigrationPriority(b.latestMigration?.status);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }

  return a.name.localeCompare(b.name);
}

function StorageMigrationStatusBadge(props: { status: StorageMigrationStatus }) {
  return (
    <span className={`badge ${resolveStorageMigrationBadgeClass(props.status)}`}>
      {formatStorageMigrationStatusLabel(props.status)}
    </span>
  );
}

function ConfiguredBackendCard(props: {
  backend: AdminStorageOverview["backends"][number];
  isSaving: boolean;
  isTesting: boolean;
  onTestBackend: (backendId: string) => Promise<void>;
}) {
  const canTestMount = props.backend.type !== "local";

  return (
    <article className="section-card" style={{ padding: "0.85rem" }}>
      <div className="stack-form" style={{ gap: "0.75rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
          <strong>{props.backend.label}</strong>
          <span className={`badge ${props.backend.healthState === "ready" ? "good" : "warning"}`}>
            {props.backend.healthState === "ready" ? "Ready" : "Error"}
          </span>
        </div>
        <div>
          <p className="muted-text" style={{ marginTop: 0, marginBottom: 0 }}>
            {formatBackendTypeLabel(props.backend.type)} · {props.backend.workspaceCount} workspace
            {props.backend.workspaceCount === 1 ? "" : "s"}
          </p>
          <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
            Mounted: {props.backend.mounted ? "Yes" : "No"}
          </p>
          {props.backend.healthMessage ? (
            <p className="muted-text" style={{ marginTop: "0.5rem", marginBottom: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
              {props.backend.healthMessage}
            </p>
          ) : null}
        </div>
        {canTestMount ? (
          <div className="row-actions" style={{ justifyContent: "flex-start" }}>
            <button
              className="btn ghost"
              type="button"
              onClick={() => void props.onTestBackend(props.backend.id)}
              disabled={props.isSaving || props.isTesting}
            >
              {props.isTesting ? "Checking..." : "Check Path"}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  );
}

function StorageMigrationStatCard(props: {
  label: string;
  value: number;
  tone: "good" | "warning" | "muted";
}) {
  return (
    <article className="section-card" style={{ padding: "0.85rem" }}>
      <div className="stack-form" style={{ gap: "0.35rem" }}>
        <span className={`badge ${props.tone}`}>{props.label}</span>
        <strong style={{ fontSize: "1.2rem" }}>{props.value}</strong>
      </div>
    </article>
  );
}

function ActiveWorkspaceMigrationCard(props: {
  migration: AdminActiveWorkspaceStorageMigrationSummary;
}) {
  const activityLabel = props.migration.status === "running" ? "Started" : "Queued";
  const activityTimestamp = props.migration.status === "running"
    ? formatTimestamp(props.migration.startedAt ?? props.migration.createdAt)
    : formatTimestamp(props.migration.createdAt);

  return (
    <article className="section-card" style={{ padding: "0.85rem" }}>
      <div className="stack-form" style={{ gap: "0.6rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0, flex: "1 1 16rem" }}>
            <strong style={{ display: "block", overflowWrap: "anywhere" }}>{props.migration.workspaceName}</strong>
            <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
              Owner: {props.migration.ownerEmail ?? "Unknown"}
            </p>
          </div>
          <StorageMigrationStatusBadge status={props.migration.status} />
        </div>

        <div>
          <p className="muted-text" style={{ marginTop: 0, marginBottom: 0 }}>
            {props.migration.sourceBackendLabel} → {props.migration.targetBackendLabel}
          </p>
          <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
            {activityLabel}: {activityTimestamp}
          </p>
          <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
            Last update: {formatTimestamp(props.migration.updatedAt)}
          </p>
          <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
            {formatStorageMigrationRequestSource(props.migration.requestSource)}
          </p>
        </div>
      </div>
    </article>
  );
}

function StorageMigrationActivitySection(props: {
  storage: AdminStorageOverview;
}) {
  const activity = props.storage.migrationActivity;
  const activeCount = activity.queuedCount + activity.runningCount;

  if (activeCount === 0) {
    return (
      <p className="muted-text" style={{ margin: 0 }}>
        No workspace storage migrations are queued or running right now.
      </p>
    );
  }

  return (
    <div className="stack-form" style={{ gap: "0.9rem" }}>
      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        <StorageMigrationStatCard label="Running" value={activity.runningCount} tone={activity.runningCount > 0 ? "warning" : "muted"} />
        <StorageMigrationStatCard label="Queued" value={activity.queuedCount} tone={activity.queuedCount > 0 ? "warning" : "muted"} />
      </div>

      <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
        {activity.activeMigrations.map((migration) => (
          <ActiveWorkspaceMigrationCard key={migration.id} migration={migration} />
        ))}
      </div>

      {activity.hiddenActiveCount > 0 ? (
        <p className="muted-text" style={{ margin: 0 }}>
          Showing the first {activity.activeMigrations.length} active item{activity.activeMigrations.length === 1 ? "" : "s"};
          {" "}{activity.hiddenActiveCount} more are still queued.
        </p>
      ) : null}
    </div>
  );
}

function StorageUserLookupSection(props: StorageUserLookupSectionProps) {
  const canClearSearch = props.storageUserSearchDraft.trim().length > 0 || props.hasSearchedStorageUsers;

  return (
    <div className="stack-form" style={{ gap: "0.9rem" }}>
      <form
        className="row-actions"
        style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.75rem" }}
        onSubmit={(event) => {
          event.preventDefault();
          void props.onSearchStorageUsers();
        }}
      >
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: "1 1 320px", flexWrap: "wrap" }}>
          <input
            type="search"
            value={props.storageUserSearchDraft}
            onChange={(event) => props.onStorageUserSearchDraftChange(event.target.value)}
            placeholder="Search by owner email"
            aria-label="Search storage owners by email"
            disabled={props.isSaving || props.isSearchingStorageUsers || props.isLoadingSelectedStorageUserWorkspaces}
          />
          <button
            className="btn primary"
            type="submit"
            disabled={props.isSaving || props.isSearchingStorageUsers || props.isLoadingSelectedStorageUserWorkspaces}
          >
            {props.isSearchingStorageUsers ? "Searching..." : "Find User"}
          </button>
          <button className="btn ghost" type="button" onClick={props.onClearStorageUserSearch} disabled={!canClearSearch}>
            Clear Search
          </button>
        </div>
      </form>

      {props.selectedStorageUser ? (
        <div className="section-card" style={{ padding: "0.85rem", display: "flex", justifyContent: "space-between", gap: "0.75rem", flexWrap: "wrap" }}>
          <div style={{ minWidth: 0 }}>
            <strong>{props.selectedStorageUser.email}</strong>
            {props.selectedStorageUser.displayName ? (
              <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                {props.selectedStorageUser.displayName}
              </p>
            ) : null}
            <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
              {formatOwnedWorkspaceCount(props.selectedStorageUser.ownedWorkspaceCount)}
            </p>
          </div>
          <button
            className="btn ghost"
            type="button"
            onClick={() => void props.onClearSelectedStorageUser()}
            disabled={props.isSaving || props.isLoadingSelectedStorageUserWorkspaces}
          >
            Clear Selection
          </button>
        </div>
      ) : null}

      {props.storageUserSearchResults.length > 0 ? (
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
          {props.storageUserSearchResults.map((user) => {
            const isSelected = props.selectedStorageUser?.id === user.id;

            return (
              <article key={user.id} className="section-card" style={{ padding: "0.85rem" }}>
                <div className="stack-form" style={{ gap: "0.6rem" }}>
                  <div>
                    <strong>{user.email}</strong>
                    {user.displayName ? (
                      <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                        {user.displayName}
                      </p>
                    ) : null}
                    <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
                      {formatOwnedWorkspaceCount(user.ownedWorkspaceCount)}
                    </p>
                  </div>
                  <div className="row-actions" style={{ justifyContent: "flex-start" }}>
                    <button
                      className={`btn ${isSelected ? "ghost" : "primary"}`}
                      type="button"
                      onClick={() => void props.onSelectStorageUser(user)}
                      disabled={props.isSaving || props.isLoadingSelectedStorageUserWorkspaces || isSelected}
                    >
                      {isSelected ? "Selected" : "Load Workspaces"}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      ) : props.hasSearchedStorageUsers ? (
        <p className="muted-text" style={{ margin: 0 }}>
          No users found for that email search.
        </p>
      ) : null}
    </div>
  );
}

function WorkspaceStorageCard(props: {
  storage: AdminStorageOverview;
  workspace: AdminWorkspaceStorageSummary;
  workspaceBackendDrafts: Record<string, string>;
  isSaving: boolean;
  onWorkspaceBackendDraftChange: (workspaceId: string, backendId: string) => void;
  onMigrateWorkspace: (workspaceId: string) => Promise<void>;
}) {
  const draftBackendId = props.workspaceBackendDrafts[props.workspace.id] ?? props.workspace.storageBackendId;
  const latestMigration = props.workspace.latestMigration;
  const migrationPending = latestMigration?.status === "queued" || latestMigration?.status === "running";
  const canMigrate = draftBackendId.length > 0 && draftBackendId !== props.workspace.storageBackendId && !migrationPending;
  const migrationSourceLabel = latestMigration ? resolveStorageBackendLabel(props.storage, latestMigration.sourceBackendId) : null;
  const migrationTargetLabel = latestMigration ? resolveStorageBackendLabel(props.storage, latestMigration.targetBackendId) : null;
  const queueButtonLabel = latestMigration?.status === "running"
    ? "Migration Running"
    : latestMigration?.status === "queued"
      ? "Migration Queued"
      : "Queue Migration";

  return (
    <article className="section-card" style={{ padding: "0.85rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 280px" }}>
          <strong>{props.workspace.name}</strong>
          <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
            Owner: {props.workspace.ownerEmail ?? "Unknown"}
          </p>
          <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0 }}>
            Current backend: {props.workspace.storageBackendLabel}
          </p>
          <p className="muted-text" style={{ marginTop: "0.35rem", marginBottom: 0, wordBreak: "break-all" }}>
            Root: {props.workspace.rootPath || "(uninitialized)"}
          </p>
          {latestMigration ? (
            <div className="stack-form" style={{ gap: "0.35rem", marginTop: "0.65rem" }}>
              <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flexWrap: "wrap" }}>
                <StorageMigrationStatusBadge status={latestMigration.status} />
                <span className="muted-text">
                  {migrationSourceLabel} → {migrationTargetLabel}
                </span>
              </div>
              <p className="muted-text" style={{ margin: 0 }}>
                Created: {formatTimestamp(latestMigration.createdAt)} · Started: {formatTimestamp(latestMigration.startedAt)}
              </p>
              <p className="muted-text" style={{ margin: 0 }}>
                Last update: {formatTimestamp(latestMigration.updatedAt)} · Completed: {formatTimestamp(latestMigration.completedAt)}
              </p>
              <p className="muted-text" style={{ margin: 0 }}>
                {formatStorageMigrationRequestSource(latestMigration.requestSource)}
              </p>
              {latestMigration.errorSummary ? (
                <p className="muted-text" style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {latestMigration.errorSummary}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        <div style={{ display: "flex", gap: "0.75rem", alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={draftBackendId}
            onChange={(event) => props.onWorkspaceBackendDraftChange(props.workspace.id, event.target.value)}
            disabled={props.isSaving || migrationPending}
          >
            {props.storage.backends.map((backend) => (
              <option key={backend.id} value={backend.id}>
                {backend.label}
              </option>
            ))}
          </select>
          <button
            className="btn primary"
            type="button"
            onClick={() => void props.onMigrateWorkspace(props.workspace.id)}
            disabled={props.isSaving || !canMigrate}
          >
            {queueButtonLabel}
          </button>
        </div>
      </div>
    </article>
  );
}

function StorageWorkspaceListSection(props: StorageWorkspaceListSectionProps) {
  if (!props.selectedStorageUser) {
    return (
      <p className="muted-text" style={{ margin: 0 }}>
        Select a user to load workspace migrations.
      </p>
    );
  }

  if (props.isLoadingSelectedStorageUserWorkspaces) {
    return <p className="muted-text" style={{ margin: 0 }}>Loading workspaces for {props.selectedStorageUser.email}...</p>;
  }

  if (props.storage.workspaces.length === 0) {
    return (
      <p className="muted-text" style={{ margin: 0 }}>
        No owned workspaces found for {props.selectedStorageUser.email}.
      </p>
    );
  }

  const orderedWorkspaces = [...props.storage.workspaces].sort(compareWorkspaceStorageCards);

  return (
    <div className="stack-form" style={{ gap: "0.75rem" }}>
      <p className="muted-text" style={{ margin: 0 }}>
        Showing {props.storage.workspaces.length} workspace{props.storage.workspaces.length === 1 ? "" : "s"} for {props.selectedStorageUser.email}.
      </p>
      {orderedWorkspaces.map((workspace) => (
        <WorkspaceStorageCard
          key={workspace.id}
          storage={props.storage}
          workspace={workspace}
          workspaceBackendDrafts={props.workspaceBackendDrafts}
          isSaving={props.isSaving}
          onWorkspaceBackendDraftChange={props.onWorkspaceBackendDraftChange}
          onMigrateWorkspace={props.onMigrateWorkspace}
        />
      ))}
    </div>
  );
}

export function StorageSettingsTab(props: StorageSettingsTabProps) {
  if (!props.storage) {
    return <p className="muted-text">Loading storage configuration...</p>;
  }

  const storage = props.storage;

  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      <section className="section-card" style={{ padding: "1rem" }}>
        <div className="stack-form">
          <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
            <strong>Default backend for new workspaces</strong>
            <select
              value={props.defaultBackendIdDraft}
              onChange={(event) => props.onDefaultBackendIdChange(event.target.value)}
              disabled={props.isSaving}
            >
              {storage.backends.map((backend) => (
                <option key={backend.id} value={backend.id}>
                  {backend.label}
                </option>
              ))}
            </select>
          </label>

          <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={props.migrateExistingOnDefaultChange}
              onChange={(event) => props.onMigrateExistingOnDefaultChange(event.target.checked)}
              disabled={props.isSaving}
              style={{ marginTop: "0.2rem" }}
            />
            <div>
              <strong>Also queue migrations for existing workspaces</strong>
              <p className="muted-text" style={{ marginTop: "0.3rem" }}>
                Existing workspaces keep their current backend unless you explicitly queue migrations.
              </p>
            </div>
          </label>

          <div className="row-actions">
            <button className="btn primary" type="button" onClick={() => void props.onSaveDefault()} disabled={props.isSaving}>
              {props.isSaving ? "Saving..." : "Save Default Backend"}
            </button>
          </div>
        </div>
      </section>

      <section className="section-card" style={{ padding: "1rem" }}>
        <div className="section-head">
          <div>
            <h4 style={{ margin: 0 }}>Configured backends</h4>
            <p className="muted-text" style={{ marginTop: "0.35rem" }}>
              Named backends come from config JSON. Check Path validates that the configured mounted path is visible and active.
              Current default for new workspaces: {storage.defaultWorkspaceBackendId}
            </p>
          </div>
        </div>
        <div style={{ display: "grid", gap: "0.75rem", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          {storage.backends.map((backend) => (
            <ConfiguredBackendCard
              key={backend.id}
              backend={backend}
              isSaving={props.isSaving}
              isTesting={props.testingStorageBackendId === backend.id}
              onTestBackend={props.onTestBackend}
            />
          ))}
        </div>
      </section>

      <section className="section-card" style={{ padding: "1rem" }}>
        <div className="section-head">
          <div>
            <h4 style={{ margin: 0 }}>Migration activity</h4>
            <p className="muted-text" style={{ marginTop: "0.35rem" }}>
              Queued and running workspace backend moves across the whole server.
            </p>
          </div>
        </div>

        <StorageMigrationActivitySection storage={storage} />
      </section>

      <section className="section-card" style={{ padding: "1rem" }}>
        <div className="section-head">
          <div>
            <h4 style={{ margin: 0 }}>Workspace storage</h4>
            <p className="muted-text" style={{ marginTop: "0.35rem" }}>
              Pick a user email first, then queue or inspect workspace migrations for that owner.
            </p>
          </div>
        </div>

        <div className="stack-form" style={{ gap: "1rem" }}>
          <StorageUserLookupSection
            storageUserSearchDraft={props.storageUserSearchDraft}
            storageUserSearchResults={props.storageUserSearchResults}
            selectedStorageUser={props.selectedStorageUser}
            hasSearchedStorageUsers={props.hasSearchedStorageUsers}
            isSaving={props.isSaving}
            isSearchingStorageUsers={props.isSearchingStorageUsers}
            isLoadingSelectedStorageUserWorkspaces={props.isLoadingSelectedStorageUserWorkspaces}
            onStorageUserSearchDraftChange={props.onStorageUserSearchDraftChange}
            onSearchStorageUsers={props.onSearchStorageUsers}
            onClearStorageUserSearch={props.onClearStorageUserSearch}
            onSelectStorageUser={props.onSelectStorageUser}
            onClearSelectedStorageUser={props.onClearSelectedStorageUser}
          />

          <StorageWorkspaceListSection
            storage={storage}
            workspaceBackendDrafts={props.workspaceBackendDrafts}
            selectedStorageUser={props.selectedStorageUser}
            isSaving={props.isSaving}
            isLoadingSelectedStorageUserWorkspaces={props.isLoadingSelectedStorageUserWorkspaces}
            onWorkspaceBackendDraftChange={props.onWorkspaceBackendDraftChange}
            onMigrateWorkspace={props.onMigrateWorkspace}
          />
        </div>
      </section>

      {props.error ? <p className="error-text">{props.error}</p> : null}
    </div>
  );
}
