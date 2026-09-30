import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { buildRuntimeResourceDraft, parseRuntimeResourceDraft } from "./runtime-resource-draft";
import type {
  AdminUser,
  ResourceDraft,
  SubscriptionPlan,
  SubscriptionPlansResponse,
  UsersResponse
} from "./adminUsersTypes";

function parsePlanSelection(input: string, plans: SubscriptionPlan[]): string[] | null {
  const tokens = input.trim().split(",").map((token) => token.trim()).filter(Boolean);
  if (tokens.length === 0) return [];
  const planIds: string[] = [];
  for (const token of tokens) {
    const byId = plans.find((plan) => plan.id === token);
    if (byId) {
      planIds.push(byId.id);
      continue;
    }
    const index = Number.parseInt(token, 10);
    if (Number.isFinite(index) && index >= 1 && index <= plans.length) {
      planIds.push(plans[index - 1].id);
      continue;
    }
    return null;
  }
  return Array.from(new Set(planIds));
}

function useAdminUsersData() {
  const { api, user: currentUser } = useWorkspaceApp();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserIds, setSelectedUserIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const totalPages = useMemo(() => Math.max(1, Math.ceil(total / 20)), [total]);
  const fetchUsers = useCallback(() => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: "20" });
    if (searchQuery.trim()) params.set("search", searchQuery.trim());
    api.get<UsersResponse>(`/api/admin/users?${params.toString()}`)
      .then((response) => {
        setUsers(response.users);
        setTotal(response.total);
        setSelectedUserIds((current) => {
          if (current.size === 0) return current;
          const allowed = new Set(response.users.map((user) => user.id));
          return new Set([...current].filter((id) => allowed.has(id)));
        });
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)))
      .finally(() => setLoading(false));
  }, [api, page, searchQuery]);
  const fetchPlans = useCallback(() => {
    api.get<SubscriptionPlansResponse>("/api/admin/subscriptions/plans")
      .then((response) => setPlans(response.plans))
      .catch((cause) => setError(cause instanceof Error ? cause.message : String(cause)));
  }, [api]);
  useEffect(() => {
    fetchUsers();
    fetchPlans();
  }, [fetchPlans, fetchUsers]);
  useEffect(() => {
    const closeMenu = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", closeMenu);
    return () => document.removeEventListener("mousedown", closeMenu);
  }, []);
  const handleSearchSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPage(1);
    setSearchQuery(searchDraft.trim());
  };
  const clearSearch = () => {
    if (!searchDraft && !searchQuery) return;
    setSearchDraft("");
    setSearchQuery("");
    setPage(1);
  };
  const toggleSelectedUser = (userId: string, checked: boolean) => setSelectedUserIds((current) => {
    const next = new Set(current);
    if (checked) next.add(userId);
    else next.delete(userId);
    return next;
  });
  const toggleSelectAllOnPage = (checked: boolean) => setSelectedUserIds((current) => {
    const next = new Set(current);
    for (const user of users) {
      if (checked) next.add(user.id);
      else next.delete(user.id);
    }
    return next;
  });
  return {
    users, plans, page, setPage, searchDraft, setSearchDraft, searchQuery, selectedUserIds, setSelectedUserIds,
    loading, error, openMenuId, setOpenMenuId, menuRef, totalPages, fetchUsers, handleSearchSubmit, clearSearch,
    toggleSelectedUser, toggleSelectAllOnPage, currentUserId: currentUser?.id ?? null
  };
}

