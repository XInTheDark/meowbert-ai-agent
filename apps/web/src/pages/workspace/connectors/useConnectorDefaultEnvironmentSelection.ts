import { useEffect } from "react";
import type { Environment } from "../../../lib/types";

export function useConnectorDefaultEnvironmentSelection(
  activeEnvironments: Environment[],
  defaultEnvironmentId: string,
  setDefaultEnvironmentId: (environmentId: string) => void
): void {
  useEffect(() => {
    if (defaultEnvironmentId || activeEnvironments.length === 0) {
      return;
    }

    setDefaultEnvironmentId(activeEnvironments[0].id);
  }, [activeEnvironments, defaultEnvironmentId, setDefaultEnvironmentId]);

  useEffect(() => {
    if (!defaultEnvironmentId) {
      return;
    }

    const selectedStillActive = activeEnvironments.some((environment) => environment.id === defaultEnvironmentId);
    if (selectedStillActive || activeEnvironments.length === 0) {
      return;
    }

    setDefaultEnvironmentId(activeEnvironments[0].id);
  }, [activeEnvironments, defaultEnvironmentId, setDefaultEnvironmentId]);
}
