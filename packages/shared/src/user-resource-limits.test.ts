import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKSPACE_LIMIT,
  DEFAULT_PERSISTENT_RUNTIME_COMPUTE_CREDITS,
  DEFAULT_PERSISTENT_RUNTIME_LIMIT,
  resolveEffectiveSandboxContainerResources,
  resolveEffectiveUserResourceLimits,
  resolveEffectiveWorkspaceLimit,
  resolveEffectiveWorkspaceStorageBytes
} from "./user-resource-limits.js";

describe("user resource limit helpers", () => {
  const defaults = {
    pids: 400,
    memoryMb: 640,
    cpus: 1,
    storageMb: 800
  };

  it("falls back to platform defaults when overrides are blank", () => {
    expect(resolveEffectiveUserResourceLimits({
      defaults,
      overrides: {
        workspaceLimit: null,
        sandboxPidsLimit: null,
        sandboxMemoryMb: null,
        sandboxCpus: null,
        workspaceStorageMb: null
      }
    })).toEqual({
      workspaceLimit: null,
      sandboxPidsLimit: null,
      sandboxMemoryMb: null,
      sandboxCpus: null,
      workspaceStorageMb: null,
      effectiveWorkspaceLimit: DEFAULT_WORKSPACE_LIMIT,
      effectiveSandboxPidsLimit: 400,
      effectiveSandboxMemoryMb: 640,
      effectiveSandboxCpus: 1,
      effectiveWorkspaceStorageMb: 800,
      effectivePersistentRuntimeComputeCredits: DEFAULT_PERSISTENT_RUNTIME_COMPUTE_CREDITS,
      effectivePersistentRuntimeLimit: DEFAULT_PERSISTENT_RUNTIME_LIMIT
    });
  });

  it("applies explicit per-user overrides", () => {
    expect(resolveEffectiveSandboxContainerResources({
      defaults,
      sandboxPidsLimit: 512,
      sandboxMemoryMb: 2048,
      sandboxCpus: 2.5
    })).toEqual({
      pids: 512,
      memoryMb: 2048,
      cpus: 2.5
    });
  });

  it("converts workspace storage mb to bytes", () => {
    expect(resolveEffectiveWorkspaceStorageBytes({
      defaults,
      workspaceStorageMb: 1024
    })).toBe(1024 * 1024 * 1024);
  });

  it("falls back to active subscription plan resource limits before platform defaults", () => {
    expect(resolveEffectiveUserResourceLimits({
      defaults,
      subscriptionPlanOverrides: {
        workspaceLimit: null,
        sandboxPidsLimit: 750,
        sandboxMemoryMb: 1536,
        sandboxCpus: 1.75,
        workspaceStorageMb: 2048
      },
      overrides: {
        workspaceLimit: null,
        sandboxPidsLimit: null,
        sandboxMemoryMb: null,
        sandboxCpus: null,
        workspaceStorageMb: null
      }
    })).toEqual({
      workspaceLimit: null,
      sandboxPidsLimit: null,
      sandboxMemoryMb: null,
      sandboxCpus: null,
      workspaceStorageMb: null,
      effectiveWorkspaceLimit: DEFAULT_WORKSPACE_LIMIT,
      effectiveSandboxPidsLimit: 750,
      effectiveSandboxMemoryMb: 1536,
      effectiveSandboxCpus: 1.75,
      effectiveWorkspaceStorageMb: 2048,
      effectivePersistentRuntimeComputeCredits: DEFAULT_PERSISTENT_RUNTIME_COMPUTE_CREDITS,
      effectivePersistentRuntimeLimit: DEFAULT_PERSISTENT_RUNTIME_LIMIT
    });
  });

  it("prefers explicit user overrides over subscription plan resource defaults", () => {
    expect(resolveEffectiveUserResourceLimits({
      defaults,
      subscriptionPlanOverrides: {
        workspaceLimit: 6,
        sandboxPidsLimit: 750,
        sandboxMemoryMb: 1536,
        sandboxCpus: 1.75,
        workspaceStorageMb: 2048
      },
      overrides: {
        workspaceLimit: 2,
        sandboxPidsLimit: 800,
        sandboxMemoryMb: 4096,
        sandboxCpus: 3,
        workspaceStorageMb: 3072
      }
    })).toEqual({
      workspaceLimit: 2,
      sandboxPidsLimit: 800,
      sandboxMemoryMb: 4096,
      sandboxCpus: 3,
      workspaceStorageMb: 3072,
      effectiveWorkspaceLimit: 2,
      effectiveSandboxPidsLimit: 800,
      effectiveSandboxMemoryMb: 4096,
      effectiveSandboxCpus: 3,
      effectiveWorkspaceStorageMb: 3072,
      effectivePersistentRuntimeComputeCredits: DEFAULT_PERSISTENT_RUNTIME_COMPUTE_CREDITS,
      effectivePersistentRuntimeLimit: DEFAULT_PERSISTENT_RUNTIME_LIMIT
    });
  });

  it("uses plan runtime credits and lets a user override them", () => {
    const resolved = resolveEffectiveUserResourceLimits({
      defaults,
      subscriptionPlanOverrides: {
        workspaceLimit: null,
        sandboxPidsLimit: null,
        sandboxMemoryMb: null,
        sandboxCpus: null,
        workspaceStorageMb: null,
        persistentRuntimeComputeCredits: 120,
        persistentRuntimeLimit: 3
      },
      overrides: {
        workspaceLimit: null,
        sandboxPidsLimit: null,
        sandboxMemoryMb: null,
        sandboxCpus: null,
        workspaceStorageMb: null,
        persistentRuntimeComputeCredits: 45,
        persistentRuntimeLimit: 1
      }
    });

    expect(resolved.effectivePersistentRuntimeComputeCredits).toBe(45);
    expect(resolved.effectivePersistentRuntimeLimit).toBe(1);
  });

  it("falls back to subscription plan workspace limit before the default", () => {
    expect(resolveEffectiveWorkspaceLimit({
      workspaceLimit: null,
      subscriptionPlanWorkspaceLimit: 5
    })).toBe(5);
  });
});
