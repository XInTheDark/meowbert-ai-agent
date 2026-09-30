import { useCallback, useState } from "react";
import {
  Check,
  Copy,
  GitFork,
  Info,
  MessageSquareMore,
  Pencil,
  Play,
  RotateCcw
} from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useWorkspaceApp } from "../../contexts/WorkspaceContext";
import { TaskMessage } from "../../lib/types";
import { getMessageText } from "../../lib/utils";
import { TaskForkDialog, type TaskForkOptions } from "../tasks/TaskForkDialog";
import { MessageMetadataDialog } from "./MessageMetadataDialog";

interface MessageActionsProps {
  taskId: string;
  message: TaskMessage;
  onConversationChanged?: () => void;
  onEditRequested?: (message: TaskMessage) => void;
  threadCount?: number;
  onThreadRequested?: (message: TaskMessage) => void;
  onThreadListRequested?: (message: TaskMessage) => void;
}

export function MessageActions({
  taskId,
  message,
  onConversationChanged,
  onEditRequested,
  threadCount = 0,
  onThreadRequested,
  onThreadListRequested
}: MessageActionsProps) {
  const { api } = useWorkspaceApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [isBusy, setIsBusy] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isForking, setIsForking] = useState(false);
  const [isForkDialogOpen, setIsForkDialogOpen] = useState(false);
  const [isMetadataOpen, setIsMetadataOpen] = useState(false);

  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasThreads = threadCount > 0;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(getMessageText(message));
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, 1800);
    } catch {
      setIsCopied(true);
      setTimeout(() => {
        setIsCopied(false);
      }, 1800);
    }
  }, [message]);

  const handleForkTask = async (options: TaskForkOptions) => {
    try {
      setIsForkDialogOpen(false);
      setIsBusy(true);
      setIsForking(true);
      const res = await api.post<{ taskId: string }>(`/api/tasks/${taskId}/fork`, {
        messageId: message.id,
        copyTaskFiles: options.copyTaskFiles
      });
      const nextPath = `${location.pathname.replace(/\/tasks\/[^/]+$/, `/tasks/${res.taskId}`)}${location.search}`;
      navigate(nextPath);
    } catch (err) {
      console.error(err);
      alert("Failed to fork task");
    } finally {
      setIsForking(false);
      setIsBusy(false);
    }
  };

  const handleRetry = async () => {
    if (!confirm("Retry generation from this message? A new branch will be created.")) return;
    try {
      setIsBusy(true);
      await api.post(`/api/tasks/${taskId}/messages/${message.id}/retry`);
      onConversationChanged?.();
    } catch (err) {
      console.error(err);
      alert("Failed to retry");
    } finally {
      setIsBusy(false);
    }
  };

  const handleContinue = async () => {
    try {
      setIsBusy(true);
      await api.post(`/api/tasks/${taskId}/messages/${message.id}/continue`);
      onConversationChanged?.();
    } catch (err) {
      console.error(err);
      alert("Failed to continue");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="message-actions" role="toolbar" aria-label="Message actions">
      <button
        className={`action-btn msg-action-btn ${isCopied ? "copied" : ""}`}
        onClick={handleCopy}
        title={isCopied ? "Copied!" : "Copy"}
        data-tooltip={isCopied ? "Copied!" : "Copy message"}
        aria-label={isCopied ? "Copied" : "Copy message"}
        disabled={isBusy}
        type="button"
      >
        {isCopied ? <Check size={14} className="copy-success-icon" /> : <Copy size={14} />}
      </button>

      <button
        className="action-btn msg-action-btn"
        type="button"
        onClick={() => setIsMetadataOpen(true)}
        title="Metadata"
        data-tooltip="Message details"
        aria-label="Message details"
        disabled={isBusy}
      >
        <Info size={14} />
      </button>

      {isUser && (
        <button
          className="action-btn msg-action-btn"
          onClick={() => onEditRequested?.(message)}
          title="Edit"
          data-tooltip="Edit message"
          aria-label="Edit message"
          disabled={isBusy}
          type="button"
        >
          <Pencil size={14} />
        </button>
      )}

      {isAssistant && (
        <button
          className="action-btn msg-action-btn"
          onClick={handleContinue}
          title="Continue from here"
          data-tooltip="Continue response"
          aria-label="Continue response"
          disabled={isBusy}
          type="button"
        >
          <Play size={14} />
        </button>
      )}

      {(isUser || isAssistant) && (
        <button
          className="action-btn msg-action-btn"
          onClick={handleRetry}
          title="Retry from here"
          data-tooltip="Retry response"
          aria-label="Retry response"
          disabled={isBusy}
          type="button"
        >
          <RotateCcw size={14} />
        </button>
      )}

      {isAssistant && (onThreadRequested || onThreadListRequested) ? (
        <button
          className="action-btn msg-action-btn thread-icon-btn"
          onClick={() => {
            if (hasThreads && onThreadListRequested) {
              onThreadListRequested(message);
              return;
            }
            onThreadRequested?.(message);
          }}
          title={hasThreads ? `Open ${threadCount} thread${threadCount === 1 ? "" : "s"}` : "Start thread"}
          data-tooltip={hasThreads ? `Open ${threadCount} thread${threadCount === 1 ? "" : "s"}` : "Start thread"}
          aria-label={hasThreads ? `Open ${threadCount} threads` : "Start thread"}
          disabled={isBusy}
          type="button"
        >
          <MessageSquareMore size={14} />
          {hasThreads ? <span className="thread-icon-badge">{threadCount}</span> : null}
        </button>
      ) : null}

      <button
        className="action-btn msg-action-btn"
        onClick={() => setIsForkDialogOpen(true)}
        title={isForking ? "Forking task..." : "Fork from here"}
        data-tooltip={isForking ? "Forking task..." : "Fork branch"}
        aria-label="Fork branch"
        disabled={isBusy}
        type="button"
      >
        <GitFork size={14} />
      </button>

      {isForking ? (
        <span className="message-action-status" role="status" aria-live="polite">
          Forking task...
        </span>
      ) : null}

      {isForkDialogOpen ? (
        <TaskForkDialog
          isSubmitting={isForking}
          onCancel={() => setIsForkDialogOpen(false)}
          onConfirm={(options) => {
            void handleForkTask(options);
          }}
        />
      ) : null}

      {isMetadataOpen ? (
        <MessageMetadataDialog
          metadata={message.message_metadata_json}
          onClose={() => setIsMetadataOpen(false)}
        />
      ) : null}
    </div>
  );
}
