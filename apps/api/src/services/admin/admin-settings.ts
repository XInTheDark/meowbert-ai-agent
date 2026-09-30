import type { PoolClient } from "pg";
import {
  buildDefaultTaskSchedulerSettings,
  normalizePlatformAgentPresets,
  validatePlatformAgentPresetGraph,
  normalizePlatformModelMetadata,
  normalizePlatformModelRouters,
  normalizePlatformSpecializedModels,
  normalizeModelSliderAgentIds,
  normalizeTaskSchedulerSettings,
  findPlatformModelRouterById,
  resolvePlatformModelRouterDefaultRuntimeModel,
  resolveContextWindowForModel,
  normalizeUsageRateMultiplier,
  resolveInternalModel,
  type TaskSchedulerSettings,
  type PlatformAgentPreset,
  type PlatformModelMetadata,
  type PlatformModelRouter
} from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { config } from "../../lib/config.js";

const REGISTRATION_GUARD_LOCK = 819205017;

class InvalidAdminSettingsError extends Error {
  readonly statusCode = 400;
  readonly exposeMessage = true;
}

interface AdminSettingsRow {
  allow_user_signup: boolean;
  require_admin_signup_approval: boolean;
  enable_forgot_password: boolean;
  require_email_verification_on_signup: boolean;
  enable_prompt_caching: boolean;
  debug_mode: boolean;
  default_free_message_limit: number | null;
  max_task_run_retries: number;
  task_scheduler_json: unknown;
  usage_rate_multiplier: string | number;
  model_metadata_json: unknown;
  model_routers_json: unknown;
  agent_presets_json: unknown;
  specialized_models_json: unknown;
  model_slider_agent_ids_json: unknown;
}

export interface AdminSettings {
  allowUserSignup: boolean;
  requireAdminSignupApproval: boolean;
  enableForgotPassword: boolean;
  requireEmailVerificationOnSignup: boolean;
  enablePromptCaching: boolean;
  debugMode: boolean;
  defaultFreeMessageLimit: number | null;
  maxTaskRunRetries: number;
  taskScheduler: TaskSchedulerSettings;
  usageRateMultiplier: number;
  modelMetadata: PlatformModelMetadata;
  modelRouters: PlatformModelRouter[];
  agentPresets: PlatformAgentPreset[];
  specializedModels: import("@meowbert/shared").PlatformSpecializedModels;
  modelSliderAgentIds: string[];
}

interface RegistrationAvailability {
  enabled: boolean;
  allowUserSignup: boolean;
  requireAdminSignupApproval: boolean;
  enableForgotPassword: boolean;
  requireEmailVerificationOnSignup: boolean;
  userCount: number;
}

async function runQuery<T extends object>(
  sql: string,
  params: unknown[] = [],
  client?: PoolClient
): Promise<{ rows: T[]; rowCount: number | null }> {
  if (client) {
    const result = await client.query<T>(sql, params);
    return {
      rows: result.rows,
      rowCount: result.rowCount
    };
  }

  const result = await query<T>(sql, params);
  return {
    rows: result.rows,
    rowCount: result.rowCount
  };
}

function mapAdminSettings(row: AdminSettingsRow | undefined): AdminSettings {
  const defaultTaskSchedulerSettings = buildDefaultTaskSchedulerSettings({
    defaultEnvironmentConcurrency: config.limits.defaultTaskConcurrencyPerEnv,
    maxWorkspaceConcurrency: config.limits.maxConcurrentTasksWorkspace
  });
  const usageRateMultiplier = normalizeUsageRateMultiplier(row?.usage_rate_multiplier ?? 1);
  const modelMetadata = normalizePlatformModelMetadata(row?.model_metadata_json ?? null);
  const modelRouters = normalizePlatformModelRouters(row?.model_routers_json ?? null);
  const agentPresets = normalizePlatformAgentPresets(row?.agent_presets_json ?? null);
  const specializedModels = normalizePlatformSpecializedModels(row?.specialized_models_json ?? null);
  const modelSliderAgentIds = normalizeModelSliderAgentIds(row?.model_slider_agent_ids_json ?? null);
  const taskScheduler = normalizeTaskSchedulerSettings(row?.task_scheduler_json ?? null, defaultTaskSchedulerSettings);

  return {
    allowUserSignup: row?.allow_user_signup ?? false,
    requireAdminSignupApproval: row?.require_admin_signup_approval ?? false,
    enableForgotPassword: row?.enable_forgot_password ?? false,
    requireEmailVerificationOnSignup: row?.require_email_verification_on_signup ?? false,
    enablePromptCaching: row?.enable_prompt_caching ?? true,
    debugMode: row?.debug_mode ?? false,
    defaultFreeMessageLimit: row?.default_free_message_limit ?? null,
    maxTaskRunRetries: row?.max_task_run_retries ?? 5,
    taskScheduler,
    usageRateMultiplier,
    modelMetadata,
    modelRouters,
    agentPresets,
    specializedModels,
    modelSliderAgentIds
  };
}

