import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { LoadingIndicator } from "../LoadingIndicator";
import { AdminTable, AdminTableCell, AdminTableRow } from "./AdminTable";
import { RuntimeResourceFields } from "./RuntimeResourceFields";
import type { AdminUser, ResourceDraft } from "./adminUsersTypes";
import type { AdminUsersTabController } from "./useAdminUsersTab";

type ControllerProps = { controller: AdminUsersTabController };

function formatOptionalLimit(value: number | null, formatter: (input: number) => string): string {
  return value === null ? "Default" : formatter(value);
}

function formatCpuLimit(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function UserResourcesModal(props: {
  user: AdminUser;
  draft: ResourceDraft;
  saving: boolean;
  error: string | null;
  onChange: (draft: ResourceDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") props.onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);
  const defaults = props.user.resourceLimits;
  return (
    <div className="legal-overlay" onClick={props.onClose}>
      <div className="legal-modal admin-user-resources-modal" role="dialog" aria-modal="true"
        aria-labelledby="admin-user-resources-title" onClick={(event) => event.stopPropagation()}>
        <div className="legal-modal-header">
          <div>
            <h2 id="admin-user-resources-title">Edit resources</h2>
            <p className="muted-text" style={{ margin: "0.25rem 0 0", fontSize: "0.9rem" }}>{props.user.email}</p>
          </div>
          <button className="legal-close" type="button" onClick={props.onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="legal-modal-body admin-user-resources-modal__body">
          <RuntimeResourceFields draft={props.draft} onChange={props.onChange} fieldConfig={{
            workspaceLimit: {
              placeholder: String(defaults.effectiveWorkspaceLimit),
              hint: `Blank = subscription or default (${defaults.effectiveWorkspaceLimit})`
            },
            workspaceStorageMb: {
              placeholder: defaults.effectiveWorkspaceStorageMb !== null ? String(defaults.effectiveWorkspaceStorageMb) : "No default",
              hint: `Blank = subscription or platform default (${formatOptionalLimit(defaults.effectiveWorkspaceStorageMb, (value) => value >= 1024 && value % 1024 === 0 ? `${value / 1024} GB` : `${value} MB`)})`
            },
            sandboxMemoryMb: {
              placeholder: defaults.effectiveSandboxMemoryMb !== null ? String(defaults.effectiveSandboxMemoryMb) : "No default",
              hint: `Blank = subscription or platform default (${formatOptionalLimit(defaults.effectiveSandboxMemoryMb, (value) => `${value} MB`)})`
            },
            sandboxCpus: {
              placeholder: defaults.effectiveSandboxCpus !== null ? String(defaults.effectiveSandboxCpus) : "No default",
              hint: `Blank = subscription or platform default (${formatOptionalLimit(defaults.effectiveSandboxCpus, formatCpuLimit)})`
            },
            sandboxPidsLimit: {
              placeholder: String(defaults.effectiveSandboxPidsLimit),
              hint: `Blank = subscription or platform default (${defaults.effectiveSandboxPidsLimit})`
            },
            persistentRuntimeComputeCredits: {
              placeholder: String(defaults.effectivePersistentRuntimeComputeCredits),
              hint: `Blank = subscription or platform default (${defaults.effectivePersistentRuntimeComputeCredits}/month)`
            },
            persistentRuntimeLimit: {
              placeholder: String(defaults.effectivePersistentRuntimeLimit),
              hint: `Blank = subscription or platform default (${defaults.effectivePersistentRuntimeLimit})`
            }
          }} />
          {props.error ? <p className="error-text" style={{ marginTop: "0.85rem" }}>{props.error}</p> : null}
        </div>
        <div className="computer-use-modal-footer">
          <button className="btn ghost" type="button" onClick={props.onClose} disabled={props.saving}>Cancel</button>
          <button className="btn primary" type="button" onClick={props.onSubmit} disabled={props.saving}>
            {props.saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function UsageSummary({ user }: { user: AdminUser }) {
  const tokenUsage = user.monthlyWeightedTokensLimit > 0
    ? `${user.monthlyWeightedTokensUsed} / ${user.monthlyWeightedTokensLimit}` : "No active quota";
  return (
    <div className="admin-user-list">
      <div className="admin-user-list__row">
        <span className="admin-user-list__label">Free messages</span>
        <span className="admin-user-list__value">{user.freeMessagesUsed} / {user.freeMessageLimit ?? "default"}</span>
      </div>
      <div className="admin-user-list__row">
        <span className="admin-user-list__label">Usage</span>
        <span className="admin-user-list__value">{tokenUsage}</span>
      </div>
    </div>
  );
}

function DropdownItem(props: { children: ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button onClick={props.onClick} disabled={props.disabled} style={{
      display: "block", width: "100%", textAlign: "left", padding: "6px 14px", background: "none",
      border: "none", cursor: props.disabled ? "default" : "pointer", fontSize: "0.875rem",
      color: props.disabled ? "#a0aec0" : props.danger ? "#c53030" : "inherit", opacity: props.disabled ? 0.6 : 1
    }}>{props.children}</button>
  );
}

function DropdownDivider() {
  return <div style={{ height: "1px", background: "var(--border, #e2e8f0)", margin: "4px 0" }} />;
}

function UserActionsMenu({ controller, user }: ControllerProps & { user: AdminUser }) {
  const isSelf = user.id === controller.data.currentUserId;
  return (
    <div style={{
      position: "absolute", right: 0, top: "100%", zIndex: 100, background: "var(--surface, #fff)",
      border: "1px solid var(--border, #e2e8f0)", borderRadius: "6px", boxShadow: "0 4px 12px rgba(0,0,0,0.12)",
      minWidth: "220px", padding: "4px 0"
    }}>
      <DropdownItem onClick={() => controller.resources.open(user)}>Edit resources</DropdownItem>
      <DropdownItem onClick={() => void controller.usageActions.updateFreeMessageLimit(user)}>Set free-message limit</DropdownItem>
      <DropdownItem onClick={() => void controller.usageActions.setUsage(user)}>Set usage</DropdownItem>
      <DropdownItem onClick={() => void controller.usageActions.updateSubscriptions(user)}>Assign subscriptions</DropdownItem>
      <DropdownItem onClick={() => void controller.accountActions.changePassword(user)}>Change password</DropdownItem>
      {user.signupApprovalStatus === "pending" ? (
        <>
          <DropdownDivider />
          <DropdownItem onClick={() => void controller.accountActions.decideApproval(user, "approve")}>Approve signup</DropdownItem>
          <DropdownItem onClick={() => void controller.accountActions.decideApproval(user, "reject")} danger>Reject signup</DropdownItem>
        </>
      ) : null}
      <DropdownDivider />
      <DropdownItem onClick={() => void controller.accountActions.toggleActive(user)} disabled={isSelf}>
        {user.isActive ? "Deactivate account" : "Activate account"}
      </DropdownItem>
      <DropdownItem onClick={() => void controller.accountActions.toggleAdmin(user)} disabled={isSelf}>
        {user.isSuperAdmin ? "Demote from admin" : "Promote to admin"}
      </DropdownItem>
      <DropdownDivider />
      <DropdownItem onClick={() => void controller.accountActions.impersonate(user)} disabled={isSelf} danger>Log in as user</DropdownItem>
      <DropdownItem onClick={() => void controller.accountActions.deleteUser(user)} disabled={isSelf} danger>Delete user</DropdownItem>
    </div>
  );
}

function UserDetailsCells({ user }: { user: AdminUser }) {
  const status = user.signupApprovalStatus === "pending"
    ? { label: "Pending", background: "#fffbea", color: "#975a16" }
    : user.signupApprovalStatus === "rejected"
      ? { label: "Rejected", background: "#fff5f5", color: "#c53030" }
      : !user.isActive ? { label: "Inactive", background: "#edf2f7", color: "#4a5568" }
        : { label: "Active", background: "#e6fffa", color: "#2c7a7b" };
  return (
    <>
      <AdminTableCell verticalAlign="top">
        <div className="admin-user-name">{user.displayName || "No Name"}</div>
        <div className="admin-user-meta">{user.email}</div>
        <div className="admin-user-meta">Joined {new Date(user.createdAt).toLocaleDateString()}</div>
      </AdminTableCell>
      <AdminTableCell verticalAlign="top">
        <span className="admin-user-status-pill" style={{ background: status.background, color: status.color }}>{status.label}</span>
      </AdminTableCell>
      <AdminTableCell verticalAlign="top">
        <div className="admin-user-role-stack">
          <span className={`admin-user-role-pill ${user.isSuperAdmin ? "admin-user-role-pill--admin" : ""}`}>
            {user.isSuperAdmin ? "Admin" : "User"}
          </span>
          <span className="admin-user-meta">Last seen {user.lastSeenAt ? new Date(user.lastSeenAt).toLocaleDateString() : "Never"}</span>
        </div>
      </AdminTableCell>
      <AdminTableCell verticalAlign="top"><UsageSummary user={user} /></AdminTableCell>
      <AdminTableCell verticalAlign="top">
        {user.subscriptions.length > 0 ? (
          <div className="admin-user-subscriptions">
            {user.subscriptions.map((plan) => (
              <span key={plan.id} className="admin-user-subscription-pill">{plan.name}{!plan.isActive ? " · inactive" : ""}</span>
            ))}
          </div>
        ) : <span className="muted-text" style={{ fontSize: "0.85em" }}>None</span>}
      </AdminTableCell>
    </>
  );
}

function AdminUserRow({ controller, user }: ControllerProps & { user: AdminUser }) {
  const menuOpen = controller.data.openMenuId === user.id;
  return (
    <AdminTableRow>
      <AdminTableCell verticalAlign="top" width="36px">
        <input type="checkbox" aria-label={`Select ${user.email}`} checked={controller.data.selectedUserIds.has(user.id)}
          onChange={(event) => controller.data.toggleSelectedUser(user.id, event.target.checked)} />
      </AdminTableCell>
      <UserDetailsCells user={user} />
      <AdminTableCell align="right" verticalAlign="top">
        <div style={{ position: "relative", display: "inline-block" }} ref={menuOpen ? controller.data.menuRef : null}>
          <button className="btn ghost" style={{ padding: "0.25rem 0.6rem", fontSize: "0.9rem", minHeight: "unset" }}
            onClick={() => controller.data.setOpenMenuId(menuOpen ? null : user.id)} title="Actions">⋯</button>
          {menuOpen ? <UserActionsMenu controller={controller} user={user} /> : null}
        </div>
      </AdminTableCell>
    </AdminTableRow>
  );
}

function UsersToolbar({ controller }: ControllerProps) {
  const selectedCount = controller.data.users.filter((user) => controller.data.selectedUserIds.has(user.id)).length;
  const allSelected = controller.data.users.length > 0 && selectedCount === controller.data.users.length;
  return (
    <div className="stack-form" style={{ marginBottom: "0.9rem", gap: "0.65rem" }}>
      <form className="row-actions" style={{ justifyContent: "space-between", flexWrap: "wrap" }}
        onSubmit={controller.data.handleSearchSubmit}>
        <div style={{ display: "flex", gap: "0.5rem", alignItems: "center", flex: "1 1 320px" }}>
          <input type="search" value={controller.data.searchDraft}
            onChange={(event) => controller.data.setSearchDraft(event.target.value)}
            placeholder="Search by email or display name" aria-label="Search users" />
          <button className="btn primary" type="submit">Search</button>
          <button className="btn ghost" type="button" onClick={controller.data.clearSearch}
            disabled={!controller.data.searchDraft && !controller.data.searchQuery}>Clear</button>
        </div>
        <div className="muted-text" style={{ fontSize: "0.85rem" }}>
          {controller.data.searchQuery ? `Filtered by "${controller.data.searchQuery}"` : "Showing all users"}
        </div>
      </form>
      <div className="row-actions" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: "0.6rem" }}>
        <span className="muted-text" style={{ fontSize: "0.85rem" }}>
          {selectedCount > 0 ? `${selectedCount} selected on this page` : "No users selected"}
        </span>
        <div style={{ display: "inline-flex", gap: "0.5rem", alignItems: "center" }}>
          <button className="btn ghost" type="button" onClick={() => controller.data.toggleSelectAllOnPage(!allSelected)}
            disabled={controller.data.users.length === 0}>{allSelected ? "Unselect page" : "Select page"}</button>
          <button className="btn ghost" type="button" onClick={() => controller.data.setSelectedUserIds(new Set())}
            disabled={controller.data.selectedUserIds.size === 0}>Clear selection</button>
        </div>
      </div>
    </div>
  );
}

function UsersTable({ controller }: ControllerProps) {
  const selectedCount = controller.data.users.filter((user) => controller.data.selectedUserIds.has(user.id)).length;
  const allSelected = controller.data.users.length > 0 && selectedCount === controller.data.users.length;
  return (
    <AdminTable columns={[
      { key: "select", label: <input type="checkbox" aria-label="Select all users on page" checked={allSelected}
        onChange={(event) => controller.data.toggleSelectAllOnPage(event.target.checked)} disabled={controller.data.users.length === 0} />, width: "36px" },
      { key: "user", label: "User" },
      { key: "status", label: "Status", width: "110px" },
      { key: "role", label: "Role", width: "140px" },
      { key: "usage", label: "Usage", width: "220px" },
      { key: "subscriptions", label: "Subscriptions", width: "200px" },
      { key: "actions", label: "Actions", align: "right", width: "80px" }
    ]} minWidth={940}>
      {controller.data.users.length === 0 ? (
        <AdminTableRow><AdminTableCell colSpan={7}><span className="muted-text">No users found.</span></AdminTableCell></AdminTableRow>
      ) : null}
      {controller.data.users.map((user) => <AdminUserRow key={user.id} controller={controller} user={user} />)}
    </AdminTable>
  );
}

export function AdminUsersTabContent({ controller }: ControllerProps) {
  if (controller.data.loading && controller.data.users.length === 0) {
    return <LoadingIndicator center label="Loading users..." delayMs={0} />;
  }
  if (controller.data.error) return <div className="error-text">Error loading users: {controller.data.error}</div>;
  return (
    <>
      <div>
        <UsersToolbar controller={controller} />
        <UsersTable controller={controller} />
        <div className="users-pagination" style={{ marginTop: "1rem", display: "flex", gap: "1rem", alignItems: "center" }}>
          <button className="btn" disabled={controller.data.page === 1}
            onClick={() => controller.data.setPage((page) => page - 1)}>Previous</button>
          <span>Page {controller.data.page} of {controller.data.totalPages}</span>
          <button className="btn" disabled={controller.data.page >= controller.data.totalPages}
            onClick={() => controller.data.setPage((page) => page + 1)}>Next</button>
        </div>
      </div>
      {controller.resources.editingUser && controller.resources.draft ? (
        <UserResourcesModal
          user={controller.resources.editingUser}
          draft={controller.resources.draft}
          saving={controller.resources.saving}
          error={controller.resources.error}
          onChange={controller.resources.setDraft}
          onClose={controller.resources.close}
          onSubmit={() => void controller.resources.save()}
        />
      ) : null}
    </>
  );
}
