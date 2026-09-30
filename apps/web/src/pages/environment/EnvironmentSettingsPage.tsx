import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getProjectMemorySynthesisEnabled,
  setProjectMemorySynthesisEnabled
} from "@meowbert/shared/memory";
import {
  AgentDefaultsSettingsSection,
  type AgentPersonalityOption
} from "../../components/settings/AgentDefaultsSettingsSection";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import {
  getProjectSystemPromptOverride,
  getPersistentRuntimeEnabled,
  getProjectJsonPayload,
  getProjectPersonalityOverrideId,
  getTaskCleanupExpirationDays,
  safeParseJson,
  isPlainObject,
  normalizeProjectJsonPayload,
  setProjectSystemPromptOverride,
  setPersistentRuntimeEnabled,
  setProjectPersonalityId,
  getSandboxNetworkEnabledOverride,
  setSandboxNetworkEnabledOverride,
  setTaskCleanupExpirationDays,
  getNetworkRequestLoggingEnabled,
  setNetworkRequestLoggingEnabled,
  formatDateTime,
  TASK_CLEANUP_EXPIRATION_DAYS_MAX,
  TASK_CLEANUP_EXPIRATION_DAYS_MIN
} from "../../lib/utils";

interface CleanupStatusSnapshot {
  executedAt: string;
  mode: "setting" | "override";
  expirationDays: number;
  cutoffIso: string;
  deletedTaskCount: number;
  deletedPathCount: number;
  skippedPathCount: number;
  pathErrorCount: number;
  reachedBatchLimit: boolean;
}

interface ProjectPersonalityResponse {
  items: AgentPersonalityOption[];
  defaultId: string | null;
}

