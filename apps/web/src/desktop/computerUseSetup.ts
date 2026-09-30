import type { DesktopComputerStatus } from "@meowbert/shared";

export interface ComputerUseSetupState {
  ready: boolean;
  executorAvailable: boolean;
  missingAccessibility: boolean;
  missingScreenRecording: boolean;
  reason: string | null;
}

export function describeComputerUseSetup(status: DesktopComputerStatus | null | undefined): ComputerUseSetupState {
  const executorAvailable = status?.available === true;
  const missingAccessibility = status?.canControlComputer === false;
  const missingScreenRecording = status?.canTakeScreenshot === false;
  const ready = executorAvailable && !missingAccessibility && !missingScreenRecording;

  return {
    ready,
    executorAvailable,
    missingAccessibility,
    missingScreenRecording,
    reason: status?.reason ?? null
  };
}
