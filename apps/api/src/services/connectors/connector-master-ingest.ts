import type { ConnectorType } from "@meowbert/shared";
import { query } from "../../lib/db.js";
import { isEnvironmentMemoryEnabled } from "../environments/environment-memory.js";
import {
  ensureProjectMasterTask,
  getProjectMasterTaskId,
  isProjectMasterEnabledForWorkspace,
  ProjectMasterError
} from "../project-master/master-task.js";
import { ensureTaskHistoryWarm } from "../tasks/task-history.js";
import { appendTaskUserMessageAndEnqueue } from "../tasks/task-service/index.js";
import { TaskExecutionUserRequiredError } from "../tasks/task-service/prompt-usage.js";
import { buildConnectorTaskAgentSelection } from "./connector-agent.js";
import { decideEnvironmentRoute } from "./connector-routing.js";
import { listActiveConnectorEnvironments } from "./connector-task-context.js";
import { buildTaskToolOptionsFromConnectorConfig } from "./connector-tools.js";
import { upsertConnectorThreadMessageTaskLink } from "./connector-threads.js";

const MASTER_REQUIRED_MESSAGE =
  "Connectors need the Project Master. Ask a workspace admin to turn it on in workspace settings.";

// Every connector hands inbound messages to the Master of the chosen project, which decides
// whether to answer, start a task, or steer an existing one.
export interface ConnectorMasterTarget {
  source: ConnectorType;
  workspaceId: string;
  environmentId: string;
  masterTaskId: string;
  actorUserId: string;
  routingNote: string | null;
}

export interface ConnectorIngestResult {
  processed: boolean;
  reason?: string;
  taskId?: string;
  environmentId?: string;
  action?: "sent_to_master";
}

// A Master created from a chat has no browser to read a timezone from, so borrow the user's latest web one.
async function resolveNewMasterTimezone(userId: string): Promise<string> {
  const result = await query<{ default_timezone: string }>(
    `SELECT default_timezone
       FROM tasks
      WHERE initiator_user_id = $1
        AND source = 'web'
        AND is_hidden = false
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId]
  );
  return result.rows[0]?.default_timezone ?? "UTC";
}

export async function resolveConnectorMasterTarget(input: {
  source: ConnectorType;
  workspaceId: string;
  actorUserId: string | null | undefined;
  defaultEnvironmentId: string | null;
  routingText: string;
}): Promise<ConnectorMasterTarget> {
  if (!input.actorUserId) {
    throw new TaskExecutionUserRequiredError(input.source);
  }
  if (!(await isProjectMasterEnabledForWorkspace(input.workspaceId))) {
    throw new ProjectMasterError(MASTER_REQUIRED_MESSAGE, 409);
  }

  const environments = await listActiveConnectorEnvironments(input.workspaceId);
  if (environments.length === 0) {
    throw new ProjectMasterError("This workspace has no active projects yet.", 409);
  }
  const decision = await decideEnvironmentRoute({
    message: input.routingText,
    defaultEnvironmentId: input.defaultEnvironmentId ?? undefined,
    environments
  });

  const masterTaskId = (await getProjectMasterTaskId(decision.environmentId))
    ?? await ensureProjectMasterTask({
      environmentId: decision.environmentId,
      workspaceId: input.workspaceId,
      userId: input.actorUserId,
      timezone: await resolveNewMasterTimezone(input.actorUserId)
    });
  const projectName = environments.find((environment) => environment.id === decision.environmentId)?.name;

  return {
    source: input.source,
    workspaceId: input.workspaceId,
    environmentId: decision.environmentId,
    masterTaskId,
    actorUserId: input.actorUserId,
    routingNote: decision.usedFallback
      ? `Routing note: I could not confidently pick a project, so this went to "${projectName ?? "the fallback project"}".`
      : null
  };
}

export async function deliverConnectorMessageToMaster(input: {
  target: ConnectorMasterTarget;
  threadId: string;
  inboundMessageId: string | null;
  message: string;
  toolsConfig: unknown;
  agentId: string | null;
}): Promise<ConnectorIngestResult> {
  const { target } = input;
  await ensureTaskHistoryWarm(target.masterTaskId);
  const run = await appendTaskUserMessageAndEnqueue({
    taskId: target.masterTaskId,
    workspaceId: target.workspaceId,
    environmentId: target.environmentId,
    triggerSource: target.source,
    message: target.routingNote ? `${input.message}\n\n${target.routingNote}` : input.message,
    tools: buildTaskToolOptionsFromConnectorConfig(
      input.toolsConfig,
      await isEnvironmentMemoryEnabled(target.environmentId)
    ),
    agent: buildConnectorTaskAgentSelection(input.agentId),
    userId: target.actorUserId,
    connectorContextId: input.threadId,
    interruptQueued: true
  });

  if (input.inboundMessageId) {
    await upsertConnectorThreadMessageTaskLink({
      threadId: input.threadId,
      externalMessageId: input.inboundMessageId,
      direction: "inbound",
      taskId: target.masterTaskId
    });
  }

  return {
    processed: true,
    taskId: run.taskId,
    environmentId: target.environmentId,
    action: "sent_to_master"
  };
}