export function ProjectSettingsPage() {
  const workspaceApp = useWorkspaceApp();
  const { api, activeWorkspaceId, workspaceSettings, setFlash } = workspaceApp;
  const activeProjectId = workspaceApp.activeProjectId ?? workspaceApp.activeEnvironmentId;
  const projects = workspaceApp.projects ?? workspaceApp.environments;
  const patchProject = workspaceApp.patchProject ?? workspaceApp.patchEnvironment;
  const navigate = useNavigate();
  const project = projects.find((item) => item.id === activeProjectId);

  const [payloadDraft, setPayloadDraft] = useState("");
  const [personalityOptions, setPersonalityOptions] = useState<AgentPersonalityOption[]>([]);
  const [defaultPersonalityId, setDefaultPersonalityId] = useState<string | null>("default");
  const [isLoadingPersonalityOptions, setIsLoadingPersonalityOptions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunningCleanup, setIsRunningCleanup] = useState(false);
  const [lastCleanupStatus, setLastCleanupStatus] = useState<CleanupStatusSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<"general" | "runtime" | "memory" | "cleanup" | "debug" | "json">("general");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (project) {
      setError(null);
      setPayloadDraft(JSON.stringify(getProjectJsonPayload(project), null, 2));
    }
  }, [project]);

  useEffect(() => {
    setLastCleanupStatus(null);
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeWorkspaceId || !project) {
      setPersonalityOptions([]);
      setDefaultPersonalityId("default");
      return;
    }

    let cancelled = false;
    setIsLoadingPersonalityOptions(true);
    setError(null);

    api
      .get<ProjectPersonalityResponse>(`/api/workspaces/${activeWorkspaceId}/personalities`)
      .then((response) => {
        if (!cancelled) {
          setPersonalityOptions(response.items);
          setDefaultPersonalityId(response.defaultId);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingPersonalityOptions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api, project]);

  if (!project || !activeProjectId) {
    return (
      <section className="page-content settings-page">
        <article className="section-card empty-card">
          <h3>Project unavailable</h3>
          <p>Select another project before editing settings.</p>
        </article>
      </section>
    );
  }

  const projectId = project.id;
  const currentJson = safeParseJson(payloadDraft);
  const systemPrompt = getProjectSystemPromptOverride(currentJson);
  const personalityOverrideId = getProjectPersonalityOverrideId(currentJson);
  const workspacePersonalityLabel = personalityOptions.find(
    (option) => option.id === (workspaceSettings?.effectivePersonalityId ?? defaultPersonalityId)
  )?.label ?? null;
  const cleanupExpirationDays = getTaskCleanupExpirationDays(currentJson);
  const sandboxNetworkEnabled = getSandboxNetworkEnabledOverride(currentJson);
  const networkRequestLoggingEnabled = getNetworkRequestLoggingEnabled(currentJson);
  const projectMemorySynthesisEnabled = getProjectMemorySynthesisEnabled(currentJson);
  const persistentRuntimeEnabled = getPersistentRuntimeEnabled(currentJson);

  const updateSystemPrompt = (newValue: string) => {
    try {
      const current = JSON.parse(payloadDraft) as Record<string, unknown>;
      setPayloadDraft(JSON.stringify(setProjectSystemPromptOverride(current, newValue), null, 2));
    } catch {
      // ignore until JSON is fixed
    }
  };

  const updatePersonality = (nextPersonalityId: string | null) => {
    try {
      const current = JSON.parse(payloadDraft) as Record<string, unknown>;
      setPayloadDraft(JSON.stringify(setProjectPersonalityId(current, nextPersonalityId), null, 2));
    } catch {
      // ignore until JSON is fixed
    }
  };

  const updateTaskCleanupExpiration = (nextValue: number | null) => {
    try {
      const current = JSON.parse(payloadDraft) as Record<string, unknown>;
      setPayloadDraft(JSON.stringify(setTaskCleanupExpirationDays(current, nextValue), null, 2));
    } catch {
      // ignore until JSON is fixed
    }
  };

  const updateSandboxNetworking = (enabled: boolean | null) => {
    try {
      const current = JSON.parse(payloadDraft) as Record<string, unknown>;
      setPayloadDraft(JSON.stringify(setSandboxNetworkEnabledOverride(current, enabled), null, 2));
    } catch {
      // ignore until JSON is fixed
    }
  };

  const updateNetworkRequestLogging = (enabled: boolean) => {
    try {
      const current = JSON.parse(payloadDraft) as Record<string, unknown>;
      setPayloadDraft(JSON.stringify(setNetworkRequestLoggingEnabled(current, enabled), null, 2));
    } catch {
      // ignore until JSON is fixed
    }
  };

  const updateProjectMemorySynthesis = (enabled: boolean) => {
    try {
      const current = JSON.parse(payloadDraft) as Record<string, unknown>;
      setPayloadDraft(JSON.stringify(setProjectMemorySynthesisEnabled(current, enabled), null, 2));
    } catch {
      // ignore until JSON is fixed
    }
  };

  const updatePersistentRuntime = (enabled: boolean) => {
    try {
      const current = JSON.parse(payloadDraft) as Record<string, unknown>;
      setPayloadDraft(JSON.stringify(setPersistentRuntimeEnabled(current, enabled), null, 2));
    } catch {
      // ignore until JSON is fixed
    }
  };

  const handleCleanupExpirationInput = (rawValue: string) => {
    const trimmed = rawValue.trim();
    if (trimmed.length === 0) {
      updateTaskCleanupExpiration(null);
      return;
    }

    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      return;
    }

    const rounded = Math.floor(parsed);
    const clamped = Math.min(
      TASK_CLEANUP_EXPIRATION_DAYS_MAX,
      Math.max(TASK_CLEANUP_EXPIRATION_DAYS_MIN, rounded)
    );
    updateTaskCleanupExpiration(clamped);
  };

  async function saveSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    setError(null);

    let parsed: unknown;
    try {
      parsed = JSON.parse(payloadDraft);
    } catch (err) {
      setError(err instanceof Error ? `Invalid JSON: ${err.message}` : "Invalid JSON payload");
      return;
    }

    if (!isPlainObject(parsed)) {
      setError("Json payload must be a JSON object.");
      return;
    }

    setIsSaving(true);
    try {
      await patchProject(projectId, { jsonPayload: normalizeProjectJsonPayload(parsed) });
      setFlash({ tone: "success", text: "Project settings saved." });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function runManualCleanup(): Promise<void> {
    if (!cleanupExpirationDays) {
      setError("Set a cleanup expiration before running manual cleanup.");
      return;
    }

    const confirmed = window.confirm(
      `Delete completed/cancelled tasks older than ${cleanupExpirationDays} day(s) now? This is permanent.`
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setIsRunningCleanup(true);
    try {
      const result = await api.post<CleanupStatusSnapshot>(`/api/projects/${projectId}/tasks/cleanup`, {
        expirationDays: cleanupExpirationDays
      });
      setLastCleanupStatus(result);
      const suffix = result.reachedBatchLimit ? " More tasks may still be eligible; run cleanup again to continue." : "";
      setFlash({ tone: "success", text: `Cleanup deleted ${result.deletedTaskCount} task(s).${suffix}` });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunningCleanup(false);
    }
  }

  return (
    <section className="page-content settings-page">
      <article className="section-card">
        <div className="section-head">
          <div>
            <h3>Project Settings</h3>
            <p className="muted-text">{project.name} · Configure project-specific overrides.</p>
          </div>
          <div className="row-actions">
            <button className="btn ghost" onClick={() => navigate(`/app/${activeWorkspaceId}/settings`)}>
              Workspace Settings
            </button>
            <button className="btn ghost" onClick={() => navigate(`/app/${activeWorkspaceId}/projects/${project.id}`)}>
              Back to Tasks
            </button>
          </div>
        </div>

        <div className="tab-row" style={{ marginTop: "1rem" }}>
          <button className={`tab-btn ${activeTab === "general" ? "active" : ""}`} onClick={() => setActiveTab("general")}>General</button>
          <button className={`tab-btn ${activeTab === "runtime" ? "active" : ""}`} onClick={() => setActiveTab("runtime")}>Runtime</button>
          <button className={`tab-btn ${activeTab === "memory" ? "active" : ""}`} onClick={() => setActiveTab("memory")}>Memory</button>
          <button className={`tab-btn ${activeTab === "cleanup" ? "active" : ""}`} onClick={() => setActiveTab("cleanup")}>Cleanup</button>
          <button className={`tab-btn ${activeTab === "debug" ? "active" : ""}`} onClick={() => setActiveTab("debug")}>Debug</button>
          <button className={`tab-btn ${activeTab === "json" ? "active" : ""}`} onClick={() => setActiveTab("json")}>Advanced JSON</button>
        </div>

        <form className="stack-form" onSubmit={saveSettings} style={{ marginTop: "1rem" }}>
          {activeTab === "general" ? (
            <AgentDefaultsSettingsSection
              mode="project"
              disabled={isLoadingPersonalityOptions}
              systemPrompt={systemPrompt}
              personalityId={personalityOverrideId}
              sandboxNetworkEnabled={sandboxNetworkEnabled}
              personalityOptions={personalityOptions}
              defaultPersonalityId={defaultPersonalityId}
              workspaceDefaultPersonalityLabel={workspacePersonalityLabel}
              workspaceDefaultNetworkEnabled={workspaceSettings?.effectiveSandboxNetworkEnabled}
              onSystemPromptChange={updateSystemPrompt}
              onPersonalityChange={updatePersonality}
              onSandboxNetworkChange={updateSandboxNetworking}
            />
          ) : null}

          {activeTab === "memory" ? (
            <div className="stack-form">
              <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={projectMemorySynthesisEnabled}
                  onChange={(event) => updateProjectMemorySynthesis(event.target.checked)}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <strong>Enable Automatic Memory Refresh</strong>
                  <p className="hint-text" style={{ marginTop: "0.3rem" }}>
                    Allows this Project to refresh its Memory automatically. It only runs when Automatic Memory Refresh is enabled in Workspace Settings.
                  </p>
                </div>
              </label>
            </div>
          ) : null}

          {activeTab === "runtime" ? (
            <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
              <input
                type="checkbox"
                checked={persistentRuntimeEnabled}
                onChange={(event) => updatePersistentRuntime(event.target.checked)}
                style={{ marginTop: "0.2rem" }}
              />
              <div>
                <strong>Enable persistent shell runtime</strong>
                <p className="hint-text" style={{ marginTop: "0.3rem" }}>
                  Lets tasks start managed project shell sessions that continue across task runs. Usage is charged to the user who starts the session.
                </p>
              </div>
            </label>
          ) : null}

          {activeTab === "cleanup" ? (
            <div className="stack-form">
              <label>
                <strong>Task Cleanup Expiration (Days)</strong>
                <p className="hint-text">Automatically deletes old completed/cancelled tasks to free disk space. Leave blank to disable cleanup.</p>
                <input
                  type="number"
                  min={TASK_CLEANUP_EXPIRATION_DAYS_MIN}
                  max={TASK_CLEANUP_EXPIRATION_DAYS_MAX}
                  step={1}
                  value={cleanupExpirationDays ?? ""}
                  onChange={(event) => handleCleanupExpirationInput(event.target.value)}
                  placeholder="Disabled"
                />
              </label>
              <div className="row-actions">
                <button className="btn ghost" type="button" onClick={() => void runManualCleanup()} disabled={!cleanupExpirationDays || isRunningCleanup}>
                  {isRunningCleanup ? "Running cleanup..." : "Run Cleanup Now"}
                </button>
              </div>
              {lastCleanupStatus ? (
                <div className="note-card">
                  <strong>Last Cleanup</strong>
                  <p className="muted-text">{formatDateTime(lastCleanupStatus.executedAt)}</p>
                  <p className="muted-text">Deleted {lastCleanupStatus.deletedTaskCount} task(s) and {lastCleanupStatus.deletedPathCount} path(s).</p>
                </div>
              ) : null}
            </div>
          ) : null}

          {activeTab === "debug" ? (
            <div className="stack-form">
              <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={networkRequestLoggingEnabled}
                  onChange={(event) => updateNetworkRequestLogging(event.target.checked)}
                  style={{ marginTop: "0.2rem" }}
                />
                <div>
                  <strong>Log model network requests</strong>
                  <p className="hint-text" style={{ marginTop: "0.3rem" }}>
                    Emits model request start/success/error events into the task timeline for debugging.
                  </p>
                </div>
              </label>
            </div>
          ) : null}

          {activeTab === "json" ? (
            <label>
              <strong>Advanced JSON</strong>
              <p className="hint-text">Edit the raw project payload directly.</p>
              <textarea value={payloadDraft} onChange={(event) => setPayloadDraft(event.target.value)} rows={20} spellCheck={false} style={{ fontFamily: "var(--font-mono, monospace)" }} />
            </label>
          ) : null}

          {error ? <p className="error-text">{error}</p> : null}

          <div className="row-actions" style={{ justifyContent: "flex-end" }}>
            <button className="btn primary" type="submit" disabled={isSaving}>
              {isSaving ? "Saving..." : "Save Project Settings"}
            </button>
          </div>
        </form>
      </article>
    </section>
  );
}

export const EnvironmentSettingsPage = ProjectSettingsPage;
