import { getNewMessageOrganizationEnabled, getProjectMasterEnabled } from "@meowbert/shared/workspace-agent-settings";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AgentDefaultsSettingsSection,
  type AgentPersonalityOption
} from "../../components/settings/AgentDefaultsSettingsSection";
import { WorkspaceDefaultAgentSetting } from "../../components/settings/WorkspaceDefaultAgentSetting";
import { WorkspaceToolsetSettingsSection } from "../../components/settings/WorkspaceToolsetSettingsSection";
import type { SkillSummary } from "../../components/tasks/ToolOptionsDropdown";
import { WorkspaceMembersTab } from "../../components/workspace/WorkspaceMembersTab";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import type { ApiClient } from "../../lib/api";
import type { TaskToolOptions, WorkspaceSettings } from "../../lib/types";
import { buildDefaultTaskToolOptions, normalizeToolOptions } from "../../task/taskInputDrafts";

type WorkspaceSettingsTab = "agent" | "memory" | "requests" | "experiments" | "sandbox" | "members";

interface WorkspaceSettingsPatchBody {
  modelRequestTimeoutMs?: number | null;
  shellToolMaxTimeoutMs?: number | null;
  mcpTimeoutMs?: number | null;
  newMessageOrganizationEnabled?: boolean;
  projectMasterEnabled?: boolean;
  defaultAgentId?: string | null;
  nativeCompactionEnabled?: boolean;
  sendMetadataToModel?: boolean;
  claudeCacheKeepalive?: boolean;
  codeModeEnabled?: boolean;
  systemPrompt?: string | null;
  personalityId?: string | null;
  sandboxNetworkEnabled?: boolean | null;
  defaultToolset?: TaskToolOptions;
  memoryEnabled?: boolean;
  thoughtPersistenceEnabled?: boolean;
  memorySynthesisEnabled?: boolean;
  suggestedActionsEnabled?: boolean;
  runAsRoot?: boolean;
}

interface WorkspaceSettingsDraftValues {
  systemPromptDraft: string;
  defaultAgentIdDraft: string | null;
  personalityIdDraft: string | null;
  sandboxNetworkEnabledDraft: boolean | null;
  defaultToolset: TaskToolOptions;
  requestTimeoutMinutesDraft: string;
  shellToolMaxTimeoutMinutesDraft: string;
  mcpTimeoutMinutesDraft: string;
  newMessageOrganizationEnabled: boolean;
  organizationSettingChanged: boolean;
  projectMasterSettingChanged: boolean;
  projectMasterEnabled: boolean;
  nativeCompactionEnabled: boolean;
  sendMetadataToModel: boolean;
  claudeCacheKeepalive: boolean;
  codeModeEnabled: boolean;
  memoryEnabled: boolean;
  thoughtPersistenceEnabled: boolean;
  memorySynthesisEnabled: boolean;
  suggestedActionsEnabled: boolean;
  runAsRootEnabled: boolean;
}

interface WorkspaceSettingsDraftController extends WorkspaceSettingsDraftValues {
  setSystemPromptDraft: (value: string) => void;
  setDefaultAgentIdDraft: (value: string | null) => void;
  setPersonalityIdDraft: (value: string | null) => void;
  setSandboxNetworkEnabledDraft: (value: boolean | null) => void;
  setDefaultToolset: (value: TaskToolOptions) => void;
  setRequestTimeoutMinutesDraft: (value: string) => void;
  setShellToolMaxTimeoutMinutesDraft: (value: string) => void;
  setMcpTimeoutMinutesDraft: (value: string) => void;
  setNewMessageOrganizationEnabled: (value: boolean) => void;
  setProjectMasterEnabled: (value: boolean) => void;
  setNativeCompactionEnabled: (value: boolean) => void;
  setSendMetadataToModel: (value: boolean) => void;
  setClaudeCacheKeepalive: (value: boolean) => void;
  setCodeModeEnabled: (value: boolean) => void;
  setMemoryEnabled: (value: boolean) => void;
  setThoughtPersistenceEnabled: (value: boolean) => void;
  setMemorySynthesisEnabled: (value: boolean) => void;
  setSuggestedActionsEnabled: (value: boolean) => void;
  setRunAsRootEnabled: (value: boolean) => void;
}

