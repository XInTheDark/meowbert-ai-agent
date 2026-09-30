export type ReasoningEffortChoice = "off" | "low" | "medium" | "high";

export interface SelectedSetupModel {
  modelId: string;
  reasoningEffort: ReasoningEffortChoice;
}

export interface SetupAgentPreset {
  id: string;
  name: string;
  description: string;
  requiresSuperAdmin: boolean;
  payload: Record<string, unknown>;
}

function slugify(modelId: string): string {
  const slug = modelId.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return slug.length > 0 ? slug : "model";
}

function buildPayload(model: SelectedSetupModel): Record<string, unknown> {
  if (model.reasoningEffort === "off") {
    return { model: model.modelId };
  }
  return { model: model.modelId, responses: { reasoning: { effort: model.reasoningEffort, summary: "auto" } } };
}

function describe(model: SelectedSetupModel, isDefault: boolean): string {
  const reasoning = model.reasoningEffort === "off" ? "No reasoning" : `Reasoning: ${model.reasoningEffort}`;
  return isDefault ? `Default model. ${reasoning}.` : `${reasoning}.`;
}

// The first selected model becomes the "default" preset, which new tasks use unless the user picks another.
export function buildSetupAgentPresets(models: SelectedSetupModel[]): SetupAgentPreset[] {
  const usedIds = new Set<string>();
  return models.map((model, index) => {
    const baseId = index === 0 ? "default" : slugify(model.modelId);
    let id = baseId;
    for (let suffix = 2; usedIds.has(id); suffix += 1) {
      id = `${baseId}-${suffix}`;
    }
    usedIds.add(id);

    return {
      id,
      name: model.modelId,
      description: describe(model, index === 0),
      requiresSuperAdmin: false,
      payload: buildPayload(model)
    };
  });
}
