import { useRef, useEffect, useState, useCallback, KeyboardEvent, DragEvent, ClipboardEvent } from "react";
import { Brain, Search, ShieldCheck, Users } from "lucide-react";
import { useAppRuntime } from "../../contexts/AppRuntimeContext";
import { TaskAttachment, TaskParameters, TaskToolOptions, TaskType, TaskWorkflowComposerConfig } from "../../lib/types";
import type { WorkspaceSourceSummary } from "../../sources/sourceTypes";
import type { SkillSummary } from "../tasks/ToolOptionsDropdown";
import type { AgentSummary } from "../tasks/AgentDropdown";
import { formatAgentSwarmRosterSummary } from "../../task/agentSwarmRosterSummary";
import { CreateTextFileModal } from "../files/CreateTextFileModal";
import type { SubscriptionUsageWarning } from "../../subscription/usageLimits";
import { ChatInputAttachmentRow } from "./ChatInputAttachmentRow";
import { ChatInputControls } from "./ChatInputControls";
import type { ChatToolsPopoverPlacement } from "../tasks/useChatToolsDropdownPlacement";

export { filterToolsMenuSkills, matchesToolsMenuQuery } from "../tasks/ToolOptionsDropdown";

interface ChatInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  hasExternalContent?: boolean;
  placeholder?: string;
  attachments: TaskAttachment[];
  popoverPlacement?: ChatToolsPopoverPlacement;
  onRemoveAttachment: (id: string) => void;
  onToggleAttachmentForceInclude?: (id: string) => void;
  onAttachFiles: (files: FileList | File[] | null) => void;
  onOpenEnvironmentFiles?: () => void;
  onOpenProjectFiles?: () => void;
  onOpenCanvases?: () => void;
  isUploading: boolean;
  pendingUploads?: Array<{ id: string; label: string }>;
  toolOptions?: TaskToolOptions;
  onToolOptionsChange?: (options: TaskToolOptions) => void;
  showMemorySearch?: boolean;
  showComputerUse?: boolean;
  allowScheduleTaskOption?: boolean;
  allowSubtasksOption?: boolean;
  isTaskRunning?: boolean;
  onStop?: () => void;
  availableSkills?: SkillSummary[];
  availableSources?: WorkspaceSourceSummary[];
  attachableSources?: WorkspaceSourceSummary[];
  availableAgents?: AgentSummary[];
  selectedAgentId?: string | null;
  defaultAgentId?: string | null;
  modelSliderAgentIds?: string[];
  onAgentChange?: (agentId: string) => void;
  onSourceSetupRequested?: (source: WorkspaceSourceSummary) => void;
  onOpenSourceFiles?: (source: WorkspaceSourceSummary) => void;
  showAgentSwitcher?: boolean;
  taskParameters?: TaskParameters;
  onTaskParametersChange?: (taskParameters: TaskParameters) => void | Promise<void>;
  taskParametersMode?: "create" | "edit";
  taskType?: TaskType;
  workflowConfig?: TaskWorkflowComposerConfig;
  onWorkflowConfigChange?: (workflowConfig: TaskWorkflowComposerConfig) => void | Promise<void>;
  autoFocus?: boolean;
  focusToken?: number;
  mobileEnterBehavior?: "newline" | "submit";
  submitWithShiftEnter?: boolean;
  subscriptionUsageWarning?: SubscriptionUsageWarning | null;
}

export function isPasteAsFileShortcut(event: Pick<KeyboardEvent<HTMLTextAreaElement>, "key" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey">): boolean {
  return event.key.toLowerCase() === "v"
    && event.shiftKey
    && !event.altKey
    && (event.metaKey || event.ctrlKey);
}

export function buildPasteAsFileName(timestamp: Date = new Date()): string {
  return `clipboard-${timestamp.toISOString().replace(/[:.]/g, "-")}.txt`;
}

export function shouldSubmitOnEnter(input: {
  key: string;
  shiftKey: boolean;
  metaKey?: boolean;
  ctrlKey?: boolean;
  isNarrowViewport: boolean;
  mobileEnterBehavior?: "newline" | "submit";
  submitWithShiftEnter?: boolean;
}): boolean {
  if (input.key !== "Enter") {
    return false;
  }

  if (input.submitWithShiftEnter) {
    if (!input.metaKey && !input.ctrlKey) {
      return false;
    }
  } else if (input.shiftKey) {
    return false;
  }

  if (input.isNarrowViewport && input.mobileEnterBehavior !== "submit") {
    return false;
  }

  return true;
}

export function canSubmitChatInput(value: string, attachments: TaskAttachment[], pendingUploadCount = 0): boolean {
  return value.trim().length > 0 || attachments.length > 0 || pendingUploadCount > 0;
}

export function shouldQueueSubmit(input: {
  hasContent: boolean;
  isSubmitting: boolean;
  isUploading: boolean;
}): boolean {
  return input.hasContent && !input.isSubmitting && input.isUploading;
}