function formatTimeoutMinutes(ms: number): string {
  const minutes = ms / 60_000;
  if (Number.isInteger(minutes)) {
    return String(minutes);
  }

  return String(Number(minutes.toFixed(2)));
}

function parseTimeoutDraftToMs(raw: string, fieldLabel: string): { value: number | null; error: string | null } {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { value: null, error: null };
  }

  const parsedMinutes = Number(trimmed);
  if (!Number.isFinite(parsedMinutes) || parsedMinutes <= 0) {
    return { value: null, error: `${fieldLabel} must be a positive number of minutes.` };
  }

  const parsedTimeoutMs = Math.floor(parsedMinutes * 60_000);
  if (parsedTimeoutMs < 1_000) {
    return { value: null, error: `${fieldLabel} must be at least 1 second.` };
  }

  return { value: parsedTimeoutMs, error: null };
}

function useWorkspaceSettingsDrafts(workspaceSettings: WorkspaceSettings | null): WorkspaceSettingsDraftController {
  const [systemPromptDraft, setSystemPromptDraft] = useState("");
  const [defaultAgentIdDraft, setDefaultAgentIdDraft] = useState<string | null>(null);
  const [personalityIdDraft, setPersonalityIdDraft] = useState<string | null>(null);
  const [sandboxNetworkEnabledDraft, setSandboxNetworkEnabledDraft] = useState<boolean | null>(null);
  const [defaultToolset, setDefaultToolset] = useState<TaskToolOptions>(() => buildDefaultTaskToolOptions());
  const [requestTimeoutMinutesDraft, setRequestTimeoutMinutesDraft] = useState("");
  const [shellToolMaxTimeoutMinutesDraft, setShellToolMaxTimeoutMinutesDraft] = useState("");
  const [mcpTimeoutMinutesDraft, setMcpTimeoutMinutesDraft] = useState("");
  const [newMessageOrganizationEnabled, setNewMessageOrganizationEnabled] = useState(() => getNewMessageOrganizationEnabled(null));
  const organizationSettingChanged = newMessageOrganizationEnabled !== getNewMessageOrganizationEnabled(workspaceSettings?.modelDefaults);
  const [projectMasterEnabled, setProjectMasterEnabled] = useState(() => getProjectMasterEnabled(null));
  const projectMasterSettingChanged = projectMasterEnabled !== getProjectMasterEnabled(workspaceSettings?.modelDefaults);
  const [nativeCompactionEnabled, setNativeCompactionEnabled] = useState(true);
  const [sendMetadataToModel, setSendMetadataToModel] = useState(false);
  const [claudeCacheKeepalive, setClaudeCacheKeepalive] = useState(false);
  const [codeModeEnabled, setCodeModeEnabled] = useState(true);
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [thoughtPersistenceEnabled, setThoughtPersistenceEnabled] = useState(false);
  const [memorySynthesisEnabled, setMemorySynthesisEnabled] = useState(false);
  const [suggestedActionsEnabled, setSuggestedActionsEnabled] = useState(true);
  const [runAsRootEnabled, setRunAsRootEnabled] = useState(false);

  useEffect(() => {
    setSystemPromptDraft(workspaceSettings?.systemPrompt ?? "");
    setDefaultAgentIdDraft(workspaceSettings?.defaultAgentId ?? null);
    setPersonalityIdDraft(workspaceSettings?.personalityId ?? null);
    setSandboxNetworkEnabledDraft(workspaceSettings?.sandboxNetworkEnabled ?? null);
    setDefaultToolset(normalizeToolOptions(workspaceSettings?.defaultToolset, { memorySearch: false }));
    setRequestTimeoutMinutesDraft(
      workspaceSettings?.modelRequestTimeoutMs == null ? "" : formatTimeoutMinutes(workspaceSettings.modelRequestTimeoutMs)
    );
    setShellToolMaxTimeoutMinutesDraft(
      workspaceSettings?.shellToolMaxTimeoutMs == null ? "" : formatTimeoutMinutes(workspaceSettings.shellToolMaxTimeoutMs)
    );
    setMcpTimeoutMinutesDraft(
      workspaceSettings?.mcpTimeoutMs == null ? "" : formatTimeoutMinutes(workspaceSettings.mcpTimeoutMs)
    );
    setNewMessageOrganizationEnabled(getNewMessageOrganizationEnabled(workspaceSettings?.modelDefaults));
    setProjectMasterEnabled(getProjectMasterEnabled(workspaceSettings?.modelDefaults));
    setNativeCompactionEnabled(workspaceSettings?.nativeCompactionEnabled !== false);
    setSendMetadataToModel(workspaceSettings?.sendMetadataToModel === true);
    setClaudeCacheKeepalive(workspaceSettings?.claudeCacheKeepalive === true);
    setCodeModeEnabled(workspaceSettings?.codeModeEnabled !== false);
    setMemoryEnabled(workspaceSettings?.memoryEnabled === true);
    setThoughtPersistenceEnabled(workspaceSettings?.thoughtPersistenceEnabled !== false);
    setMemorySynthesisEnabled(workspaceSettings?.memorySynthesisEnabled === true);
    setSuggestedActionsEnabled(workspaceSettings?.suggestedActionsEnabled !== false);
    setRunAsRootEnabled(workspaceSettings?.runAsRoot === true);
  }, [workspaceSettings]);

  return {
    systemPromptDraft,
    defaultAgentIdDraft,
    setDefaultAgentIdDraft,
    personalityIdDraft,
    sandboxNetworkEnabledDraft,
    defaultToolset,
    requestTimeoutMinutesDraft,
    shellToolMaxTimeoutMinutesDraft,
    mcpTimeoutMinutesDraft,
    newMessageOrganizationEnabled,
    organizationSettingChanged,
    projectMasterSettingChanged,
    setNewMessageOrganizationEnabled,
    projectMasterEnabled,
    setProjectMasterEnabled,
    nativeCompactionEnabled,
    sendMetadataToModel,
    claudeCacheKeepalive,
    codeModeEnabled,
    memoryEnabled,
    thoughtPersistenceEnabled,
    memorySynthesisEnabled,
    suggestedActionsEnabled,
    runAsRootEnabled,
    setSystemPromptDraft,
    setPersonalityIdDraft,
    setSandboxNetworkEnabledDraft,
    setDefaultToolset,
    setRequestTimeoutMinutesDraft,
    setShellToolMaxTimeoutMinutesDraft,
    setMcpTimeoutMinutesDraft,
    setNativeCompactionEnabled,
    setSendMetadataToModel,
    setClaudeCacheKeepalive,
    setCodeModeEnabled,
    setMemoryEnabled,
    setThoughtPersistenceEnabled,
    setMemorySynthesisEnabled,
    setSuggestedActionsEnabled,
    setRunAsRootEnabled
  };
}

