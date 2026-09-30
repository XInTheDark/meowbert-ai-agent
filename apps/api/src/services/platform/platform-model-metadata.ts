import {
  findPlatformModelRouterById,
  normalizePlatformModelRouters,
  resolveContextWindowForModel,
  normalizePlatformSpecializedModels,
  resolveInternalModel,
  resolvePlatformModelRouterDefaultRuntimeModel
} from "@meowbert/shared";
import { config } from "../../lib/config.js";
import { query } from "../../lib/db.js";

export async function resolveContextWindowTokensForWorkspace(workspaceId: string): Promise<number> {
  const [workspaceSettingsResult, platformSettingsResult] = await Promise.all([
    query<{ model_defaults_json: Record<string, unknown> }>(
      `SELECT model_defaults_json
         FROM workspace_settings
        WHERE workspace_id = $1`,
      [workspaceId]
    ),
    query<{ model_metadata_json: unknown; model_routers_json: unknown; specialized_models_json: unknown }>(
      `SELECT model_metadata_json,
              model_routers_json,
              specialized_models_json
         FROM platform_settings
        WHERE id = 1`
    )
  ]);

  const modelDefaults = workspaceSettingsResult.rows[0]?.model_defaults_json ?? {};
  const requestedWorkspaceModel = typeof modelDefaults.defaultModel === "string" ? modelDefaults.defaultModel.trim() : "";
  const modelRouters = normalizePlatformModelRouters(platformSettingsResult.rows[0]?.model_routers_json ?? null);
  const workspaceRouter = findPlatformModelRouterById(modelRouters, requestedWorkspaceModel);
  const workspaceModel = workspaceRouter
    ? resolvePlatformModelRouterDefaultRuntimeModel(workspaceRouter)
    : requestedWorkspaceModel;

  return resolveContextWindowForModel(
    workspaceModel || resolveInternalModel({
      specializedModels: normalizePlatformSpecializedModels(platformSettingsResult.rows[0]?.specialized_models_json ?? null),
      fallbackModel: config.openai.defaultModel
    }),
    platformSettingsResult.rows[0]?.model_metadata_json ?? null
  );
}
