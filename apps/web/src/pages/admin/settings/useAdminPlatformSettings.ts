import { useState, type Dispatch, type FormEvent, type SetStateAction } from "react";
import type { ApiClient } from "../../../lib/api";
import type { AdminSettings, FlashMessage } from "../../../lib/types";
import {
  parseAgentPresetsDraft,
  parseModelMetadataDraft,
  parseModelRoutersDraft,
  parseModelSliderAgentIdsDraft,
  parseSpecializedModelsDraft
} from "./adminSettingsDrafts";
import type { AdminSettingsResponse } from "./shared";

interface UseAdminPlatformSettingsInput {
  api: ApiClient;
  setError: (error: string | null) => void;
  setFlash: (flash: FlashMessage | null) => void;
  setIsSaving: Dispatch<SetStateAction<boolean>>;
}

function useAdminPlatformDraftState() {
  const [settings, setSettings] = useState<AdminSettings | null>(null);
  const [allowUserSignup, setAllowUserSignup] = useState(true);
  const [requireAdminSignupApproval, setRequireAdminSignupApproval] = useState(false);
  const [enableForgotPassword, setEnableForgotPassword] = useState(true);
  const [requireEmailVerificationOnSignup, setRequireEmailVerificationOnSignup] = useState(true);
  const [enablePromptCaching, setEnablePromptCaching] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [defaultFreeMessageLimit, setDefaultFreeMessageLimit] = useState<number | null>(null);
  const [maxTaskRunRetries, setMaxTaskRunRetries] = useState(5);
  const [taskSchedulerDefaultEnvironmentConcurrency, setTaskSchedulerDefaultEnvironmentConcurrency] = useState(4);
  const [taskSchedulerMaxWorkspaceConcurrency, setTaskSchedulerMaxWorkspaceConcurrency] = useState(20);
  const [taskSchedulerMaxQueuedAheadPerWorkspace, setTaskSchedulerMaxQueuedAheadPerWorkspace] = useState(1);
  const [taskSchedulerBackgroundAgingMinutes, setTaskSchedulerBackgroundAgingMinutes] = useState(15);
  const [usageRateMultiplier, setUsageRateMultiplier] = useState(1);
  const [modelMetadataDraft, setModelMetadataDraft] = useState("{}");
  const [modelRoutersDraft, setModelRoutersDraft] = useState("[]");
  const [modelSliderAgentIdsDraft, setModelSliderAgentIdsDraft] = useState("[]");
  const [agentPresetsDraft, setAgentPresetsDraft] = useState("[]");
  const [specializedModelsDraft, setSpecializedModelsDraft] = useState('{"internalModel":null,"fastModel":null,"memorySynthesisAgent":null,"reviewerAgent":null,"subagentFastAgent":null}');

  function applyPlatformSettings(nextSettings: AdminSettings): void {
    setSettings(nextSettings);
    setAllowUserSignup(nextSettings.allowUserSignup);
    setRequireAdminSignupApproval(nextSettings.requireAdminSignupApproval);
    setEnableForgotPassword(nextSettings.enableForgotPassword);
    setRequireEmailVerificationOnSignup(nextSettings.requireEmailVerificationOnSignup);
    setEnablePromptCaching(nextSettings.enablePromptCaching);
    setDebugMode(nextSettings.debugMode);
    setDefaultFreeMessageLimit(nextSettings.defaultFreeMessageLimit);
    setMaxTaskRunRetries(nextSettings.maxTaskRunRetries);
    setTaskSchedulerDefaultEnvironmentConcurrency(nextSettings.taskScheduler.defaultEnvironmentConcurrency);
    setTaskSchedulerMaxWorkspaceConcurrency(nextSettings.taskScheduler.maxWorkspaceConcurrency);
    setTaskSchedulerMaxQueuedAheadPerWorkspace(nextSettings.taskScheduler.maxQueuedAheadPerWorkspace);
    setTaskSchedulerBackgroundAgingMinutes(nextSettings.taskScheduler.backgroundAgingMinutes);
    setUsageRateMultiplier(nextSettings.usageRateMultiplier);
    setModelMetadataDraft(JSON.stringify(nextSettings.modelMetadata, null, 2));
    setModelRoutersDraft(JSON.stringify(nextSettings.modelRouters, null, 2));
    setModelSliderAgentIdsDraft(JSON.stringify(nextSettings.modelSliderAgentIds, null, 2));
    setAgentPresetsDraft(JSON.stringify(nextSettings.agentPresets, null, 2));
    setSpecializedModelsDraft(JSON.stringify(nextSettings.specializedModels, null, 2));
  }

  return {
    settings,
    allowUserSignup,
    setAllowUserSignup,
    requireAdminSignupApproval,
    setRequireAdminSignupApproval,
    enableForgotPassword,
    setEnableForgotPassword,
    requireEmailVerificationOnSignup,
    setRequireEmailVerificationOnSignup,
    enablePromptCaching,
    setEnablePromptCaching,
    debugMode,
    setDebugMode,
    defaultFreeMessageLimit,
    setDefaultFreeMessageLimit,
    maxTaskRunRetries,
    setMaxTaskRunRetries,
    taskSchedulerDefaultEnvironmentConcurrency,
    setTaskSchedulerDefaultEnvironmentConcurrency,
    taskSchedulerMaxWorkspaceConcurrency,
    setTaskSchedulerMaxWorkspaceConcurrency,
    taskSchedulerMaxQueuedAheadPerWorkspace,
    setTaskSchedulerMaxQueuedAheadPerWorkspace,
    taskSchedulerBackgroundAgingMinutes,
    setTaskSchedulerBackgroundAgingMinutes,
    usageRateMultiplier,
    setUsageRateMultiplier,
    modelMetadataDraft,
    setModelMetadataDraft,
    modelRoutersDraft,
    setModelRoutersDraft,
    modelSliderAgentIdsDraft,
    setModelSliderAgentIdsDraft,
    agentPresetsDraft,
    setAgentPresetsDraft,
    specializedModelsDraft,
    setSpecializedModelsDraft,
    applyPlatformSettings
  };
}

