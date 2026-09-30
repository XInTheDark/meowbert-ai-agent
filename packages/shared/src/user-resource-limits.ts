import type { SandboxConfig, SandboxResourcesConfig } from "./sandbox.js";

export const DEFAULT_WORKSPACE_LIMIT = 1;
export const DEFAULT_PERSISTENT_RUNTIME_COMPUTE_CREDITS = 0;
export const DEFAULT_PERSISTENT_RUNTIME_LIMIT = 2;

export interface RuntimeResourceLimitOverrides {
  sandboxPidsLimit: number | null;
  sandboxMemoryMb: number | null;
  sandboxCpus: number | null;
  workspaceStorageMb: number | null;
  persistentRuntimeComputeCredits?: number | null;
  persistentRuntimeLimit?: number | null;
}

export interface UserResourceLimitOverrides extends RuntimeResourceLimitOverrides {
  workspaceLimit: number | null;
}

export interface EffectiveUserResourceLimits extends UserResourceLimitOverrides {
  effectiveWorkspaceLimit: number;
  effectiveSandboxPidsLimit: number;
  effectiveSandboxMemoryMb: number | null;
  effectiveSandboxCpus: number | null;
  effectiveWorkspaceStorageMb: number | null;
  effectivePersistentRuntimeComputeCredits: number;
  effectivePersistentRuntimeLimit: number;
}

export interface SandboxContainerResourceLimits {
  pids: number;
  memoryMb?: number;
  cpus?: number;
}

export interface SubscriptionPlanResourceLimitOverrides extends RuntimeResourceLimitOverrides {
  workspaceLimit: number | null;
}

function normalizeNonNegativeLimit(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return Math.floor(value);
}

export function resolveEffectivePersistentRuntimeLimit(input: {
  subscriptionPlanLimit?: number | null;
  userLimit?: number | null;
}): number {
  return normalizeNonNegativeLimit(input.userLimit)
    ?? normalizeNonNegativeLimit(input.subscriptionPlanLimit)
    ?? DEFAULT_PERSISTENT_RUNTIME_LIMIT;
}

export function resolveEffectivePersistentRuntimeComputeCredits(input: {
  subscriptionPlanCredits?: number | null;
  userCredits?: number | null;
}): number {
  return normalizeNonNegativeLimit(input.userCredits)
    ?? normalizeNonNegativeLimit(input.subscriptionPlanCredits)
    ?? DEFAULT_PERSISTENT_RUNTIME_COMPUTE_CREDITS;
}

