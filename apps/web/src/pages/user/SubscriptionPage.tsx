import { FormEvent, useEffect, useMemo, useState } from "react";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { ChatGptDeviceAuthModal } from "./components/ChatGptDeviceAuthModal";
import { ChatGptByoSection } from "./components/ChatGptByoSection";
import { CustomApiByoSection } from "./components/CustomApiByoSection";

interface AssignedPlan {
  id: string;
  name: string;
  monthlyTokenQuota: number;
  usageLimits: Array<{ weightedTokens: number; durationDays: number }>;
  notes: string | null;
  isActive: boolean;
  assignedAt: string;
}

interface SubscriptionSummaryResponse {
  mode: "admin_exempt" | "byo" | "subscription" | "free";
  monthStartUtc: string;
  monthEndUtc: string;
  usage: {
    weightedTokensUsed: number;
    weightedTokensLimit: number;
    weightedTokensRemaining: number;
    limits: Array<{
      weightedTokens: number;
      durationDays: number;
      used: number;
      remaining: number;
      percentUsed: number;
      percentRemaining: number;
      windowStartUtc: string;
      resetAtUtc: string;
      exceeded: boolean;
    }>;
    freeMessagesUsed: number;
    freeMessageLimit: number | null;
    freeMessagesRemaining: number | null;
  };
  plans: AssignedPlan[];
  byo: {
    enabled: boolean;
    provider: "openai_compatible" | "chatgpt_oauth";
    baseUrl: string | null;
    model: string | null;
    hasApiKey: boolean;
    chatgpt?: {
      isConnected: boolean;
      email: string | null;
      accountId: string | null;
      forcedModel: string | null;
      expiresAt: string | null;
    } | null;
  };
}

function formatResetTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Reset time unavailable";
  return `Resets ${date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  })}`;
}