export function useAdminPlatformSettings(input: UseAdminPlatformSettingsInput) {
  const state = useAdminPlatformDraftState();

  async function saveSettings(event: FormEvent): Promise<void> {
    event.preventDefault();
    input.setIsSaving(true);
    input.setError(null);
    try {
      const response = await input.api.patch<AdminSettingsResponse>("/api/admin/settings", {
        allowUserSignup: state.allowUserSignup,
        requireAdminSignupApproval: state.requireAdminSignupApproval,
        enableForgotPassword: state.enableForgotPassword,
        requireEmailVerificationOnSignup: state.requireEmailVerificationOnSignup,
        enablePromptCaching: state.enablePromptCaching,
        debugMode: state.debugMode,
        defaultFreeMessageLimit: state.defaultFreeMessageLimit,
        maxTaskRunRetries: state.maxTaskRunRetries,
        taskScheduler: {
          defaultEnvironmentConcurrency: state.taskSchedulerDefaultEnvironmentConcurrency,
          maxWorkspaceConcurrency: state.taskSchedulerMaxWorkspaceConcurrency,
          maxQueuedAheadPerWorkspace: state.taskSchedulerMaxQueuedAheadPerWorkspace,
          backgroundAgingMinutes: state.taskSchedulerBackgroundAgingMinutes
        },
        usageRateMultiplier: state.usageRateMultiplier,
        modelMetadata: parseModelMetadataDraft(state.modelMetadataDraft),
        modelRouters: parseModelRoutersDraft(state.modelRoutersDraft),
        modelSliderAgentIds: parseModelSliderAgentIdsDraft(state.modelSliderAgentIdsDraft),
        agentPresets: parseAgentPresetsDraft(state.agentPresetsDraft),
        specializedModels: parseSpecializedModelsDraft(state.specializedModelsDraft)
      });
      state.applyPlatformSettings(response.settings);
      input.api.invalidateGet?.({ pathPrefix: "/api/agents" });
      input.setFlash({ tone: "success", text: "Admin settings saved." });
    } catch (error) {
      input.setError(error instanceof Error ? error.message : String(error));
    } finally {
      input.setIsSaving(false);
    }
  }

  return { ...state, saveSettings };
}