function canSaveWorkspaceSettingsTab(tab: WorkspaceSettingsTab, isOwner: boolean, isSuperAdmin: boolean): boolean {
  if (tab === "sandbox") {
    return isSuperAdmin;
  }

  return tab !== "members" && isOwner;
}

function buildWorkspaceSettingsPatchForTab(
  tab: Exclude<WorkspaceSettingsTab, "members">,
  drafts: WorkspaceSettingsDraftValues
): { patch: WorkspaceSettingsPatchBody; successText: string; error: string | null } {
  if (tab === "agent") {
    return {
      patch: {
        systemPrompt: drafts.systemPromptDraft.trim().length > 0 ? drafts.systemPromptDraft : null,
        defaultAgentId: drafts.defaultAgentIdDraft,
        personalityId: drafts.personalityIdDraft,
        sandboxNetworkEnabled: drafts.sandboxNetworkEnabledDraft,
        defaultToolset: normalizeToolOptions(drafts.defaultToolset, { memorySearch: false })
      },
      successText: "Workspace agent defaults saved.",
      error: null
    };
  }

  if (tab === "memory") {
    return {
      patch: {
        memoryEnabled: drafts.memoryEnabled,
        thoughtPersistenceEnabled: drafts.thoughtPersistenceEnabled,
        memorySynthesisEnabled: drafts.memorySynthesisEnabled,
        suggestedActionsEnabled: drafts.suggestedActionsEnabled
      },
      successText: drafts.memoryEnabled ? "Workspace Memory settings saved." : "Workspace Memory disabled.",
      error: null
    };
  }

  if (tab === "requests") {
    const modelTimeout = parseTimeoutDraftToMs(drafts.requestTimeoutMinutesDraft, "Model request timeout");
    if (modelTimeout.error) {
      return { patch: {}, successText: "", error: modelTimeout.error };
    }

    const shellTimeout = parseTimeoutDraftToMs(drafts.shellToolMaxTimeoutMinutesDraft, "Shell tool max timeout");
    if (shellTimeout.error) {
      return { patch: {}, successText: "", error: shellTimeout.error };
    }

    const mcpTimeout = parseTimeoutDraftToMs(drafts.mcpTimeoutMinutesDraft, "MCP timeout");
    if (mcpTimeout.error) {
      return { patch: {}, successText: "", error: mcpTimeout.error };
    }

    return {
      patch: {
        modelRequestTimeoutMs: modelTimeout.value,
        shellToolMaxTimeoutMs: shellTimeout.value,
        mcpTimeoutMs: mcpTimeout.value
      },
      successText: "Workspace request settings saved.",
      error: null
    };
  }

  if (tab === "experiments") {
    return {
      patch: {
        ...(drafts.organizationSettingChanged ? { newMessageOrganizationEnabled: drafts.newMessageOrganizationEnabled } : {}),
        ...(drafts.projectMasterSettingChanged ? { projectMasterEnabled: drafts.projectMasterEnabled } : {}),
        nativeCompactionEnabled: drafts.nativeCompactionEnabled,
        sendMetadataToModel: drafts.sendMetadataToModel,
        claudeCacheKeepalive: drafts.claudeCacheKeepalive,
        codeModeEnabled: drafts.codeModeEnabled
      },
      successText: "Workspace experiments saved.",
      error: null
    };
  }

  return {
    patch: { runAsRoot: drafts.runAsRootEnabled },
    successText: drafts.runAsRootEnabled ? "Workspace sandboxes will now run as root." : "Workspace sandboxes restored to non-root mode.",
    error: null
  };
}

