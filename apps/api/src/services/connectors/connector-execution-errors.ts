import { ProjectMasterError } from "../project-master/master-task.js";
import {
  TaskExecutionUserRequiredError,
  TaskPromptEntitlementError
} from "../tasks/task-service/prompt-usage.js";

export function describeConnectorExecutionError(error: unknown): string | null {
  if (error instanceof TaskPromptEntitlementError) {
    return error.message;
  }
  if (error instanceof TaskExecutionUserRequiredError) {
    return error.message;
  }
  if (error instanceof ProjectMasterError) {
    return error.message;
  }

  return null;
}