export async function acquireRegistrationGuardLock(client: PoolClient): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock($1)", [REGISTRATION_GUARD_LOCK]);
}

export async function getAdminSettings(client?: PoolClient): Promise<AdminSettings> {
  const result = await runQuery<AdminSettingsRow>(
    `SELECT
       allow_user_signup,
       require_admin_signup_approval,
       enable_forgot_password,
       require_email_verification_on_signup,
       enable_prompt_caching,
       debug_mode,
       default_free_message_limit,
       max_task_run_retries,
       task_scheduler_json,
       usage_rate_multiplier,
       model_metadata_json,
       model_routers_json,
       agent_presets_json,
       specialized_models_json,
       model_slider_agent_ids_json
     FROM platform_settings
     WHERE id = 1`,
    [],
    client
  );

  return mapAdminSettings(result.rows[0]);
}

export async function getInternalModel(): Promise<string> {
  const settings = await getAdminSettings();
  return resolveInternalModel({ specializedModels: settings.specializedModels, fallbackModel: config.openai.defaultModel });
}

export async function getRegistrationAvailability(client?: PoolClient): Promise<RegistrationAvailability> {
  const [settings, userCountResult] = await Promise.all([
    getAdminSettings(client),
    runQuery<{ count: number }>("SELECT COUNT(*)::int AS count FROM users", [], client)
  ]);

  const userCount = Number(userCountResult.rows[0]?.count ?? 0);
  const isFirstUserSignup = userCount === 0;

  return {
    enabled: settings.allowUserSignup || isFirstUserSignup,
    allowUserSignup: settings.allowUserSignup,
    requireAdminSignupApproval: settings.requireAdminSignupApproval,
    enableForgotPassword: settings.enableForgotPassword,
    requireEmailVerificationOnSignup: settings.requireEmailVerificationOnSignup,
    userCount
  };
}

