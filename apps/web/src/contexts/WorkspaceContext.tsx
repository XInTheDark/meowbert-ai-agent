import { createContext, useContext } from "react";
import { WorkspaceContextValue } from "../lib/types";

export const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function useOptionalWorkspaceApp(): WorkspaceContextValue | null {
  return useContext(WorkspaceContext);
}

export function useWorkspaceApp(): WorkspaceContextValue {
  const context = useOptionalWorkspaceApp();
  if (!context) {
    throw new Error("useWorkspaceApp must be used within WorkspaceLayout");
  }
  return context;
}
