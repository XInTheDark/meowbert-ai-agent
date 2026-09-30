import { useEffect, useState, type FormEvent } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { AdminTable, AdminTableCell, AdminTableRow } from "../../../components/admin/AdminTable";
import { RuntimeResourceFields } from "../../../components/admin/RuntimeResourceFields";
import { AgentDropdown, type AgentSummary } from "../../../components/tasks/AgentDropdown";
import {
  buildRuntimeResourceDraft,
  emptyRuntimeResourceDraft,
  parseRuntimeResourceDraft,
  type RuntimeResourceDraft
} from "../../../components/admin/runtime-resource-draft";
import { DraftNumberInput } from "../../../components/forms/DraftNumberInput";
import type { SubscriptionPlan, SubscriptionPlanInput } from "./shared";

interface SubscriptionPlanEditorDraft {
  name: string;
  usageLimits: Array<{ weightedTokens: number; durationDays: number }>;
  notes: string;
  resources: RuntimeResourceDraft;
  agentIds: string[];
  isDefault?: boolean;
}

interface SubscriptionPlansTabProps {
  plans: SubscriptionPlan[];
  agentPresets: AgentSummary[];
  isPlanSaving: boolean;
  error: string | null;
  onCreatePlan: (input: SubscriptionPlanInput) => Promise<void>;
  onUpdatePlan: (planId: string, input: SubscriptionPlanInput) => Promise<void>;
  onTogglePlanActive: (plan: SubscriptionPlan) => Promise<void>;
}

function buildPlanEditorDraft(plan?: SubscriptionPlan): SubscriptionPlanEditorDraft {
  if (!plan) {
    return {
      name: "",
      usageLimits: [{ weightedTokens: 0, durationDays: 30 }],
      notes: "",
      resources: emptyRuntimeResourceDraft(),
      agentIds: [],
      isDefault: false
    };
  }

  return {
    name: plan.name,
    usageLimits: plan.usageLimits.length > 0
      ? plan.usageLimits
      : (plan.monthlyTokenQuota > 0 ? [{ weightedTokens: plan.monthlyTokenQuota, durationDays: 30 }] : []),
    notes: plan.notes ?? "",
    resources: buildRuntimeResourceDraft({
      workspaceLimit: plan.workspaceLimit,
      sandboxPidsLimit: plan.sandboxPidsLimit,
      sandboxMemoryMb: plan.sandboxMemoryMb,
      sandboxCpus: plan.sandboxCpus,
      workspaceStorageMb: plan.workspaceStorageMb,
      persistentRuntimeComputeCredits: plan.persistentRuntimeComputeCredits,
      persistentRuntimeLimit: plan.persistentRuntimeLimit
    }),
    agentIds: Array.isArray(plan.agentIds) ? plan.agentIds : [],
    isDefault: plan.isDefault === true
  };
}

function buildPlanInput(draft: SubscriptionPlanEditorDraft): SubscriptionPlanInput {
  if (!draft.name.trim()) {
    throw new Error("Plan name is required.");
  }

  return {
    name: draft.name.trim(),
    usageLimits: draft.usageLimits
      .map((limit) => ({
        weightedTokens: Math.max(0, Math.floor(limit.weightedTokens)),
        durationDays: Math.max(0, Math.floor(limit.durationDays))
      }))
      .filter((limit) => limit.weightedTokens > 0 && limit.durationDays > 0),
    notes: draft.notes.trim() || null,
    agentIds: Array.from(new Set(draft.agentIds.map((agentId) => agentId.trim().toLowerCase()).filter(Boolean))),
    ...parseRuntimeResourceDraft(draft.resources)
  };
}

function formatUsageLimit(limit: { weightedTokens: number; durationDays: number }): string {
  return `${limit.weightedTokens.toLocaleString()} tokens / ${limit.durationDays} day${limit.durationDays === 1 ? "" : "s"}`;
}

function formatCpuLimit(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0+$/, "$1");
}

function formatStorageMb(value: number): string {
  if (value >= 1024 && value % 1024 === 0) {
    return `${value / 1024} GB`;
  }

  return `${value} MB`;
}

