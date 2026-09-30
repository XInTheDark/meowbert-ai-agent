export interface RunDeliveryInput {
  taskId: string;
  runId: string;
  finalResponse: string;
  notificationRequested: boolean;
  isSubtask: boolean;
  connectorContextId: string | null;
  workspaceId?: string;
  environmentId?: string;
  taskTitle?: string | null;
  targetUserId?: string | null;
}
export type RunDeliveryChannel = "web" | "push" | "telegram" | "discord" | "github" | "email";
