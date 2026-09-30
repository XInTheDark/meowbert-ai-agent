import { useState } from "react";
import { X } from "lucide-react";
import type { AiProviderConfig } from "@meowbert/shared";
import type { ApiClient } from "../../lib/api";
import type { SelectedSetupModel } from "./adminSetupPresets";
import { saveAdminSetup, type SignupPolicy } from "./saveAdminSetup";
import { AdminSetupProviderStep } from "./AdminSetupProviderStep";
import { AdminSetupModelsStep } from "./AdminSetupModelsStep";
import { AdminSetupBackgroundStep } from "./AdminSetupBackgroundStep";
import { AdminSetupSignupStep } from "./AdminSetupSignupStep";
import { AdminSetupDoneStep } from "./AdminSetupDoneStep";
import "./admin-setup.css";

type WizardStep = "provider" | "models" | "background" | "signup" | "done";

const STEP_TITLES: Record<WizardStep, string> = {
  provider: "Connect a model provider",
  models: "Choose your models",
  background: "Background models",
  signup: "Sign-ups",
  done: "You're all set"
};
const NUMBERED_STEPS: WizardStep[] = ["provider", "models", "background", "signup"];

export function AdminSetupWizard(props: {
  api: ApiClient;
  onSkip: () => void;
  onComplete: () => void;
  onOpenAdmin: () => void;
}) {
  const [step, setStep] = useState<WizardStep>("provider");
  const [provider, setProvider] = useState<AiProviderConfig | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [models, setModels] = useState<SelectedSetupModel[]>([]);
  const [internalModel, setInternalModel] = useState("");
  const [fastModel, setFastModel] = useState<string | null>(null);
  const [signupPolicy, setSignupPolicy] = useState<SignupPolicy>("closed");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const modelIds = models.map((model) => model.modelId);
  const stepNumber = NUMBERED_STEPS.indexOf(step) + 1;

  async function finish(): Promise<void> {
    if (!provider) {
      return;
    }
    setIsSaving(true);
    setSaveError(null);
    try {
      await saveAdminSetup(props.api, { provider, models, internalModel: internalModel || modelIds[0], fastModel, signupPolicy });
      setStep("done");
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="legal-overlay">
      <div className="legal-modal admin-setup-modal" role="dialog" aria-modal="true" aria-label="Set up Meowbert">
        <div className="legal-modal-header">
          <div>
            <span className="muted-text admin-setup-kicker">{stepNumber > 0 ? `Admin setup · Step ${stepNumber} of ${NUMBERED_STEPS.length}` : "Admin setup"}</span>
            <h2>{STEP_TITLES[step]}</h2>
          </div>
          {step !== "done" ? (
            <button className="legal-close" type="button" onClick={props.onSkip} aria-label="Skip setup for now"><X size={18} /></button>
          ) : null}
        </div>
        <div className="legal-modal-body">
          {step === "provider" ? (
            <AdminSetupProviderStep api={props.api} initialProvider={provider} onConnected={(nextProvider, listed) => {
              setProvider(nextProvider);
              setAvailableModels(listed);
              setStep("models");
            }} />
          ) : null}
          {step === "models" ? (
            <AdminSetupModelsStep availableModels={availableModels} selected={models} onChange={setModels} onNext={() => {
              if (!modelIds.includes(internalModel)) setInternalModel(modelIds[0] ?? "");
              if (fastModel && !modelIds.includes(fastModel)) setFastModel(null);
              setStep("background");
            }} />
          ) : null}
          {step === "background" ? (
            <AdminSetupBackgroundStep modelIds={modelIds} internalModel={internalModel || modelIds[0]} fastModel={fastModel}
              onInternalModelChange={setInternalModel} onFastModelChange={setFastModel} onNext={() => setStep("signup")} />
          ) : null}
          {step === "signup" ? (
            <AdminSetupSignupStep policy={signupPolicy} onChange={setSignupPolicy} isSaving={isSaving} error={saveError} onFinish={() => void finish()} />
          ) : null}
          {step === "done" ? <AdminSetupDoneStep onClose={props.onComplete} onOpenAdmin={props.onOpenAdmin} /> : null}
        </div>
        {step !== "provider" && step !== "done" ? (
          <div className="admin-setup-footer">
            <button type="button" className="link-button" onClick={() => setStep(NUMBERED_STEPS[stepNumber - 2])}>Back</button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