function AgentSettingsSection(props: {
  api: ApiClient;
  workspaceId: string;
  drafts: WorkspaceSettingsDraftController;
  personalityOptions: AgentPersonalityOption[];
  availableSkills: SkillSummary[];
  defaultPersonalityId: string | null;
  disabled: boolean;
}) {
  return (
    <div className="stack-form">
      <WorkspaceDefaultAgentSetting
        api={props.api}
        workspaceId={props.workspaceId}
        value={props.drafts.defaultAgentIdDraft}
        disabled={props.disabled}
        onChange={props.drafts.setDefaultAgentIdDraft}
      />
      <AgentDefaultsSettingsSection
        mode="workspace"
        disabled={props.disabled}
        systemPrompt={props.drafts.systemPromptDraft}
        personalityId={props.drafts.personalityIdDraft}
        sandboxNetworkEnabled={props.drafts.sandboxNetworkEnabledDraft}
        personalityOptions={props.personalityOptions}
        defaultPersonalityId={props.defaultPersonalityId}
        onSystemPromptChange={props.drafts.setSystemPromptDraft}
        onPersonalityChange={props.drafts.setPersonalityIdDraft}
        onSandboxNetworkChange={props.drafts.setSandboxNetworkEnabledDraft}
      />
      <WorkspaceToolsetSettingsSection
        disabled={props.disabled}
        toolset={props.drafts.defaultToolset}
        availableSkills={props.availableSkills}
        onChange={(nextToolset) => props.drafts.setDefaultToolset(normalizeToolOptions(nextToolset, { memorySearch: false }))}
      />
    </div>
  );
}

function CheckboxSetting(props: {
  checked: boolean;
  disabled: boolean;
  title: string;
  description: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        disabled={props.disabled}
        style={{ marginTop: "0.2rem" }}
      />
      <div>
        <strong>{props.title}</strong>
        <p className="hint-text" style={{ marginTop: "0.3rem" }}>{props.description}</p>
      </div>
    </label>
  );
}

