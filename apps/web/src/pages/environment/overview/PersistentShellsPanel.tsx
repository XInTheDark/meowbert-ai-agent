import { ChevronDown, RotateCw, Square, Terminal } from "lucide-react";
import { useState, type ReactNode } from "react";
import type { PersistentShellSessionSummary } from "../../../lib/types";
import { formatDateTime } from "../../../lib/utils";

interface PersistentShellsPanelProps {
  kicker?: string;
  title: string;
  description: string;
  items: PersistentShellSessionSummary[];
  isLoading: boolean;
  error: string | null;
  onRefresh: () => void;
  onTerminate: (sessionId: string) => Promise<void>;
  onTerminateAll: () => Promise<void>;
  emptyMessage: string;
  actions?: ReactNode;
}

function isActiveShellStatus(status: PersistentShellSessionSummary["status"]): boolean {
  return status === "starting" || status === "running" || status === "idle";
}

function ShellOutput({ output }: { output: string | null }) {
  if (!output) {
    return <div className="persistent-shell-output-empty">Waiting for output…</div>;
  }

  return <pre className="persistent-shell-output">{output}</pre>;
}

function ShellCommand({ command }: { command: string }) {
  command = command || "Idle shell";
  return (
    <details className="persistent-shell-command-details">
      <summary className="persistent-shell-command" title="Expand command">
        <Terminal size={16} aria-hidden="true" />
        <code>{command}</code>
        <ChevronDown size={14} aria-hidden="true" className="persistent-shell-command-chevron" />
      </summary>
      <pre className="persistent-shell-command-expanded">{command}</pre>
    </details>
  );
}

export function PersistentShellsPanel(props: PersistentShellsPanelProps) {
  const [terminatingSessionId, setTerminatingSessionId] = useState<string | null>(null);
  const [isTerminatingAll, setIsTerminatingAll] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const hasActiveShells = props.items.some((shell) => isActiveShellStatus(shell.status));

  async function handleTerminate(sessionId: string): Promise<void> {
    setTerminatingSessionId(sessionId);
    setActionError(null);
    try {
      await props.onTerminate(sessionId);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setTerminatingSessionId(null);
    }
  }

  async function handleTerminateAll(): Promise<void> {
    if (!window.confirm("Terminate all active shell sessions?")) return;
    setIsTerminatingAll(true);
    setActionError(null);
    try {
      await props.onTerminateAll();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setIsTerminatingAll(false);
    }
  }

  return (
    <article className="workbench-panel padded task-command-panel">
      <div className="project-command-header">
        <div className="project-command-title">
          {props.kicker ? <span className="workbench-kicker">{props.kicker}</span> : null}
          <h2>{props.title}</h2>
          <p className="muted-text persistent-shells-description">{props.description}</p>
        </div>
        <div className="workbench-actions">
          <button
            type="button"
            className="btn ghost icon-btn"
            onClick={props.onRefresh}
            disabled={props.isLoading}
            title="Refresh shell output"
            aria-label="Refresh shell output"
          >
            <RotateCw size={16} />
          </button>
          {hasActiveShells ? (
            <button
              type="button"
              className="btn ghost persistent-shells-terminate-all-btn"
              onClick={() => void handleTerminateAll()}
              disabled={props.isLoading || isTerminatingAll || terminatingSessionId !== null}
              title="Terminate all active shell sessions"
            >
              <Square size={14} />
              Terminate all shells
            </button>
          ) : null}
          {props.actions}
        </div>
      </div>

      {props.error || actionError ? <div className="error-banner">{actionError ?? props.error}</div> : null}
      {!props.isLoading && props.items.length === 0 ? (
        <div className="task-list-empty persistent-shells-empty">{props.emptyMessage}</div>
      ) : null}
      <div className="persistent-shell-list" aria-live="polite">
        {props.items.map((shell) => (
          <article className="persistent-shell-card" key={shell.id}>
            <div className="persistent-shell-card-header">
              <ShellCommand command={shell.command} />
              <div className="persistent-shell-card-status-actions">
                <span className={`persistent-shell-status persistent-shell-status-${shell.status}`}>{shell.status}</span>
                {isActiveShellStatus(shell.status) ? (
                  <button
                    type="button"
                    className="btn ghost icon-btn persistent-shell-terminate-btn"
                    onClick={() => void handleTerminate(shell.id)}
                    disabled={props.isLoading || isTerminatingAll || terminatingSessionId !== null}
                    title="Terminate shell"
                    aria-label={`Terminate shell ${shell.command}`}
                  >
                    <Square size={14} />
                  </button>
                ) : null}
              </div>
            </div>
            <div className="persistent-shell-meta">
              <span title={shell.workingDir}>{shell.workingDir}</span>
              <span>Started {shell.startedAt ? formatDateTime(shell.startedAt) : "starting"}</span>
              <span>Updated {formatDateTime(shell.updatedAt)}</span>
              {shell.expiresAt ? <span>Expires {formatDateTime(shell.expiresAt)}</span> : null}
            </div>
            <ShellOutput output={shell.output} />
          </article>
        ))}
      </div>
    </article>
  );
}
