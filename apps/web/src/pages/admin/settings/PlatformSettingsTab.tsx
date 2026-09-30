import { useState, type FormEvent } from "react";
import { DraftNumberInput } from "../../../components/forms/DraftNumberInput";

interface PlatformSettingsTabProps {
  allowUserSignup: boolean;
  requireAdminSignupApproval: boolean;
  requireEmailVerificationOnSignup: boolean;
  enableForgotPassword: boolean;
  enablePromptCaching: boolean;
  debugMode: boolean;
  defaultFreeMessageLimit: number | null;
  maxTaskRunRetries: number;
  taskSchedulerDefaultEnvironmentConcurrency: number;
  taskSchedulerMaxWorkspaceConcurrency: number;
  taskSchedulerMaxQueuedAheadPerWorkspace: number;
  taskSchedulerBackgroundAgingMinutes: number;
  isSaving: boolean;
  hasSettings: boolean;
  error: string | null;
  onAllowUserSignupChange: (value: boolean) => void;
  onRequireAdminSignupApprovalChange: (value: boolean) => void;
  onRequireEmailVerificationOnSignupChange: (value: boolean) => void;
  onEnableForgotPasswordChange: (value: boolean) => void;
  onEnablePromptCachingChange: (value: boolean) => void;
  onDebugModeChange: (value: boolean) => void;
  onDefaultFreeMessageLimitChange: (value: number | null) => void;
  onMaxTaskRunRetriesChange: (value: number) => void;
  onTaskSchedulerDefaultEnvironmentConcurrencyChange: (value: number) => void;
  onTaskSchedulerMaxWorkspaceConcurrencyChange: (value: number) => void;
  onTaskSchedulerMaxQueuedAheadPerWorkspaceChange: (value: number) => void;
  onTaskSchedulerBackgroundAgingMinutesChange: (value: number) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}

type PlatformSettingsSubTabKey = "signups" | "defaults" | "scheduling" | "advanced";

const platformSettingsSubTabs: Array<{ key: PlatformSettingsSubTabKey; label: string }> = [
  { key: "signups", label: "Sign ups" },
  { key: "defaults", label: "Defaults" },
  { key: "scheduling", label: "Scheduling" },
  { key: "advanced", label: "Advanced" }
];

