import type { AiProviderConfig } from "@meowbert/shared";
import type { ApiClient } from "../../lib/api";
import type { AdminSettings } from "../../lib/types";
import { buildSetupAgentPresets, type SelectedSetupModel } from "./adminSetupPresets";

export type SignupPolicy = "closed" | "approval" | "open";

export interface AdminSetupChoices {
  provider: AiProviderConfig;
  models: SelectedSetupModel[];
  internalModel: string;
  fastModel: string | null;
  signupPolicy: SignupPolicy;
}

function signupSettings(policy: SignupPolicy): Pick<AdminSettings, "allowUserSignup" | "requireAdminSignupApproval"> {
  return {
    allowUserSignup: policy !== "closed",
    requireAdminSignupApproval: policy === "approval"
  };
}

// Saves the provider first (the first provider is selected automatically), then the models and sign-up settings.
export async function saveAdminSetup(api: ApiClient, choices: AdminSetupChoices): Promise<void> {
  await api.post("/api/admin/ai-providers", choices.provider);

  const { settings } = await api.get<{ settings: AdminSettings }>("/api/admin/settings");
  const agentPresets = buildSetupAgentPresets(choices.models);
  const presetIds = new Set(agentPresets.map((preset) => preset.id));

  await api.patch("/api/admin/settings", {
    ...settings,
    ...signupSettings(choices.signupPolicy),
    agentPresets,
    modelSliderAgentIds: settings.modelSliderAgentIds.filter((id) => presetIds.has(id)),
    specializedModels: {
      ...settings.specializedModels,
      internalModel: choices.internalModel,
      fastModel: choices.fastModel
    }
  });
}
