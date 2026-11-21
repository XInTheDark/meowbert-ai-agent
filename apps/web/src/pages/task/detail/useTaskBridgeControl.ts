import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isBridgeTaskExecutionTarget, type TaskExecutionTarget } from "@meowbert/shared";
import type { ApiClient } from "../../../lib/api";
import type { TaskDetail } from "../../../lib/types";
import {
  formatBridgeControlTitle,
  resolveBridgeToggleTarget,
  useProjectExecutionTargets,
  type BridgeComposerControl
} from "../../../task/useProjectExecutionTargets";
import { updateTaskExecutionTarget } from "./taskDetailMutations";

export function useTaskBridgeControl(input: {
  api: ApiClient;
  projectId: string | null;
  task: TaskDetail["task"] | null | undefined;
  isTaskRunning: boolean;
  onTargetUpdated: (nextTarget: TaskExecutionTarget) => void;
  onError: (message: string | null) => void;
}): BridgeComposerControl | undefined {
  const { api, projectId, task, isTaskRunning, onTargetUpdated, onError } = input;
  const isDesktop = typeof window !== "undefined" && Boolean(window.meowbertDesktop);
  const currentTarget: TaskExecutionTarget = task?.execution_target ?? { kind: "cloud" };
  const active = isBridgeTaskExecutionTarget(currentTarget);
  const supportsBridge = Boolean(
    task
    && (task.task_type ?? "standard") === "standard"
    && task.is_project_master !== true
    && task.is_legacy_swarm !== true
  );
  const targets = useProjectExecutionTargets(api, projectId, isDesktop && Boolean(task));
  const [isUpdating, setIsUpdating] = useState(false);
  const previousNonBridgeRef = useRef<{ taskId: string; target: TaskExecutionTarget } | null>(null);

  useEffect(() => {
    if (!task) {
      previousNonBridgeRef.current = null;
      return;
    }
    if (previousNonBridgeRef.current && previousNonBridgeRef.current.taskId !== task.id) {
      previousNonBridgeRef.current = null;
    }
  }, [task?.id]);

  const requireSandbox = task?.read_only === true || task?.network_disabled === true;
  const canEnable = active || (targets.enabled && targets.devices.length > 0);
  const visible = isDesktop && Boolean(task) && (active || (supportsBridge && canEnable));

  const disabledReason = !supportsBridge
    ? "Bridge mode supports standard tasks without workflows or schedules"
    : isTaskRunning
      ? "Stop or wait for the active run before changing Bridge mode"
      : (!active && !canEnable ? "No verified local device is available for Bridge mode" : null);

  const handleToggle = useCallback(() => {
    if (!task || isUpdating || disabledReason) return;
    const previousNonBridgeTarget = previousNonBridgeRef.current?.taskId === task.id
      ? previousNonBridgeRef.current.target
      : null;
    const nextTarget = resolveBridgeToggleTarget({
      currentTarget,
      previousNonBridgeTarget,
      targets,
      requireSandbox
    });
    if (!nextTarget) return;

    if (!active) {
      previousNonBridgeRef.current = { taskId: task.id, target: currentTarget };
    }
    setIsUpdating(true);
    onError(null);
    void updateTaskExecutionTarget(api, task.id, nextTarget)
      .then((saved) => {
        onTargetUpdated(saved);
      })
      .catch((error) => {
        onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        setIsUpdating(false);
      });
  }, [active, api, currentTarget, disabledReason, isUpdating, onError, onTargetUpdated, requireSandbox, targets, task]);

  return useMemo<BridgeComposerControl | undefined>(() => {
    if (!visible) return undefined;
    return {
      active,
      disabled: isUpdating || Boolean(disabledReason),
      title: formatBridgeControlTitle({ active, target: currentTarget, disabledReason }),
      onToggle: handleToggle
    };
  }, [active, currentTarget, disabledReason, handleToggle, isUpdating, visible]);
}