function PlatformSettingsSubTabBar(props: {
  activeSubTab: PlatformSettingsSubTabKey;
  onSelectSubTab: (tab: PlatformSettingsSubTabKey) => void;
}) {
  return (
    <div className="tab-row" style={{ marginBottom: "0.1rem" }}>
      {platformSettingsSubTabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={`tab-btn ${props.activeSubTab === tab.key ? "active" : ""}`}
          onClick={() => props.onSelectSubTab(tab.key)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}

function SettingsCheckboxField(props: {
  checked: boolean;
  title: string;
  description: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <label style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start" }}>
      <input
        type="checkbox"
        checked={props.checked}
        onChange={(event) => props.onChange(event.target.checked)}
        style={{ marginTop: "0.2rem" }}
      />
      <div>
        <strong>{props.title}</strong>
        <p className="muted-text" style={{ marginTop: "0.3rem" }}>
          {props.description}
        </p>
      </div>
    </label>
  );
}

function SignupsSettingsSection(props: Pick<
  PlatformSettingsTabProps,
  | "allowUserSignup"
  | "requireAdminSignupApproval"
  | "requireEmailVerificationOnSignup"
  | "enableForgotPassword"
  | "onAllowUserSignupChange"
  | "onRequireAdminSignupApprovalChange"
  | "onRequireEmailVerificationOnSignupChange"
  | "onEnableForgotPasswordChange"
>) {
  return (
    <div className="stack-form">
      <SettingsCheckboxField
        checked={props.allowUserSignup}
        title="Allow new user sign ups"
        description="When disabled, only existing users can sign in. The first-ever signup always remains available."
        onChange={props.onAllowUserSignupChange}
      />
      <SettingsCheckboxField
        checked={props.requireAdminSignupApproval}
        title="Require admin approval for signup"
        description="New users stay pending until a super admin approves or rejects them."
        onChange={props.onRequireAdminSignupApprovalChange}
      />
      <SettingsCheckboxField
        checked={props.requireEmailVerificationOnSignup}
        title="Require email verification on signup"
        description="New users must verify an email code before account activation."
        onChange={props.onRequireEmailVerificationOnSignupChange}
      />
      <SettingsCheckboxField
        checked={props.enableForgotPassword}
        title="Enable forgot password flow"
        description="Users can request password reset links from the login screen."
        onChange={props.onEnableForgotPasswordChange}
      />
    </div>
  );
}

function DefaultsSettingsSection(props: Pick<
  PlatformSettingsTabProps,
  "defaultFreeMessageLimit" | "onDefaultFreeMessageLimitChange"
>) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <strong>Messages per user (lifetime)</strong>
      <p className="muted-text" style={{ marginTop: 0 }}>
        Applies to users without a subscription plan or their own provider. Admins are never limited. You can override this per user.
      </p>
      <span style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
        <input
          type="checkbox"
          checked={props.defaultFreeMessageLimit === null}
          onChange={(event) => props.onDefaultFreeMessageLimitChange(event.target.checked ? null : 100)}
        />
        Unlimited
      </span>
      {props.defaultFreeMessageLimit !== null ? (
        <DraftNumberInput
          min={0}
          value={props.defaultFreeMessageLimit}
          onValueChange={props.onDefaultFreeMessageLimitChange}
          style={{ width: "10rem", padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px" }}
        />
      ) : null}
    </label>
  );
}

function SchedulerNumberField(props: {
  title: string;
  description: string;
  min: number;
  max?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
      <strong>{props.title}</strong>
      <p className="muted-text" style={{ marginTop: 0 }}>
        {props.description}
      </p>
      <DraftNumberInput
        min={props.min}
        max={props.max}
        value={props.value}
        onValueChange={props.onChange}
        style={{ width: "10rem", padding: "0.4rem 0.6rem", border: "1px solid var(--border)", borderRadius: "4px" }}
      />
    </label>
  );
}

function SchedulingSettingsSection(props: Pick<
  PlatformSettingsTabProps,
  | "taskSchedulerDefaultEnvironmentConcurrency"
  | "taskSchedulerMaxWorkspaceConcurrency"
  | "taskSchedulerMaxQueuedAheadPerWorkspace"
  | "taskSchedulerBackgroundAgingMinutes"
  | "maxTaskRunRetries"
  | "onTaskSchedulerDefaultEnvironmentConcurrencyChange"
  | "onTaskSchedulerMaxWorkspaceConcurrencyChange"
  | "onTaskSchedulerMaxQueuedAheadPerWorkspaceChange"
  | "onTaskSchedulerBackgroundAgingMinutesChange"
  | "onMaxTaskRunRetriesChange"
>) {
  return (
    <div className="stack-form">
      <SchedulerNumberField
        title="Max task run retries"
        description="How many times a failed task run may retry after its initial attempt. Set to 0 to disable automatic retries."
        min={0}
        max={100}
        value={props.maxTaskRunRetries}
        onChange={props.onMaxTaskRunRetriesChange}
      />
      <SchedulerNumberField
        title="Default project concurrency"
        description="How many top-level tasks one project can have admitted or running at once."
        min={1}
        value={props.taskSchedulerDefaultEnvironmentConcurrency}
        onChange={props.onTaskSchedulerDefaultEnvironmentConcurrencyChange}
      />
      <SchedulerNumberField
        title="Max workspace concurrency"
        description="How many top-level tasks one workspace can have admitted or running at once."
        min={1}
        value={props.taskSchedulerMaxWorkspaceConcurrency}
        onChange={props.onTaskSchedulerMaxWorkspaceConcurrencyChange}
      />
      <SchedulerNumberField
        title="Max queued ahead per workspace"
        description="How many extra top-level tasks a workspace can have admitted but not started yet."
        min={0}
        value={props.taskSchedulerMaxQueuedAheadPerWorkspace}
        onChange={props.onTaskSchedulerMaxQueuedAheadPerWorkspaceChange}
      />
      <SchedulerNumberField
        title="Background aging minutes"
        description="How long a scheduled or infinite auto-run waits before it is treated like a normal new task."
        min={0}
        value={props.taskSchedulerBackgroundAgingMinutes}
        onChange={props.onTaskSchedulerBackgroundAgingMinutesChange}
      />
    </div>
  );
}

function AdvancedSettingsSection(props: Pick<
  PlatformSettingsTabProps,
  "enablePromptCaching" | "onEnablePromptCachingChange" | "debugMode" | "onDebugModeChange"
>) {
  return (
    <div className="stack-form">
      <SettingsCheckboxField
        checked={props.enablePromptCaching}
        title="Enable prompt caching"
        description="Use prompt caching on model requests so compatible providers can reuse cached prompt prefixes."
        onChange={props.onEnablePromptCachingChange}
      />
      <SettingsCheckboxField
        checked={props.debugMode}
        title="Enable Debug Mode"
        description="Show advanced prompt/context metadata and detailed model errors in task views."
        onChange={props.onDebugModeChange}
      />
    </div>
  );
}

function renderActiveSubTab(props: PlatformSettingsTabProps, activeSubTab: PlatformSettingsSubTabKey) {
  if (activeSubTab === "signups") {
    return <SignupsSettingsSection {...props} />;
  }
  if (activeSubTab === "defaults") {
    return <DefaultsSettingsSection {...props} />;
  }
  if (activeSubTab === "scheduling") {
    return <SchedulingSettingsSection {...props} />;
  }
  return <AdvancedSettingsSection {...props} />;
}

export function PlatformSettingsTab(props: PlatformSettingsTabProps) {
  const [activeSubTab, setActiveSubTab] = useState<PlatformSettingsSubTabKey>("signups");

  return (
    <form className="stack-form" style={{ marginTop: "1rem" }} onSubmit={(event) => void props.onSubmit(event)}>
      <PlatformSettingsSubTabBar activeSubTab={activeSubTab} onSelectSubTab={setActiveSubTab} />
      {renderActiveSubTab(props, activeSubTab)}
      {props.error ? <p className="error-text">{props.error}</p> : null}

      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={props.isSaving || !props.hasSettings}>
          {props.isSaving ? "Saving..." : "Save Settings"}
        </button>
      </div>
    </form>
  );
}
