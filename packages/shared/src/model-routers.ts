import { normalizeAgentPresetPayload } from "./responses-settings.js";

export interface PlatformModelRouterTarget {
  id: string;
  description: string;
  payload: Record<string, unknown>;
}

export interface PlatformModelRouter {
  id: string;
  routingModel: string;
  defaultTargetModel: string;
  allowQuickMode?: boolean;
  models: PlatformModelRouterTarget[];
}

const MAX_MODEL_ROUTERS = 100;
const MAX_MODELS_PER_ROUTER = 50;
const MAX_ID_LENGTH = 240;
const MAX_MODEL_LENGTH = 240;
const MAX_DESCRIPTION_LENGTH = 4_000;

const DEFAULT_GPT_5_4_DESCRIPTION =
  "Choose for difficult, ambiguous, or high-stakes work: architecture changes, tricky debugging, multi-file refactors, complex planning, or anything where a wrong answer would be costly. Prefer this when deeper reasoning and reliability matter more than speed or cost.";
const DEFAULT_GPT_5_4_MINI_DESCRIPTION =
  "Choose for straightforward, low-risk work: simple edits, short Q&A, summarization, formatting, small bug fixes, or rapid back-and-forth. Prefer this when the task is clear and speed or cost matter more than maximum reasoning depth.";

export const DEFAULT_PLATFORM_MODEL_ROUTERS: PlatformModelRouter[] = [
  {
    id: "router-v1",
    routingModel: "gpt-5.4-mini",
    defaultTargetModel: "gpt-5.4-mini",
    allowQuickMode: false,
    models: [
      {
        id: "gpt-5.4",
        description: DEFAULT_GPT_5_4_DESCRIPTION,
        payload: {
          model: "gpt-5.4"
        }
      },
      {
        id: "gpt-5.4-mini",
        description: DEFAULT_GPT_5_4_MINI_DESCRIPTION,
        payload: {
          model: "gpt-5.4-mini"
        }
      }
    ]
  }
];

function deepCloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeRouterId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > MAX_ID_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizeModelId(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_MODEL_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizeDescription(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_DESCRIPTION_LENGTH) {
    return null;
  }

  return normalized;
}

function normalizeTarget(rawTarget: unknown): PlatformModelRouterTarget | null {
  if (!rawTarget || typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    return null;
  }

  const record = rawTarget as {
    id?: unknown;
    description?: unknown;
    payload?: unknown;
  };
  const id = normalizeModelId(record.id);
  const description = normalizeDescription(record.description);
  if (!id || !description) {
    return null;
  }

  const rawPayload = isPlainObject(record.payload) ? record.payload : { model: id };
  const payload = normalizeAgentPresetPayload(deepCloneJsonValue(rawPayload));
  const payloadModel = normalizeModelId(payload.model);
  if (!payloadModel) {
    return null;
  }
  payload.model = payloadModel;

  return {
    id,
    description,
    payload
  };
}

function cloneRouter(router: PlatformModelRouter): PlatformModelRouter {
  return deepCloneJsonValue(router);
}

export function clonePlatformModelRouters(routers: PlatformModelRouter[]): PlatformModelRouter[] {
  return routers.map((router) => cloneRouter(router));
}

function normalizeRouter(rawRouter: unknown): PlatformModelRouter | null {
  if (!rawRouter || typeof rawRouter !== "object" || Array.isArray(rawRouter)) {
    return null;
  }

  const record = rawRouter as {
    id?: unknown;
    routingModel?: unknown;
    defaultTargetModel?: unknown;
    allowQuickMode?: unknown;
    models?: unknown;
  };
  const id = normalizeRouterId(record.id);
  const routingModel = normalizeModelId(record.routingModel);
  if (!id || !routingModel || !Array.isArray(record.models)) {
    return null;
  }

  const models: PlatformModelRouterTarget[] = [];
  const seenModelIds = new Set<string>();
  for (const rawTarget of record.models.slice(0, MAX_MODELS_PER_ROUTER)) {
    const target = normalizeTarget(rawTarget);
    if (!target || seenModelIds.has(target.id)) {
      continue;
    }

    seenModelIds.add(target.id);
    models.push(target);
  }

  if (models.length === 0) {
    return null;
  }

  const explicitDefaultTargetModel = normalizeModelId(record.defaultTargetModel);
  const defaultTargetModel = models.some((target) => target.id === explicitDefaultTargetModel)
    ? explicitDefaultTargetModel!
    : models[0].id;

  return {
    id,
    routingModel,
    defaultTargetModel,
    allowQuickMode: record.allowQuickMode === true,
    models
  };
}

export function normalizePlatformModelRouters(rawValue: unknown): PlatformModelRouter[] {
  if (!Array.isArray(rawValue)) {
    return clonePlatformModelRouters(DEFAULT_PLATFORM_MODEL_ROUTERS);
  }

  const normalized: PlatformModelRouter[] = [];
  const seenIds = new Set<string>();
  for (const rawRouter of rawValue.slice(0, MAX_MODEL_ROUTERS)) {
    const router = normalizeRouter(rawRouter);
    if (!router || seenIds.has(router.id)) {
      continue;
    }

    seenIds.add(router.id);
    normalized.push(router);
  }

  if (normalized.length === 0 && rawValue.length > 0) {
    return clonePlatformModelRouters(DEFAULT_PLATFORM_MODEL_ROUTERS);
  }

  return normalized;
}

export function findPlatformModelRouterById(
  routers: PlatformModelRouter[],
  routerId: string | null | undefined
): PlatformModelRouter | null {
  const normalizedRouterId = normalizeRouterId(routerId);
  if (!normalizedRouterId) {
    return null;
  }

  const match = routers.find((router) => router.id === normalizedRouterId);
  return match ? cloneRouter(match) : null;
}

export function resolvePlatformModelRouterTargetRuntimeModel(
  router: PlatformModelRouter,
  targetId: string | null | undefined
): string | null {
  const normalizedTargetId = normalizeModelId(targetId);
  if (!normalizedTargetId) {
    return null;
  }

  const target = router.models.find((model) => model.id === normalizedTargetId);
  const runtimeModel = normalizeModelId(target?.payload.model);
  return runtimeModel;
}

export function resolvePlatformModelRouterDefaultRuntimeModel(router: PlatformModelRouter): string {
  return resolvePlatformModelRouterTargetRuntimeModel(router, router.defaultTargetModel)
    ?? router.defaultTargetModel;
}