function MemorySettingsSection(props: {
  memoryEnabled: boolean;
  thoughtPersistenceEnabled: boolean;
  memorySynthesisEnabled: boolean;
  suggestedActionsEnabled: boolean;
  disabled: boolean;
  onMemoryEnabledChange: (value: boolean) => void;
  onThoughtPersistenceEnabledChange: (value: boolean) => void;
  onMemorySynthesisEnabledChange: (value: boolean) => void;
  onSuggestedActionsEnabledChange: (value: boolean) => void;
}) {
  return (
    <div className="stack-form">
      <CheckboxSetting
        checked={props.memoryEnabled}
        disabled={props.disabled}
        onChange={props.onMemoryEnabledChange}
        title="Enable Workspace Memory"
        description="Stores persistent notes in the workspace `.memory` directory and enables Memory search for tasks in this workspace."
      />
      <CheckboxSetting
        checked={props.memorySynthesisEnabled}
        disabled={props.disabled || !props.memoryEnabled}
        onChange={props.onMemorySynthesisEnabledChange}
        title="Enable Automatic Memory Refresh"
        description="Creates bounded Memory refresh tasks from new workspace activity."
      />
      <CheckboxSetting
        checked={props.suggestedActionsEnabled}
        disabled={props.disabled || !props.memoryEnabled}
        onChange={props.onSuggestedActionsEnabledChange}
        title="Enable Suggested Starter Actions"
        description="Generates and updates project-specific starter prompt suggestions during Memory refresh to show underneath the task composer."
      />
      <CheckboxSetting
        checked={props.thoughtPersistenceEnabled}
        disabled={props.disabled || !props.memoryEnabled}
        onChange={props.onThoughtPersistenceEnabledChange}
        title="Enable Thought Persistence Checkpoints"
        description="Shows the `.thinking` checkpoint guidance in the agent prompt so non-trivial runs keep a persistent progress log inside workspace memory."
      />
    </div>
  );
}

function RequestSettingsSection(props: {
  requestTimeoutMinutesDraft: string;
  shellToolMaxTimeoutMinutesDraft: string;
  mcpTimeoutMinutesDraft: string;
  disabled: boolean;
  onRequestTimeoutMinutesChange: (value: string) => void;
  onShellToolMaxTimeoutMinutesChange: (value: string) => void;
  onMcpTimeoutMinutesChange: (value: string) => void;
}) {
  return (
    <div className="stack-form">
      <label>
        <strong>Model Request Timeout (Minutes)</strong>
        <input
          type="number"
          min={0.02}
          max={1_440}
          step="any"
          value={props.requestTimeoutMinutesDraft}
          onChange={(event) => props.onRequestTimeoutMinutesChange(event.target.value)}
          placeholder="Default (5)"
          disabled={props.disabled}
        />
      </label>
      <label>
        <strong>Shell tool max timeout (Minutes)</strong>
        <input
          type="number"
          min={0.02}
          max={1_440}
          step="any"
          value={props.shellToolMaxTimeoutMinutesDraft}
          onChange={(event) => props.onShellToolMaxTimeoutMinutesChange(event.target.value)}
          placeholder="Default (5)"
          disabled={props.disabled}
        />
      </label>
      <label>
        <strong>MCP timeout (Minutes)</strong>
        <input
          type="number"
          min={0.02}
          max={1_440}
          step="any"
          value={props.mcpTimeoutMinutesDraft}
          onChange={(event) => props.onMcpTimeoutMinutesChange(event.target.value)}
          placeholder="Default (1)"
          disabled={props.disabled}
        />
      </label>
    </div>
  );
}