function normalizeOptionalLimit(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeDefaultOptionalLimit(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeRequiredLimit(value: number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
    return Math.floor(value);
  }

  return fallback;
}

export function resolveEffectiveWorkspaceLimit(input: {
  defaultWorkspaceLimit?: number;
  subscriptionPlanWorkspaceLimit?: number | null;
  workspaceLimit?: number | null;
}): number {
  return (
    normalizeOptionalLimit(input.workspaceLimit)
    ?? normalizeOptionalLimit(input.subscriptionPlanWorkspaceLimit)
    ?? normalizeRequiredLimit(input.defaultWorkspaceLimit, DEFAULT_WORKSPACE_LIMIT)
  );
}

export function resolveEffectiveWorkspaceStorageMb(input: {
  defaults: SandboxResourcesConfig;
  subscriptionPlanWorkspaceStorageMb?: number | null;
  workspaceStorageMb?: number | null;
}): number | null {
  return (
    normalizeOptionalLimit(input.workspaceStorageMb)
    ?? normalizeOptionalLimit(input.subscriptionPlanWorkspaceStorageMb)
    ?? normalizeDefaultOptionalLimit(input.defaults.storageMb)
  );
}

export function resolveEffectiveWorkspaceStorageBytes(input: {
  defaults: SandboxResourcesConfig;
  subscriptionPlanWorkspaceStorageMb?: number | null;
  workspaceStorageMb?: number | null;
}): number | null {
  const storageMb = resolveEffectiveWorkspaceStorageMb(input);
  return storageMb === null ? null : storageMb * 1024 * 1024;
}

export function resolveEffectiveSandboxContainerResources(input: {
  defaults: SandboxConfig["resources"];
  subscriptionPlanSandboxPidsLimit?: number | null;
  subscriptionPlanSandboxMemoryMb?: number | null;
  subscriptionPlanSandboxCpus?: number | null;
  sandboxPidsLimit?: number | null;
  sandboxMemoryMb?: number | null;
  sandboxCpus?: number | null;
}): SandboxContainerResourceLimits {
  const resources: SandboxContainerResourceLimits = {
    pids:
      normalizeOptionalLimit(input.sandboxPidsLimit)
      ?? normalizeOptionalLimit(input.subscriptionPlanSandboxPidsLimit)
      ?? input.defaults.pids
  };

  const memoryMb =
    normalizeOptionalLimit(input.sandboxMemoryMb)
    ?? normalizeOptionalLimit(input.subscriptionPlanSandboxMemoryMb)
    ?? normalizeDefaultOptionalLimit(input.defaults.memoryMb);
  if (memoryMb !== null) {
    resources.memoryMb = memoryMb;
  }

  const cpus =
    normalizeOptionalLimit(input.sandboxCpus)
    ?? normalizeOptionalLimit(input.subscriptionPlanSandboxCpus)
    ?? normalizeDefaultOptionalLimit(input.defaults.cpus);
  if (cpus !== null) {
    resources.cpus = cpus;
  }

  return resources;
}

export function resolveEffectiveUserResourceLimits(input: {
  defaults: SandboxConfig["resources"];
  defaultWorkspaceLimit?: number;
  subscriptionPlanOverrides?: SubscriptionPlanResourceLimitOverrides;
  overrides: UserResourceLimitOverrides;
}): EffectiveUserResourceLimits {
  const sandboxResources = resolveEffectiveSandboxContainerResources({
    defaults: input.defaults,
    subscriptionPlanSandboxPidsLimit: input.subscriptionPlanOverrides?.sandboxPidsLimit ?? null,
    subscriptionPlanSandboxMemoryMb: input.subscriptionPlanOverrides?.sandboxMemoryMb ?? null,
    subscriptionPlanSandboxCpus: input.subscriptionPlanOverrides?.sandboxCpus ?? null,
    sandboxPidsLimit: input.overrides.sandboxPidsLimit,
    sandboxMemoryMb: input.overrides.sandboxMemoryMb,
    sandboxCpus: input.overrides.sandboxCpus
  });

  return {
    ...input.overrides,
    effectiveWorkspaceLimit: resolveEffectiveWorkspaceLimit({
      defaultWorkspaceLimit: input.defaultWorkspaceLimit,
      subscriptionPlanWorkspaceLimit: input.subscriptionPlanOverrides?.workspaceLimit ?? null,
      workspaceLimit: input.overrides.workspaceLimit
    }),
    effectiveSandboxPidsLimit: sandboxResources.pids,
    effectiveSandboxMemoryMb: sandboxResources.memoryMb ?? null,
    effectiveSandboxCpus: sandboxResources.cpus ?? null,
    effectiveWorkspaceStorageMb: resolveEffectiveWorkspaceStorageMb({
      defaults: input.defaults,
      subscriptionPlanWorkspaceStorageMb: input.subscriptionPlanOverrides?.workspaceStorageMb ?? null,
      workspaceStorageMb: input.overrides.workspaceStorageMb
    }),
    effectivePersistentRuntimeComputeCredits: resolveEffectivePersistentRuntimeComputeCredits({
      subscriptionPlanCredits: input.subscriptionPlanOverrides?.persistentRuntimeComputeCredits ?? null,
      userCredits: input.overrides.persistentRuntimeComputeCredits ?? null
    }),
    effectivePersistentRuntimeLimit: resolveEffectivePersistentRuntimeLimit({
      subscriptionPlanLimit: input.subscriptionPlanOverrides?.persistentRuntimeLimit ?? null,
      userLimit: input.overrides.persistentRuntimeLimit ?? null
    })
  };
}
