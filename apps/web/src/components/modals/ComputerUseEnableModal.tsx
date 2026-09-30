import { useEffect } from "react";
import { RefreshCcw, X } from "lucide-react";
import type { DesktopComputerStatus } from "@meowbert/shared";
import { describeComputerUseSetup } from "../../desktop/computerUseSetup";

interface ComputerUseEnableModalProps {
  status: DesktopComputerStatus | null;
  loading: boolean;
  error: string | null;
  actionMessage: string | null;
  onClose: () => void;
  onConfirm: () => void;
  onRefresh: () => void;
  onPromptAccessibility: () => void;
  onOpenScreenRecordingSettings: () => void;
  onOpenDesktopPreferences: () => void;
}

export function ComputerUseEnableModal(props: ComputerUseEnableModalProps) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [props.onClose]);

  const setup = describeComputerUseSetup(props.status);
  const isCheckingStatus = props.loading && props.status === null && props.error === null;
  const accessibilityStatus = isCheckingStatus ? "checking" : (props.status?.permissions.accessibility ?? "unknown");
  const screenRecordingStatus = isCheckingStatus ? "checking" : (props.status?.permissions.screenRecording ?? "unknown");

  return (
    <div className="legal-overlay" onClick={props.onClose}>
      <div
        className="legal-modal computer-use-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="computer-use-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="legal-modal-header computer-use-modal-header">
          <div>
            <h2 id="computer-use-modal-title">Enable computer use?</h2>
            <p className="computer-use-modal-subtitle">Experimental desktop control</p>
          </div>
          <button className="legal-close" type="button" onClick={props.onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="legal-modal-body computer-use-modal-body">
          <section className="computer-use-callout">
            <strong>Watch the agent carefully.</strong>
            <p>
              Computer use is experimental. It can click, type, scroll, and interact with whatever is on your desktop,
              so keep an eye on it and close anything sensitive first.
            </p>
          </section>

          <section className="computer-use-status-summary">
            <div>
              <strong>{isCheckingStatus ? "Checking this desktop..." : setup.ready ? "This desktop is ready." : "This desktop still needs setup."}</strong>
              <p>{isCheckingStatus ? "Reading the current desktop status and permissions." : (setup.reason ?? "The desktop executor is connected and permissions look good.")}</p>
            </div>
            <span className={`badge ${setup.ready ? "good" : "warning"}`}>
              {isCheckingStatus ? "Checking" : setup.ready ? "Ready" : "Needs setup"}
            </span>
          </section>

          <div className="computer-use-requirements">
            <div className="computer-use-requirement">
              <div className="computer-use-requirement-copy">
                <strong>Accessibility</strong>
                <p>Status: {accessibilityStatus}</p>
              </div>
              <div className="computer-use-requirement-actions">
                <span className={`badge ${setup.missingAccessibility ? "warning" : "good"}`}>
                  {setup.missingAccessibility ? "Needed" : "Granted"}
                </span>
                {setup.missingAccessibility ? (
                  <button className="btn ghost" type="button" onClick={props.onPromptAccessibility} disabled={props.loading}>
                    Prompt
                  </button>
                ) : null}
              </div>
            </div>

            <div className="computer-use-requirement">
              <div className="computer-use-requirement-copy">
                <strong>Screen Recording</strong>
                <p>Status: {screenRecordingStatus}</p>
              </div>
              <div className="computer-use-requirement-actions">
                <span className={`badge ${setup.missingScreenRecording ? "warning" : "good"}`}>
                  {setup.missingScreenRecording ? "Needed" : "Granted"}
                </span>
                {setup.missingScreenRecording ? (
                  <button className="btn ghost" type="button" onClick={props.onOpenScreenRecordingSettings} disabled={props.loading}>
                    Open Settings
                  </button>
                ) : null}
              </div>
            </div>

            {!setup.executorAvailable ? (
              <div className="computer-use-requirement">
                <div className="computer-use-requirement-copy">
                  <strong>Desktop executor</strong>
                  <p>Sign in through Meowbert Desktop on this machine, then refresh this check.</p>
                </div>
                <div className="computer-use-requirement-actions">
                  <span className="badge warning">Offline</span>
                </div>
              </div>
            ) : null}
          </div>

          <div className="computer-use-actions-row">
            <button className="btn ghost" type="button" onClick={props.onRefresh} disabled={props.loading}>
              <RefreshCcw size={16} className={props.loading ? "spin-icon" : undefined} />
              Refresh status
            </button>
            <button className="btn ghost" type="button" onClick={props.onOpenDesktopPreferences}>
              Open Desktop Preferences
            </button>
          </div>

          {props.actionMessage ? <p className="computer-use-helper-text">{props.actionMessage}</p> : null}
          {props.error ? <p className="error-text computer-use-helper-text">{props.error}</p> : null}
        </div>

        <div className="computer-use-modal-footer">
          <button className="btn ghost" type="button" onClick={props.onClose}>
            Not now
          </button>
          <button
            className="btn primary"
            type="button"
            onClick={props.onConfirm}
            disabled={isCheckingStatus}
          >
            Enable computer use
          </button>
        </div>
      </div>
    </div>
  );
}
