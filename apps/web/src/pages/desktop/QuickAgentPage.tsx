import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { LoaderCircle, PanelTopOpen, X } from "lucide-react";
import { createApiClient } from "../../lib/api";
import { ChatInput } from "../../components/taskConversation/ChatInput";
import { EnvironmentFilePickerModal } from "../../components/modals/EnvironmentFilePickerModal";
import { SourceFilePickerModal } from "../../components/modals/SourceFilePickerModal";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { useFileUpload } from "../../hooks/useFileUpload";
import { useTaskInputCatalog } from "../../hooks/useTaskInputCatalog";
import {
  buildCreateTaskParametersPayload,
  buildCreateTaskSchedulePayload,
  buildDefaultTaskParameters
} from "../../task/taskParameters";
import { buildTaskInputAttachmentPath } from "../../task/taskFileDestinations";
import { buildDefaultTaskToolOptions, normalizeToolOptions } from "../../task/taskInputDrafts";
import { canSelectTaskModel } from "../../task/taskModelSelection";
import type { Environment, TaskParameters, TaskToolOptions, UserProfile, Workspace, WorkspaceSettings } from "../../lib/types";
import { joinTaskMessage } from "../../lib/utils";
import type { WorkspaceSourceSummary } from "../../sources/sourceTypes";

function createPendingTaskId(): string {
  return crypto.randomUUID();
}

const DEFAULT_TOOL_OPTIONS: TaskToolOptions = buildDefaultTaskToolOptions();
const DEFAULT_TASK_PARAMETERS: TaskParameters = buildDefaultTaskParameters();

function QuickAgentWindowCard(props: {
  children: ReactNode;
  className?: string;
}) {
  const className = props.className ? `quick-agent-card ${props.className}` : "quick-agent-card";

  return (
    <section className={className}>
      <div className="quick-agent-drag-bar" aria-hidden="true">
        <span className="quick-agent-drag-pill">
          <span className="quick-agent-drag-grip">⋯⋯</span>
          <span className="quick-agent-drag-label">Quick Agent</span>
        </span>
      </div>
      {props.children}
    </section>
  );
}