function formatPlanResourceSummary(plan: SubscriptionPlan): string[] {
  const items: string[] = [];

  if (plan.workspaceLimit !== null) {
    items.push(`Workspace limit ${plan.workspaceLimit}`);
  }

  if (plan.workspaceStorageMb !== null) {
    items.push(`Storage ${formatStorageMb(plan.workspaceStorageMb)}`);
  }

  if (plan.sandboxMemoryMb !== null) {
    items.push(`Memory ${plan.sandboxMemoryMb} MB`);
  }

  if (plan.sandboxCpus !== null) {
    items.push(`CPUs ${formatCpuLimit(plan.sandboxCpus)}`);
  }

  if (plan.sandboxPidsLimit !== null) {
    items.push(`PIDs ${plan.sandboxPidsLimit}`);
  }

  if (plan.persistentRuntimeComputeCredits !== null) {
    items.push(`Runtime credits ${plan.persistentRuntimeComputeCredits}/month`);
  }

  if (plan.persistentRuntimeLimit !== null) {
    items.push(`Persistent runtimes ${plan.persistentRuntimeLimit}`);
  }

  return items;
}

function SubscriptionPlanForm(props: {
  draft: SubscriptionPlanEditorDraft;
  submitLabel: string;
  savingLabel: string;
  saving: boolean;
  error: string | null;
  agentPresets: AgentSummary[];
  onChange: (draft: SubscriptionPlanEditorDraft) => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  const isDefault = props.draft.isDefault === true;

  return (
    <form className="stack-form" onSubmit={(event) => void props.onSubmit(event)}>
      <label>
        <strong>Plan name</strong>
        <input
          value={props.draft.name}
          onChange={(event) => props.onChange({ ...props.draft, name: event.target.value })}
          placeholder="Starter"
          disabled={isDefault}
        />
        {isDefault ? (
          <p className="muted-text" style={{ margin: "0.25rem 0 0", fontSize: "0.85rem" }}>
            This default plan is automatically applied to all users.
          </p>
        ) : null}
      </label>

      <label>
        <strong>Usage limits</strong>
        <div style={{ display: "grid", gap: "0.5rem", marginTop: "0.35rem" }}>
          {props.draft.usageLimits.length === 0 ? (
            <p className="muted-text" style={{ margin: "0.15rem 0", fontSize: "0.85rem" }}>
              No usage limits configured (users default to lifetime free messages).
            </p>
          ) : null}
          {props.draft.usageLimits.map((limit, index) => (
            <div key={index} style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(6rem, 0.45fr) auto", gap: "0.5rem", alignItems: "end" }}>
              <label style={{ margin: 0 }}>
                Tokens
                <DraftNumberInput
                  min={0}
                  value={limit.weightedTokens}
                  onValueChange={(value) => {
                    const usageLimits = props.draft.usageLimits.map((entry, entryIndex) => (
                      entryIndex === index ? { ...entry, weightedTokens: value } : entry
                    ));
                    props.onChange({ ...props.draft, usageLimits });
                  }}
                />
              </label>
              <label style={{ margin: 0 }}>
                Days
                <DraftNumberInput
                  min={1}
                  value={limit.durationDays}
                  onValueChange={(value) => {
                    const usageLimits = props.draft.usageLimits.map((entry, entryIndex) => (
                      entryIndex === index ? { ...entry, durationDays: value } : entry
                    ));
                    props.onChange({ ...props.draft, usageLimits });
                  }}
                />
              </label>
              <button
                type="button"
                className="btn ghost"
                aria-label="Remove usage limit"
                title="Remove usage limit"
                onClick={() => {
                  const usageLimits = props.draft.usageLimits.filter((_, entryIndex) => entryIndex !== index);
                  props.onChange({ ...props.draft, usageLimits });
                }}
                disabled={props.saving}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="btn ghost"
            onClick={() => props.onChange({
              ...props.draft,
              usageLimits: [...props.draft.usageLimits, { weightedTokens: 0, durationDays: 30 }]
            })}
            disabled={props.saving}
          >
            <Plus size={14} /> Add limit
          </button>
        </div>
      </label>

      <label>
        <strong>Notes (optional)</strong>
        <input
          value={props.draft.notes}
          onChange={(event) => props.onChange({ ...props.draft, notes: event.target.value })}
          placeholder="Internal notes"
        />
      </label>

      <div className="stack-form">
        <strong>Agent access</strong>
        {props.agentPresets.length > 0 ? (
          <AgentDropdown
            availableAgents={props.agentPresets}
            selectedAgentIds={props.draft.agentIds}
            onMultiChange={(agentIds) => props.onChange({ ...props.draft, agentIds })}
            disabled={props.saving}
            variant="button"
            multiSelect
          />
        ) : (
          <p className="muted-text" style={{ margin: 0 }}>No agent presets configured.</p>
        )}
        <p className="muted-text" style={{ margin: 0 }}>
          {isDefault ? "All users can use the selected agents." : "Users assigned this plan can use the selected agents."}
        </p>
      </div>

      <div className="stack-form">
        <strong>Resources</strong>
        <RuntimeResourceFields
          draft={props.draft.resources}
          onChange={(resources) => props.onChange({ ...props.draft, resources })}
          fieldConfig={{
            workspaceLimit: { hint: isDefault ? "Default workspace limit for all users." : "Blank = no plan-specific workspace limit." },
            workspaceStorageMb: { hint: isDefault ? "Default storage limit for all users." : "Blank = no plan-specific storage limit." },
            sandboxMemoryMb: { hint: isDefault ? "Default memory limit for all users." : "Blank = no plan-specific memory limit." },
            sandboxCpus: { hint: isDefault ? "Default CPU limit for all users." : "Blank = no plan-specific CPU limit." },
            sandboxPidsLimit: { hint: isDefault ? "Default PID limit for all users." : "Blank = no plan-specific PID limit." }
          }}
        />
      </div>

      {props.error ? <p className="error-text">{props.error}</p> : null}

      <div className="row-actions">
        <button className="btn primary" type="submit" disabled={props.saving}>
          {props.saving ? props.savingLabel : props.submitLabel}
        </button>
      </div>
    </form>
  );
}

function SubscriptionPlanEditorModal(props: {
  title: string;
  draft: SubscriptionPlanEditorDraft;
  submitLabel: string;
  saving: boolean;
  error: string | null;
  agentPresets: AgentSummary[];
  onChange: (draft: SubscriptionPlanEditorDraft) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent) => Promise<void>;
}) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  return (
    <div className="legal-overlay" onClick={props.onClose}>
      <div
        className="legal-modal admin-user-resources-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="subscription-plan-editor-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="legal-modal-header">
          <div>
            <h2 id="subscription-plan-editor-title">{props.title}</h2>
          </div>
          <button className="legal-close" type="button" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="legal-modal-body admin-user-resources-modal__body">
          <SubscriptionPlanForm
            draft={props.draft}
            submitLabel={props.submitLabel}
            savingLabel="Saving..."
            saving={props.saving}
            error={props.error}
            agentPresets={props.agentPresets}
            onChange={props.onChange}
            onSubmit={props.onSubmit}
          />
        </div>
      </div>
    </div>
  );
}

function SubscriptionPlanTable(props: {
  plans: SubscriptionPlan[];
  isSaving: boolean;
  onEditPlan: (plan: SubscriptionPlan) => void;
  onTogglePlanActive: (plan: SubscriptionPlan) => Promise<void>;
}) {
  return (
    <AdminTable
      columns={[
        { key: "plan", label: "Plan" },
        { key: "quota", label: "Usage Limits" },
        { key: "resources", label: "Resources" },
        { key: "status", label: "Status" },
        { key: "actions", label: "Actions", align: "right" }
      ]}
    >
      {props.plans.map((plan) => {
        const resourceSummary = formatPlanResourceSummary(plan);
        const effectiveLimits = plan.usageLimits.length > 0
          ? plan.usageLimits
          : (plan.monthlyTokenQuota > 0 ? [{ weightedTokens: plan.monthlyTokenQuota, durationDays: 30 }] : []);

        return (
          <AdminTableRow key={plan.id}>
            <AdminTableCell>
              <div><strong>{plan.name}</strong></div>
              {plan.isDefault ? (
                <div className="muted-text" style={{ fontSize: "0.85rem" }}>Default plan (all users)</div>
              ) : null}
              {plan.notes ? <div className="muted-text" style={{ fontSize: "0.85rem" }}>{plan.notes}</div> : null}
            </AdminTableCell>
            <AdminTableCell>
              {effectiveLimits.length > 0 ? (
                effectiveLimits.map((limit) => (
                  <div key={`${limit.weightedTokens}-${limit.durationDays}`} className="muted-text" style={{ fontSize: "0.85rem" }}>
                    {formatUsageLimit(limit)}
                  </div>
                ))
              ) : (
                <span className="muted-text" style={{ fontSize: "0.85rem" }}>None (free messages)</span>
              )}
            </AdminTableCell>
            <AdminTableCell>
              {resourceSummary.length > 0 ? (
                <div className="muted-text" style={{ display: "grid", gap: "0.15rem", fontSize: "0.85rem" }}>
                  {resourceSummary.map((item) => (
                    <div key={item}>{item}</div>
                  ))}
                </div>
              ) : (
                <span className="muted-text">Default</span>
              )}
            </AdminTableCell>
            <AdminTableCell>
              <span className="muted-text">{plan.isActive ? "Active" : "Inactive"}</span>
            </AdminTableCell>
            <AdminTableCell align="right">
              <div style={{ display: "inline-flex", gap: "0.5rem" }}>
                <button className="btn ghost" type="button" onClick={() => props.onEditPlan(plan)} disabled={props.isSaving}>
                  Edit
                </button>
                {!plan.isDefault ? (
                  <button className="btn ghost" type="button" onClick={() => void props.onTogglePlanActive(plan)} disabled={props.isSaving}>
                    {plan.isActive ? "Deactivate" : "Activate"}
                  </button>
                ) : null}
              </div>
            </AdminTableCell>
          </AdminTableRow>
        );
      })}
    </AdminTable>
  );
}

export function SubscriptionPlansTab(props: SubscriptionPlansTabProps) {
  const [editorMode, setEditorMode] = useState<"create" | "edit" | null>(null);
  const [editingPlan, setEditingPlan] = useState<SubscriptionPlan | null>(null);
  const [editorDraft, setEditorDraft] = useState<SubscriptionPlanEditorDraft>(() => buildPlanEditorDraft());
  const [localError, setLocalError] = useState<string | null>(null);

  function openCreatePlan() {
    setLocalError(null);
    setEditingPlan(null);
    setEditorDraft(buildPlanEditorDraft());
    setEditorMode("create");
  }

  function openEditPlan(plan: SubscriptionPlan) {
    setLocalError(null);
    setEditingPlan(plan);
    setEditorDraft(buildPlanEditorDraft(plan));
    setEditorMode("edit");
  }

  function closePlanEditor() {
    if (props.isPlanSaving) {
      return;
    }

    setEditorMode(null);
    setEditingPlan(null);
    setLocalError(null);
  }

  async function submitPlan(event: FormEvent): Promise<void> {
    event.preventDefault();

    try {
      setLocalError(null);
      if (editorMode === "create") {
        await props.onCreatePlan(buildPlanInput(editorDraft));
      } else if (editorMode === "edit" && editingPlan) {
        await props.onUpdatePlan(editingPlan.id, buildPlanInput(editorDraft));
      }
      setEditorMode(null);
      setEditingPlan(null);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : String(error));
    }
  }

  const errorText = localError ?? props.error;

  return (
    <div className="stack-form" style={{ marginTop: "1rem" }}>
      <div className="row-actions" style={{ justifyContent: "flex-end" }}>
        <button className="btn primary" type="button" onClick={openCreatePlan} disabled={props.isPlanSaving}>
          Create Plan
        </button>
      </div>

      <SubscriptionPlanTable
        plans={props.plans}
        isSaving={props.isPlanSaving}
        onEditPlan={openEditPlan}
        onTogglePlanActive={props.onTogglePlanActive}
      />

      {editorMode ? (
        <SubscriptionPlanEditorModal
          title={editorMode === "create" ? "Create plan" : (editingPlan?.isDefault ? "Edit default plan" : "Edit plan")}
          draft={editorDraft}
          submitLabel={editorMode === "create" ? "Create Plan" : "Save"}
          saving={props.isPlanSaving}
          error={errorText}
          agentPresets={props.agentPresets}
          onChange={setEditorDraft}
          onClose={closePlanEditor}
          onSubmit={submitPlan}
        />
      ) : null}
    </div>
  );
}