function ExperimentSettingsSection(props: {
  newMessageOrganizationEnabled: boolean;
  onNewMessageOrganizationEnabledChange: (value: boolean) => void;
  projectMasterEnabled: boolean;
  onProjectMasterEnabledChange: (value: boolean) => void;
  nativeCompactionEnabled: boolean;
  sendMetadataToModel: boolean;
  claudeCacheKeepalive: boolean;
  codeModeEnabled: boolean;
  disabled: boolean;
  onNativeCompactionEnabledChange: (value: boolean) => void;
  onSendMetadataToModelChange: (value: boolean) => void;
  onClaudeCacheKeepaliveChange: (value: boolean) => void;
  onCodeModeEnabledChange: (value: boolean) => void;
}) {
  return (
    <div className="stack-form">
      <CheckboxSetting
        checked={props.newMessageOrganizationEnabled}
        disabled={props.disabled}
        onChange={props.onNewMessageOrganizationEnabledChange}
        title="New message organization"
        description="Let the assistant organize conversations with an outline, turn summaries, and a map."
      />
      <CheckboxSetting
        checked={props.projectMasterEnabled}
        disabled={props.disabled}
        onChange={props.onProjectMasterEnabledChange}
        title="Project Master"
        description="On by default. Opening a project takes you to its Master, who coordinates tasks for you and reports back. You can still manage tasks yourself."
      />
      <CheckboxSetting
        checked={props.nativeCompactionEnabled}
        disabled={props.disabled}
        onChange={props.onNativeCompactionEnabledChange}
        title="Native context compaction"
        description="Experimental. Uses the Responses API compaction trigger instead of the local summary-based compaction path when the active model/provider supports it."
      />
      <CheckboxSetting
        checked={props.sendMetadataToModel}
        disabled={props.disabled}
        onChange={props.onSendMetadataToModelChange}
        title="Send metadata to model"
        description="Adds hidden message metadata to the model context as a system message."
      />
      <CheckboxSetting
        checked={props.claudeCacheKeepalive}
        disabled={props.disabled}
        onChange={props.onClaudeCacheKeepaliveChange}
        title="Cachebeat for Claude models"
        description="Experimental. Keeps a Claude task's prompt cache warm for 30 minutes after each request, so continuing after a pause doesn't reprocess the whole conversation."
      />
      <CheckboxSetting
        checked={props.codeModeEnabled}
        disabled={props.disabled}
        onChange={props.onCodeModeEnabledChange}
        title="Code mode"
        description="Experimental. The agent runs several tool calls from one short script instead of spending a model turn on each, which can cut token use on long tasks."
      />
    </div>
  );
}

function SandboxSettingsSection(props: {
  runAsRootEnabled: boolean;
  disabled: boolean;
  onRunAsRootChange: (value: boolean) => void;
}) {
  return (
    <div className="stack-form">
      <CheckboxSetting
        checked={props.runAsRootEnabled}
        disabled={props.disabled}
        onChange={props.onRunAsRootChange}
        title="Run as root"
        description="Launch task and shell sandboxes in this workspace as root (uid 0)."
      />
    </div>
  );
}

function WorkspaceSettingsTabBar(props: {
  activeTab: WorkspaceSettingsTab;
  isOwner: boolean;
  isSuperAdmin: boolean;
  onTabChange: (tab: WorkspaceSettingsTab) => void;
}) {
  return (
    <div className="tab-row" style={{ marginTop: "1rem" }}>
      <button className={`tab-btn ${props.activeTab === "agent" ? "active" : ""}`} onClick={() => props.onTabChange("agent")}>Agent</button>
      <button className={`tab-btn ${props.activeTab === "memory" ? "active" : ""}`} onClick={() => props.onTabChange("memory")}>Memory</button>
      <button className={`tab-btn ${props.activeTab === "requests" ? "active" : ""}`} onClick={() => props.onTabChange("requests")}>Requests</button>
      <button className={`tab-btn ${props.activeTab === "experiments" ? "active" : ""}`} onClick={() => props.onTabChange("experiments")}>Experiments</button>
      {props.isSuperAdmin ? (
        <button className={`tab-btn ${props.activeTab === "sandbox" ? "active" : ""}`} onClick={() => props.onTabChange("sandbox")}>Sandbox</button>
      ) : null}
      {props.isOwner ? (
        <button className={`tab-btn ${props.activeTab === "members" ? "active" : ""}`} onClick={() => props.onTabChange("members")}>Members</button>
      ) : null}
    </div>
  );
}