export function QuickAgentPage(props: {
  token: string | null;
  requiresServerSelection: boolean;
}) {
  const { activeContext, capabilities, platform, saveActiveContext } = useAppRuntime();
  const api = useMemo(() => (props.token ? createApiClient(props.token) : null), [props.token]);
  const [focusToken, setFocusToken] = useState(1);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [environments, setEnvironments] = useState<Environment[]>([]);
  const [workspaceSettingsById, setWorkspaceSettingsById] = useState<Record<string, WorkspaceSettings>>({});
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string | null>(activeContext.workspaceId);
  const [selectedEnvironmentId, setSelectedEnvironmentId] = useState<string | null>(activeContext.environmentId);
  const [pendingTaskId, setPendingTaskId] = useState<string>(() => createPendingTaskId());
  const [prompt, setPrompt] = useState("");
  const [toolOptions, setToolOptions] = useState<TaskToolOptions>(DEFAULT_TOOL_OPTIONS);
  const [taskParameters, setTaskParameters] = useState<TaskParameters>(DEFAULT_TASK_PARAMETERS);
  const [selectedSource, setSelectedSource] = useState<WorkspaceSourceSummary | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [isContextLoading, setIsContextLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isEnvironmentFilePickerOpen, setIsEnvironmentFilePickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const {
    availableSkills,
    availableAgents,
    availableSources,
    attachableSources,
    defaultAgentId,
    modelSliderAgentIds
  } = useTaskInputCatalog(api, selectedWorkspaceId, user?.is_super_admin === true);

  useEffect(() => platform.onQuickAgentActivated(() => setFocusToken((current) => current + 1)), [platform]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        void platform.closeQuickAgent();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [platform]);

  useEffect(() => {
    if (!api) {
      return;
    }

    let cancelled = false;
    setIsContextLoading(true);

    void api.get<{ user: UserProfile; workspaces: Workspace[] }>("/api/auth/me")
      .then((response) => {
        if (cancelled) {
          return;
        }

        setUser(response.user);
        setWorkspaces(response.workspaces);
        setSelectedWorkspaceId((current) => {
          if (current && response.workspaces.some((workspace) => workspace.id === current)) {
            return current;
          }

          if (activeContext.workspaceId && response.workspaces.some((workspace) => workspace.id === activeContext.workspaceId)) {
            return activeContext.workspaceId;
          }

          return response.workspaces[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsContextLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeContext.workspaceId, api]);

  useEffect(() => {
    if (!api || !selectedWorkspaceId) {
      setEnvironments([]);
      setSelectedEnvironmentId(null);
      return;
    }

    let cancelled = false;
    setIsContextLoading(true);

    void api.get<{ items: Environment[] }>(`/api/workspaces/${selectedWorkspaceId}/projects`)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setEnvironments(response.items);
        setSelectedEnvironmentId((current) => {
          if (current && response.items.some((environment) => environment.id === current)) {
            return current;
          }

          if (
            activeContext.workspaceId === selectedWorkspaceId
            && activeContext.environmentId
            && response.items.some((environment) => environment.id === activeContext.environmentId)
          ) {
            return activeContext.environmentId;
          }

          return response.items[0]?.id ?? null;
        });
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsContextLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeContext.environmentId, activeContext.workspaceId, api, selectedWorkspaceId]);

  useEffect(() => {
    setPendingTaskId(createPendingTaskId());
  }, [selectedEnvironmentId]);

  useEffect(() => {
    if (!api || !selectedWorkspaceId) {
      return;
    }

    let cancelled = false;
    void api.get<WorkspaceSettings>(`/api/workspaces/${selectedWorkspaceId}/settings`)
      .then((settings) => {
        if (!cancelled) {
          setWorkspaceSettingsById((current) => ({ ...current, [selectedWorkspaceId]: settings }));
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [api, selectedWorkspaceId]);


  useEffect(() => {
    if (!canSelectTaskModel(user) || availableAgents.length === 0) {
      setSelectedAgentId(null);
      return;
    }

    setSelectedAgentId((current) => {
      if (current && availableAgents.some((agent) => agent.id === current)) {
        return current;
      }

      if (typeof defaultAgentId === "string" && availableAgents.some((agent) => agent.id === defaultAgentId)) {
        return defaultAgentId;
      }

      return availableAgents[0]?.id ?? null;
    });
  }, [availableAgents, defaultAgentId, user]);

  const taskInputUploadPath = useMemo(() => {
    if (!selectedEnvironmentId) {
      return null;
    }

    return `.meowbert/task-runs/${pendingTaskId}/inputs`;
  }, [pendingTaskId, selectedEnvironmentId]);

  const {
    attachments,
    uploadFiles,
    removeAttachment,
    toggleAttachmentForceInclude,
    clearAttachments,
    isUploading,
    pendingUploads,
    uploadError,
    appendAttachments
  } = useFileUpload(
    api ?? createApiClient(""),
    selectedEnvironmentId,
    {
      destinationPath: taskInputUploadPath,
      createDirectories: true,
      toAttachmentPath: (uploaded) => buildTaskInputAttachmentPath(taskInputUploadPath, uploaded.relativePath, uploaded.name)
    }
  );

  const canSubmit = !!api && !!selectedWorkspaceId && !!selectedEnvironmentId;

  const selectedWorkspace = workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const selectedEnvironment = environments.find((environment) => environment.id === selectedEnvironmentId) ?? null;
  const selectedWorkspaceSettings = selectedWorkspaceId ? workspaceSettingsById[selectedWorkspaceId] : null;
  const workspaceMemoryEnabled = selectedWorkspaceSettings?.memoryEnabled === true;
  const toolDefaults = useMemo(
    () => ({ memorySearch: workspaceMemoryEnabled, defaultToolset: selectedWorkspaceSettings?.defaultToolset ?? null }),
    [selectedWorkspaceSettings?.defaultToolset, workspaceMemoryEnabled]
  );
  const resolvedToolOptions = useMemo(
    () => ({
      ...toolOptions,
      memorySearch: workspaceMemoryEnabled ? toolOptions.memorySearch : false
    }),
    [workspaceMemoryEnabled, toolOptions]
  );

  const handleWorkspaceChange = useCallback((nextWorkspaceId: string) => {
    setSelectedWorkspaceId(nextWorkspaceId || null);
    setSelectedEnvironmentId(null);
    setError(null);
  }, []);

  const handleEnvironmentChange = useCallback((nextEnvironmentId: string) => {
    setSelectedEnvironmentId(nextEnvironmentId || null);
    setError(null);
  }, []);

  useEffect(() => {
    setToolOptions(buildDefaultTaskToolOptions(toolDefaults));
    setTaskParameters(buildDefaultTaskParameters());
  }, [selectedEnvironmentId, toolDefaults]);

  async function submitTask(): Promise<void> {
    if (!api || !selectedWorkspaceId || !selectedEnvironmentId || (!prompt.trim() && attachments.length === 0)) {
      return;
    }

    setError(null);
    setIsSubmitting(true);

    try {
      const toolsPayload: Record<string, unknown> = {};
      if (resolvedToolOptions.webSearch) toolsPayload.webSearch = true;
      if (workspaceMemoryEnabled && resolvedToolOptions.memorySearch) toolsPayload.memorySearch = true;
      if (resolvedToolOptions.scheduleTask) toolsPayload.scheduleTask = true;
      if (resolvedToolOptions.subtasks) toolsPayload.subtasks = true;
      if (capabilities.isDesktop && resolvedToolOptions.computerUse) toolsPayload.computerUse = true;
      if (resolvedToolOptions.enabledSkills.length > 0) toolsPayload.enabledSkills = resolvedToolOptions.enabledSkills;
      if (resolvedToolOptions.enabledSources.length > 0) toolsPayload.enabledSources = resolvedToolOptions.enabledSources;
      const hasTools = Object.keys(toolsPayload).length > 0;
      const clientTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const schedulePayload = buildCreateTaskSchedulePayload(taskParameters);
      const parametersPayload = buildCreateTaskParametersPayload(taskParameters);

      const created = await api.post<{ taskId: string }>(`/api/projects/${selectedEnvironmentId}/tasks`, {
        taskId: pendingTaskId,
        message: joinTaskMessage(prompt, attachments),
        attachments,
        ...(typeof clientTimezone === "string" && clientTimezone.length > 0 ? { clientTimezone } : {}),
        ...(hasTools ? { tools: toolsPayload } : {}),
        ...(schedulePayload ? { schedule: schedulePayload } : {}),
        ...(parametersPayload ? { parameters: parametersPayload } : {}),
        ...(selectedAgentId ? { agent: { id: selectedAgentId } } : {})
      });

      await saveActiveContext({
        workspaceId: selectedWorkspaceId,
        environmentId: selectedEnvironmentId
      });

      setPrompt("");
      setToolOptions(buildDefaultTaskToolOptions(toolDefaults));
      setTaskParameters(buildDefaultTaskParameters());
      clearAttachments();
      setPendingTaskId(createPendingTaskId());
      await platform.focusMainWindow(`/app/${selectedWorkspaceId}/projects/${selectedEnvironmentId}/tasks/${created.taskId}`);
      await platform.closeQuickAgent();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIsSubmitting(false);
      return;
    }

    setIsSubmitting(false);
  }

  if (props.requiresServerSelection) {
    return (
      <main className="quick-agent-shell">
        <QuickAgentWindowCard className="quick-agent-empty card">
          <h2>Finish setup first</h2>
          <p className="muted-text">Choose your Meowbert server in the main app before using Quick Agent.</p>
          <div className="row-actions" style={{ justifyContent: "center" }}>
            <button className="btn primary" type="button" onClick={() => void platform.focusMainWindow("/servers")}>
              Open Setup
            </button>
          </div>
        </QuickAgentWindowCard>
      </main>
    );
  }

  if (!props.token) {
    return (
      <main className="quick-agent-shell">
        <QuickAgentWindowCard className="quick-agent-empty card">
          <h2>Sign in to use Quick Agent</h2>
          <p className="muted-text">Quick Agent uses your existing Meowbert session to create tasks instantly.</p>
          <div className="row-actions" style={{ justifyContent: "center" }}>
            <button className="btn primary" type="button" onClick={() => void platform.focusMainWindow("/auth")}>
              Open Sign In
            </button>
          </div>
        </QuickAgentWindowCard>
      </main>
    );
  }

  return (
    <main className="quick-agent-shell">
      <QuickAgentWindowCard>
        <div className="quick-agent-toolbar">
          <div className="quick-agent-context-controls">
            <label className="quick-agent-context-select">
              <select
                aria-label="Workspace"
                value={selectedWorkspaceId ?? ""}
                onChange={(event) => handleWorkspaceChange(event.target.value)}
                disabled={isContextLoading || workspaces.length === 0}
              >
                {workspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                ))}
              </select>
            </label>
            <label className="quick-agent-context-select">
              <select
                aria-label="Project"
                value={selectedEnvironmentId ?? ""}
                onChange={(event) => handleEnvironmentChange(event.target.value)}
                disabled={isContextLoading || environments.length === 0}
              >
                {environments.map((environment) => (
                  <option key={environment.id} value={environment.id}>{environment.name}</option>
                ))}
              </select>
            </label>
          </div>

          <div className="quick-agent-actions">
            <button
              className="btn ghost icon-btn quick-agent-action"
              type="button"
              onClick={() => void platform.focusMainWindow(
                selectedWorkspaceId && selectedEnvironmentId
                  ? `/app/${selectedWorkspaceId}/projects/${selectedEnvironmentId}/tasks/new`
                  : "/app"
              )}
              aria-label="Open Full Composer"
              title="Open Full Composer"
            >
              <PanelTopOpen size={16} />
            </button>
            <button
              className="btn ghost icon-btn quick-agent-action"
              type="button"
              onClick={() => void platform.closeQuickAgent()}
              aria-label="Close Quick Agent"
              title="Close Quick Agent"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {isContextLoading ? (
          <div className="quick-agent-loading muted-text">
            <LoaderCircle size={18} className="spin" />
            <span>Loading your environments…</span>
          </div>
        ) : null}

        {!isContextLoading && (!selectedWorkspace || !selectedEnvironment) ? (
          <div className="quick-agent-empty-state section-card empty-card">
            <h3>No environment available</h3>
            <p>Pick a workspace with an environment, or create one in the main app.</p>
            <button className="btn primary" type="button" onClick={() => void platform.focusMainWindow("/app")}>Open Main App</button>
          </div>
        ) : (
          <div className="quick-agent-composer">
            <ChatInput
              value={prompt}
              onChange={setPrompt}
              onSubmit={() => {
                void submitTask();
              }}
              isSubmitting={isSubmitting}
              attachments={attachments}
              onRemoveAttachment={removeAttachment}
              onToggleAttachmentForceInclude={toggleAttachmentForceInclude}
              onAttachFiles={uploadFiles}
              onOpenEnvironmentFiles={() => setIsEnvironmentFilePickerOpen(true)}
              isUploading={isUploading}
              pendingUploads={pendingUploads}
              toolOptions={resolvedToolOptions}
              showMemorySearch={workspaceMemoryEnabled}
              showComputerUse={capabilities.isDesktop}
              onToolOptionsChange={(nextToolOptions) => {
                setToolOptions(normalizeToolOptions(nextToolOptions, toolDefaults));
              }}
              taskParameters={taskParameters}
              onTaskParametersChange={setTaskParameters}
              taskParametersMode="create"
              availableSkills={availableSkills}
              availableSources={availableSources}
              attachableSources={attachableSources}
              availableAgents={availableAgents}
              selectedAgentId={selectedAgentId}
              defaultAgentId={defaultAgentId}
              modelSliderAgentIds={modelSliderAgentIds}
              onAgentChange={setSelectedAgentId}
              onSourceSetupRequested={() => {
                if (!selectedWorkspaceId) {
                  return;
                }

                void platform.focusMainWindow(`/app/${selectedWorkspaceId}/connectors?tab=sources`);
              }}
              onOpenSourceFiles={(source) => setSelectedSource(source)}
              showAgentSwitcher={canSelectTaskModel(user)}
              placeholder="Ask Bert to handle something…"
              autoFocus
              focusToken={focusToken}
              mobileEnterBehavior="submit"
            />
          </div>
        )}

        {(error || uploadError) ? <p className="error-text quick-agent-error">{error || uploadError}</p> : null}
      </QuickAgentWindowCard>
      <EnvironmentFilePickerModal
        api={api ?? createApiClient("")}
        environmentId={selectedEnvironmentId}
        isOpen={isEnvironmentFilePickerOpen}
        onClose={() => setIsEnvironmentFilePickerOpen(false)}
        onSelect={appendAttachments}
      />
      <SourceFilePickerModal
        api={api ?? createApiClient("")}
        workspaceId={selectedWorkspaceId}
        environmentId={selectedEnvironmentId}
        taskId={pendingTaskId}
        source={selectedSource}
        isOpen={selectedSource !== null}
        onClose={() => setSelectedSource(null)}
        onSelect={appendAttachments}
        destinationPath={taskInputUploadPath}
        createDirectories
        toAttachmentPath={(uploaded) => buildTaskInputAttachmentPath(taskInputUploadPath, uploaded.relativePath, uploaded.name)}
      />
    </main>
  );
}
