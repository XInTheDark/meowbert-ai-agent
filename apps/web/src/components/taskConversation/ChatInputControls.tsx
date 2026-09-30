import type { RefObject } from "react";
import { Square } from "lucide-react";
import { AttachFilesMenu } from "../files/AttachFilesMenu";
import { ToolOptionsDropdown, type SkillSummary } from "../tasks/ToolOptionsDropdown";
import { SourceOptionsDropdown } from "../tasks/SourceOptionsDropdown";
import { TaskParametersDropdown } from "../tasks/TaskParametersDropdown";
import { AgentDropdown, type AgentSummary } from "../tasks/AgentDropdown";
import { SubscriptionUsageWarningLink, type SubscriptionUsageWarning } from "../../subscription/usageLimits";
import type { TaskParameters, TaskToolOptions, TaskType, TaskWorkflowComposerConfig } from "../../lib/types";
import type { WorkspaceSourceSummary } from "../../sources/sourceTypes";
import type { ChatToolsPopoverPlacement } from "../tasks/useChatToolsDropdownPlacement";
import { ChatInputSendButton } from "./ChatInputSendButton";

interface ChatInputControlsProps {
  isSubmitting: boolean;
  subscriptionUsageWarning?: SubscriptionUsageWarning | null;
  fileInputRef: RefObject<HTMLInputElement>;
  popoverPlacement?: ChatToolsPopoverPlacement;
  onAttachFiles: (files: FileList | File[] | null) => void;
  onOpenCreateTextFile: () => void;
  openProjectFiles?: () => void;
  onOpenCanvases?: () => void;
  attachableSources?: WorkspaceSourceSummary[];
  onOpenSourceFiles?: (source: WorkspaceSourceSummary) => void;
  toolOptions?: TaskToolOptions;
  onToolOptionsChange?: (options: TaskToolOptions) => void;
  availableSkills?: SkillSummary[];
  showMemorySearch?: boolean;
  showComputerUse?: boolean;
  allowScheduleTaskOption?: boolean;
  allowSubtasksOption?: boolean;
  availableSources?: WorkspaceSourceSummary[];
  onSourceSetupRequested?: (source: WorkspaceSourceSummary) => void;
  taskParameters?: TaskParameters;
  onTaskParametersChange?: (taskParameters: TaskParameters) => void | Promise<void>;
  taskParametersMode?: "create" | "edit";
  taskType?: TaskType;
  workflowConfig?: TaskWorkflowComposerConfig;
  onWorkflowConfigChange?: (workflowConfig: TaskWorkflowComposerConfig) => void | Promise<void>;
  availableAgents?: AgentSummary[];
  selectedAgentId?: string | null;
  defaultAgentId?: string | null;
  modelSliderAgentIds?: string[];
  onAgentChange?: (agentId: string) => void;
  shouldShowAgentSwitcher: boolean;
  isTaskRunning?: boolean;
  onStop?: () => void;
  submitBlockedByUploads: boolean;
  isQueuedSubmitPending: boolean;
  handleSubmitRequest: () => void;
  isSendButtonDisabled: boolean;
}

const DEFAULT_TOOL_OPTIONS: TaskToolOptions = {
  webSearch: false,
  memorySearch: false,
  scheduleTask: false,
  subtasks: false,
  computerUse: false,
  interactiveCanvas: false,
  enabledSkills: [],
  enabledSources: []
};

export function ChatInputControls(props: ChatInputControlsProps) {
  const toolOptions = props.toolOptions ?? DEFAULT_TOOL_OPTIONS;

  return (
    <div className="chat-controls">
      <div className="chat-controls-left">
        {props.subscriptionUsageWarning ? (
          <SubscriptionUsageWarningLink warning={props.subscriptionUsageWarning} className="subscription-usage-warning-link composer-usage-warning-link" />
        ) : null}
        <input
          type="file"
          multiple
          ref={props.fileInputRef}
          style={{ display: "none" }}
          onChange={(e) => {
            props.onAttachFiles(e.target.files);
            if (props.fileInputRef.current) props.fileInputRef.current.value = "";
          }}
        />
        <AttachFilesMenu
          disabled={props.isSubmitting}
          popoverPlacement={props.popoverPlacement}
          onUploadFiles={(files) => props.onAttachFiles(files)}
          onUploadFolder={(files) => props.onAttachFiles(files)}
          onCreateTextFile={props.onOpenCreateTextFile}
          onOpenProjectFiles={props.openProjectFiles}
          onOpenCanvases={props.onOpenCanvases}
          sourceActions={props.attachableSources?.map((source) => ({
            id: source.id,
            label: source.name,
            onSelect: () => props.onOpenSourceFiles?.(source)
          }))}
        />
        <ToolOptionsDropdown
          toolOptions={toolOptions}
          onChange={props.onToolOptionsChange}
          availableSkills={props.availableSkills}
          showMemorySearch={props.showMemorySearch}
          showComputerUse={props.showComputerUse}
          allowScheduleTaskOption={props.allowScheduleTaskOption}
          allowSubtasksOption={props.allowSubtasksOption}
          disabled={props.isSubmitting}
          label="Task tools"
          popoverPlacement={props.popoverPlacement}
        />
        <SourceOptionsDropdown
          toolOptions={toolOptions}
          onChange={props.onToolOptionsChange}
          availableSources={props.availableSources}
          onSetupRequested={props.onSourceSetupRequested}
          disabled={props.isSubmitting}
          label="Sources"
          popoverPlacement={props.popoverPlacement}
        />
        {props.taskParameters ? (
          <TaskParametersDropdown
            taskParameters={props.taskParameters}
            onChange={props.onTaskParametersChange}
            disabled={props.isSubmitting}
            mode={props.taskParametersMode}
            taskType={props.taskType}
            workflowConfig={props.workflowConfig}
            onWorkflowChange={props.onWorkflowConfigChange}
            availableAgents={props.availableAgents}
            selectedAgentId={props.selectedAgentId}
            defaultAgentId={props.defaultAgentId}
            popoverPlacement={props.popoverPlacement}
          />
        ) : null}
        {props.shouldShowAgentSwitcher ? (
          <AgentDropdown
            availableAgents={props.availableAgents}
            selectedAgentId={props.selectedAgentId}
            defaultAgentId={props.defaultAgentId}
            modelSliderAgentIds={props.modelSliderAgentIds}
            onChange={(agentId) => {
              if (typeof agentId === "string") {
                props.onAgentChange?.(agentId);
              }
            }}
            disabled={props.isSubmitting}
            popoverPlacement={props.popoverPlacement}
          />
        ) : null}
      </div>

      <div className="chat-controls-right">
        {props.isTaskRunning && props.onStop ? (
          <button
            className="stop-btn"
            onClick={props.onStop}
            title="Stop task"
            type="button"
          >
            <Square size={16} />
          </button>
        ) : null}
        <ChatInputSendButton
          isSubmitting={props.isSubmitting}
          submitBlockedByUploads={props.submitBlockedByUploads}
          isQueuedSubmitPending={props.isQueuedSubmitPending}
          isSendButtonDisabled={props.isSendButtonDisabled}
          onClick={props.handleSubmitRequest}
        />
      </div>
    </div>
  );
}