function useAdminUserAccountActions(data: ReturnType<typeof useAdminUsersData>) {
  const { api, setFlash, replaceSessionToken } = useWorkspaceApp();
  const navigate = useNavigate();
  const runMutation = async (action: () => Promise<unknown>, success: string, refresh = true) => {
    try {
      await action();
      setFlash({ tone: "success", text: success });
      if (refresh) data.fetchUsers();
    } catch (error) {
      setFlash({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };
  const toggleAdmin = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    if (!confirm(`Are you sure you want to ${user.isSuperAdmin ? "remove" : "grant"} super admin rights for ${user.email}?`)) return;
    await runMutation(() => api.patch(`/api/admin/users/${user.id}/admin`, { isSuperAdmin: !user.isSuperAdmin }), "User updated successfully.");
  };
  const toggleActive = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    if (!confirm(`Are you sure you want to ${user.isActive ? "deactivate" : "activate"} ${user.email}?`)) return;
    await runMutation(() => api.patch(`/api/admin/users/${user.id}/active`, { isActive: !user.isActive }), "User updated successfully.");
  };
  const decideApproval = async (user: AdminUser, decision: "approve" | "reject") => {
    data.setOpenMenuId(null);
    if (!confirm(`Are you sure you want to ${decision} signup for ${user.email}?`)) return;
    await runMutation(() => api.patch(`/api/admin/users/${user.id}/approval`, { decision }), `Signup ${decision}d.`);
  };
  const changePassword = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    const password = prompt(`Enter new password for ${user.email} (min 8 characters):`);
    if (password === null) return;
    if (password.length < 8) return alert("Password must be at least 8 characters.");
    await runMutation(() => api.patch(`/api/admin/users/${user.id}/password`, { password }), "Password changed successfully.", false);
  };
  const impersonate = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    if (!confirm(`Are you sure you want to log in as ${user.email}? You will be logged out of your current account.`)) return;
    try {
      const response = await api.post<{ token: string }>(`/api/admin/users/${user.id}/impersonate`, {});
      replaceSessionToken(response.token);
      navigate("/app", { replace: true });
    } catch (error) {
      setFlash({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };
  const deleteUser = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    if (!confirm(`Are you sure you want to permanently delete ${user.email}? This action cannot be undone.`)) return;
    await runMutation(() => api.delete(`/api/admin/users/${user.id}`), "User deleted successfully.");
  };
  return { toggleAdmin, toggleActive, decideApproval, changePassword, impersonate, deleteUser };
}

function useAdminUserUsageActions(data: ReturnType<typeof useAdminUsersData>) {
  const { api, setFlash } = useWorkspaceApp();
  const runMutation = async (action: () => Promise<unknown>, success: string) => {
    try {
      await action();
      setFlash({ tone: "success", text: success });
      data.fetchUsers();
    } catch (error) {
      setFlash({ tone: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };
  const updateFreeMessageLimit = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    const input = prompt(`Enter lifetime free-message limit for ${user.email}\n(leave blank to use the platform default):`,
      user.freeMessageLimit !== null ? String(user.freeMessageLimit) : "");
    if (input === null) return;
    const value = input.trim() === "" ? null : Number.parseInt(input.trim(), 10);
    if (value !== null && (Number.isNaN(value) || value < 0)) return alert("Invalid limit. Must be a number >= 0 or blank for default.");
    await runMutation(() => api.patch(`/api/admin/users/${user.id}/free-message-limit`, { freeMessageLimit: value }),
      "Free-message limit updated.");
  };
  const setUsage = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    const input = prompt(`Set current usage for ${user.email}:`, String(user.monthlyWeightedTokensUsed));
    if (input === null) return;
    const usage = Number.parseInt(input.trim(), 10);
    if (!Number.isFinite(usage) || Number.isNaN(usage) || usage < 0) return alert("Invalid usage. Must be a whole number >= 0.");
    await runMutation(() => api.patch(`/api/admin/users/${user.id}/usage`, { usage }), "Usage updated.");
  };
  const updateSubscriptions = async (user: AdminUser) => {
    data.setOpenMenuId(null);
    const assignablePlans = data.plans.filter((plan) => !plan.isDefault);
    if (assignablePlans.length === 0) return alert("No subscription plans found. Create plans in Admin > Subscriptions first.");
    const current = user.subscriptions.map((plan) => plan.id);
    const choices = assignablePlans.map((plan, index) => {
      const limits = (plan.usageLimits?.length ? plan.usageLimits : [{ weightedTokens: plan.monthlyTokenQuota, durationDays: 30 }])
        .map((limit) => `${limit.weightedTokens}/${limit.durationDays}d`).join(", ");
      return `${index + 1}. ${plan.name} (${limits}) ${plan.isActive ? "[active]" : "[inactive]"} id=${plan.id}`;
    }).join("\n");
    const input = prompt(
      `Enter comma-separated plan indices or plan IDs for ${user.email}.\nLeave blank for no plans.\n\nCurrent: ${current.join(", ") || "none"}\n\nAvailable:\n${choices}`,
      current.join(",")
    );
    if (input === null) return;
    const planIds = parsePlanSelection(input, assignablePlans);
    if (planIds === null) return alert("Invalid plan selection. Use indices or plan IDs separated by commas.");
    await runMutation(() => api.put(`/api/admin/users/${user.id}/subscriptions`, { planIds }), "User subscriptions updated.");
  };
  return { updateFreeMessageLimit, setUsage, updateSubscriptions };
}

function buildResourceDraft(user: AdminUser): ResourceDraft {
  return buildRuntimeResourceDraft(user.resourceLimits);
}

function useAdminUserResources(data: ReturnType<typeof useAdminUsersData>) {
  const { api, setFlash } = useWorkspaceApp();
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [draft, setDraft] = useState<ResourceDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const open = (user: AdminUser) => {
    data.setOpenMenuId(null);
    setEditingUser(user);
    setDraft(buildResourceDraft(user));
    setError(null);
  };
  const close = () => {
    if (saving) return;
    setEditingUser(null);
    setDraft(null);
    setError(null);
  };
  const save = async () => {
    if (!editingUser || !draft) return;
    try {
      setSaving(true);
      setError(null);
      await api.patch(`/api/admin/users/${editingUser.id}/resources`, parseRuntimeResourceDraft(draft));
      setFlash({ tone: "success", text: "Resource limits updated." });
      close();
      data.fetchUsers();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };
  return { editingUser, draft, setDraft, error, saving, open, close, save };
}

export function useAdminUsersTab() {
  const data = useAdminUsersData();
  const accountActions = useAdminUserAccountActions(data);
  const usageActions = useAdminUserUsageActions(data);
  const resources = useAdminUserResources(data);
  return { data, accountActions, usageActions, resources };
}

export type AdminUsersTabController = ReturnType<typeof useAdminUsersTab>;