function createClipboardTextFile(text: string): File {
  return new File([text], buildPasteAsFileName(), {
    type: "text/plain;charset=utf-8"
  });
}

function canReadClipboardText(): boolean {
  return typeof navigator !== "undefined"
    && typeof navigator.clipboard?.readText === "function";
}

function getWorkflowReminder(
  workflowConfig: TaskWorkflowComposerConfig | undefined,
  availableAgents: AgentSummary[] | undefined,
  selectedAgentId: string | null | undefined
): { label: string; icon: "brain" | "search" | "shield" | "users" } | null {
  if (workflowConfig?.type === "long_horizon") {
    return { label: "Long Horizon selected", icon: "brain" };
  }
  if (workflowConfig?.type === "quality_control") {
    return { label: "Quality control selected", icon: "shield" };
  }
  if (workflowConfig?.type === "deep_research") {
    return { label: "Deep Research selected", icon: "search" };
  }
  if (workflowConfig?.type === "agent_swarm") {
    const roster = formatAgentSwarmRosterSummary(workflowConfig, availableAgents ?? [], selectedAgentId);
    return { label: roster ? `Agent Swarm · ${roster}` : "Agent Swarm selected", icon: "users" };
  }
  return null;
}

export function ChatInput({
  value,
  onChange,
  onSubmit,
  isSubmitting,
  hasExternalContent = false,
  placeholder = "Type a message...",
  attachments,
  onRemoveAttachment,
  onToggleAttachmentForceInclude,
  onAttachFiles,
  onOpenEnvironmentFiles,
  onOpenProjectFiles,
  onOpenCanvases,
  isUploading,
  pendingUploads = [],
  toolOptions,
  onToolOptionsChange,
  isTaskRunning,
  onStop,
  showMemorySearch = false,
  showComputerUse = false,
  allowScheduleTaskOption = true,
  allowSubtasksOption = true,
  availableSkills,
  availableSources,
  attachableSources,
  availableAgents,
  selectedAgentId,
  defaultAgentId,
  modelSliderAgentIds,
  onAgentChange,
  onSourceSetupRequested,
  onOpenSourceFiles,
  showAgentSwitcher = true,
  taskParameters,
  onTaskParametersChange,
  taskParametersMode = "create",
  taskType,
  workflowConfig,
  onWorkflowConfigChange,
  autoFocus = false,
  focusToken = 0,
  mobileEnterBehavior = "newline",
  submitWithShiftEnter = false,
  subscriptionUsageWarning = null,
  popoverPlacement
}: ChatInputProps) {
  const openProjectFiles = onOpenProjectFiles ?? onOpenEnvironmentFiles;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isCreateTextFileOpen, setIsCreateTextFileOpen] = useState(false);
  const [isSubmitQueued, setIsSubmitQueued] = useState(false);
  const { platform, capabilities } = useAppRuntime();
  const hasContent = hasExternalContent || canSubmitChatInput(value, attachments, pendingUploads.length);
  const submitBlockedByUploads = shouldQueueSubmit({
    hasContent,
    isSubmitting,
    isUploading
  });
  const isQueuedSubmitPending = isSubmitQueued && isUploading && !isSubmitting;
  const isSendButtonDisabled = !hasContent || isSubmitting;
  const workflowReminder = getWorkflowReminder(workflowConfig, availableAgents, selectedAgentId);

  const handleSubmitRequest = useCallback(() => {
    if (!hasContent || isSubmitting) {
      return;
    }
    if (isUploading) {
      setIsSubmitQueued(true);
      return;
    }
    setIsSubmitQueued(false);
    onSubmit();
  }, [hasContent, isSubmitting, isUploading, onSubmit]);

  useEffect(() => {
    if (!autoFocus || !textareaRef.current) {
      return;
    }
    textareaRef.current.focus();
  }, [autoFocus, focusToken]);

  useEffect(() => {
    if (!isSubmitQueued) {
      return;
    }
    if (!hasContent) {
      setIsSubmitQueued(false);
      return;
    }
    if (isUploading || isSubmitting) {
      return;
    }
    setIsSubmitQueued(false);
    onSubmit();
  }, [hasContent, isSubmitQueued, isSubmitting, isUploading, onSubmit]);

  const shouldShowAgentSwitcher = showAgentSwitcher
    && Array.isArray(availableAgents)
    && availableAgents.length > 0
    && typeof onAgentChange === "function";

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (isPasteAsFileShortcut(e)) {
      if (!canReadClipboardText()) {
        return;
      }
      e.preventDefault();
      void navigator.clipboard.readText()
        .then((clipboardText) => {
          if (clipboardText.length === 0) return;
          onAttachFiles([createClipboardTextFile(clipboardText)]);
        })
        .catch((error) => console.error("Failed to paste clipboard as file", error));
      return;
    }

    if (shouldSubmitOnEnter({
      key: e.key,
      shiftKey: e.shiftKey,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      isNarrowViewport: window.matchMedia("(max-width: 900px)").matches,
      mobileEnterBehavior,
      submitWithShiftEnter
    })) {
      e.preventDefault();
      handleSubmitRequest();
    }
  };

  const handleAttachClick = useCallback(async (): Promise<void> => {
    if (capabilities.supportsNativeFileDialogs) {
      const files = await platform.pickFiles();
      if (files.length > 0) {
        onAttachFiles(files);
      }
      return;
    }
    fileInputRef.current?.click();
  }, [capabilities.supportsNativeFileDialogs, onAttachFiles, platform]);

  useEffect(() => {
    const handleUploadRequest = () => {
      void handleAttachClick();
    };
    window.addEventListener("meowbert:request-upload", handleUploadRequest);
    return () => {
      window.removeEventListener("meowbert:request-upload", handleUploadRequest);
    };
  }, [handleAttachClick]);

  const handleResetInput = () => {
    onChange("");
    attachments.forEach((attachment) => onRemoveAttachment(attachment.id));
  };

  return (
    <div
      className={[
        "chat-input-box",
        isDragOver ? "drag-over" : ""
      ].filter(Boolean).join(" ")}
      aria-busy={isUploading}
      onDragOver={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragEnter={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
      }}
      onDragLeave={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
      }}
      onDrop={(e: DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          onAttachFiles(e.dataTransfer.files);
        }
      }}
    >
      <ChatInputAttachmentRow
        pendingUploads={pendingUploads}
        attachments={attachments}
        onRemoveAttachment={onRemoveAttachment}
        onToggleAttachmentForceInclude={onToggleAttachmentForceInclude}
        onResetInput={handleResetInput}
        isSubmitting={isSubmitting}
      />

      {workflowReminder ? (
        <div className="chat-workflow-reminder" aria-live="polite">
          {workflowReminder.icon === "brain"
            ? <Brain size={13} />
            : workflowReminder.icon === "search"
              ? <Search size={13} />
              : workflowReminder.icon === "shield" ? <ShieldCheck size={13} /> : <Users size={13} />}
          <span>{workflowReminder.label}</span>
        </div>
      ) : null}

      <textarea
        ref={textareaRef}
        className="chat-textarea"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        onPaste={(e: ClipboardEvent<HTMLTextAreaElement>) => {
          const files = e.clipboardData?.files;
          if (files && files.length > 0) {
            e.preventDefault();
            onAttachFiles(files);
          }
        }}
        disabled={isSubmitting}
        rows={1}
      />

      <ChatInputControls
        isSubmitting={isSubmitting}
        subscriptionUsageWarning={subscriptionUsageWarning}
        fileInputRef={fileInputRef}
        popoverPlacement={popoverPlacement}
        onAttachFiles={onAttachFiles}
        onOpenCreateTextFile={() => setIsCreateTextFileOpen(true)}
        openProjectFiles={openProjectFiles}
        onOpenCanvases={onOpenCanvases}
        attachableSources={attachableSources}
        onOpenSourceFiles={onOpenSourceFiles}
        toolOptions={toolOptions}
        onToolOptionsChange={onToolOptionsChange}
        availableSkills={availableSkills}
        showMemorySearch={showMemorySearch}
        showComputerUse={showComputerUse}
        allowScheduleTaskOption={allowScheduleTaskOption}
        allowSubtasksOption={allowSubtasksOption}
        availableSources={availableSources}
        onSourceSetupRequested={onSourceSetupRequested}
        taskParameters={taskParameters}
        onTaskParametersChange={onTaskParametersChange}
        taskParametersMode={taskParametersMode}
        taskType={taskType}
        workflowConfig={workflowConfig}
        onWorkflowConfigChange={onWorkflowConfigChange}
        availableAgents={availableAgents}
        selectedAgentId={selectedAgentId}
        defaultAgentId={defaultAgentId}
        modelSliderAgentIds={modelSliderAgentIds}
        onAgentChange={onAgentChange}
        shouldShowAgentSwitcher={shouldShowAgentSwitcher}
        isTaskRunning={isTaskRunning}
        onStop={onStop}
        submitBlockedByUploads={submitBlockedByUploads}
        isQueuedSubmitPending={isQueuedSubmitPending}
        handleSubmitRequest={handleSubmitRequest}
        isSendButtonDisabled={isSendButtonDisabled}
      />

      <CreateTextFileModal
        isOpen={isCreateTextFileOpen}
        title="Create text file"
        description="Create a quick text file and attach it to this task."
        submitLabel="Attach file"
        onClose={() => setIsCreateTextFileOpen(false)}
        onSubmit={async ({ name, content }) => {
          onAttachFiles([
            new File([content], name, {
              type: "text/plain;charset=utf-8"
            })
          ]);
        }}
      />
    </div>
  );
}