function WorkspaceSettingsEditor(props: {
  api: ApiClient;
  workspaceId: string;
  activeTab: Exclude<WorkspaceSettingsTab, "members">;
  drafts: WorkspaceSettingsDraftController;
  personalityOptions: AgentPersonalityOption[];
  availableSkills: SkillSummary[];
  defaultPersonalityId: string | null;
  canSave: boolean;
  error: string | null;
  isSaving: boolean;
  isWorkspaceSettingsLoading: boolean;
  readOnlyMessage: string;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  const disabled = props.isWorkspaceSettingsLoading || !props.canSave;

  return (
    <form className="stack-form" onSubmit={props.onSubmit} style={{ marginTop: "1rem" }}>
      {!props.canSave ? <p className="muted-text">{props.readOnlyMessage}</p> : null}
      {props.activeTab === "agent" ? (
        <AgentSettingsSection
          api={props.api}
          workspaceId={props.workspaceId}
          drafts={props.drafts}
          personalityOptions={props.personalityOptions}
          availableSkills={props.availableSkills}
          defaultPersonalityId={props.defaultPersonalityId}
          disabled={disabled}
        />
      ) : null}
      {props.activeTab === "memory" ? (
        <MemorySettingsSection
          memoryEnabled={props.drafts.memoryEnabled}
          thoughtPersistenceEnabled={props.drafts.thoughtPersistenceEnabled}
          memorySynthesisEnabled={props.drafts.memorySynthesisEnabled}
          suggestedActionsEnabled={props.drafts.suggestedActionsEnabled}
          disabled={disabled}
          onMemoryEnabledChange={props.drafts.setMemoryEnabled}
          onThoughtPersistenceEnabledChange={props.drafts.setThoughtPersistenceEnabled}
          onMemorySynthesisEnabledChange={props.drafts.setMemorySynthesisEnabled}
          onSuggestedActionsEnabledChange={props.drafts.setSuggestedActionsEnabled}
        />
      ) : null}
      {props.activeTab === "requests" ? <RequestSettingsSection requestTimeoutMinutesDraft={props.drafts.requestTimeoutMinutesDraft} shellToolMaxTimeoutMinutesDraft={props.drafts.shellToolMaxTimeoutMinutesDraft} mcpTimeoutMinutesDraft={props.drafts.mcpTimeoutMinutesDraft} disabled={disabled} onRequestTimeoutMinutesChange={props.drafts.setRequestTimeoutMinutesDraft} onShellToolMaxTimeoutMinutesChange={props.drafts.setShellToolMaxTimeoutMinutesDraft} onMcpTimeoutMinutesChange={props.drafts.setMcpTimeoutMinutesDraft} /> : null}
      {props.activeTab === "experiments" ? <ExperimentSettingsSection newMessageOrganizationEnabled={props.drafts.newMessageOrganizationEnabled} onNewMessageOrganizationEnabledChange={props.drafts.setNewMessageOrganizationEnabled} projectMasterEnabled={props.drafts.projectMasterEnabled} onProjectMasterEnabledChange={props.drafts.setProjectMasterEnabled} nativeCompactionEnabled={props.drafts.nativeCompactionEnabled} sendMetadataToModel={props.drafts.sendMetadataToModel} claudeCacheKeepalive={props.drafts.claudeCacheKeepalive} codeModeEnabled={props.drafts.codeModeEnabled} disabled={disabled} onNativeCompactionEnabledChange={props.drafts.setNativeCompactionEnabled} onSendMetadataToModelChange={props.drafts.setSendMetadataToModel} onClaudeCacheKeepaliveChange={props.drafts.setClaudeCacheKeepalive} onCodeModeEnabledChange={props.drafts.setCodeModeEnabled} /> : null}
      {props.activeTab === "sandbox" ? <SandboxSettingsSection runAsRootEnabled={props.drafts.runAsRootEnabled} disabled={disabled} onRunAsRootChange={props.drafts.setRunAsRootEnabled} /> : null}
      {props.error ? <p className="error-text">{props.error}</p> : null}
      <div className="row-actions" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" type="submit" disabled={props.isSaving || disabled}>
          {props.isSaving ? "Saving..." : "Save Workspace Settings"}
        </button>
      </div>
    </form>
  );
}

export function WorkspaceSettingsPage() {
  const {
    api,
    activeWorkspaceId,
    workspaces,
    workspaceSettings,
    isWorkspaceSettingsLoading,
    refreshWorkspaceSettings,
    setFlash,
    user
  } = useWorkspaceApp();
  const navigate = useNavigate();
  const drafts = useWorkspaceSettingsDrafts(workspaceSettings);
  const [activeTab, setActiveTab] = useState<WorkspaceSettingsTab>("agent");
  const [personalityOptions, setPersonalityOptions] = useState<AgentPersonalityOption[]>([]);
  const [availableSkills, setAvailableSkills] = useState<SkillSummary[]>([]);
  const [defaultPersonalityId, setDefaultPersonalityId] = useState<string | null>("default");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? null,
    [activeWorkspaceId, workspaces]
  );
  const isOwner = activeWorkspace?.role === "owner";
  const isSuperAdmin = user?.is_super_admin === true;
  const canSaveActiveTab = canSaveWorkspaceSettingsTab(activeTab, isOwner, isSuperAdmin);
  const activeTabReadOnlyMessage = activeTab === "sandbox"
    ? "Only super admins can change sandbox runtime settings."
    : "You can view workspace-wide settings here, but only owners can change them.";

  useEffect(() => {
    if (activeTab === "members" && !isOwner) {
      setActiveTab("agent");
    }
    if (activeTab === "sandbox" && !isSuperAdmin) {
      setActiveTab("agent");
    }
  }, [activeTab, isOwner, isSuperAdmin]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setPersonalityOptions([]);
      setDefaultPersonalityId("default");
      return;
    }

    let cancelled = false;
    api
      .get<{ items: AgentPersonalityOption[]; defaultId: string | null }>(`/api/workspaces/${activeWorkspaceId}/personalities`)
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
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api]);

  useEffect(() => {
    if (!activeWorkspaceId) {
      setAvailableSkills([]);
      return;
    }

    let cancelled = false;
    api
      .get<{ skills: SkillSummary[] }>("/api/skills")
      .then((response) => {
        if (!cancelled) {
          setAvailableSkills(response.skills);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAvailableSkills([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeWorkspaceId, api]);

  if (!activeWorkspaceId || !activeWorkspace) {
    return (
      <section className="page-content settings-page">
        <article className="section-card empty-card">
          <h3>Workspace unavailable</h3>
          <p>Select another workspace before editing settings.</p>
        </article>
      </section>
    );
  }

  async function saveSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (activeTab === "members") {
      return;
    }
    if (!canSaveActiveTab) {
      setError(activeTabReadOnlyMessage);
      return;
    }

    setError(null);
    setIsSaving(true);
    const saveRequest = buildWorkspaceSettingsPatchForTab(activeTab, drafts);
    if (saveRequest.error) {
      setError(saveRequest.error);
      setIsSaving(false);
      return;
    }

    try {
      await api.patch(`/api/workspaces/${activeWorkspaceId}/settings`, saveRequest.patch);
      api.invalidateGet?.({ pathPrefix: "/api/agents" });
      setFlash({ tone: "success", text: saveRequest.successText });
      await refreshWorkspaceSettings();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="page-content settings-page">
      <article className="section-card">
        <div className="section-head">
          <div>
            <h3>Workspace Settings</h3>
            <p className="muted-text">{activeWorkspace.name} · Agent defaults, memory, requests, sandbox runtime, and workspace-wide experiments.</p>
          </div>
          <button className="btn ghost" onClick={() => navigate(`/app/${activeWorkspaceId}/projects`)}>
            Back to Workspace
          </button>
        </div>

        <WorkspaceSettingsTabBar activeTab={activeTab} isOwner={isOwner} isSuperAdmin={isSuperAdmin} onTabChange={setActiveTab} />

        {activeTab === "members" ? (
          <div className="stack-form" style={{ marginTop: "1rem" }}>
            <WorkspaceMembersTab workspace={activeWorkspace} />
          </div>
        ) : (
          <WorkspaceSettingsEditor
            api={api}
            workspaceId={activeWorkspaceId}
            activeTab={activeTab}
            drafts={drafts}
            personalityOptions={personalityOptions}
            availableSkills={availableSkills}
            defaultPersonalityId={defaultPersonalityId}
            canSave={canSaveActiveTab}
            error={error}
            isSaving={isSaving}
            isWorkspaceSettingsLoading={isWorkspaceSettingsLoading}
            readOnlyMessage={activeTabReadOnlyMessage}
            onSubmit={saveSettings}
          />
        )}
      </article>
    </section>
  );
}