export function SubscriptionPage() {
  const { api, setFlash, refreshWorkspaces } = useWorkspaceApp();
  const [summary, setSummary] = useState<SubscriptionSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fetchingModels, setFetchingModels] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"chatgpt" | "custom">("chatgpt");
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [byoBaseUrlDraft, setByoBaseUrlDraft] = useState("");
  const [byoModelDraft, setByoModelDraft] = useState("");
  const [byoApiKeyDraft, setByoApiKeyDraft] = useState("");
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);

  async function loadSummary(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<SubscriptionSummaryResponse>("/api/subscription");
      setSummary(response);
      setActiveTab(response.byo.provider === "chatgpt_oauth" ? "chatgpt" : "custom");
      setByoBaseUrlDraft(response.byo.baseUrl ?? "");
      setByoModelDraft(response.byo.model ?? "");
      setByoApiKeyDraft("");
      setFetchedModels([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadSummary(); }, []);

  const activePlans = useMemo(() => (summary?.plans ?? []).filter((plan) => plan.isActive), [summary?.plans]);

  async function saveCustomByo(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await api.patch<{ byo: SubscriptionSummaryResponse["byo"] }>("/api/subscription/byo", {
        enabled: true,
        provider: "openai_compatible",
        baseUrl: byoBaseUrlDraft.trim() || null,
        model: byoModelDraft.trim() || null,
        ...(byoApiKeyDraft.trim().length > 0 ? { apiKey: byoApiKeyDraft.trim() } : {})
      });
      await loadSummary();
      setFlash({ tone: "success", text: "Custom API key BYO settings saved and activated." });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function fetchModels(): Promise<void> {
    setFetchingModels(true);
    setError(null);
    try {
      const res = await api.post<{ models: string[] }>("/api/subscription/byo/models", {
        baseUrl: byoBaseUrlDraft.trim() || undefined,
        apiKey: byoApiKeyDraft.trim() || undefined
      });
      setFetchedModels(res.models);
      if (!res.models.includes(byoModelDraft) && res.models.length > 0) {
        setByoModelDraft(res.models[0]);
      }
      setFlash({ tone: "success", text: `Fetched ${res.models.length} model(s).` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setFetchingModels(false);
    }
  }

  async function handleToggleByo(enabled: boolean): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await api.patch("/api/subscription/byo", {
        enabled,
        provider: activeTab === "chatgpt" ? "chatgpt_oauth" : "openai_compatible"
      });
      await loadSummary();
      setFlash({ tone: "success", text: enabled ? "BYO provider activated." : "BYO provider disabled." });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleDisconnectChatGpt(): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await api.post("/api/subscription/byo/chatgpt/disconnect", {});
      await loadSummary();
      setFlash({ tone: "success", text: "ChatGPT account disconnected." });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function handleChatGptForceDefaultModelChange(model: string): Promise<void> {
    setSaving(true);
    setError(null);
    try {
      await api.patch("/api/subscription/byo/chatgpt/force-model", { model: model.trim() || null });
      await loadSummary();
      void refreshWorkspaces().catch(() => {});
      setFlash({ tone: "success", text: "ChatGPT force-default model updated." });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <section className="page-content">
        <article className="section-card empty-card">
          <h3>Loading subscription details...</h3>
        </article>
      </section>
    );
  }

  if (!summary) {
    return (
      <section className="page-content">
        <article className="section-card empty-card">
          <h3>Subscription unavailable</h3>
          <p>{error ?? "Unable to load subscription details."}</p>
        </article>
      </section>
    );
  }

  const isChatGptActive = summary.byo.enabled && summary.byo.provider === "chatgpt_oauth";
  const isCustomApiActive = summary.byo.enabled && summary.byo.provider === "openai_compatible";

  return (
    <section className="page-content">
      <article className="section-card">
        <div className="section-head">
          <div>
            <h3>Subscription & Providers</h3>
            <p className="muted-text">Track quota usage and manage your BYO (Bring Your Own) provider settings.</p>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: "0.75rem", marginTop: "1rem" }}>
          <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
            <strong>Current mode</strong>
            <p className="muted-text" style={{ margin: "0.4rem 0 0" }}>{summary.mode}</p>
          </div>
          {summary.usage.limits.length > 0 ? summary.usage.limits.map((limit) => (
            <div key={limit.durationDays} className="subscription-usage-limit-card">
              <strong>{limit.durationDays} day usage limit</strong>
              <p className="subscription-usage-limit-percent">
                {limit.percentRemaining}% <span>remaining</span>
              </p>
              <div className="subscription-usage-limit-meter" aria-hidden="true">
                <span style={{ width: `${limit.percentRemaining}%` }} />
              </div>
              <p className="muted-text" style={{ margin: "0.2rem 0 0" }}>{formatResetTime(limit.resetAtUtc)}</p>
            </div>
          )) : (
            <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
              <strong>Usage limits</strong>
              <p className="muted-text" style={{ margin: "0.4rem 0 0" }}>No active token limit</p>
            </div>
          )}
          <div className="section-card" style={{ boxShadow: "none", background: "var(--surface-muted)" }}>
            <strong>Messages</strong>
            {summary.usage.freeMessageLimit === null ? (
              <p className="muted-text" style={{ margin: "0.4rem 0 0" }}>Unlimited</p>
            ) : (
              <>
                <p className="muted-text" style={{ margin: "0.4rem 0 0" }}>
                  {summary.usage.freeMessagesUsed} / {summary.usage.freeMessageLimit}
                </p>
                <p className="muted-text" style={{ margin: "0.2rem 0 0" }}>Remaining: {summary.usage.freeMessagesRemaining}</p>
              </>
            )}
          </div>
        </div>

        <div className="stack-form" style={{ marginTop: "1rem" }}>
          <strong>Assigned plans</strong>
          {summary.plans.length > 0 ? (
            <div style={{ display: "grid", gap: "0.5rem" }}>
              {summary.plans.map((plan) => (
                <div key={plan.id} style={{ border: "1px solid var(--border)", borderRadius: "8px", padding: "0.75rem" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: "0.5rem" }}>
                    <strong>{plan.name}</strong>
                    <span className="muted-text">{plan.isActive ? "Active" : "Inactive"}</span>
                  </div>
                  <p className="muted-text" style={{ margin: "0.3rem 0 0" }}>
                    {(plan.usageLimits.length > 0 ? plan.usageLimits : [{ weightedTokens: plan.monthlyTokenQuota, durationDays: 30 }])
                      .map((limit) => `${limit.durationDays} day limit`)
                      .join(", ")}
                  </p>
                  {plan.notes ? <p className="muted-text" style={{ margin: "0.25rem 0 0" }}>{plan.notes}</p> : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="muted-text">No subscription plans assigned.</p>
          )}
          {activePlans.length === 0 ? (
            <p className="muted-text" style={{ marginTop: "0.2rem" }}>
              Free-message quota is used when you have no active plans and BYO is disabled.
            </p>
          ) : null}
        </div>

        <div style={{ marginTop: "1.5rem", display: "grid", gap: "1rem" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <strong>Bring your own provider (BYO)</strong>
            {summary.byo.enabled ? (
              <button className="btn ghost danger" type="button" onClick={() => void handleToggleByo(false)} disabled={saving}>
                Disable BYO
              </button>
            ) : null}
          </div>

          <div style={{ display: "flex", gap: "0.5rem", borderBottom: "1px solid var(--border)", paddingBottom: "0.5rem" }}>
            <button
              className={`btn ${activeTab === "chatgpt" ? "primary" : "ghost"}`}
              type="button"
              onClick={() => setActiveTab("chatgpt")}
            >
              Sign in with ChatGPT {isChatGptActive ? " (Active)" : ""}
            </button>
            <button
              className={`btn ${activeTab === "custom" ? "primary" : "ghost"}`}
              type="button"
              onClick={() => setActiveTab("custom")}
            >
              Custom API Key {isCustomApiActive ? " (Active)" : ""}
            </button>
          </div>

          {activeTab === "chatgpt" ? (
            <ChatGptByoSection
              chatgpt={summary.byo.chatgpt}
              isCurrentProvider={isChatGptActive}
              onOpenAuthModal={() => setShowAuthModal(true)}
              onDisconnect={handleDisconnectChatGpt}
              onEnable={() => handleToggleByo(true)}
              onForceDefaultModelChange={handleChatGptForceDefaultModelChange}
              disabled={saving}
            />
          ) : (
            <CustomApiByoSection
              baseUrl={byoBaseUrlDraft}
              model={byoModelDraft}
              apiKey={byoApiKeyDraft}
              hasApiKey={summary.byo.hasApiKey}
              isCurrentProvider={isCustomApiActive}
              fetchedModels={fetchedModels}
              saving={saving}
              fetchingModels={fetchingModels}
              onBaseUrlChange={setByoBaseUrlDraft}
              onModelChange={setByoModelDraft}
              onApiKeyChange={setByoApiKeyDraft}
              onFetchModels={fetchModels}
              onSave={saveCustomByo}
            />
          )}

          {error ? <p className="error-text">{error}</p> : null}
        </div>
      </article>

      {showAuthModal ? (
        <ChatGptDeviceAuthModal
          api={api}
          onClose={() => setShowAuthModal(false)}
          onSuccess={() => {
            setShowAuthModal(false);
            void loadSummary();
            setFlash({ tone: "success", text: "Successfully connected ChatGPT subscription!" });
          }}
        />
      ) : null}
    </section>
  );
}