export async function updateAdminSettings(input: AdminSettings): Promise<AdminSettings> {
  const defaultTaskSchedulerSettings = buildDefaultTaskSchedulerSettings({
    defaultEnvironmentConcurrency: config.limits.defaultTaskConcurrencyPerEnv,
    maxWorkspaceConcurrency: config.limits.maxConcurrentTasksWorkspace
  });
  const normalizedUsageRateMultiplier = normalizeUsageRateMultiplier(input.usageRateMultiplier);
  const normalizedModelMetadata = normalizePlatformModelMetadata(input.modelMetadata);
  const normalizedModelRouters = normalizePlatformModelRouters(input.modelRouters);
  const normalizedAgentPresets = normalizePlatformAgentPresets(input.agentPresets);
  const presetGraphErrors = validatePlatformAgentPresetGraph(normalizedAgentPresets);
  if (presetGraphErrors.length > 0) {
    throw new InvalidAdminSettingsError(presetGraphErrors.join(" "));
  }
  const normalizedSpecializedModels = normalizePlatformSpecializedModels(input.specializedModels);
  const normalizedModelSliderAgentIds = normalizeModelSliderAgentIds(input.modelSliderAgentIds);
  const normalizedTaskScheduler = normalizeTaskSchedulerSettings(input.taskScheduler, defaultTaskSchedulerSettings);

  const params = [
    input.allowUserSignup,
    input.requireAdminSignupApproval,
    input.enableForgotPassword,
    input.requireEmailVerificationOnSignup,
    input.enablePromptCaching,
    input.debugMode,
    input.defaultFreeMessageLimit === null ? null : Math.max(0, Math.floor(input.defaultFreeMessageLimit)),
    Math.max(0, Math.min(100, Math.floor(input.maxTaskRunRetries))),
    JSON.stringify(normalizedTaskScheduler),
    normalizedUsageRateMultiplier,
    JSON.stringify(normalizedModelMetadata),
    JSON.stringify(normalizedModelRouters),
    JSON.stringify(normalizedAgentPresets),
    JSON.stringify(normalizedSpecializedModels),
    JSON.stringify(normalizedModelSliderAgentIds)
  ];

  const updated = await query<AdminSettingsRow>(
    `UPDATE platform_settings
        SET allow_user_signup = $1,
            require_admin_signup_approval = $2,
            enable_forgot_password = $3,
            require_email_verification_on_signup = $4,
            enable_prompt_caching = $5,
            debug_mode = $6,
            default_free_message_limit = $7,
            max_task_run_retries = $8,
            task_scheduler_json = $9::jsonb,
            usage_rate_multiplier = $10,
            model_metadata_json = $11::jsonb,
            model_routers_json = $12::jsonb,
            agent_presets_json = $13::jsonb,
            specialized_models_json = $14::jsonb,
            model_slider_agent_ids_json = $15::jsonb,
            updated_at = now()
      WHERE id = 1
    RETURNING
      allow_user_signup,
      require_admin_signup_approval,
      enable_forgot_password,
      require_email_verification_on_signup,
      enable_prompt_caching,
      debug_mode,
      default_free_message_limit,
      max_task_run_retries,
      task_scheduler_json,
      usage_rate_multiplier,
      model_metadata_json,
      model_routers_json,
      agent_presets_json,
      specialized_models_json,
      model_slider_agent_ids_json`,
    params
  );

  if ((updated.rowCount ?? 0) > 0) {
    return mapAdminSettings(updated.rows[0]);
  }

  const inserted = await query<AdminSettingsRow>(
    `INSERT INTO platform_settings (
      id,
      allow_user_signup,
      require_admin_signup_approval,
      enable_forgot_password,
      require_email_verification_on_signup,
      enable_prompt_caching,
      debug_mode,
      default_free_message_limit,
      max_task_run_retries,
      task_scheduler_json,
      usage_rate_multiplier,
      model_metadata_json,
      model_routers_json,
      agent_presets_json,
      specialized_models_json,
      model_slider_agent_ids_json
    )
    VALUES (1, $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10, $11::jsonb, $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb)
    ON CONFLICT (id)
    DO UPDATE
      SET allow_user_signup = EXCLUDED.allow_user_signup,
          require_admin_signup_approval = EXCLUDED.require_admin_signup_approval,
          enable_forgot_password = EXCLUDED.enable_forgot_password,
          require_email_verification_on_signup = EXCLUDED.require_email_verification_on_signup,
          enable_prompt_caching = EXCLUDED.enable_prompt_caching,
          debug_mode = EXCLUDED.debug_mode,
          default_free_message_limit = EXCLUDED.default_free_message_limit,
          max_task_run_retries = EXCLUDED.max_task_run_retries,
          task_scheduler_json = EXCLUDED.task_scheduler_json,
          usage_rate_multiplier = EXCLUDED.usage_rate_multiplier,
          model_metadata_json = EXCLUDED.model_metadata_json,
          model_routers_json = EXCLUDED.model_routers_json,
          agent_presets_json = EXCLUDED.agent_presets_json,
          specialized_models_json = EXCLUDED.specialized_models_json,
          model_slider_agent_ids_json = EXCLUDED.model_slider_agent_ids_json,
          updated_at = now()
    RETURNING
      allow_user_signup,
      require_admin_signup_approval,
      enable_forgot_password,
      require_email_verification_on_signup,
      enable_prompt_caching,
      debug_mode,
      default_free_message_limit,
      max_task_run_retries,
      task_scheduler_json,
      usage_rate_multiplier,
      model_metadata_json,
      model_routers_json,
      agent_presets_json,
      specialized_models_json,
      model_slider_agent_ids_json`,
    params
  );

  return mapAdminSettings(inserted.rows[0]);
}

export async function resolveContextWindowTokensForModel(model: string, client?: PoolClient): Promise<number> {
  const settings = await getAdminSettings(client);
  const router = findPlatformModelRouterById(settings.modelRouters, model);
  const resolvedModel = router ? resolvePlatformModelRouterDefaultRuntimeModel(router) : model;
  return resolveContextWindowForModel(resolvedModel, settings.modelMetadata);
}

export async function isSuperAdmin(userId: string): Promise<boolean> {
  const result = await query<{ is_super_admin: boolean }>(
    `SELECT is_super_admin
       FROM users
      WHERE id = $1`,
    [userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return false;
  }

  return result.rows[0].is_super_admin === true;
}

export async function assertSuperAdmin(userId: string): Promise<void> {
  const allowed = await isSuperAdmin(userId);
  if (!allowed) {
    throw new Error("Super admin access denied");
  }
}
